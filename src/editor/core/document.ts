import * as THREE from 'three';
import {
  cloneDocument,
  cloneMeshData,
  cloneTransform,
  DEFAULT_MATERIAL,
  DEFAULT_TRANSFORM,
  type EditorNode,
  type GroupNode,
  type MaterialData,
  type MaterialId,
  type MeshData,
  type MirrorModifier,
  type MeshNode,
  type NodeId,
  type PrimitiveKind,
  type PrimitiveOptions,
  ROOT_NODE_ID,
  type SceneDocument,
  type TextureData,
  type Transform,
  type Vec3,
} from './types';
import { createPrimitiveMesh } from '../geometry/mesh-data';
import {
  applyMeshScale,
  generateAutoUvMesh,
  bendMeshGeometry,
  bevelMeshEdge,
  colorMeshFaces,
  deleteMeshEdges,
  deleteDegenerateMeshFaces,
  dissolveMeshEdges,
  extrudeMeshFaces,
  insetMeshFaces,
  loopCutMesh,
  mergeMeshVertices,
  mergeMeshVerticesByDistance,
  mergeMeshVertexGroups,
  mirrorMeshGeometry,
  recalculateMeshNormals,
  resizeMeshGeometry,
  subdivideMeshEdges,
  transformMeshVertices,
  transformMeshVerticesInSpace,
} from '../geometry/mesh-operations';
import type { BendAxis, MeshElementTransform } from '../geometry/mesh-operations';
import { getGroundTranslationInParentSpace, getNodeWorldMatrix } from '../geometry/world-bounds';

export type GeometryTransformOrientation = 'local' | 'world';

function nextId(document: SceneDocument, prefix: string): NodeId {
  let index = 1;
  while (document.nodes[`${prefix}-${index}`]) {
    index += 1;
  }
  return `${prefix}-${index}`;
}

function defaultPrimitiveName(kind: PrimitiveKind): string {
  return {
    cube: 'Cube',
    plane: 'Plane',
    cylinder: 'Cylinder',
    cone: 'Cone',
    sphere: 'Sphere',
    icosphere: 'Icosphere',
  }[kind];
}

function bumpRevision(document: SceneDocument, nodes: SceneDocument['nodes']): SceneDocument {
  return { ...document, revision: document.revision + 1, nodes };
}

function transformsMatch(left: Transform, right: Transform): boolean {
  return (
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.position.z === right.position.z &&
    left.rotation.x === right.rotation.x &&
    left.rotation.y === right.rotation.y &&
    left.rotation.z === right.rotation.z &&
    left.scale.x === right.scale.x &&
    left.scale.y === right.scale.y &&
    left.scale.z === right.scale.z
  );
}

export function createEmptyDocument(): SceneDocument {
  return {
    metadata: { forwardConfirmed: false, groundReferenceY: 0, groundContactTolerance: 0.001 },
    version: 1,
    revision: 0,
    rootId: ROOT_NODE_ID,
    nodes: {
      [ROOT_NODE_ID]: {
        id: ROOT_NODE_ID,
        name: 'asset_root',
        parentId: null,
        hidden: false,
        transform: cloneTransform(DEFAULT_TRANSFORM),
        type: 'group',
      },
    },
    materials: {
      [DEFAULT_MATERIAL.id]: { ...DEFAULT_MATERIAL },
    },
    textures: {},
  };
}

export function getNode(document: SceneDocument, nodeId: NodeId): EditorNode | undefined {
  return document.nodes[nodeId];
}

export function getChildren(document: SceneDocument, parentId: NodeId): EditorNode[] {
  return Object.values(document.nodes).filter((node) => node.parentId === parentId);
}

export function createPrimitiveNode(
  document: SceneDocument,
  primitive: PrimitiveKind,
  parentId = document.rootId,
  options: PrimitiveOptions = {},
): MeshNode {
  if (!document.nodes[parentId]) {
    throw new Error(`Cannot add a primitive to missing parent "${parentId}".`);
  }

  return {
    id: nextId(document, 'mesh'),
    name: defaultPrimitiveName(primitive),
    parentId,
    hidden: false,
    transform: cloneTransform(DEFAULT_TRANSFORM),
    type: 'mesh',
    mesh: createPrimitiveMesh(primitive, DEFAULT_MATERIAL.id, options),
  };
}

