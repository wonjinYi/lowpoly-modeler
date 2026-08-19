import type {
  EditorMode,
  EditorNode,
  MaterialData,
  MeshData,
  PersistedEditorState,
  SceneDocument,
  Transform,
} from '../core/types';

export const SHADE_ASSET_FORMAT = 'lowpoly-modeler.shadeasset';
export const SHADE_ASSET_VERSION = 2;
export const SHADE_ASSET_MIME_TYPE = 'application/vnd.lowpoly-modeler.shadeasset+json';

export interface ShadeAssetManifestV1 {
  format: typeof SHADE_ASSET_FORMAT;
  formatVersion: typeof SHADE_ASSET_VERSION;
  document: SceneDocument;
  editor: PersistedEditorState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function hasOnlyKnownKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function isVec3(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}

function isTransform(value: unknown): value is Transform {
  return isRecord(value) && isVec3(value.position) && isVec3(value.rotation) && isVec3(value.scale);
}

function isMesh(value: unknown, materialIds: Set<string>): value is MeshData {
  if (!isRecord(value) || !isRecord(value.vertices) || !isRecord(value.faces)) {
    return false;
  }
  const vertices = value.vertices;
  for (const [id, vertex] of Object.entries(vertices)) {
    if (!isRecord(vertex) || vertex.id !== id || !isVec3(vertex.position)) {
      return false;
    }
    if (vertex.normal !== undefined && !isVec3(vertex.normal)) {
      return false;
    }
    if (
      vertex.tangent !== undefined &&
      (!isRecord(vertex.tangent) ||
        !isFiniteNumber(vertex.tangent.w) ||
        !isFiniteNumber(vertex.tangent.x) ||
        !isFiniteNumber(vertex.tangent.y) ||
        !isFiniteNumber(vertex.tangent.z))
    ) {
      return false;
    }
    if (
      vertex.uv !== undefined &&
      (!isRecord(vertex.uv) || !isFiniteNumber(vertex.uv.u) || !isFiniteNumber(vertex.uv.v))
    ) {
      return false;
    }
    if (
      vertex.color !== undefined &&
      (!isRecord(vertex.color) ||
        !isFiniteNumber(vertex.color.r) ||
        !isFiniteNumber(vertex.color.g) ||
        !isFiniteNumber(vertex.color.b))
    ) {
      return false;
    }
  }
  return Object.entries(value.faces).every(([id, face]) => {
    if (!isRecord(face) || face.id !== id || !isStringArray(face.vertexIds) || face.vertexIds.length < 3) {
      return false;
    }
    return (
      face.vertexIds.every((vertexId) => Boolean(vertices[vertexId])) &&
      typeof face.materialId === 'string' &&
      materialIds.has(face.materialId)
    );
  });
}

function isMaterial(value: unknown, id: string): value is MaterialData {
  return (
    isRecord(value) &&
    value.id === id &&
    typeof value.name === 'string' &&
    isColor(value.baseColor) &&
    isFiniteNumber(value.roughness) &&
    value.roughness >= 0 &&
    value.roughness <= 1 &&
    isFiniteNumber(value.metalness) &&
    value.metalness >= 0 &&
    value.metalness <= 1 &&
    isFiniteNumber(value.opacity) &&
    value.opacity >= 0 &&
    value.opacity <= 1 &&
    typeof value.flatShading === 'boolean' &&
    (value.baseColorTextureId === undefined || typeof value.baseColorTextureId === 'string')
  );
}

function isTexture(value: unknown, id: string): boolean {
  return (
    isRecord(value) &&
    value.id === id &&
    typeof value.name === 'string' &&
    value.mimeType === 'image/png' &&
    value.colorSpace === 'srgb' &&
    typeof value.dataUrl === 'string' &&
    value.dataUrl.startsWith('data:image/png;base64,') &&
    isFiniteNumber(value.width) &&
    Number.isInteger(value.width) &&
    value.width > 0 &&
    value.width <= 2048 &&
    isFiniteNumber(value.height) &&
    Number.isInteger(value.height) &&
    value.height > 0 &&
    value.height <= 2048
  );
}

function isMirrorModifier(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.axis === 'x' || value.axis === 'y' || value.axis === 'z') &&
    isFiniteNumber(value.seamTolerance) &&
    value.seamTolerance >= 0
  );
}

