import type { MeshData, MeshVertex, VertexId } from '../core/types';

export interface MeshEdge {
  faceIds: string[];
  id: string;
  vertexAId: VertexId;
  vertexBId: VertexId;
}

export interface MeshTopologyDiagnostics {
  boundaryEdgeIds: string[];
  edgeCount: number;
  inconsistentFaceIds: string[];
  nonManifoldEdgeIds: string[];
}

/** Structural checks that every modeling operation must leave behind. */
export interface MeshDataInvariantDiagnostics {
  danglingVertexReferenceFaceIds: string[];
  degenerateFaceIds: string[];
  inconsistentFaceIds: string[];
  invalidVertexIds: string[];
  nonFiniteVertexIds: string[];
}

export interface MeshTopology {
  edgeIdsByFace: Record<string, string[]>;
  edgeIdsByVertex: Record<VertexId, string[]>;
  edges: MeshEdge[];
  faceIdsByVertex: Record<VertexId, string[]>;
}

export interface MeshConnectedComponent {
  faceIds: string[];
  id: string;
  vertexIds: VertexId[];
}

export interface DuplicateVertexGroup {
  vertexIds: VertexId[];
}

const topologyCache = new WeakMap<MeshData, MeshTopology>();

export function edgeId(vertexAId: VertexId, vertexBId: VertexId): string {
  return [vertexAId, vertexBId].sort().join('|');
}

export function getMeshTopology(mesh: MeshData): MeshTopology {
  const cached = topologyCache.get(mesh);
  if (cached) {
    return cached;
  }
  const edges = new Map<string, MeshEdge>();
  const edgeIdsByFace: Record<string, string[]> = {};
  const edgeIdsByVertex: Record<VertexId, string[]> = {};
  const faceIdsByVertex: Record<VertexId, string[]> = {};
  Object.values(mesh.faces).forEach((face) => {
    edgeIdsByFace[face.id] = [];
    face.vertexIds.forEach((vertexAId, index) => {
      const vertexBId = face.vertexIds[(index + 1) % face.vertexIds.length]!;
      const id = edgeId(vertexAId, vertexBId);
      edgeIdsByFace[face.id]!.push(id);
      (faceIdsByVertex[vertexAId] ??= []).push(face.id);
      (edgeIdsByVertex[vertexAId] ??= []).push(id);
      (edgeIdsByVertex[vertexBId] ??= []).push(id);
      const existing = edges.get(id);
      if (existing) {
        existing.faceIds.push(face.id);
        return;
      }
      edges.set(id, { id, vertexAId, vertexBId, faceIds: [face.id] });
    });
  });
  const topology = {
    edges: [...edges.values()],
    edgeIdsByFace,
    edgeIdsByVertex: Object.fromEntries(
      Object.entries(edgeIdsByVertex).map(([vertexId, edgeIds]) => [vertexId, [...new Set(edgeIds)]]),
    ),
    faceIdsByVertex,
  };
  topologyCache.set(mesh, topology);
  return topology;
}

export function getMeshEdges(mesh: MeshData): MeshEdge[] {
  return getMeshTopology(mesh).edges;
}

function optionalVectorMatches(
  left: { x: number; y: number; z: number } | undefined,
  right: { x: number; y: number; z: number } | undefined,
): boolean {
  return (
    left === right || Boolean(left && right && left.x === right.x && left.y === right.y && left.z === right.z)
  );
}

function optionalTangentMatches(left: MeshVertex['tangent'], right: MeshVertex['tangent']): boolean {
  return (
    left === right ||
    Boolean(
      left && right && left.x === right.x && left.y === right.y && left.z === right.z && left.w === right.w,
    )
  );
}

function vertexAttributesMatch(left: MeshVertex, right: MeshVertex): boolean {
  return (
    optionalVectorMatches(left.normal, right.normal) &&
    optionalTangentMatches(left.tangent, right.tangent) &&
    (left.uv === right.uv ||
      Boolean(left.uv && right.uv && left.uv.u === right.uv.u && left.uv.v === right.uv.v)) &&
    (left.color === right.color ||
      Boolean(
        left.color &&
        right.color &&
        left.color.r === right.color.r &&
        left.color.g === right.color.g &&
        left.color.b === right.color.b,
      ))
  );
}