export function createGroupNode(
  document: SceneDocument,
  name = 'Pivot',
  parentId = document.rootId,
): GroupNode {
  if (!document.nodes[parentId]) {
    throw new Error(`Cannot add a pivot to missing parent "${parentId}".`);
  }
  return {
    id: nextId(document, 'group'),
    name,
    parentId,
    hidden: false,
    transform: cloneTransform(DEFAULT_TRANSFORM),
    type: 'group',
  };
}

export function insertNode(document: SceneDocument, node: EditorNode): SceneDocument {
  if (document.nodes[node.id]) {
    throw new Error(`A node with id "${node.id}" already exists.`);
  }
  if (node.parentId && !document.nodes[node.parentId]) {
    throw new Error(`Cannot insert "${node.id}" under missing parent "${node.parentId}".`);
  }

  return bumpRevision(document, {
    ...document.nodes,
    [node.id]: { ...node, transform: cloneTransform(node.transform) },
  });
}

export function updateNodeTransform(
  document: SceneDocument,
  nodeId: NodeId,
  transform: Transform,
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || transformsMatch(node.transform, transform)) {
    return document;
  }

  return bumpRevision(document, {
    ...document.nodes,
    [nodeId]: { ...node, transform: cloneTransform(transform) },
  });
}

export function updateMeshVertexPosition(
  document: SceneDocument,
  nodeId: NodeId,
  vertexId: string,
  position: { x: number; y: number; z: number },
): SceneDocument {
  const node = document.nodes[nodeId];
  const vertex = node?.type === 'mesh' ? node.mesh.vertices[vertexId] : undefined;
  if (
    !node ||
    node.type !== 'mesh' ||
    !vertex ||
    ![position.x, position.y, position.z].every(Number.isFinite)
  ) {
    return document;
  }
  if (
    vertex.position.x === position.x &&
    vertex.position.y === position.y &&
    vertex.position.z === position.z
  ) {
    return document;
  }
  return bumpRevision(document, {
    ...document.nodes,
    [nodeId]: {
      ...node,
      mesh: {
        ...node.mesh,
        vertices: { ...node.mesh.vertices, [vertexId]: { ...vertex, position: { ...position } } },
      },
    },
  });
}

export function deleteMeshFaces(document: SceneDocument, nodeId: NodeId, faceIds: string[]): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const idsToDelete = new Set(faceIds.filter((faceId) => Boolean(node.mesh.faces[faceId])));
  if (idsToDelete.size === 0) {
    return document;
  }
  const faces = Object.fromEntries(
    Object.entries(node.mesh.faces).filter(([faceId]) => !idsToDelete.has(faceId)),
  );
  return bumpRevision(document, {
    ...document.nodes,
    [nodeId]: { ...node, mesh: { ...node.mesh, faces } },
  });
}

export function deleteNodeEdges(document: SceneDocument, nodeId: NodeId, edgeIds: string[]): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = deleteMeshEdges(node.mesh, edgeIds);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function deleteNodeDegenerateFaces(document: SceneDocument, nodeId: NodeId): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = deleteDegenerateMeshFaces(node.mesh);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function recalculateNodeNormals(document: SceneDocument, nodeId: NodeId): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = recalculateMeshNormals(node.mesh);
  if (JSON.stringify(mesh) === JSON.stringify(node.mesh)) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function dissolveNodeEdges(document: SceneDocument, nodeId: NodeId, edgeIds: string[]): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = dissolveMeshEdges(node.mesh, edgeIds);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function deleteMeshVertices(
  document: SceneDocument,
  nodeId: NodeId,
  vertexIds: string[],
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const idsToDelete = new Set(vertexIds.filter((vertexId) => Boolean(node.mesh.vertices[vertexId])));
  if (idsToDelete.size === 0) {
    return document;
  }
  const vertices = Object.fromEntries(
    Object.entries(node.mesh.vertices).filter(([vertexId]) => !idsToDelete.has(vertexId)),
  );
  const faces = Object.fromEntries(
    Object.entries(node.mesh.faces).filter(([, face]) =>
      face.vertexIds.every((vertexId) => !idsToDelete.has(vertexId)),
    ),
  );
  return bumpRevision(document, {
    ...document.nodes,
    [nodeId]: { ...node, mesh: { vertices, faces } },
  });
}

