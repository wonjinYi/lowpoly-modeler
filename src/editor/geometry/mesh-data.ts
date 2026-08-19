import type {
  MaterialId,
  MeshData,
  MeshFace,
  MeshTangent,
  MeshVertex,
  PrimitiveKind,
  PrimitiveOptions,
  Vec3,
} from '../core/types';

interface MeshVertexInput {
  position: Vec3;
  normal?: Vec3;
  tangent?: MeshTangent;
  uv?: { u: number; v: number };
  color?: { r: number; g: number; b: number };
}

function buildMesh(vertices: MeshVertexInput[], faces: number[][], materialId: MaterialId): MeshData {
  const meshVertices: Record<string, MeshVertex> = {};
  const vertexIds = vertices.map((vertex, index) => {
    const id = `v${index + 1}`;
    meshVertices[id] = {
      id,
      position: { ...vertex.position },
      normal: vertex.normal ? { ...vertex.normal } : undefined,
      tangent: vertex.tangent ? { ...vertex.tangent } : undefined,
      uv: vertex.uv ? { ...vertex.uv } : undefined,
      color: vertex.color ? { ...vertex.color } : undefined,
    };
    return id;
  });

  const meshFaces: Record<string, MeshFace> = {};
  faces.forEach((face, index) => {
    const id = `f${index + 1}`;
    meshFaces[id] = {
      id,
      vertexIds: face.map((vertexIndex) => vertexIds[vertexIndex]),
      materialId,
    };
  });

  return { vertices: meshVertices, faces: meshFaces };
}

function createCube(materialId: MaterialId): MeshData {
  const h = 0.5;
  return buildMesh(
    [
      { position: { x: -h, y: -h, z: -h } },
      { position: { x: h, y: -h, z: -h } },
      { position: { x: h, y: h, z: -h } },
      { position: { x: -h, y: h, z: -h } },
      { position: { x: -h, y: -h, z: h } },
      { position: { x: h, y: -h, z: h } },
      { position: { x: h, y: h, z: h } },
      { position: { x: -h, y: h, z: h } },
    ],
    [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ],
    materialId,
  );
}

function createPlane(materialId: MaterialId): MeshData {
  const h = 0.5;
  return buildMesh(
    [
      { position: { x: -h, y: 0, z: -h }, uv: { u: 0, v: 0 } },
      { position: { x: h, y: 0, z: -h }, uv: { u: 1, v: 0 } },
      { position: { x: h, y: 0, z: h }, uv: { u: 1, v: 1 } },
      { position: { x: -h, y: 0, z: h }, uv: { u: 0, v: 1 } },
    ],
    [[0, 3, 2, 1]],
    materialId,
  );
}

function createCylinder(materialId: MaterialId, segments = 8): MeshData {
  const vertices: MeshVertexInput[] = [];
  const faces: number[][] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const x = Math.cos(angle) * 0.5;
    const z = Math.sin(angle) * 0.5;
    vertices.push({ position: { x, y: 0.5, z } });
  }
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const x = Math.cos(angle) * 0.5;
    const z = Math.sin(angle) * 0.5;
    vertices.push({ position: { x, y: -0.5, z } });
  }
  faces.push([...Array.from({ length: segments }, (_, index) => index)].reverse());
  faces.push(Array.from({ length: segments }, (_, index) => segments + index));
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    faces.push([segments + index, index, next, segments + next]);
  }
  return buildMesh(vertices, faces, materialId);
}

function createCone(materialId: MaterialId, segments = 8): MeshData {
  const vertices: MeshVertexInput[] = [{ position: { x: 0, y: 0.5, z: 0 } }];
  const faces: number[][] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    vertices.push({ position: { x: Math.cos(angle) * 0.5, y: -0.5, z: Math.sin(angle) * 0.5 } });
  }
  faces.push(Array.from({ length: segments }, (_, index) => index + 1));
  for (let index = 0; index < segments; index += 1) {
    const next = ((index + 1) % segments) + 1;
    faces.push([index + 1, 0, next]);
  }
  return buildMesh(vertices, faces, materialId);
}

