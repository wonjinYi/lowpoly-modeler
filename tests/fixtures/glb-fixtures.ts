function encodeGlb(document: object, binary: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(document));
  const jsonPadding = (4 - (json.length % 4)) % 4;
  const totalLength = 12 + 8 + json.length + jsonPadding + 8 + binary.length;
  const glb = Buffer.alloc(totalLength);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(totalLength, 8);
  glb.writeUInt32LE(json.length + jsonPadding, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  glb.fill(0x20, 20 + json.length, 20 + json.length + jsonPadding);
  const binaryHeaderOffset = 20 + json.length + jsonPadding;
  glb.writeUInt32LE(binary.length, binaryHeaderOffset);
  glb.writeUInt32LE(0x004e4942, binaryHeaderOffset + 4);
  binary.copy(glb, binaryHeaderOffset + 8);
  return glb;
}

export function createTriangleHierarchyGlb(): Buffer {
  const binary = Buffer.alloc(44);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => binary.writeFloatLE(value, index * 4));
  [0, 1, 2].forEach((value, index) => binary.writeUInt16LE(value, 36 + index * 2));
  return encodeGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { children: [1], name: 'Pivot Anchor', translation: [1, 0, 0] },
        { mesh: 0, name: 'Imported Triangle' },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 6 },
      ],
      buffers: [{ byteLength: 42 }],
    },
    binary,
  );
}

export function createTangentTriangleGlb(): Buffer {
  const binary = Buffer.alloc(128);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => binary.writeFloatLE(value, index * 4));
  [0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((value, index) => binary.writeFloatLE(value, 36 + index * 4));
  [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1].forEach((value, index) => binary.writeFloatLE(value, 72 + index * 4));
  [0, 1, 2].forEach((value, index) => binary.writeUInt16LE(value, 120 + index * 2));
  return encodeGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'Tangent Triangle' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TANGENT: 2 }, indices: 3 }] }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
        { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 36 },
        { buffer: 0, byteOffset: 72, byteLength: 48 },
        { buffer: 0, byteOffset: 120, byteLength: 6 },
      ],
      buffers: [{ byteLength: 126 }],
    },
    binary,
  );
}

export function createCubeGlb(): Buffer {
  const binary = Buffer.alloc(168);
  const positions = [
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    0.5, 0.5, -0.5, 0.5, 0.5,
  ];
  const indexes = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4,
    7,
  ];
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  indexes.forEach((value, index) => binary.writeUInt16LE(value, 96 + index * 2));
  return encodeGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'Fixture Cube' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 8,
          type: 'VEC3',
          min: [-0.5, -0.5, -0.5],
          max: [0.5, 0.5, 0.5],
        },
        { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 96 },
        { buffer: 0, byteOffset: 96, byteLength: 72 },
      ],
      buffers: [{ byteLength: 168 }],
    },
    binary,
  );
}

/**
 * A small, anonymized Meshy-like import: hierarchy, two meshes, three PBR
 * materials, UVs/normals, and an embedded base-color texture. It deliberately
 * stays tiny enough for deterministic browser E2E runs.
 */
export function createMeshyLikeGlb(): Buffer {
  const texturePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const binary = Buffer.alloc(148 + texturePng.length);
  const canopyPositions = [-0.5, 0, 0, 0.5, 0, 0, 0, 0.85, 0];
  const canopyNormals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  const canopyUvs = [0, 0, 1, 0, 0.5, 1];
  const accentPositions = [-0.2, 0.1, 0.15, 0.2, 0.1, 0.15, 0, 0.45, 0.15];
  canopyPositions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  canopyNormals.forEach((value, index) => binary.writeFloatLE(value, 36 + index * 4));
  canopyUvs.forEach((value, index) => binary.writeFloatLE(value, 72 + index * 4));
  [0, 1, 2].forEach((value, index) => binary.writeUInt16LE(value, 96 + index * 2));
  accentPositions.forEach((value, index) => binary.writeFloatLE(value, 104 + index * 4));
  [0, 1, 2].forEach((value, index) => binary.writeUInt16LE(value, 140 + index * 2));
  texturePng.copy(binary, 148);

  return encodeGlb(
    {
      asset: { version: '2.0', generator: 'Anonymized Meshy-like fixture' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { children: [1, 2], name: 'Generated Asset Root' },
        { mesh: 0, name: 'Canopy Surface', translation: [0, 0.2, 0] },
        { mesh: 1, name: 'Accent Trim', translation: [0, 0, 0.1] },
      ],
      meshes: [
        {
          name: 'Canopy Geometry',
          primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }],
        },
        { name: 'Accent Geometry', primitives: [{ attributes: { POSITION: 4 }, indices: 5, material: 1 }] },
      ],
      materials: [
        {
          name: 'Moss Texture',
          pbrMetallicRoughness: {
            baseColorFactor: [0.24, 0.55, 0.31, 1],
            baseColorTexture: { index: 0 },
            metallicFactor: 0.05,
            roughnessFactor: 0.72,
          },
        },
        {
          name: 'Accent Paint',
          pbrMetallicRoughness: {
            baseColorFactor: [0.9, 0.48, 0.18, 1],
            metallicFactor: 0.1,
            roughnessFactor: 0.46,
          },
        },
      ],
      textures: [{ source: 0 }],
      images: [{ bufferView: 6, mimeType: 'image/png', name: 'Tiny texture' }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [-0.5, 0, 0],
          max: [0.5, 0.85, 0],
        },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
        { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
        {
          bufferView: 4,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [-0.2, 0.1, 0.15],
          max: [0.2, 0.45, 0.15],
        },
        { bufferView: 5, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
        { buffer: 0, byteOffset: 36, byteLength: 36, target: 34962 },
        { buffer: 0, byteOffset: 72, byteLength: 24, target: 34962 },
        { buffer: 0, byteOffset: 96, byteLength: 6, target: 34963 },
        { buffer: 0, byteOffset: 104, byteLength: 36, target: 34962 },
        { buffer: 0, byteOffset: 140, byteLength: 6, target: 34963 },
        { buffer: 0, byteOffset: 148, byteLength: texturePng.length },
      ],
      buffers: [{ byteLength: binary.length }],
    },
    binary,
  );
}