export function flipMeshFaces(document: SceneDocument, nodeId: NodeId, faceIds: string[]): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const idsToFlip = new Set(faceIds.filter((faceId) => Boolean(node.mesh.faces[faceId])));
  if (idsToFlip.size === 0) {
    return document;
  }
  const faces = Object.fromEntries(
    Object.entries(node.mesh.faces).map(([faceId, face]) => [
      faceId,
      idsToFlip.has(faceId) ? { ...face, vertexIds: [...face.vertexIds].reverse() } : face,
    ]),
  );
  const vertices = Object.fromEntries(
    Object.entries(node.mesh.vertices).map(([vertexId, vertex]) => [
      vertexId,
      { ...vertex, normal: undefined },
    ]),
  );
  return bumpRevision(document, {
    ...document.nodes,
    [nodeId]: { ...node, mesh: { vertices, faces } },
  });
}

export function extrudeNodeFaces(
  document: SceneDocument,
  nodeId: NodeId,
  faceIds: string[],
  distance: number,
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = extrudeMeshFaces(node.mesh, faceIds, distance);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function insetNodeFaces(
  document: SceneDocument,
  nodeId: NodeId,
  faceIds: string[],
  factor: number,
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = insetMeshFaces(node.mesh, faceIds, factor);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function colorNodeFaces(
  document: SceneDocument,
  nodeId: NodeId,
  faceIds: string[],
  hexColor: string,
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = colorMeshFaces(node.mesh, faceIds, hexColor);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function subdivideNodeEdges(
  document: SceneDocument,
  nodeId: NodeId,
  edgeIds: string[],
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = subdivideMeshEdges(node.mesh, edgeIds);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function loopCutNodeEdge(
  document: SceneDocument,
  nodeId: NodeId,
  edgeId: string,
  factor: number,
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = loopCutMesh(node.mesh, edgeId, factor);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function bevelNodeEdge(
  document: SceneDocument,
  nodeId: NodeId,
  edgeId: string,
  width: number,
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = bevelMeshEdge(node.mesh, edgeId, width);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function bendNodeGeometry(
  document: SceneDocument,
  nodeId: NodeId,
  axis: BendAxis,
  angleRadians: number,
  origin: Vec3,
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = bendMeshGeometry(node.mesh, axis, angleRadians, origin);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function transformNodeGeometry(
  document: SceneDocument,
  nodeId: NodeId,
  vertexIds: string[],
  transform: MeshElementTransform,
  orientation: GeometryTransformOrientation = 'local',
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const worldMatrix = orientation === 'world' ? getNodeWorldMatrix(document, nodeId) : null;
  if (orientation === 'world' && (!worldMatrix || worldMatrix.determinant() === 0)) {
    return document;
  }
  const inverseWorldMatrix = worldMatrix?.clone().invert();
  const mesh =
    worldMatrix && inverseWorldMatrix
      ? transformMeshVerticesInSpace(
          node.mesh,
          vertexIds,
          transform,
          (position) => {
            const point = new THREE.Vector3(position.x, position.y, position.z).applyMatrix4(worldMatrix);
            return { x: point.x, y: point.y, z: point.z };
          },
          (position) => {
            const point = new THREE.Vector3(position.x, position.y, position.z).applyMatrix4(
              inverseWorldMatrix,
            );
            return { x: point.x, y: point.y, z: point.z };
          },
        )
      : transformMeshVertices(node.mesh, vertexIds, transform);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function mirrorNodeGeometry(
  document: SceneDocument,
  nodeId: NodeId,
  axis: BendAxis,
  seamTolerance: number,
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = mirrorMeshGeometry(node.mesh, axis, seamTolerance);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function setNodeMirrorModifier(
  document: SceneDocument,
  nodeId: NodeId,
  modifier: MirrorModifier | null,
): SceneDocument {
  const node = document.nodes[nodeId];
  if (
    !node ||
    node.type !== 'mesh' ||
    (modifier !== null &&
      (!['x', 'y', 'z'].includes(modifier.axis) ||
        !Number.isFinite(modifier.seamTolerance) ||
        modifier.seamTolerance < 0))
  ) {
    return document;
  }
  if (
    node.mirrorModifier?.axis === modifier?.axis &&
    node.mirrorModifier?.seamTolerance === modifier?.seamTolerance
  ) {
    return document;
  }
  return bumpRevision(document, {
    ...document.nodes,
    [nodeId]: { ...node, mirrorModifier: modifier ? { ...modifier } : undefined },
  });
}

export function bakeNodeMirrorModifier(document: SceneDocument, nodeId: NodeId): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh' || !node.mirrorModifier) {
    return document;
  }
  return bumpRevision(document, {
    ...document.nodes,
    [nodeId]: {
      ...node,
      mesh: mirrorMeshGeometry(node.mesh, node.mirrorModifier.axis, node.mirrorModifier.seamTolerance),
      mirrorModifier: undefined,
    },
  });
}

/** Creates the GLB-ready document while leaving the editable live modifiers untouched. */
export function bakeMirrorModifiersForExport(document: SceneDocument): SceneDocument {
  return Object.values(document.nodes)
    .filter((node): node is MeshNode => node.type === 'mesh' && Boolean(node.mirrorModifier))
    .reduce((baked, node) => bakeNodeMirrorModifier(baked, node.id), document);
}

export function mergeNodeVertices(
  document: SceneDocument,
  nodeId: NodeId,
  vertexIds: string[],
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = mergeMeshVertices(node.mesh, vertexIds);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function mergeNodeVertexGroups(
  document: SceneDocument,
  nodeId: NodeId,
  vertexGroups: string[][],
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = mergeMeshVertexGroups(node.mesh, vertexGroups);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function mergeNodeVerticesByDistance(
  document: SceneDocument,
  nodeId: NodeId,
  vertexIds: string[],
  distance: number,
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = mergeMeshVerticesByDistance(node.mesh, vertexIds, distance);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

/**
 * Moves a proper subset of a mesh's faces into a sibling mesh node. Both mesh
 * nodes retain the source local transform and material references, so their
 * world-space result is unchanged while loose geometry becomes manageable.
 */
export function separateNodeFaces(document: SceneDocument, nodeId: NodeId, faceIds: string[]): SceneDocument {
  const node = document.nodes[nodeId];
  const selectedFaceIds = new Set(
    faceIds.filter((faceId) => Boolean(node?.type === 'mesh' && node.mesh.faces[faceId])),
  );
  if (
    !node ||
    node.type !== 'mesh' ||
    selectedFaceIds.size === 0 ||
    selectedFaceIds.size === Object.keys(node.mesh.faces).length
  ) {
    return document;
  }
  const separatedFaces = Object.fromEntries(
    Object.entries(node.mesh.faces).filter(([faceId]) => selectedFaceIds.has(faceId)),
  );
  const remainingFaces = Object.fromEntries(
    Object.entries(node.mesh.faces).filter(([faceId]) => !selectedFaceIds.has(faceId)),
  );
  const verticesFor = (faces: typeof node.mesh.faces): typeof node.mesh.vertices => {
    const vertexIds = new Set(Object.values(faces).flatMap((face) => face.vertexIds));
    return Object.fromEntries(
      Object.entries(node.mesh.vertices)
        .filter(([vertexId]) => vertexIds.has(vertexId))
        .map(([vertexId, vertex]) => [
          vertexId,
          {
            ...vertex,
            position: { ...vertex.position },
            normal: vertex.normal ? { ...vertex.normal } : undefined,
            tangent: vertex.tangent ? { ...vertex.tangent } : undefined,
            uv: vertex.uv ? { ...vertex.uv } : undefined,
            color: vertex.color ? { ...vertex.color } : undefined,
          },
        ]),
    );
  };
  const separatedNodeId = nextId(document, 'mesh');
  const separatedNode: MeshNode = {
    id: separatedNodeId,
    name: `${node.name}_part`,
    parentId: node.parentId,
    hidden: false,
    transform: cloneTransform(node.transform),
    type: 'mesh',
    mesh: { vertices: verticesFor(separatedFaces), faces: separatedFaces },
  };
  return bumpRevision(document, {
    ...document.nodes,
    [nodeId]: { ...node, mesh: { vertices: verticesFor(remainingFaces), faces: remainingFaces } },
    [separatedNodeId]: separatedNode,
  });
}

export function renameNode(document: SceneDocument, nodeId: NodeId, name: string): SceneDocument {
  const node = document.nodes[nodeId];
  const trimmedName = name.trim();
  if (!node || !trimmedName || node.name === trimmedName) {
    return document;
  }

  return bumpRevision(document, {
    ...document.nodes,
    [nodeId]: { ...node, name: trimmedName },
  });
}

export function setForwardConfirmed(document: SceneDocument, forwardConfirmed: boolean): SceneDocument {
  if (document.metadata.forwardConfirmed === forwardConfirmed) {
    return document;
  }
  return {
    ...document,
    revision: document.revision + 1,
    metadata: { ...document.metadata, forwardConfirmed },
  };
}

export function setGroundReference(document: SceneDocument, groundReferenceY: number): SceneDocument {
  if (!Number.isFinite(groundReferenceY) || document.metadata.groundReferenceY === groundReferenceY) {
    return document;
  }
  return {
    ...document,
    revision: document.revision + 1,
    metadata: { ...document.metadata, groundReferenceY },
  };
}

export function setGroundContactTolerance(
  document: SceneDocument,
  groundContactTolerance: number,
): SceneDocument {
  if (
    !Number.isFinite(groundContactTolerance) ||
    groundContactTolerance < 0 ||
    document.metadata.groundContactTolerance === groundContactTolerance
  ) {
    return document;
  }
  return {
    ...document,
    revision: document.revision + 1,
    metadata: { ...document.metadata, groundContactTolerance },
  };
}

export function updateMaterialProperties(
  document: SceneDocument,
  materialId: MaterialId,
  patch: Partial<Pick<MaterialData, 'baseColor' | 'flatShading' | 'metalness' | 'opacity' | 'roughness'>>,
): SceneDocument {
  const material = document.materials[materialId];
  if (!material) {
    return document;
  }
  const clampMaterialValue = (value: number | undefined, fallback: number): number =>
    value === undefined || !Number.isFinite(value) ? fallback : Math.min(1, Math.max(0, value));
  const baseColor =
    typeof patch.baseColor === 'string' && /^#[0-9a-f]{6}$/i.test(patch.baseColor)
      ? patch.baseColor
      : material.baseColor;
  const nextMaterial: MaterialData = {
    ...material,
    baseColor,
    roughness: clampMaterialValue(patch.roughness, material.roughness),
    metalness: clampMaterialValue(patch.metalness, material.metalness),
    opacity: clampMaterialValue(patch.opacity, material.opacity),
    flatShading: patch.flatShading ?? material.flatShading,
  };
  if (JSON.stringify(nextMaterial) === JSON.stringify(material)) {
    return document;
  }
  return {
    ...document,
    revision: document.revision + 1,
    materials: { ...document.materials, [materialId]: nextMaterial },
  };
}

/** Replaces a material's local texture payload without retaining stale binary data. */
export function setMaterialTexture(
  document: SceneDocument,
  materialId: MaterialId,
  texture: TextureData | null,
): SceneDocument {
  const material = document.materials[materialId];
  if (!material) {
    return document;
  }
  const currentTextureId = material.baseColorTextureId;
  const canRemoveCurrentTexture =
    Boolean(currentTextureId) &&
    !Object.entries(document.materials).some(
      ([candidateId, candidate]) =>
        candidateId !== materialId && candidate.baseColorTextureId === currentTextureId,
    );
  if (texture === null) {
    if (!currentTextureId) {
      return document;
    }
    const textures = { ...document.textures };
    if (canRemoveCurrentTexture) {
      delete textures[currentTextureId];
    }
    return {
      ...document,
      revision: document.revision + 1,
      materials: { ...document.materials, [materialId]: { ...material, baseColorTextureId: undefined } },
      textures,
    };
  }
  if (
    texture.id === currentTextureId &&
    document.textures[texture.id]?.dataUrl === texture.dataUrl &&
    document.textures[texture.id]?.name === texture.name
  ) {
    return document;
  }
  const remainingTextures = { ...document.textures };
  if (currentTextureId && currentTextureId !== texture.id && canRemoveCurrentTexture) {
    delete remainingTextures[currentTextureId];
  }
  return {
    ...document,
    revision: document.revision + 1,
    materials: { ...document.materials, [materialId]: { ...material, baseColorTextureId: texture.id } },
    textures: { ...remainingTextures, [texture.id]: { ...texture } },
  };
}

export function setNodeHidden(document: SceneDocument, nodeId: NodeId, hidden: boolean): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.hidden === hidden) {
    return document;
  }

  return bumpRevision(document, {
    ...document.nodes,
    [nodeId]: { ...node, hidden },
  });
}

export function resizeNodeGeometry(
  document: SceneDocument,
  nodeId: NodeId,
  targetSize: { x: number; y: number; z: number },
): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const scaleBakedMesh = applyMeshScale(node.mesh, node.transform.scale);
  const hasUnitScale =
    node.transform.scale.x === 1 && node.transform.scale.y === 1 && node.transform.scale.z === 1;
  if (scaleBakedMesh === node.mesh && !hasUnitScale) {
    return document;
  }
  const mesh = resizeMeshGeometry(scaleBakedMesh, targetSize);
  const transform = { ...node.transform, scale: { x: 1, y: 1, z: 1 } };
  if (mesh === node.mesh && transformsMatch(node.transform, transform)) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh, transform } });
}

export function applyNodeScale(document: SceneDocument, nodeId: NodeId): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = applyMeshScale(node.mesh, node.transform.scale);
  if (mesh === node.mesh) {
    return document;
  }
  const transform = { ...node.transform, scale: { x: 1, y: 1, z: 1 } };
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh, transform } });
}