function createUvSphere(materialId: MaterialId, longitudeSegments = 12, latitudeSegments = 8): MeshData {
  const vertices: MeshVertexInput[] = [{ position: { x: 0, y: 0.5, z: 0 } }];
  const faces: number[][] = [];

  for (let latitude = 1; latitude < latitudeSegments; latitude += 1) {
    const theta = (latitude / latitudeSegments) * Math.PI;
    const ringRadius = Math.sin(theta) * 0.5;
    const y = Math.cos(theta) * 0.5;
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const phi = (longitude / longitudeSegments) * Math.PI * 2;
      vertices.push({ position: { x: Math.cos(phi) * ringRadius, y, z: Math.sin(phi) * ringRadius } });
    }
  }

  const bottomIndex = vertices.length;
  vertices.push({ position: { x: 0, y: -0.5, z: 0 } });
  const ring = (latitude: number, longitude: number): number =>
    1 + (latitude - 1) * longitudeSegments + (longitude % longitudeSegments);

  for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
    faces.push([0, ring(1, (longitude + 1) % longitudeSegments), ring(1, longitude)]);
  }
  for (let latitude = 1; latitude < latitudeSegments - 1; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const next = (longitude + 1) % longitudeSegments;
      faces.push([
        ring(latitude, longitude),
        ring(latitude, next),
        ring(latitude + 1, next),
        ring(latitude + 1, longitude),
      ]);
    }
  }
  for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
    faces.push([
      ring(latitudeSegments - 1, longitude),
      ring(latitudeSegments - 1, (longitude + 1) % longitudeSegments),
      bottomIndex,
    ]);
  }
  return buildMesh(vertices, faces, materialId);
}

function normalize(position: Vec3): Vec3 {
  const length = Math.hypot(position.x, position.y, position.z);
  return { x: position.x / length, y: position.y / length, z: position.z / length };
}

function createIcosphere(materialId: MaterialId, subdivisions = 1): MeshData {
  const phi = (1 + Math.sqrt(5)) / 2;
  let vertices: Vec3[] = [
    { x: -1, y: phi, z: 0 },
    { x: 1, y: phi, z: 0 },
    { x: -1, y: -phi, z: 0 },
    { x: 1, y: -phi, z: 0 },
    { x: 0, y: -1, z: phi },
    { x: 0, y: 1, z: phi },
    { x: 0, y: -1, z: -phi },
    { x: 0, y: 1, z: -phi },
    { x: phi, y: 0, z: -1 },
    { x: phi, y: 0, z: 1 },
    { x: -phi, y: 0, z: -1 },
    { x: -phi, y: 0, z: 1 },
  ].map((position) => {
    const unit = normalize(position);
    return { x: unit.x * 0.5, y: unit.y * 0.5, z: unit.z * 0.5 };
  });
  let faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  for (let subdivision = 0; subdivision < subdivisions; subdivision += 1) {
    const midpointIndexes = new Map<string, number>();
    const midpoint = (left: number, right: number): number => {
      const key = left < right ? `${left}:${right}` : `${right}:${left}`;
      const existing = midpointIndexes.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const leftPosition = vertices[left];
      const rightPosition = vertices[right];
      const unit = normalize({
        x: (leftPosition.x + rightPosition.x) / 2,
        y: (leftPosition.y + rightPosition.y) / 2,
        z: (leftPosition.z + rightPosition.z) / 2,
      });
      const index = vertices.length;
      vertices = [...vertices, { x: unit.x * 0.5, y: unit.y * 0.5, z: unit.z * 0.5 }];
      midpointIndexes.set(key, index);
      return index;
    };
    faces = faces.flatMap(([left, middle, right]) => {
      const leftMiddle = midpoint(left, middle);
      const middleRight = midpoint(middle, right);
      const rightLeft = midpoint(right, left);
      return [
        [left, leftMiddle, rightLeft],
        [middle, middleRight, leftMiddle],
        [right, rightLeft, middleRight],
        [leftMiddle, middleRight, rightLeft],
      ];
    });
  }

  return buildMesh(
    vertices.map((position) => ({ position })),
    faces,
    materialId,
  );
}

function segmentCount(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(value!)));
}

export function createPrimitiveMesh(
  primitive: PrimitiveKind,
  materialId: MaterialId,
  options: PrimitiveOptions = {},
): MeshData {
  switch (primitive) {
    case 'cube':
      return createCube(materialId);
    case 'plane':
      return createPlane(materialId);
    case 'cylinder':
      return createCylinder(materialId, segmentCount(options.radialSegments, 8, 3, 64));
    case 'cone':
      return createCone(materialId, segmentCount(options.radialSegments, 8, 3, 64));
    case 'sphere':
      return createUvSphere(
        materialId,
        segmentCount(options.radialSegments, 12, 3, 64),
        segmentCount(options.latitudeSegments, 8, 2, 64),
      );
    case 'icosphere':
      return createIcosphere(materialId, segmentCount(options.subdivisions, 1, 0, 3));
  }
}

export function meshStatistics(mesh: MeshData): { vertices: number; faces: number } {
  return { vertices: Object.keys(mesh.vertices).length, faces: Object.keys(mesh.faces).length };
}
