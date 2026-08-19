import * as THREE from 'three';
import { getChildren } from '../core/document';
import type { BooleanOperation, MeshData, MeshNode, NodeId, SceneDocument } from '../core/types';
import { inspectMeshDataInvariants, getMeshTopologyDiagnostics } from './topology';
import { getNodeWorldMatrix } from './world-bounds';

export interface BooleanSpikeResult {
  elapsedMs: number;
  mesh: MeshData;
  triangleCount: number;
}

interface ManifoldMesh {
  triVerts: Uint32Array;
  vertProperties: Float32Array;
}

interface ManifoldValue {
  add(other: ManifoldValue): ManifoldValue;
  delete(): void;
  getMesh(): ManifoldMesh;
  intersect(other: ManifoldValue): ManifoldValue;
  subtract(other: ManifoldValue): ManifoldValue;
}

interface ManifoldApi {
  Manifold: {
    ofMesh(mesh: unknown): ManifoldValue;
  };
  Mesh: new (options: { numProp: number; triVerts: Uint32Array; vertProperties: Float32Array }) => unknown;
  setup(): void;
}

let manifoldApiPromise: Promise<ManifoldApi> | null = null;

async function loadManifold(): Promise<ManifoldApi> {
  manifoldApiPromise ??= (async () => {
    const module = (await import('manifold-3d')) as unknown as {
      default: () => Promise<ManifoldApi>;
    };
    const api = await module.default();
    api.setup();
    return api;
  })();
  return manifoldApiPromise;
}

function assertClosedManifoldInput(mesh: MeshData, label: string): void {
  const invariant = inspectMeshDataInvariants(mesh);
  const topology = getMeshTopologyDiagnostics(mesh);
  if (
    Object.keys(mesh.faces).length === 0 ||
    invariant.danglingVertexReferenceFaceIds.length > 0 ||
    invariant.degenerateFaceIds.length > 0 ||
    invariant.inconsistentFaceIds.length > 0 ||
    invariant.invalidVertexIds.length > 0 ||
    invariant.nonFiniteVertexIds.length > 0 ||
    topology.boundaryEdgeIds.length > 0 ||
    topology.nonManifoldEdgeIds.length > 0
  ) {
    throw new Error(
      `Boolean ${label} must be a closed, consistently wound manifold mesh; repair it before Boolean.`,
    );
  }
}

function toManifoldInput(api: ManifoldApi, mesh: MeshData): ManifoldValue {
  const vertexIds = Object.keys(mesh.vertices);
  const indexByVertexId = new Map(vertexIds.map((vertexId, index) => [vertexId, index]));
  const vertProperties = new Float32Array(
    vertexIds.flatMap((vertexId) => {
      const position = mesh.vertices[vertexId]!.position;
      return [position.x, position.y, position.z];
    }),
  );
  const triVerts: number[] = [];
  Object.values(mesh.faces).forEach((face) => {
    const indexes = face.vertexIds.map((vertexId) => indexByVertexId.get(vertexId)!);
    for (let corner = 1; corner < indexes.length - 1; corner += 1) {
      triVerts.push(indexes[0]!, indexes[corner]!, indexes[corner + 1]!);
    }
  });
  return api.Manifold.ofMesh(
    new api.Mesh({ numProp: 3, triVerts: new Uint32Array(triVerts), vertProperties }),
  );
}

function fromManifoldOutput(output: ManifoldMesh, materialId: string): MeshData {
  if (output.triVerts.length === 0 || output.vertProperties.length < 3) {
    throw new Error('Boolean produced an empty mesh. The source geometry was preserved.');
  }
  const vertexCount = output.vertProperties.length / 3;
  if (!Number.isInteger(vertexCount)) {
    throw new Error('Boolean returned an invalid vertex property buffer.');
  }
  const vertices = Object.fromEntries(
    Array.from({ length: vertexCount }, (_, index) => {
      const id = `boolean-vertex-${index + 1}`;
      const offset = index * 3;
      return [
        id,
        {
          id,
          position: {
            x: output.vertProperties[offset]!,
            y: output.vertProperties[offset + 1]!,
            z: output.vertProperties[offset + 2]!,
          },
        },
      ];
    }),
  );
  if (output.triVerts.length % 3 !== 0) {
    throw new Error('Boolean returned an incomplete triangle buffer.');
  }
  const faces = Object.fromEntries(
    Array.from({ length: output.triVerts.length / 3 }, (_, index) => {
      const id = `boolean-face-${index + 1}`;
      const offset = index * 3;
      return [
        id,
        {
          id,
          materialId,
          vertexIds: [
            `boolean-vertex-${output.triVerts[offset]! + 1}`,
            `boolean-vertex-${output.triVerts[offset + 1]! + 1}`,
            `boolean-vertex-${output.triVerts[offset + 2]! + 1}`,
          ],
        },
      ];
    }),
  );
  const mesh = { vertices, faces };
  const invariant = inspectMeshDataInvariants(mesh);
  if (Object.values(invariant).some((value) => value.length > 0)) {
    throw new Error('Boolean produced invalid editable geometry. The source geometry was preserved.');
  }
  return mesh;
}

