export type NodeId = string;
export type MaterialId = string;
export type TextureId = string;
export type VertexId = string;
export type FaceId = string;

export interface VertexSelection {
  nodeId: NodeId;
  vertexId: VertexId;
}

export interface FaceSelection {
  faceId: FaceId;
  nodeId: NodeId;
}

export interface EdgeSelection {
  edgeId: string;
  nodeId: NodeId;
}

export type PrimitiveKind = 'cube' | 'plane' | 'cylinder' | 'cone' | 'sphere' | 'icosphere';

export interface PrimitiveOptions {
  latitudeSegments?: number;
  radialSegments?: number;
  subdivisions?: number;
}

export type EditorMode = 'object' | 'vertex' | 'edge' | 'face' | 'pivot' | 'face-color' | 'texture-paint';

export type TransformTool = 'translate' | 'rotate' | 'scale';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface MaterialData {
  id: MaterialId;
  name: string;
  baseColor: string;
  roughness: number;
  metalness: number;
  opacity: number;
  flatShading: boolean;
  baseColorTextureId?: TextureId;
}

/** Browser-owned, lossless project payload for a base-color texture. */
export interface TextureData {
  colorSpace: 'srgb';
  dataUrl: string;
  height: number;
  id: TextureId;
  mimeType: 'image/png';
  name: string;
  width: number;
}

export interface MeshTangent {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface MeshVertex {
  id: VertexId;
  position: Vec3;
  normal?: Vec3;
  tangent?: MeshTangent;
  uv?: { u: number; v: number };
  color?: { r: number; g: number; b: number };
}

export interface MeshFace {
  id: FaceId;
  vertexIds: VertexId[];
  materialId: MaterialId;
}

export interface MeshData {
  vertices: Record<VertexId, MeshVertex>;
  faces: Record<FaceId, MeshFace>;
}

export interface MirrorModifier {
  axis: 'x' | 'y' | 'z';
  seamTolerance: number;
}

export type BooleanOperation = 'difference' | 'intersection' | 'union';

/**
 * A derived Boolean result shown only in the viewport until the user commits it.
 * It intentionally does not belong in SceneDocument or .shadeasset persistence.
 */
export interface BooleanPreview {
  cutterNodeId: NodeId;
  documentRevision: number;
  elapsedMs: number;
  mesh: MeshData;
  operation: BooleanOperation;
  subjectNodeId: NodeId;
  triangleCount: number;
}

export interface BaseNode {
  id: NodeId;
  name: string;
  parentId: NodeId | null;
  hidden: boolean;
  transform: Transform;
}

export interface GroupNode extends BaseNode {
  type: 'group';
}

export interface MeshNode extends BaseNode {
  type: 'mesh';
  mesh: MeshData;
  mirrorModifier?: MirrorModifier;
}

export type EditorNode = GroupNode | MeshNode;

export interface GameAssetMetadata {
  forwardConfirmed: boolean;
  groundContactTolerance: number;
  groundReferenceY: number;
}

export interface SceneDocument {
  metadata: GameAssetMetadata;
  version: 1;
  revision: number;
  rootId: NodeId;
  nodes: Record<NodeId, EditorNode>;
  materials: Record<MaterialId, MaterialData>;
  textures: Record<TextureId, TextureData>;
}

/**
 * Editor-only state that belongs beside a SceneDocument in a .shadeasset.
 * Runtime previews and command history deliberately stay out of the project file.
 */
export interface PersistedEditorState {
  selectedNodeIds: NodeId[];
  selectedVertexIds: VertexSelection[];
  selectedFaceIds: FaceSelection[];
  selectedEdgeIds: EdgeSelection[];
  mode: EditorMode;
  groundVisible: boolean;
  transformTool: TransformTool;
  facePaintColor: string;
  facePaintRecentColors: string[];
  textureBrushOpacity: number;
  textureBrushSize: number;
  texturePaintTool: 'brush' | 'eraser' | 'eyedropper';
}

export const ROOT_NODE_ID = 'asset_root';

export const DEFAULT_TRANSFORM: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

export const DEFAULT_MATERIAL: MaterialData = {
  id: 'material-1',
  name: 'Default matte',
  baseColor: '#7fcf98',
  roughness: 0.82,
  metalness: 0,
  opacity: 1,
  flatShading: true,
};

export function cloneVec3(vector: Vec3): Vec3 {
  return { ...vector };
}

export function cloneTransform(transform: Transform): Transform {
  return {
    position: cloneVec3(transform.position),
    rotation: cloneVec3(transform.rotation),
    scale: cloneVec3(transform.scale),
  };
}

export function cloneNode(node: EditorNode): EditorNode {
  if (node.type === 'mesh') {
    return {
      ...node,
      transform: cloneTransform(node.transform),
      mesh: cloneMeshData(node.mesh),
      mirrorModifier: node.mirrorModifier ? { ...node.mirrorModifier } : undefined,
    };
  }
  return { ...node, transform: cloneTransform(node.transform) };
}

export function cloneMeshData(mesh: MeshData): MeshData {
  return {
    vertices: Object.fromEntries(
      Object.entries(mesh.vertices).map(([id, vertex]) => [
        id,
        {
          ...vertex,
          position: cloneVec3(vertex.position),
          normal: vertex.normal ? cloneVec3(vertex.normal) : undefined,
          tangent: vertex.tangent ? { ...vertex.tangent } : undefined,
          uv: vertex.uv ? { ...vertex.uv } : undefined,
          color: vertex.color ? { ...vertex.color } : undefined,
        },
      ]),
    ),
    faces: Object.fromEntries(
      Object.entries(mesh.faces).map(([id, face]) => [id, { ...face, vertexIds: [...face.vertexIds] }]),
    ),
  };
}

export function cloneDocument(document: SceneDocument): SceneDocument {
  return {
    ...document,
    metadata: { ...document.metadata },
    nodes: Object.fromEntries(Object.entries(document.nodes).map(([id, node]) => [id, cloneNode(node)])),
    materials: Object.fromEntries(
      Object.entries(document.materials).map(([id, material]) => [id, { ...material }]),
    ),
    textures: Object.fromEntries(
      Object.entries(document.textures).map(([id, texture]) => [id, { ...texture }]),
    ),
  };
}

export function isFiniteTransform(transform: Transform): boolean {
  const values = [
    transform.position.x,
    transform.position.y,
    transform.position.z,
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    transform.scale.x,
    transform.scale.y,
    transform.scale.z,
  ];

  return values.every(Number.isFinite);
}
