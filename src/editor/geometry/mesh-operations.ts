import type { MeshData, MeshFace, MeshTangent, MeshVertex, MirrorModifier, Vec3 } from '../core/types';
import { edgeId, getMeshEdges } from './topology';

export interface MeshBounds {
  center: Vec3;
  max: Vec3;
  min: Vec3;
  size: Vec3;
}

export type BendAxis = 'x' | 'y' | 'z';

/** Local-space transform applied to a selected set of editable vertices. */
export interface MeshElementTransform {
  translation: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export function getMeshBounds(mesh: MeshData): MeshBounds | null {
  const vertices = Object.values(mesh.vertices);
  if (vertices.length === 0) {
    return null;
  }
  const min = { ...vertices[0].position };
  const max = { ...vertices[0].position };
  vertices.slice(1).forEach(({ position }) => {
    min.x = Math.min(min.x, position.x);
    min.y = Math.min(min.y, position.y);
    min.z = Math.min(min.z, position.z);
    max.x = Math.max(max.x, position.x);
    max.y = Math.max(max.y, position.y);
    max.z = Math.max(max.z, position.z);
  });
  const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
  return {
    min,
    max,
    size,
    center: { x: min.x + size.x / 2, y: min.y + size.y / 2, z: min.z + size.z / 2 },
  };
}

function hasPositiveFiniteComponents(vector: Vec3): boolean {
  return (
    vector.x > 0 && vector.y > 0 && vector.z > 0 && [vector.x, vector.y, vector.z].every(Number.isFinite)
  );
}

function cloneWithVertexPositions(
  mesh: MeshData,
  updatePosition: (position: Vec3) => Vec3,
  updateNormal: (normal: Vec3) => Vec3 = (normal) => ({ ...normal }),
  updateTangent: (tangent: MeshTangent) => MeshTangent = (tangent) => ({ ...tangent }),
): MeshData {
  return {
    vertices: Object.fromEntries(
      Object.entries(mesh.vertices).map(([id, vertex]) => [
        id,
        {
          ...vertex,
          position: updatePosition(vertex.position),
          normal: vertex.normal ? updateNormal(vertex.normal) : undefined,
          tangent: vertex.tangent ? updateTangent(vertex.tangent) : undefined,
        },
      ]),
    ),
    faces: Object.fromEntries(
      Object.entries(mesh.faces).map(([id, face]) => [id, { ...face, vertexIds: [...face.vertexIds] }]),
    ),
  };
}

export function resizeMeshGeometry(mesh: MeshData, targetSize: Vec3): MeshData {
  const bounds = getMeshBounds(mesh);
  if (!bounds || !hasPositiveFiniteComponents(targetSize)) {
    return mesh;
  }
  const current = bounds.size;
  if (current.x === 0 || current.y === 0 || current.z === 0) {
    return mesh;
  }
  const factor = {
    x: targetSize.x / current.x,
    y: targetSize.y / current.y,
    z: targetSize.z / current.z,
  };
  if (factor.x === 1 && factor.y === 1 && factor.z === 1) {
    return mesh;
  }
  return cloneWithVertexPositions(mesh, (position) => ({
    x: bounds.center.x + (position.x - bounds.center.x) * factor.x,
    y: bounds.center.y + (position.y - bounds.center.y) * factor.y,
    z: bounds.center.z + (position.z - bounds.center.z) * factor.z,
  }));
}

export function applyMeshScale(mesh: MeshData, scale: Vec3): MeshData {
  if (
    ![scale.x, scale.y, scale.z].every(Number.isFinite) ||
    scale.x === 0 ||
    scale.y === 0 ||
    scale.z === 0 ||
    (scale.x === 1 && scale.y === 1 && scale.z === 1)
  ) {
    return mesh;
  }
  const isReflection = scale.x * scale.y * scale.z < 0;
  const scaled = cloneWithVertexPositions(
    mesh,
    (position) => ({
      x: position.x * scale.x,
      y: position.y * scale.y,
      z: position.z * scale.z,
    }),
    (normal) => {
      const transformed = { x: normal.x / scale.x, y: normal.y / scale.y, z: normal.z / scale.z };
      const length = Math.hypot(transformed.x, transformed.y, transformed.z);
      return length === 0
        ? { ...normal }
        : { x: transformed.x / length, y: transformed.y / length, z: transformed.z / length };
    },
    (tangent) => {
      const transformed = {
        x: tangent.x * scale.x,
        y: tangent.y * scale.y,
        z: tangent.z * scale.z,
      };
      const length = Math.hypot(transformed.x, transformed.y, transformed.z);
      return {
        x: length === 0 ? tangent.x : transformed.x / length,
        y: length === 0 ? tangent.y : transformed.y / length,
        z: length === 0 ? tangent.z : transformed.z / length,
        w: isReflection ? -tangent.w : tangent.w,
      };
    },
  );
  if (!isReflection) {
    return scaled;
  }
  return {
    ...scaled,
    faces: Object.fromEntries(
      Object.entries(scaled.faces).map(([faceId, face]) => [
        faceId,
        { ...face, vertexIds: [...face.vertexIds].reverse() },
      ]),
    ),
  };
}

function rotatePointXYZ(point: Vec3, rotation: Vec3): Vec3 {
  const cosX = Math.cos(rotation.x);
  const sinX = Math.sin(rotation.x);
  const afterX = { x: point.x, y: point.y * cosX - point.z * sinX, z: point.y * sinX + point.z * cosX };
  const cosY = Math.cos(rotation.y);
  const sinY = Math.sin(rotation.y);
  const afterY = {
    x: afterX.x * cosY + afterX.z * sinY,
    y: afterX.y,
    z: -afterX.x * sinY + afterX.z * cosY,
  };
  const cosZ = Math.cos(rotation.z);
  const sinZ = Math.sin(rotation.z);
  return {
    x: afterY.x * cosZ - afterY.y * sinZ,
    y: afterY.x * sinZ + afterY.y * cosZ,
    z: afterY.z,
  };
}

/**
 * Transforms only the supplied editable vertices around their shared local
 * center. This is the common geometry operation used by Vertex, Edge, and
 * Face selection transforms; changed normals and tangents are intentionally
 * invalidated because the editable tangent basis can no longer be trusted.
 */
export function transformMeshVertices(
  mesh: MeshData,
  vertexIds: string[],
  transform: MeshElementTransform,
): MeshData {
  return transformMeshVerticesInSpace(
    mesh,
    vertexIds,
    transform,
    (position) => position,
    (position) => position,
  );
}

/**
 * Applies a selected-vertex transform in an arbitrary coordinate space and
 * stores the result back in mesh-local positions. This allows the editor to
 * expose a true World orientation without making render objects authoritative.
 */
export function transformMeshVerticesInSpace(
  mesh: MeshData,
  vertexIds: string[],
  transform: MeshElementTransform,
  toSpace: (position: Vec3) => Vec3,
  fromSpace: (position: Vec3) => Vec3,
): MeshData {
  const { rotation, scale, translation } = transform;
  if (
    ![
      rotation.x,
      rotation.y,
      rotation.z,
      scale.x,
      scale.y,
      scale.z,
      translation.x,
      translation.y,
      translation.z,
    ].every(Number.isFinite) ||
    scale.x === 0 ||
    scale.y === 0 ||
    scale.z === 0
  ) {
    return mesh;
  }
  const targets = [...new Set(vertexIds)]
    .map((vertexId) => mesh.vertices[vertexId])
    .filter((vertex): vertex is MeshVertex => Boolean(vertex));
  if (targets.length === 0) {
    return mesh;
  }
  if (
    rotation.x === 0 &&
    rotation.y === 0 &&
    rotation.z === 0 &&
    scale.x === 1 &&
    scale.y === 1 &&
    scale.z === 1 &&
    translation.x === 0 &&
    translation.y === 0 &&
    translation.z === 0
  ) {
    return mesh;
  }
  const positionByVertexId = new Map(targets.map((vertex) => [vertex.id, toSpace(vertex.position)] as const));
  if (
    [...positionByVertexId.values()].some(
      (position) => ![position.x, position.y, position.z].every(Number.isFinite),
    )
  ) {
    return mesh;
  }
  const center = targets.reduce(
    (sum, vertex) => {
      const position = positionByVertexId.get(vertex.id)!;
      return {
        x: sum.x + position.x / targets.length,
        y: sum.y + position.y / targets.length,
        z: sum.z + position.z / targets.length,
      };
    },
    { x: 0, y: 0, z: 0 },
  );
  const nextPositionByVertexId = new Map<string, Vec3>();
  for (const vertex of targets) {
    const position = positionByVertexId.get(vertex.id)!;
    const offset = {
      x: (position.x - center.x) * scale.x,
      y: (position.y - center.y) * scale.y,
      z: (position.z - center.z) * scale.z,
    };
    const rotated = rotatePointXYZ(offset, rotation);
    const nextPosition = fromSpace({
      x: center.x + rotated.x + translation.x,
      y: center.y + rotated.y + translation.y,
      z: center.z + rotated.z + translation.z,
    });
    if (![nextPosition.x, nextPosition.y, nextPosition.z].every(Number.isFinite)) {
      return mesh;
    }
    nextPositionByVertexId.set(vertex.id, nextPosition);
  }
  const targetIds = new Set(targets.map((vertex) => vertex.id));
  const vertices = Object.fromEntries(
    Object.entries(mesh.vertices).map(([vertexId, vertex]) => {
      if (!targetIds.has(vertexId)) {
        return [vertexId, vertex];
      }
      return [
        vertexId,
        {
          ...vertex,
          position: nextPositionByVertexId.get(vertexId)!,
          normal: undefined,
          tangent: undefined,
        },
      ];
    }),
  );
  return { ...mesh, vertices };
}

function nextMeshElementId(entries: Record<string, unknown>, prefix: string): string {
  let index = 1;
  while (entries[`${prefix}-${index}`]) {
    index += 1;
  }
  return `${prefix}-${index}`;
}

function faceNormal(mesh: MeshData, vertexIds: string[]): Vec3 | null {
  const [firstId, secondId, thirdId] = vertexIds;
  const first = mesh.vertices[firstId]?.position;
  const second = mesh.vertices[secondId]?.position;
  const third = mesh.vertices[thirdId]?.position;
  if (!first || !second || !third) {
    return null;
  }
  const ab = { x: second.x - first.x, y: second.y - first.y, z: second.z - first.z };
  const ac = { x: third.x - first.x, y: third.y - first.y, z: third.z - first.z };
  const cross = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  const length = Math.hypot(cross.x, cross.y, cross.z);
  return length === 0 ? null : { x: cross.x / length, y: cross.y / length, z: cross.z / length };
}

function polygonNormal(mesh: MeshData, vertexIds: string[]): Vec3 | null {
  if (vertexIds.length < 3) {
    return null;
  }
  const positions = vertexIds.map((vertexId) => mesh.vertices[vertexId]?.position);
  if (positions.some((position) => !position)) {
    return null;
  }
  const normal = positions.reduce(
    (sum, position, index) => {
      const next = positions[(index + 1) % positions.length]!;
      return {
        x: sum.x + (position!.y - next.y) * (position!.z + next.z),
        y: sum.y + (position!.z - next.z) * (position!.x + next.x),
        z: sum.z + (position!.x - next.x) * (position!.y + next.y),
      };
    },
    { x: 0, y: 0, z: 0 },
  );
  const length = Math.hypot(normal.x, normal.y, normal.z);
  return length === 0 ? null : { x: normal.x / length, y: normal.y / length, z: normal.z / length };
}

export function getDegenerateFaceIds(mesh: MeshData): string[] {
  return Object.values(mesh.faces)
    .filter(
      (face) =>
        face.vertexIds.length < 3 ||
        new Set(face.vertexIds).size !== face.vertexIds.length ||
        !polygonNormal(mesh, face.vertexIds),
    )
    .map((face) => face.id);
}

export function deleteDegenerateMeshFaces(mesh: MeshData): MeshData {
  const degenerateFaceIds = new Set(getDegenerateFaceIds(mesh));
  if (degenerateFaceIds.size === 0) {
    return mesh;
  }
  return {
    ...mesh,
    faces: Object.fromEntries(
      Object.entries(mesh.faces).filter(([faceId]) => !degenerateFaceIds.has(faceId)),
    ),
  };
}

export function recalculateMeshNormals(mesh: MeshData): MeshData {
  const sums = Object.fromEntries(
    Object.keys(mesh.vertices).map((vertexId) => [vertexId, { x: 0, y: 0, z: 0 }]),
  );
  Object.values(mesh.faces).forEach((face) => {
    const normal = polygonNormal(mesh, face.vertexIds);
    if (!normal) {
      return;
    }
    face.vertexIds.forEach((vertexId) => {
      const sum = sums[vertexId];
      if (sum) {
        sum.x += normal.x;
        sum.y += normal.y;
        sum.z += normal.z;
      }
    });
  });
  const vertices = Object.fromEntries(
    Object.entries(mesh.vertices).map(([vertexId, vertex]) => {
      const sum = sums[vertexId]!;
      const length = Math.hypot(sum.x, sum.y, sum.z);
      return [
        vertexId,
        {
          ...vertex,
          normal: length === 0 ? undefined : { x: sum.x / length, y: sum.y / length, z: sum.z / length },
          tangent: undefined,
        },
      ];
    }),
  );
  return { ...mesh, vertices };
}

export function extrudeMeshFaces(mesh: MeshData, faceIds: string[], distance: number): MeshData {
  if (!Number.isFinite(distance) || distance === 0) {
    return mesh;
  }
  const selectedFaceIds = [...new Set(faceIds)].filter((faceId) => Boolean(mesh.faces[faceId]));
  if (selectedFaceIds.length === 0) {
    return mesh;
  }
  const vertices = { ...mesh.vertices };
  const faces = { ...mesh.faces };
  let changed = false;
  selectedFaceIds.forEach((faceId) => {
    const face = mesh.faces[faceId];
    const normal = faceNormal(mesh, face.vertexIds);
    if (!normal) {
      return;
    }
    const extrudedVertexIds = face.vertexIds.map((sourceId) => {
      const source = mesh.vertices[sourceId];
      const id = nextMeshElementId(vertices, 'vertex');
      vertices[id] = {
        ...source,
        id,
        position: {
          x: source.position.x + normal.x * distance,
          y: source.position.y + normal.y * distance,
          z: source.position.z + normal.z * distance,
        },
      };
      return id;
    });
    faces[faceId] = { ...face, vertexIds: extrudedVertexIds };
    face.vertexIds.forEach((sourceId, index) => {
      const nextIndex = (index + 1) % face.vertexIds.length;
      const id = nextMeshElementId(faces, 'face');
      faces[id] = {
        id,
        materialId: face.materialId,
        vertexIds: [
          sourceId,
          face.vertexIds[nextIndex],
          extrudedVertexIds[nextIndex],
          extrudedVertexIds[index],
        ],
      };
    });
    changed = true;
  });
  return changed ? { vertices, faces } : mesh;
}

function faceCentroid(mesh: MeshData, vertexIds: string[]): Vec3 | null {
  if (vertexIds.length < 3) {
    return null;
  }
  const vertices = vertexIds.map((vertexId) => mesh.vertices[vertexId]?.position);
  if (vertices.some((vertex) => !vertex)) {
    return null;
  }
  return vertices.reduce(
    (center, vertex) => ({
      x: center.x + vertex!.x / vertices.length,
      y: center.y + vertex!.y / vertices.length,
      z: center.z + vertex!.z / vertices.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
}

/**
 * Creates an inset face plus its surrounding ring. The supplied factor is a
 * fraction of each vertex's distance from the face center (0 < factor < 1).
 */
export function insetMeshFaces(mesh: MeshData, faceIds: string[], factor: number): MeshData {
  if (!Number.isFinite(factor) || factor <= 0 || factor >= 1) {
    return mesh;
  }
  const selectedFaceIds = [...new Set(faceIds)].filter((faceId) => Boolean(mesh.faces[faceId]));
  if (selectedFaceIds.length === 0) {
    return mesh;
  }
  const vertices = { ...mesh.vertices };
  const faces = { ...mesh.faces };
  let changed = false;
  selectedFaceIds.forEach((faceId) => {
    const face = mesh.faces[faceId];
    const center = faceCentroid(mesh, face.vertexIds);
    if (!center || !faceNormal(mesh, face.vertexIds)) {
      return;
    }
    const insetVertexIds = face.vertexIds.map((sourceId) => {
      const source = mesh.vertices[sourceId];
      const id = nextMeshElementId(vertices, 'vertex');
      vertices[id] = {
        ...source,
        id,
        position: {
          x: source.position.x + (center.x - source.position.x) * factor,
          y: source.position.y + (center.y - source.position.y) * factor,
          z: source.position.z + (center.z - source.position.z) * factor,
        },
      };
      return id;
    });
    faces[faceId] = { ...face, vertexIds: insetVertexIds };
    face.vertexIds.forEach((sourceId, index) => {
      const nextIndex = (index + 1) % face.vertexIds.length;
      const id = nextMeshElementId(faces, 'face');
      faces[id] = {
        id,
        materialId: face.materialId,
        vertexIds: [sourceId, face.vertexIds[nextIndex]!, insetVertexIds[nextIndex]!, insetVertexIds[index]!],
      };
    });
    changed = true;
  });
  return changed ? { vertices, faces } : mesh;
}

function colorFromHex(hex: string): { b: number; g: number; r: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1]!, 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

/**
 * Gives selected faces their own colored corners. Corner vertices are duplicated
 * so painting a face never bleeds into an adjacent unselected face.
 */
export function colorMeshFaces(mesh: MeshData, faceIds: string[], hexColor: string): MeshData {
  const color = colorFromHex(hexColor);
  const selectedFaceIds = [...new Set(faceIds)].filter((faceId) => Boolean(mesh.faces[faceId]));
  if (!color || selectedFaceIds.length === 0) {
    return mesh;
  }
  const vertices = { ...mesh.vertices };
  const faces = { ...mesh.faces };
  selectedFaceIds.forEach((faceId) => {
    const face = mesh.faces[faceId]!;
    const colorVertexIds = face.vertexIds.map((sourceId) => {
      const source = mesh.vertices[sourceId];
      const id = nextMeshElementId(vertices, 'vertex');
      vertices[id] = { ...source, id, color: { ...color } };
      return id;
    });
    faces[faceId] = { ...face, vertexIds: colorVertexIds };
  });
  return { vertices, faces };
}

function interpolatedTangent(first: MeshVertex, second: MeshVertex, factor: number): MeshTangent | undefined {
  if (!first.tangent || !second.tangent) {
    return undefined;
  }
  const vector = {
    x: first.tangent.x + (second.tangent.x - first.tangent.x) * factor,
    y: first.tangent.y + (second.tangent.y - first.tangent.y) * factor,
    z: first.tangent.z + (second.tangent.z - first.tangent.z) * factor,
  };
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length === 0) {
    return undefined;
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
    w: first.tangent.w === second.tangent.w || factor <= 0.5 ? first.tangent.w : second.tangent.w,
  };
}

function midpointVertex(id: string, first: MeshVertex, second: MeshVertex): MeshVertex {
  const normal =
    first.normal && second.normal
      ? (() => {
          const value = {
            x: (first.normal.x + second.normal.x) / 2,
            y: (first.normal.y + second.normal.y) / 2,
            z: (first.normal.z + second.normal.z) / 2,
          };
          const length = Math.hypot(value.x, value.y, value.z);
          return length === 0 ? undefined : { x: value.x / length, y: value.y / length, z: value.z / length };
        })()
      : undefined;
  return {
    id,
    position: {
      x: (first.position.x + second.position.x) / 2,
      y: (first.position.y + second.position.y) / 2,
      z: (first.position.z + second.position.z) / 2,
    },
    normal,
    tangent: interpolatedTangent(first, second, 0.5),
    uv:
      first.uv && second.uv
        ? { u: (first.uv.u + second.uv.u) / 2, v: (first.uv.v + second.uv.v) / 2 }
        : undefined,
    color:
      first.color && second.color
        ? {
            r: (first.color.r + second.color.r) / 2,
            g: (first.color.g + second.color.g) / 2,
            b: (first.color.b + second.color.b) / 2,
          }
        : undefined,
  };
}

/**
 * Splits selected polygon boundaries at their midpoints.  Unlike a face split this
 * deliberately preserves the surrounding faces, so a quad becomes a pentagon at
 * the selected edge and remains valid editable MeshData.
 */
export function subdivideMeshEdges(mesh: MeshData, edgeIds: string[]): MeshData {
  const requested = new Set(edgeIds);
  const selectedEdges = getMeshEdges(mesh).filter((edge) => requested.has(edge.id));
  if (selectedEdges.length === 0) {
    return mesh;
  }

  const vertices = { ...mesh.vertices };
  const midpointIds = new Map<string, string>();
  selectedEdges.forEach((edge) => {
    const first = mesh.vertices[edge.vertexAId];
    const second = mesh.vertices[edge.vertexBId];
    if (!first || !second) {
      return;
    }
    const id = nextMeshElementId(vertices, 'vertex');
    vertices[id] = midpointVertex(id, first, second);
    midpointIds.set(edge.id, id);
  });
  if (midpointIds.size === 0) {
    return mesh;
  }

  const faces = Object.fromEntries(
    Object.entries(mesh.faces).map(([faceId, face]) => {
      const vertexIds = face.vertexIds.flatMap((vertexId, index) => {
        const nextVertexId = face.vertexIds[(index + 1) % face.vertexIds.length]!;
        const midpointId = midpointIds.get(edgeId(vertexId, nextVertexId));
        return midpointId ? [vertexId, midpointId] : [vertexId];
      });
      return [faceId, { ...face, vertexIds }];
    }),
  );
  return { vertices, faces };
}

export interface LoopCutFace {
  entryEdgeId: string;
  exitEdgeId: string;
  faceId: string;
}

export interface TrisToQuadCandidate {
  faceIds: [string, string] | null;
  reason: string | null;
}

/**
 * Imported GLB triangles can be converted only when they share actual vertex
 * IDs (therefore no split UV corner on the shared edge), material, and a
 * nearly coplanar normal. This keeps the operation explicit and non-lossy.
 */
export function inspectTrisToQuad(mesh: MeshData, selectedEdgeId: string): TrisToQuadCandidate {
  const edge = getMeshEdges(mesh).find((candidate) => candidate.id === selectedEdgeId);
  if (!edge || edge.faceIds.length !== 2) {
    return { faceIds: null, reason: 'Tris to Quads requires one manifold shared edge.' };
  }
  const [firstFaceId, secondFaceId] = edge.faceIds;
  const firstFace = mesh.faces[firstFaceId!];
  const secondFace = mesh.faces[secondFaceId!];
  if (!firstFace || !secondFace || firstFace.vertexIds.length !== 3 || secondFace.vertexIds.length !== 3) {
    return { faceIds: null, reason: 'Tris to Quads requires two triangle faces.' };
  }
  if (firstFace.materialId !== secondFace.materialId) {
    return { faceIds: null, reason: 'Tris to Quads cannot cross a material seam.' };
  }
  const firstNormal = polygonNormal(mesh, firstFace.vertexIds);
  const secondNormal = polygonNormal(mesh, secondFace.vertexIds);
  if (!firstNormal || !secondNormal || normalDot(firstNormal, secondNormal) < 0.995) {
    return { faceIds: null, reason: 'Tris to Quads requires nearly coplanar triangle normals.' };
  }
  return { faceIds: [firstFaceId!, secondFaceId!], reason: null };
}

export interface LoopCutPath {
  faces: LoopCutFace[];
  isClosed: boolean;
  reason: string | null;
}

function loopCutFaceEntryIndex(face: MeshFace, entryEdgeId: string): number {
  return face.vertexIds.findIndex(
    (vertexId, index) =>
      entryEdgeId === edgeId(vertexId, face.vertexIds[(index + 1) % face.vertexIds.length]!),
  );
}

/**
 * Follows the opposite edge through a quad strip.  The trace is deliberately
 * conservative: a triangle/pole or a non-manifold edge returns a reason and
 * leaves the mesh untouched rather than committing a partial cut.
 */
export function traceLoopCut(mesh: MeshData, startingEdgeId: string): LoopCutPath {
  const edges = new Map(getMeshEdges(mesh).map((edge) => [edge.id, edge]));
  const startingEdge = edges.get(startingEdgeId);
  if (!startingEdge) {
    return { faces: [], isClosed: false, reason: 'Select an existing edge before using Loop Cut.' };
  }
  if (startingEdge.faceIds.length > 2) {
    return { faces: [], isClosed: false, reason: 'Loop Cut stops at a non-manifold starting edge.' };
  }

  const pending = startingEdge.faceIds.map((faceId) => ({ entryEdgeId: startingEdgeId, faceId }));
  const visited = new Map<string, LoopCutFace>();
  let isClosed = false;

  while (pending.length > 0) {
    const candidate = pending.shift()!;
    if (visited.has(candidate.faceId)) {
      isClosed = true;
      continue;
    }
    const face = mesh.faces[candidate.faceId];
    if (!face || face.vertexIds.length !== 4) {
      return {
        faces: [...visited.values()],
        isClosed: false,
        reason: `Loop Cut stops at ${candidate.faceId}: it is not a quad face.`,
      };
    }
    const entryIndex = loopCutFaceEntryIndex(face, candidate.entryEdgeId);
    if (entryIndex === -1) {
      return {
        faces: [...visited.values()],
        isClosed: false,
        reason: `Loop Cut cannot follow ${candidate.faceId}: its entry edge is invalid.`,
      };
    }
    const exitEdgeId = edgeId(
      face.vertexIds[(entryIndex + 2) % face.vertexIds.length]!,
      face.vertexIds[(entryIndex + 3) % face.vertexIds.length]!,
    );
    const exitEdge = edges.get(exitEdgeId);
    if (!exitEdge || exitEdge.faceIds.length > 2) {
      return {
        faces: [...visited.values()],
        isClosed: false,
        reason: `Loop Cut stops at ${candidate.faceId}: its opposite edge is non-manifold.`,
      };
    }
    visited.set(candidate.faceId, {
      faceId: candidate.faceId,
      entryEdgeId: candidate.entryEdgeId,
      exitEdgeId,
    });
    if (exitEdge.faceIds.length === 1) {
      continue;
    }
    const nextFaceId = exitEdge.faceIds.find((faceId) => faceId !== candidate.faceId);
    if (!nextFaceId) {
      return {
        faces: [...visited.values()],
        isClosed: false,
        reason: `Loop Cut cannot continue past ${candidate.faceId}: invalid adjacent face.`,
      };
    }
    if (visited.has(nextFaceId) || pending.some((next) => next.faceId === nextFaceId)) {
      isClosed = true;
      continue;
    }
    pending.push({ faceId: nextFaceId, entryEdgeId: exitEdgeId });
  }

  return { faces: [...visited.values()], isClosed, reason: null };
}

function interpolatedVertex(id: string, first: MeshVertex, second: MeshVertex, factor: number): MeshVertex {
  const interpolate = (left: number, right: number): number => left + (right - left) * factor;
  const normal =
    first.normal && second.normal
      ? (() => {
          const value = {
            x: interpolate(first.normal.x, second.normal.x),
            y: interpolate(first.normal.y, second.normal.y),
            z: interpolate(first.normal.z, second.normal.z),
          };
          const length = Math.hypot(value.x, value.y, value.z);
          return length === 0 ? undefined : { x: value.x / length, y: value.y / length, z: value.z / length };
        })()
      : undefined;
  return {
    id,
    position: {
      x: interpolate(first.position.x, second.position.x),
      y: interpolate(first.position.y, second.position.y),
      z: interpolate(first.position.z, second.position.z),
    },
    normal,
    tangent: interpolatedTangent(first, second, factor),
    uv:
      first.uv && second.uv
        ? { u: interpolate(first.uv.u, second.uv.u), v: interpolate(first.uv.v, second.uv.v) }
        : undefined,
    color:
      first.color && second.color
        ? {
            r: interpolate(first.color.r, second.color.r),
            g: interpolate(first.color.g, second.color.g),
            b: interpolate(first.color.b, second.color.b),
          }
        : undefined,
  };
}

/**
 * Splits every face in a traced quad strip into two quads and adds the new
 * transversal edge loop at the supplied position (0 < factor < 1).
 */
export function loopCutMesh(mesh: MeshData, startingEdgeId: string, factor = 0.5): MeshData {
  if (!Number.isFinite(factor) || factor <= 0 || factor >= 1) {
    return mesh;
  }
  const path = traceLoopCut(mesh, startingEdgeId);
  if (path.reason || path.faces.length === 0) {
    return mesh;
  }
  const vertices = { ...mesh.vertices };
  const midpointIds = new Map<string, string>();
  const midpointForEdge = (id: string): string | null => {
    const existing = midpointIds.get(id);
    if (existing) {
      return existing;
    }
    const [firstId, secondId] = id.split('|');
    const first = mesh.vertices[firstId!];
    const second = mesh.vertices[secondId!];
    if (!first || !second) {
      return null;
    }
    const midpointId = nextMeshElementId(vertices, 'vertex');
    vertices[midpointId] = interpolatedVertex(midpointId, first, second, factor);
    midpointIds.set(id, midpointId);
    return midpointId;
  };

  const faces = { ...mesh.faces };
  for (const pathFace of path.faces) {
    const face = mesh.faces[pathFace.faceId]!;
    const entryIndex = loopCutFaceEntryIndex(face, pathFace.entryEdgeId);
    const cornerA = face.vertexIds[entryIndex]!;
    const cornerB = face.vertexIds[(entryIndex + 1) % 4]!;
    const cornerC = face.vertexIds[(entryIndex + 2) % 4]!;
    const cornerD = face.vertexIds[(entryIndex + 3) % 4]!;
    const entryMidpoint = midpointForEdge(pathFace.entryEdgeId);
    const exitMidpoint = midpointForEdge(pathFace.exitEdgeId);
    if (!entryMidpoint || !exitMidpoint) {
      return mesh;
    }
    faces[face.id] = { ...face, vertexIds: [cornerA, entryMidpoint, exitMidpoint, cornerD] };
    const newFaceId = nextMeshElementId(faces, 'face');
    faces[newFaceId] = {
      id: newFaceId,
      materialId: face.materialId,
      vertexIds: [entryMidpoint, cornerB, cornerC, exitMidpoint],
    };
  }
  return { vertices, faces };
}

function bevelPoint(id: string, source: MeshVertex, neighbour: MeshVertex, width: number): MeshVertex | null {
  const distance = Math.hypot(
    neighbour.position.x - source.position.x,
    neighbour.position.y - source.position.y,
    neighbour.position.z - source.position.z,
  );
  if (distance === 0) {
    return null;
  }
  return interpolatedVertex(id, source, neighbour, Math.min(width / distance, 0.49));
}

function normalDot(left: Vec3 | null, right: Vec3 | null): number {
  return left && right ? left.x * right.x + left.y * right.y + left.z * right.z : 0;
}

/**
 * Replaces one manifold edge with a single chamfer face.  This intentionally
 * handles one selected edge/segment at a time; adjacent simultaneous bevels
 * need a wider vertex-corner solver and are rejected by the editor UI.
 */
export function bevelMeshEdge(mesh: MeshData, selectedEdgeId: string, width: number): MeshData {
  if (!Number.isFinite(width) || width <= 0) {
    return mesh;
  }
  const selectedEdge = getMeshEdges(mesh).find((edge) => edge.id === selectedEdgeId);
  if (!selectedEdge || selectedEdge.faceIds.length !== 2) {
    return mesh;
  }
  const [firstFaceId, secondFaceId] = selectedEdge.faceIds;
  const firstFace = mesh.faces[firstFaceId!];
  const secondFace = mesh.faces[secondFaceId!];
  if (
    !firstFace ||
    !secondFace ||
    firstFace.materialId !== secondFace.materialId ||
    firstFace.vertexIds.length < 3 ||
    secondFace.vertexIds.length < 3
  ) {
    return mesh;
  }
  const firstEdgeIndex = loopCutFaceEntryIndex(firstFace, selectedEdgeId);
  const secondEdgeIndex = loopCutFaceEntryIndex(secondFace, selectedEdgeId);
  if (firstEdgeIndex === -1 || secondEdgeIndex === -1) {
    return mesh;
  }

  const vertices = { ...mesh.vertices };
  const replacementByFaceAndVertex = new Map<string, string>();
  const addFaceBevelPoints = (face: MeshFace, edgeIndex: number): boolean => {
    const length = face.vertexIds.length;
    const startVertexId = face.vertexIds[edgeIndex]!;
    const endVertexId = face.vertexIds[(edgeIndex + 1) % length]!;
    const startNeighbourId = face.vertexIds[(edgeIndex - 1 + length) % length]!;
    const endNeighbourId = face.vertexIds[(edgeIndex + 2) % length]!;
    const start = mesh.vertices[startVertexId];
    const end = mesh.vertices[endVertexId];
    const startNeighbour = mesh.vertices[startNeighbourId];
    const endNeighbour = mesh.vertices[endNeighbourId];
    if (!start || !end || !startNeighbour || !endNeighbour) {
      return false;
    }
    const startId = nextMeshElementId(vertices, 'vertex');
    const startPoint = bevelPoint(startId, start, startNeighbour, width);
    if (!startPoint) {
      return false;
    }
    vertices[startId] = startPoint;
    const endId = nextMeshElementId(vertices, 'vertex');
    const endPoint = bevelPoint(endId, end, endNeighbour, width);
    if (!endPoint) {
      return false;
    }
    vertices[endId] = endPoint;
    replacementByFaceAndVertex.set(`${face.id}:${startVertexId}`, startId);
    replacementByFaceAndVertex.set(`${face.id}:${endVertexId}`, endId);
    return true;
  };

  if (!addFaceBevelPoints(firstFace, firstEdgeIndex) || !addFaceBevelPoints(secondFace, secondEdgeIndex)) {
    return mesh;
  }
  const firstStart = replacementByFaceAndVertex.get(`${firstFace.id}:${selectedEdge.vertexAId}`);
  const firstEnd = replacementByFaceAndVertex.get(`${firstFace.id}:${selectedEdge.vertexBId}`);
  const secondStart = replacementByFaceAndVertex.get(`${secondFace.id}:${selectedEdge.vertexAId}`);
  const secondEnd = replacementByFaceAndVertex.get(`${secondFace.id}:${selectedEdge.vertexBId}`);
  if (!firstStart || !firstEnd || !secondStart || !secondEnd) {
    return mesh;
  }

  const faces = {
    ...mesh.faces,
    [firstFace.id]: {
      ...firstFace,
      vertexIds: firstFace.vertexIds.map(
        (vertexId) => replacementByFaceAndVertex.get(`${firstFace.id}:${vertexId}`) ?? vertexId,
      ),
    },
    [secondFace.id]: {
      ...secondFace,
      vertexIds: secondFace.vertexIds.map(
        (vertexId) => replacementByFaceAndVertex.get(`${secondFace.id}:${vertexId}`) ?? vertexId,
      ),
    },
  };
  const bevelFaceId = nextMeshElementId(faces, 'face');
  let bevelVertexIds = [firstStart, firstEnd, secondEnd, secondStart];
  const expectedNormal = (() => {
    const firstNormal = polygonNormal(mesh, firstFace.vertexIds);
    const secondNormal = polygonNormal(mesh, secondFace.vertexIds);
    if (!firstNormal || !secondNormal) {
      return null;
    }
    const sum = {
      x: firstNormal.x + secondNormal.x,
      y: firstNormal.y + secondNormal.y,
      z: firstNormal.z + secondNormal.z,
    };
    const length = Math.hypot(sum.x, sum.y, sum.z);
    return length === 0 ? null : { x: sum.x / length, y: sum.y / length, z: sum.z / length };
  })();
  const bevelNormal = polygonNormal({ vertices, faces }, bevelVertexIds);
  if (normalDot(bevelNormal, expectedNormal) < 0) {
    bevelVertexIds = [...bevelVertexIds].reverse();
  }
  faces[bevelFaceId] = { id: bevelFaceId, materialId: firstFace.materialId, vertexIds: bevelVertexIds };
  return { vertices, faces };
}

/**
 * Bends editable vertices into a circular arc along the selected axis. The
 * origin remains fixed, and a missing normal is intentional: the runtime will
 * recalculate a coherent normal field from the bent geometry.
 */
export function bendMeshGeometry(
  mesh: MeshData,
  axis: BendAxis,
  angleRadians: number,
  origin: Vec3,
  vertexIds = Object.keys(mesh.vertices),
): MeshData {
  if (!Number.isFinite(angleRadians) || angleRadians === 0) {
    return mesh;
  }
  const targets = [...new Set(vertexIds)]
    .map((vertexId) => mesh.vertices[vertexId])
    .filter((vertex): vertex is MeshVertex => Boolean(vertex));
  if (targets.length < 2) {
    return mesh;
  }
  const min = Math.min(...targets.map((vertex) => vertex.position[axis]));
  const max = Math.max(...targets.map((vertex) => vertex.position[axis]));
  const extent = max - min;
  if (!Number.isFinite(extent) || extent <= Number.EPSILON) {
    return mesh;
  }
  const radius = extent / angleRadians;
  const targetIds = new Set(targets.map((vertex) => vertex.id));
  const vertices = Object.fromEntries(
    Object.entries(mesh.vertices).map(([vertexId, vertex]) => {
      if (!targetIds.has(vertexId)) {
        return [vertexId, vertex];
      }
      const theta = ((vertex.position[axis] - origin[axis]) / extent) * angleRadians;
      const arcCoordinate = origin[axis] + Math.sin(theta) * radius;
      const offset = (1 - Math.cos(theta)) * radius;
      const position =
        axis === 'x'
          ? { x: arcCoordinate, y: vertex.position.y + offset, z: vertex.position.z }
          : axis === 'y'
            ? { x: vertex.position.x, y: arcCoordinate, z: vertex.position.z + offset }
            : { x: vertex.position.x, y: vertex.position.y + offset, z: arcCoordinate };
      return [vertexId, { ...vertex, position, normal: undefined, tangent: undefined }];
    }),
  );
  return { ...mesh, vertices };
}

/**
 * Bakes a single-axis mirror into editable geometry. Vertices on the mirror
 * plane are reused within the supplied seam tolerance, while the mirrored
 * face winding is reversed to preserve outward normals.
 */
export function mirrorMeshGeometry(mesh: MeshData, axis: BendAxis, seamTolerance = 0.0001): MeshData {
  if (!Number.isFinite(seamTolerance) || seamTolerance < 0 || Object.keys(mesh.faces).length === 0) {
    return mesh;
  }
  const vertices = { ...mesh.vertices };
  const mirroredVertexIdBySourceId = new Map<string, string>();
  Object.values(mesh.vertices).forEach((vertex) => {
    if (Math.abs(vertex.position[axis]) <= seamTolerance) {
      mirroredVertexIdBySourceId.set(vertex.id, vertex.id);
      return;
    }
    const mirroredId = nextMeshElementId(vertices, 'vertex');
    vertices[mirroredId] = {
      ...vertex,
      id: mirroredId,
      position: { ...vertex.position, [axis]: -vertex.position[axis] },
      normal: vertex.normal ? { ...vertex.normal, [axis]: -vertex.normal[axis] } : undefined,
      tangent: vertex.tangent
        ? { ...vertex.tangent, [axis]: -vertex.tangent[axis], w: -vertex.tangent.w }
        : undefined,
    };
    mirroredVertexIdBySourceId.set(vertex.id, mirroredId);
  });
  const faces = { ...mesh.faces };
  Object.values(mesh.faces).forEach((face) => {
    const mirroredVertexIds = face.vertexIds.map((vertexId) => mirroredVertexIdBySourceId.get(vertexId)!);
    if (
      new Set(mirroredVertexIds).size < 3 ||
      mirroredVertexIds.every((vertexId, index) => vertexId === face.vertexIds[index])
    ) {
      return;
    }
    const mirroredFaceId = nextMeshElementId(faces, 'face');
    faces[mirroredFaceId] = {
      id: mirroredFaceId,
      materialId: face.materialId,
      vertexIds: [...mirroredVertexIds].reverse(),
    };
  });
  return Object.keys(faces).length === Object.keys(mesh.faces).length ? mesh : { vertices, faces };
}

/** Applies a persisted live Mirror modifier without changing the source mesh. */
export function getMirroredMeshPreview(mesh: MeshData, modifier: MirrorModifier | undefined): MeshData {
  return modifier ? mirrorMeshGeometry(mesh, modifier.axis, modifier.seamTolerance) : mesh;
}

/**
 * Conservative box-style Auto UV for unwrapped meshes. Every face gets its own
 * corner vertices so seams cannot overwrite an adjacent face's paint. Existing
 * UVs are never changed by this helper.
 */
export function generateAutoUvMesh(mesh: MeshData): MeshData {
  if (Object.values(mesh.vertices).some((vertex) => vertex.uv)) {
    return mesh;
  }
  const vertices: MeshData['vertices'] = {};
  const faces: MeshData['faces'] = {};
  Object.values(mesh.faces).forEach((face) => {
    const sourceVertices = face.vertexIds.map((vertexId) => mesh.vertices[vertexId]).filter(Boolean);
    if (sourceVertices.length !== face.vertexIds.length) {
      return;
    }
    const first = sourceVertices[0]!.position;
    const second = sourceVertices[1]!.position;
    const third = sourceVertices[2]!.position;
    const normal = {
      x: (second.y - first.y) * (third.z - first.z) - (second.z - first.z) * (third.y - first.y),
      y: (second.z - first.z) * (third.x - first.x) - (second.x - first.x) * (third.z - first.z),
      z: (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x),
    };
    const absoluteNormal = { x: Math.abs(normal.x), y: Math.abs(normal.y), z: Math.abs(normal.z) };
    const [uAxis, vAxis]: Array<keyof Vec3> =
      absoluteNormal.x >= absoluteNormal.y && absoluteNormal.x >= absoluteNormal.z
        ? ['z', 'y']
        : absoluteNormal.y >= absoluteNormal.z
          ? ['x', 'z']
          : ['x', 'y'];
    const uValues = sourceVertices.map((vertex) => vertex.position[uAxis]);
    const vValues = sourceVertices.map((vertex) => vertex.position[vAxis]);
    const minU = Math.min(...uValues);
    const minV = Math.min(...vValues);
    const spanU = Math.max(...uValues) - minU || 1;
    const spanV = Math.max(...vValues) - minV || 1;
    const vertexIds = sourceVertices.map((vertex, index) => {
      const id = `auto-uv-${face.id}-${index + 1}`;
      vertices[id] = {
        ...vertex,
        id,
        position: { ...vertex.position },
        normal: vertex.normal ? { ...vertex.normal } : undefined,
        tangent: vertex.tangent ? { ...vertex.tangent } : undefined,
        uv: {
          u: (vertex.position[uAxis] - minU) / spanU,
          v: (vertex.position[vAxis] - minV) / spanV,
        },
        color: vertex.color ? { ...vertex.color } : undefined,
      };
      return id;
    });
    faces[face.id] = { ...face, vertexIds };
  });
  return Object.keys(faces).length === Object.keys(mesh.faces).length ? { vertices, faces } : mesh;
}

function removeConsecutiveDuplicateVertexIds(vertexIds: string[]): string[] {
  const compacted = vertexIds.filter((vertexId, index) => index === 0 || vertexId !== vertexIds[index - 1]);
  if (compacted.length > 1 && compacted[0] === compacted[compacted.length - 1]) {
    compacted.pop();
  }
  return compacted;
}

function mergeVertexGroups(mesh: MeshData, groups: string[][]): MeshData {
  const targetByVertexId = new Map<string, string>();
  const positionByTargetId = new Map<string, Vec3>();
  groups.forEach((group) => {
    const vertexIds = [...new Set(group)].filter((vertexId) => Boolean(mesh.vertices[vertexId]));
    if (vertexIds.length < 2) {
      return;
    }
    const targetId = vertexIds[0]!;
    const center = vertexIds.reduce(
      (sum, vertexId) => {
        const position = mesh.vertices[vertexId]!.position;
        return {
          x: sum.x + position.x / vertexIds.length,
          y: sum.y + position.y / vertexIds.length,
          z: sum.z + position.z / vertexIds.length,
        };
      },
      { x: 0, y: 0, z: 0 },
    );
    vertexIds.forEach((vertexId) => targetByVertexId.set(vertexId, targetId));
    positionByTargetId.set(targetId, center);
  });
  if (targetByVertexId.size === 0) {
    return mesh;
  }

  const vertices = Object.fromEntries(
    Object.entries(mesh.vertices).flatMap(([vertexId, vertex]) => {
      const targetId = targetByVertexId.get(vertexId);
      if (targetId && targetId !== vertexId) {
        return [];
      }
      return [
        [
          vertexId,
          positionByTargetId.has(vertexId)
            ? { ...vertex, position: positionByTargetId.get(vertexId)! }
            : { ...vertex, position: { ...vertex.position } },
        ],
      ];
    }),
  );
  const faces = Object.fromEntries(
    Object.entries(mesh.faces).flatMap(([faceId, face]) => {
      const remappedVertexIds = removeConsecutiveDuplicateVertexIds(
        face.vertexIds.map((vertexId) => targetByVertexId.get(vertexId) ?? vertexId),
      );
      return new Set(remappedVertexIds).size < 3 ? [] : [[faceId, { ...face, vertexIds: remappedVertexIds }]];
    }),
  );
  return { vertices, faces };
}

/** Merges caller-validated groups while retaining the first vertex's corner attributes. */
export function mergeMeshVertexGroups(mesh: MeshData, groups: string[][]): MeshData {
  return mergeVertexGroups(mesh, groups);
}

/**
 * Merges selected vertices into the first selected vertex at their arithmetic
 * center. Faces that collapse below three distinct vertices are removed.
 */
export function mergeMeshVertices(mesh: MeshData, vertexIds: string[]): MeshData {
  return mergeVertexGroups(mesh, [vertexIds]);
}

export function mergeMeshVerticesByDistance(mesh: MeshData, vertexIds: string[], distance: number): MeshData {
  if (!Number.isFinite(distance) || distance < 0) {
    return mesh;
  }
  const candidates = [...new Set(vertexIds)].filter((vertexId) => Boolean(mesh.vertices[vertexId]));
  if (candidates.length < 2) {
    return mesh;
  }
  const parents = new Map(candidates.map((vertexId) => [vertexId, vertexId]));
  const find = (vertexId: string): string => {
    const parent = parents.get(vertexId)!;
    if (parent === vertexId) {
      return vertexId;
    }
    const root = find(parent);
    parents.set(vertexId, root);
    return root;
  };
  const join = (firstId: string, secondId: string): void => {
    const firstRoot = find(firstId);
    const secondRoot = find(secondId);
    if (firstRoot !== secondRoot) {
      parents.set(secondRoot, firstRoot);
    }
  };
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    const first = mesh.vertices[candidates[firstIndex]!]!.position;
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const second = mesh.vertices[candidates[secondIndex]!]!.position;
      if (Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z) <= distance) {
        join(candidates[firstIndex]!, candidates[secondIndex]!);
      }
    }
  }
  const groups = new Map<string, string[]>();
  candidates.forEach((vertexId) => {
    const root = find(vertexId);
    const group = groups.get(root) ?? [];
    group.push(vertexId);
    groups.set(root, group);
  });
  return mergeVertexGroups(
    mesh,
    [...groups.values()].filter((group) => group.length > 1),
  );
}