function isNode(value: unknown, id: string, materialIds: Set<string>): value is EditorNode {
  if (
    !isRecord(value) ||
    value.id !== id ||
    typeof value.name !== 'string' ||
    !(typeof value.parentId === 'string' || value.parentId === null) ||
    typeof value.hidden !== 'boolean' ||
    !isTransform(value.transform)
  ) {
    return false;
  }
  if (value.type === 'group') {
    return true;
  }
  return (
    value.type === 'mesh' &&
    isMesh(value.mesh, materialIds) &&
    (value.mirrorModifier === undefined || isMirrorModifier(value.mirrorModifier))
  );
}

function hasValidHierarchy(nodes: Record<string, unknown>, rootId: string): boolean {
  const root = nodes[rootId];
  if (!isRecord(root) || root.parentId !== null || root.type !== 'group') {
    return false;
  }
  return Object.keys(nodes).every((id) => {
    const seen = new Set<string>();
    let currentId: string | null = id;
    while (currentId !== null) {
      if (seen.has(currentId)) {
        return false;
      }
      seen.add(currentId);
      const current = nodes[currentId];
      if (!isRecord(current)) {
        return false;
      }
      const parentId = current.parentId;
      if (parentId !== null && (typeof parentId !== 'string' || !nodes[parentId])) {
        return false;
      }
      currentId = parentId as string | null;
    }
    return seen.has(rootId);
  });
}

function isDocument(value: unknown): value is SceneDocument {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 0
  ) {
    return false;
  }
  if (!isRecord(value.metadata) || typeof value.metadata.forwardConfirmed !== 'boolean') {
    return false;
  }
  if (
    !isFiniteNumber(value.metadata.groundContactTolerance) ||
    value.metadata.groundContactTolerance < 0 ||
    !isFiniteNumber(value.metadata.groundReferenceY) ||
    typeof value.rootId !== 'string' ||
    !isRecord(value.nodes) ||
    !isRecord(value.materials) ||
    !isRecord(value.textures)
  ) {
    return false;
  }
  const materialIds = new Set(Object.keys(value.materials));
  const textureIds = new Set(Object.keys(value.textures));
  if (
    materialIds.size === 0 ||
    !Object.entries(value.materials).every(
      ([id, material]) =>
        isMaterial(material, id) &&
        (!material.baseColorTextureId || textureIds.has(material.baseColorTextureId)),
    ) ||
    !Object.entries(value.textures).every(([id, texture]) => isTexture(texture, id))
  ) {
    return false;
  }
  if (!Object.entries(value.nodes).every(([id, node]) => isNode(node, id, materialIds))) {
    return false;
  }
  return hasValidHierarchy(value.nodes, value.rootId);
}

const EDITOR_MODES: EditorMode[] = [
  'object',
  'vertex',
  'edge',
  'face',
  'pivot',
  'face-color',
  'texture-paint',
];

function isElementSelection(value: unknown, idKey: string): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (selection) =>
        isRecord(selection) && typeof selection.nodeId === 'string' && typeof selection[idKey] === 'string',
    )
  );
}

function isEditorState(value: unknown): value is PersistedEditorState {
  return (
    isRecord(value) &&
    isStringArray(value.selectedNodeIds) &&
    isElementSelection(value.selectedVertexIds, 'vertexId') &&
    isElementSelection(value.selectedFaceIds, 'faceId') &&
    isElementSelection(value.selectedEdgeIds, 'edgeId') &&
    typeof value.mode === 'string' &&
    EDITOR_MODES.includes(value.mode as EditorMode) &&
    typeof value.groundVisible === 'boolean' &&
    (value.transformTool === 'translate' ||
      value.transformTool === 'rotate' ||
      value.transformTool === 'scale') &&
    isColor(value.facePaintColor) &&
    isStringArray(value.facePaintRecentColors) &&
    value.facePaintRecentColors.every(isColor) &&
    isFiniteNumber(value.textureBrushOpacity) &&
    value.textureBrushOpacity >= 0 &&
    value.textureBrushOpacity <= 1 &&
    isFiniteNumber(value.textureBrushSize) &&
    value.textureBrushSize >= 1 &&
    value.textureBrushSize <= 512 &&
    (value.texturePaintTool === 'brush' ||
      value.texturePaintTool === 'eraser' ||
      value.texturePaintTool === 'eyedropper')
  );
}