export function autoUvNodeGeometry(document: SceneDocument, nodeId: NodeId): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || node.type !== 'mesh') {
    return document;
  }
  const mesh = generateAutoUvMesh(node.mesh);
  if (mesh === node.mesh) {
    return document;
  }
  return bumpRevision(document, { ...document.nodes, [nodeId]: { ...node, mesh } });
}

export function moveNodeToGround(
  document: SceneDocument,
  nodeId: NodeId,
  groundReferenceY = document.metadata.groundReferenceY,
): SceneDocument {
  const node = document.nodes[nodeId];
  const localTranslation = getGroundTranslationInParentSpace(document, nodeId, groundReferenceY);
  if (!node || !localTranslation) {
    return document;
  }
  const transform = {
    ...node.transform,
    position: {
      x: node.transform.position.x + localTranslation.x,
      y: node.transform.position.y + localTranslation.y,
      z: node.transform.position.z + localTranslation.z,
    },
  };
  return updateNodeTransform(document, nodeId, transform);
}

function descendantIds(document: SceneDocument, nodeId: NodeId): NodeId[] {
  return getChildren(document, nodeId).flatMap((child) => [child.id, ...descendantIds(document, child.id)]);
}

export function removeNode(document: SceneDocument, nodeId: NodeId): SceneDocument {
  if (nodeId === document.rootId || !document.nodes[nodeId]) {
    return document;
  }

  const nextNodes = { ...document.nodes };
  for (const id of [nodeId, ...descendantIds(document, nodeId)]) {
    delete nextNodes[id];
  }
  return bumpRevision(document, nextNodes);
}