/**
 * Finds vertices occupying the same position. This intentionally ignores
 * corner attributes so an imported UV/color seam remains visible to cleanup.
 */
export function getCoincidentVertexGroups(mesh: MeshData, tolerance = 0.0001): DuplicateVertexGroup[] {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    return [];
  }
  const groups: VertexId[][] = [];
  Object.values(mesh.vertices).forEach((vertex) => {
    const group = groups.find((candidate) => {
      const representative = mesh.vertices[candidate[0]!];
      if (!representative) {
        return false;
      }
      return (
        Math.hypot(
          vertex.position.x - representative.position.x,
          vertex.position.y - representative.position.y,
          vertex.position.z - representative.position.z,
        ) <= tolerance
      );
    });
    if (group) {
      group.push(vertex.id);
    } else {
      groups.push([vertex.id]);
    }
  });
  return groups.filter((vertexIds) => vertexIds.length > 1).map((vertexIds) => ({ vertexIds }));
}

/**
 * Returns only coincident groups whose normal/tangent/UV/color data also match. These
 * groups may be merged without silently erasing a hard edge or corner seam.
 */
export function getMergeableDuplicateVertexGroups(
  mesh: MeshData,
  tolerance = 0.0001,
): DuplicateVertexGroup[] {
  return getCoincidentVertexGroups(mesh, tolerance).flatMap(({ vertexIds }) => {
    const compatibleGroups: VertexId[][] = [];
    vertexIds.forEach((vertexId) => {
      const vertex = mesh.vertices[vertexId]!;
      const group = compatibleGroups.find((candidate) =>
        vertexAttributesMatch(vertex, mesh.vertices[candidate[0]!]!),
      );
      if (group) {
        group.push(vertexId);
      } else {
        compatibleGroups.push([vertexId]);
      }
    });
    return compatibleGroups.filter((group) => group.length > 1).map((vertexIds) => ({ vertexIds }));
  });
}

export function getMeshTopologyDiagnostics(mesh: MeshData): MeshTopologyDiagnostics {
  const edges = getMeshEdges(mesh);
  const inconsistentFaceIds = new Set<string>();
  edges.forEach((edge) => {
    if (edge.faceIds.length !== 2) {
      return;
    }
    const [firstFaceId, secondFaceId] = edge.faceIds;
    const firstFace = mesh.faces[firstFaceId!];
    const secondFace = mesh.faces[secondFaceId!];
    if (!firstFace || !secondFace) {
      return;
    }
    const directedEdge = (faceVertexIds: VertexId[]): [VertexId, VertexId] | null => {
      const index = faceVertexIds.findIndex(
        (vertexId, vertexIndex) =>
          edgeId(vertexId, faceVertexIds[(vertexIndex + 1) % faceVertexIds.length]!) === edge.id,
      );
      return index === -1
        ? null
        : [faceVertexIds[index]!, faceVertexIds[(index + 1) % faceVertexIds.length]!];
    };
    const firstDirection = directedEdge(firstFace.vertexIds);
    const secondDirection = directedEdge(secondFace.vertexIds);
    if (
      firstDirection &&
      secondDirection &&
      firstDirection[0] === secondDirection[0] &&
      firstDirection[1] === secondDirection[1]
    ) {
      inconsistentFaceIds.add(firstFace.id);
      inconsistentFaceIds.add(secondFace.id);
    }
  });
  return {
    edgeCount: edges.length,
    boundaryEdgeIds: edges.filter((edge) => edge.faceIds.length === 1).map((edge) => edge.id),
    inconsistentFaceIds: [...inconsistentFaceIds].sort(),
    nonManifoldEdgeIds: edges.filter((edge) => edge.faceIds.length > 2).map((edge) => edge.id),
  };
}

function hasFiniteVector(value: { x: number; y: number; z: number } | undefined): boolean {
  return Boolean(value && [value.x, value.y, value.z].every(Number.isFinite));
}