/**
 * Version migrations are intentionally sequential. v1 is the first public format,
 * so older manifests fail clearly; a future reader must migrate N -> N+1 before
 * this validation step and never silently discard document data.
 */
function migrateManifest(value: unknown): unknown {
  if (!isRecord(value) || value.format !== SHADE_ASSET_FORMAT) {
    throw new Error('This file is not a Low-Poly Asset Editor .shadeasset project.');
  }
  if (typeof value.formatVersion !== 'number' || !Number.isInteger(value.formatVersion)) {
    throw new Error('Project manifest has no valid formatVersion.');
  }
  if (value.formatVersion > SHADE_ASSET_VERSION) {
    throw new Error(
      `Project format v${value.formatVersion} is newer than this editor supports (v${SHADE_ASSET_VERSION}).`,
    );
  }
  if (value.formatVersion === 1) {
    const document = isRecord(value.document) ? value.document : null;
    const editor = isRecord(value.editor) ? value.editor : null;
    if (!document || !editor) {
      throw new Error('Project format v1 is missing its document or editor payload.');
    }
    return {
      ...value,
      formatVersion: 2,
      document: { ...document, textures: document.textures ?? {} },
      editor: {
        ...editor,
        textureBrushOpacity: editor.textureBrushOpacity ?? 1,
        textureBrushSize: editor.textureBrushSize ?? 18,
        texturePaintTool: editor.texturePaintTool ?? 'brush',
      },
    };
  }
  if (value.formatVersion < SHADE_ASSET_VERSION) {
    throw new Error(`Project format v${value.formatVersion} has no available migration path.`);
  }
  return value;
}

function copyEditorState(editor: PersistedEditorState): PersistedEditorState {
  return {
    selectedNodeIds: [...editor.selectedNodeIds],
    selectedVertexIds: editor.selectedVertexIds.map((selection) => ({ ...selection })),
    selectedFaceIds: editor.selectedFaceIds.map((selection) => ({ ...selection })),
    selectedEdgeIds: editor.selectedEdgeIds.map((selection) => ({ ...selection })),
    mode: editor.mode,
    groundVisible: editor.groundVisible,
    transformTool: editor.transformTool,
    facePaintColor: editor.facePaintColor,
    facePaintRecentColors: [...editor.facePaintRecentColors],
    textureBrushOpacity: editor.textureBrushOpacity,
    textureBrushSize: editor.textureBrushSize,
    texturePaintTool: editor.texturePaintTool,
  };
}

export function createShadeAssetManifest(
  document: SceneDocument,
  editor: PersistedEditorState,
): ShadeAssetManifestV1 {
  return {
    format: SHADE_ASSET_FORMAT,
    formatVersion: SHADE_ASSET_VERSION,
    document,
    editor: copyEditorState(editor),
  };
}

export function serializeShadeAsset(document: SceneDocument, editor: PersistedEditorState): string {
  return `${JSON.stringify(createShadeAssetManifest(document, editor), null, 2)}\n`;
}

export function parseShadeAsset(source: string): ShadeAssetManifestV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(source) as unknown;
  } catch {
    throw new Error('Project file is not valid JSON.');
  }
  const migrated = migrateManifest(raw);
  if (
    !isRecord(migrated) ||
    !hasOnlyKnownKeys(migrated, ['format', 'formatVersion', 'document', 'editor']) ||
    !isDocument(migrated.document) ||
    !isEditorState(migrated.editor)
  ) {
    throw new Error('Project manifest is missing required data or contains invalid editable geometry.');
  }
  return {
    format: SHADE_ASSET_FORMAT,
    formatVersion: SHADE_ASSET_VERSION,
    document: migrated.document,
    editor: copyEditorState(migrated.editor),
  };
}

export function downloadShadeAsset(fileName: string, source: string): void {
  const link = window.document.createElement('a');
  const blob = new Blob([source], { type: SHADE_ASSET_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName.toLowerCase().endsWith('.shadeasset') ? fileName : `${fileName}.shadeasset`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