/** Applies a previously previewed Boolean result atomically, then removes its cutter. */
export function commitBooleanMesh(
  document: SceneDocument,
  subjectNodeId: NodeId,
  cutterNodeId: NodeId,
  mesh: MeshData,
): SceneDocument {
  const subject = document.nodes[subjectNodeId];
  const cutter = document.nodes[cutterNodeId];
  if (
    subjectNodeId === cutterNodeId ||
    subject?.type !== 'mesh' ||
    cutter?.type !== 'mesh' ||
    getChildren(document, cutterNodeId).length > 0
  ) {
    return document;
  }
  const withResult = bumpRevision(document, {
    ...document.nodes,
    [subjectNodeId]: { ...subject, mesh: cloneMeshData(mesh), mirrorModifier: undefined },
  });
  return removeNode(withResult, cutterNodeId);
}

export function setNodeParent(document: SceneDocument, nodeId: NodeId, parentId: NodeId): SceneDocument {
  const node = document.nodes[nodeId];
  if (!node || nodeId === document.rootId || !document.nodes[parentId] || node.parentId === parentId) {
    return document;
  }
  if (descendantIds(document, nodeId).includes(parentId)) {
    throw new Error('Cannot parent a node under one of its descendants.');
  }

  return bumpRevision(document, {
    ...document.nodes,
    [nodeId]: { ...node, parentId },
  });
}

export function documentChecksum(document: SceneDocument): string {
  return JSON.stringify(cloneDocument(document));
}