export function deleteMeshEdges(mesh: MeshData, edgeIds: string[]): MeshData {
  const requested = new Set(edgeIds);
  const faceIdsToDelete = new Set(
    getMeshEdges(mesh)
      .filter((edge) => requested.has(edge.id))
      .flatMap((edge) => edge.faceIds),
  );
  if (faceIdsToDelete.size === 0) {
    return mesh;
  }
  return {
    ...mesh,
    faces: Object.fromEntries(Object.entries(mesh.faces).filter(([faceId]) => !faceIdsToDelete.has(faceId))),
  };
}

function boundaryPathWithoutDirectedEdge(
  face: MeshFace,
  startVertexId: string,
  endVertexId: string,
): string[] | null {
  const edgeIndex = face.vertexIds.findIndex(
    (vertexId, index) =>
      vertexId === startVertexId && face.vertexIds[(index + 1) % face.vertexIds.length] === endVertexId,
  );
  if (edgeIndex === -1) {
    return null;
  }
  return Array.from(
    { length: face.vertexIds.length },
    (_, offset) => face.vertexIds[(edgeIndex + 1 + offset) % face.vertexIds.length]!,
  );
}

function dissolveOneMeshEdge(mesh: MeshData, edgeIdToDissolve: string): MeshData {
  const edge = getMeshEdges(mesh).find((candidate) => candidate.id === edgeIdToDissolve);
  if (!edge || edge.faceIds.length !== 2) {
    return mesh;
  }
  const [firstFaceId, secondFaceId] = edge.faceIds;
  const firstFace = mesh.faces[firstFaceId!];
  const secondFace = mesh.faces[secondFaceId!];
  if (!firstFace || !secondFace || firstFace.materialId !== secondFace.materialId) {
    return mesh;
  }
  const firstPath =
    boundaryPathWithoutDirectedEdge(firstFace, edge.vertexAId, edge.vertexBId) ??
    boundaryPathWithoutDirectedEdge(firstFace, edge.vertexBId, edge.vertexAId);
  if (!firstPath) {
    return mesh;
  }
  const firstStartsAt = firstPath[firstPath.length - 1]!;
  const firstEndsAt = firstPath[0]!;
  const secondPath = boundaryPathWithoutDirectedEdge(secondFace, firstEndsAt, firstStartsAt);
  if (!secondPath) {
    return mesh;
  }
  const mergedVertexIds = [...firstPath, ...secondPath.slice(1, -1)];
  if (mergedVertexIds.length < 3 || new Set(mergedVertexIds).size !== mergedVertexIds.length) {
    return mesh;
  }
  const faces = { ...mesh.faces, [firstFace.id]: { ...firstFace, vertexIds: mergedVertexIds } };
  delete faces[secondFace.id];
  return { ...mesh, faces };
}

/**
 * Dissolve removes a manifold edge while retaining the two adjacent surfaces as
 * one polygon. Boundary, non-manifold, winding-inconsistent, and material seam
 * edges are deliberately rejected instead of losing data.
 */
export function dissolveMeshEdges(mesh: MeshData, edgeIds: string[]): MeshData {
  return [...new Set(edgeIds)].reduce(
    (currentMesh, edgeIdToDissolve) => dissolveOneMeshEdge(currentMesh, edgeIdToDissolve),
    mesh,
  );
}