/**
 * Phase-5 spike: robust WASM Boolean on closed manifold meshes. The caller owns
 * committing the returned mesh, so failure cannot mutate source SceneDocument data.
 */
export async function runBooleanSpike(
  operation: BooleanOperation,
  subject: MeshData,
  cutter: MeshData,
  materialId = 'material-1',
): Promise<BooleanSpikeResult> {
  assertClosedManifoldInput(subject, 'subject');
  assertClosedManifoldInput(cutter, 'cutter');
  const api = await loadManifold();
  const startedAt = performance.now();
  const subjectManifold = toManifoldInput(api, subject);
  const cutterManifold = toManifoldInput(api, cutter);
  let result: ManifoldValue | null = null;
  try {
    result =
      operation === 'difference'
        ? subjectManifold.subtract(cutterManifold)
        : operation === 'intersection'
          ? subjectManifold.intersect(cutterManifold)
          : subjectManifold.add(cutterManifold);
    const mesh = fromManifoldOutput(result.getMesh(), materialId);
    return { elapsedMs: performance.now() - startedAt, mesh, triangleCount: Object.keys(mesh.faces).length };
  } finally {
    result?.delete();
    cutterManifold.delete();
    subjectManifold.delete();
  }
}

function transformMeshIntoSubjectSpace(
  mesh: MeshData,
  matrix: NonNullable<ReturnType<typeof getNodeWorldMatrix>>,
): MeshData {
  const reversesWinding = matrix.determinant() < 0;
  return {
    vertices: Object.fromEntries(
      Object.entries(mesh.vertices).map(([vertexId, vertex]) => {
        const position = new THREE.Vector3(
          vertex.position.x,
          vertex.position.y,
          vertex.position.z,
        ).applyMatrix4(matrix);
        return [vertexId, { ...vertex, position: { x: position.x, y: position.y, z: position.z } }];
      }),
    ),
    faces: Object.fromEntries(
      Object.entries(mesh.faces).map(([faceId, face]) => [
        faceId,
        { ...face, vertexIds: reversesWinding ? [...face.vertexIds].reverse() : [...face.vertexIds] },
      ]),
    ),
  };
}

function isMeshNode(value: SceneDocument['nodes'][NodeId] | undefined): value is MeshNode {
  return value?.type === 'mesh';
}

/** Returns a user-facing reason when a selected pair is unsafe for Boolean. */
export function getBooleanNodeEligibility(
  document: SceneDocument,
  subjectNodeId: NodeId | undefined,
  cutterNodeId: NodeId | undefined,
): string | null {
  if (!subjectNodeId || !cutterNodeId || subjectNodeId === cutterNodeId) {
    return 'Select exactly two different meshes: subject first, then cutter.';
  }
  const subject = document.nodes[subjectNodeId];
  const cutter = document.nodes[cutterNodeId];
  if (!isMeshNode(subject) || !isMeshNode(cutter)) {
    return 'Boolean requires two mesh objects.';
  }
  if (subject.mirrorModifier || cutter.mirrorModifier) {
    return 'Bake or disable Live Mirror on both Boolean inputs first.';
  }
  if (getChildren(document, cutter.id).length > 0) {
    return 'The cutter cannot own children because commit removes the cutter object.';
  }
  const subjectWorld = getNodeWorldMatrix(document, subject.id);
  const cutterWorld = getNodeWorldMatrix(document, cutter.id);
  if (
    !subjectWorld ||
    !cutterWorld ||
    Math.abs(subjectWorld.determinant()) < 1e-10 ||
    ![...subjectWorld.elements, ...cutterWorld.elements].every(Number.isFinite)
  ) {
    return 'Boolean requires finite, non-zero world transforms.';
  }
  return null;
}

/**
 * Runs a Boolean with the cutter transformed into subject-local coordinates.
 * The result can therefore replace subject.mesh without changing its transform.
 */
export async function runNodeBooleanSpike(
  document: SceneDocument,
  operation: BooleanOperation,
  subjectNodeId: NodeId,
  cutterNodeId: NodeId,
): Promise<BooleanSpikeResult> {
  const reason = getBooleanNodeEligibility(document, subjectNodeId, cutterNodeId);
  if (reason) {
    throw new Error(reason);
  }
  const subject = document.nodes[subjectNodeId] as MeshNode;
  const cutter = document.nodes[cutterNodeId] as MeshNode;
  const subjectWorld = getNodeWorldMatrix(document, subject.id)!;
  const cutterWorld = getNodeWorldMatrix(document, cutter.id)!;
  const cutterInSubjectSpace = transformMeshIntoSubjectSpace(
    cutter.mesh,
    subjectWorld.clone().invert().multiply(cutterWorld),
  );
  const materialId = Object.values(subject.mesh.faces)[0]?.materialId ?? 'material-1';
  return runBooleanSpike(operation, subject.mesh, cutterInSubjectSpace, materialId);
}