/**
 * Separates malformed mesh data from intentionally open geometry. Boundary and
 * non-manifold edges remain inspectable; dangling references, degenerate loops,
 * non-finite attributes, and same-direction shared edges are reported instead.
 */
export function inspectMeshDataInvariants(mesh: MeshData): MeshDataInvariantDiagnostics {
  const invalidVertexIds: string[] = [];
  const nonFiniteVertexIds: string[] = [];
  Object.entries(mesh.vertices).forEach(([vertexId, vertex]) => {
    if (vertex.id !== vertexId) {
      invalidVertexIds.push(vertexId);
    }
    const tangentIsFinite =
      vertex.tangent !== undefined &&
      [vertex.tangent.w, vertex.tangent.x, vertex.tangent.y, vertex.tangent.z].every(Number.isFinite);
    const uvIsFinite = vertex.uv !== undefined && [vertex.uv.u, vertex.uv.v].every(Number.isFinite);
    const colorIsFinite =
      vertex.color !== undefined && [vertex.color.r, vertex.color.g, vertex.color.b].every(Number.isFinite);
    if (
      !hasFiniteVector(vertex.position) ||
      (vertex.normal !== undefined && !hasFiniteVector(vertex.normal)) ||
      (vertex.tangent !== undefined && !tangentIsFinite) ||
      (vertex.uv !== undefined && !uvIsFinite) ||
      (vertex.color !== undefined && !colorIsFinite)
    ) {
      nonFiniteVertexIds.push(vertexId);
    }
  });
  const danglingVertexReferenceFaceIds: string[] = [];
  const degenerateFaceIds: string[] = [];
  Object.entries(mesh.faces).forEach(([faceId, face]) => {
    const isDangling = face.vertexIds.some((vertexId) => !mesh.vertices[vertexId]);
    if (face.id !== faceId || isDangling) {
      danglingVertexReferenceFaceIds.push(faceId);
    }
    if (face.vertexIds.length < 3 || new Set(face.vertexIds).size < 3) {
      degenerateFaceIds.push(faceId);
    }
  });
  const inconsistentFaceIds =
    danglingVertexReferenceFaceIds.length === 0 ? getMeshTopologyDiagnostics(mesh).inconsistentFaceIds : [];
  return {
    danglingVertexReferenceFaceIds: danglingVertexReferenceFaceIds.sort(),
    degenerateFaceIds: degenerateFaceIds.sort(),
    inconsistentFaceIds,
    invalidVertexIds: invalidVertexIds.sort(),
    nonFiniteVertexIds: nonFiniteVertexIds.sort(),
  };
}

/**
 * Returns loose mesh islands joined through shared editable vertices. A vertex
 * is used instead of only an edge so malformed imports remain inspectable and
 * users can still select each visibly connected piece for cleanup.
 */
export function getMeshConnectedComponents(mesh: MeshData): MeshConnectedComponent[] {
  const topology = getMeshTopology(mesh);

  const pendingFaceIds = new Set(Object.keys(mesh.faces));
  const components: MeshConnectedComponent[] = [];
  while (pendingFaceIds.size > 0) {
    const firstFaceId = pendingFaceIds.values().next().value as string;
    const queue = [firstFaceId];
    const componentFaceIds = new Set<string>();
    const componentVertexIds = new Set<VertexId>();
    pendingFaceIds.delete(firstFaceId);
    while (queue.length > 0) {
      const faceId = queue.shift()!;
      const face = mesh.faces[faceId];
      if (!face) {
        continue;
      }
      componentFaceIds.add(faceId);
      face.vertexIds.forEach((vertexId) => {
        componentVertexIds.add(vertexId);
        (topology.faceIdsByVertex[vertexId] ?? []).forEach((connectedFaceId) => {
          if (pendingFaceIds.delete(connectedFaceId)) {
            queue.push(connectedFaceId);
          }
        });
      });
    }
    components.push({
      id: `component-${components.length + 1}`,
      faceIds: [...componentFaceIds].sort(),
      vertexIds: [...componentVertexIds].sort(),
    });
  }
  return components;
}
