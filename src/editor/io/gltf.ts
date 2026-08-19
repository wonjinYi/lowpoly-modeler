import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeMirrorModifiersForExport, createEmptyDocument } from '../core/document';
import type {
  EditorNode,
  MaterialData,
  MaterialId,
  MeshData,
  MeshFace,
  MeshVertex,
  NodeId,
  SceneDocument,
  TextureData,
  Transform,
} from '../core/types';
import { createRuntimeMesh, disposeRuntimeMaterials } from '../geometry/three-bridge';
import { getSubtreeWorldBounds } from '../geometry/world-bounds';

export const GLB_MIME_TYPE = 'model/gltf-binary';

export interface ImportedGlb {
  document: SceneDocument;
  warnings: string[];
}

export interface ExportedGlb {
  arrayBuffer: ArrayBuffer;
  hiddenNodeCount: number;
}

type ReadableAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function toTransform(object: THREE.Object3D): Transform {
  return {
    position: { x: object.position.x, y: object.position.y, z: object.position.z },
    rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
    scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
  };
}

function applyTransform(object: THREE.Object3D, transform: Transform): void {
  object.position.set(transform.position.x, transform.position.y, transform.position.z);
  object.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
}

function nextId(usedIds: Set<string>, prefix: string): string {
  let index = 1;
  while (usedIds.has(`${prefix}-${index}`)) {
    index += 1;
  }
  const id = `${prefix}-${index}`;
  usedIds.add(id);
  return id;
}

function colorHex(material: THREE.Material): string {
  const color = (material as THREE.MeshStandardMaterial).color;
  return color?.isColor ? `#${color.getHexString()}` : '#b8c8c1';
}

function materialFromThree(
  material: THREE.Material,
  id: MaterialId,
  baseColorTextureId?: string,
): MaterialData {
  const standardMaterial = material as THREE.MeshStandardMaterial;
  return {
    id,
    name: material.name || `Material ${id.replace('material-', '')}`,
    baseColor: colorHex(material),
    roughness: Number.isFinite(standardMaterial.roughness) ? standardMaterial.roughness : 0.82,
    metalness: Number.isFinite(standardMaterial.metalness) ? standardMaterial.metalness : 0,
    opacity: Number.isFinite(material.opacity) ? material.opacity : 1,
    flatShading: Boolean(standardMaterial.flatShading),
    baseColorTextureId,
  };
}

async function textureDataFromThree(texture: THREE.Texture, id: string): Promise<TextureData | null> {
  if (typeof document === 'undefined' || !texture.image) {
    return null;
  }
  const source = texture.image as CanvasImageSource & { height?: number; width?: number };
  const width = source.width;
  const height = source.height;
  if (!width || !height || width < 1 || height < 1 || width > 2048 || height > 2048) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  try {
    context.drawImage(source, 0, 0, width, height);
    return {
      colorSpace: 'srgb',
      dataUrl: canvas.toDataURL('image/png'),
      height,
      id,
      mimeType: 'image/png',
      name: texture.name || `Texture ${id.replace('texture-', '')}`,
      width,
    };
  } catch {
    return null;
  }
}

async function collectTexturePayloads(
  scene: THREE.Group,
  warnings: string[],
): Promise<{ textureIdBySource: Map<THREE.Texture, string>; textures: Record<string, TextureData> }> {
  const sourceTextures = new Set<THREE.Texture>();
  scene.traverse((object) => {
    if (!isMesh(object)) {
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      const map = (material as THREE.MeshStandardMaterial).map;
      if (map) {
        sourceTextures.add(map);
      }
    });
  });
  const textureIdBySource = new Map<THREE.Texture, string>();
  const textures: Record<string, TextureData> = {};
  let index = 1;
  for (const texture of sourceTextures) {
    const id = `texture-${index}`;
    index += 1;
    const payload = await textureDataFromThree(texture, id);
    if (payload) {
      textureIdBySource.set(texture, id);
      textures[id] = payload;
    } else {
      warnings.push(
        `Could not make the base-color texture "${texture.name || id}" editable; its material color remains.`,
      );
    }
  }
  return { textureIdBySource, textures };
}

function attributeVector3(attribute: ReadableAttribute, index: number): { x: number; y: number; z: number } {
  return { x: attribute.getX(index), y: attribute.getY(index), z: attribute.getZ(index) };
}

function attributeVector4(
  attribute: ReadableAttribute,
  index: number,
): { w: number; x: number; y: number; z: number } {
  return {
    x: attribute.getX(index),
    y: attribute.getY(index),
    z: attribute.getZ(index),
    w: attribute.getW(index),
  };
}

export function importBufferGeometry(
  geometry: THREE.BufferGeometry,
  materials: THREE.Material | THREE.Material[],
  resolveMaterial: (material: THREE.Material | undefined) => MaterialId,
  nodeId: NodeId,
): MeshData | null {
  const positions = geometry.getAttribute('position') as ReadableAttribute | undefined;
  if (!positions || positions.count === 0) {
    return null;
  }
  const normals = geometry.getAttribute('normal') as ReadableAttribute | undefined;
  const tangents = geometry.getAttribute('tangent') as ReadableAttribute | undefined;
  const uvs = geometry.getAttribute('uv') as ReadableAttribute | undefined;
  const colors = geometry.getAttribute('color') as ReadableAttribute | undefined;
  const vertices: Record<string, MeshVertex> = {};
  for (let index = 0; index < positions.count; index += 1) {
    const id = `${nodeId}-vertex-${index + 1}`;
    vertices[id] = {
      id,
      position: attributeVector3(positions, index),
      normal: normals ? attributeVector3(normals, index) : undefined,
      tangent: tangents ? attributeVector4(tangents, index) : undefined,
      uv: uvs ? { u: uvs.getX(index), v: uvs.getY(index) } : undefined,
      color: colors ? { r: colors.getX(index), g: colors.getY(index), b: colors.getZ(index) } : undefined,
    };
  }

  const materialList = Array.isArray(materials) ? materials : [materials];
  const sourceIndexes = geometry.getIndex();
  const indexCount = sourceIndexes ? sourceIndexes.count : positions.count;
  const faces: Record<string, MeshFace> = {};
  for (let offset = 0; offset + 2 < indexCount; offset += 3) {
    const vertexIndexes = [0, 1, 2].map((corner) =>
      sourceIndexes ? sourceIndexes.getX(offset + corner) : offset + corner,
    );
    const group = geometry.groups.find(
      (candidate) => offset >= candidate.start && offset < candidate.start + candidate.count,
    );
    const materialId = resolveMaterial(materialList[group?.materialIndex ?? 0]);
    const faceId = `${nodeId}-face-${offset / 3 + 1}`;
    faces[faceId] = {
      id: faceId,
      vertexIds: vertexIndexes.map((index) => `${nodeId}-vertex-${index + 1}`),
      materialId,
    };
  }

  return { vertices, faces };
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh;
}

function createDocumentFromScene(
  scene: THREE.Group,
  warnings: string[],
  textureIdBySource: Map<THREE.Texture, string>,
  textures: Record<string, TextureData>,
): SceneDocument {
  const document = createEmptyDocument();
  document.textures = textures;
  const exportedAssetRoot =
    scene.children.length === 1 && scene.children[0]?.name.trim().toLowerCase() === 'asset_root'
      ? scene.children[0]
      : undefined;
  const sourceRoot = exportedAssetRoot ?? scene;
  const root = document.nodes[document.rootId];
  root.name = sourceRoot.name || 'asset_root';
  root.hidden = !sourceRoot.visible;
  root.transform = toTransform(sourceRoot);
  const nodeIds = new Set(Object.keys(document.nodes));
  const materialIds = new Set(Object.keys(document.materials));
  const importedMaterials = new Map<THREE.Material, MaterialId>();

  const resolveMaterial = (source: THREE.Material | undefined): MaterialId => {
    if (!source) {
      return 'material-1';
    }
    const existingId = importedMaterials.get(source);
    if (existingId) {
      return existingId;
    }
    const materialId = nextId(materialIds, 'material');
    const map = (source as THREE.MeshStandardMaterial).map;
    document.materials[materialId] = materialFromThree(
      source,
      materialId,
      map ? textureIdBySource.get(map) : undefined,
    );
    importedMaterials.set(source, materialId);
    return materialId;
  };

  const visit = (object: THREE.Object3D, parentId: NodeId): void => {
    if (object instanceof THREE.Camera || object instanceof THREE.Light) {
      warnings.push(`Ignored ${object.type.toLowerCase()} "${object.name || object.uuid}".`);
      return;
    }

    const id = nextId(nodeIds, 'node');
    let node: EditorNode;
    if (isMesh(object)) {
      const meshData = importBufferGeometry(object.geometry, object.material, resolveMaterial, id);
      if (!meshData) {
        warnings.push(`Ignored mesh "${object.name || object.uuid}" because it has no position attribute.`);
        object.children.forEach((child) => visit(child, parentId));
        return;
      }
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
        warnings.push(`Imported skinned mesh "${object.name || object.uuid}" as a static mesh.`);
      }
      if (Object.keys(object.morphTargetDictionary ?? {}).length > 0) {
        warnings.push(
          `Imported morph target mesh "${object.name || object.uuid}" at its current base shape.`,
        );
      }
      node = {
        id,
        name: object.name || `Mesh ${id.replace('node-', '')}`,
        parentId,
        hidden: !object.visible,
        transform: toTransform(object),
        type: 'mesh',
        mesh: meshData,
      };
    } else {
      node = {
        id,
        name: object.name || `Group ${id.replace('node-', '')}`,
        parentId,
        hidden: !object.visible,
        transform: toTransform(object),
        type: 'group',
      };
    }
    document.nodes[id] = node;
    object.children.forEach((child) => visit(child, id));
  };

  sourceRoot.children.forEach((child) => visit(child, document.rootId));
  return document;
}

export async function importGlb(arrayBuffer: ArrayBuffer): Promise<ImportedGlb> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(arrayBuffer, '');
  const warnings: string[] = [];
  if (gltf.animations.length > 0) {
    warnings.push(
      `Ignored ${gltf.animations.length} animation clip${gltf.animations.length === 1 ? '' : 's'}.`,
    );
  }
  const { textureIdBySource, textures } = await collectTexturePayloads(gltf.scene, warnings);
  return { document: createDocumentFromScene(gltf.scene, warnings, textureIdBySource, textures), warnings };
}

function buildExportObject(document: SceneDocument, nodeId: NodeId): THREE.Object3D | null {
  const node = document.nodes[nodeId];
  if (!node || node.hidden) {
    return null;
  }
  const object = node.type === 'mesh' ? createRuntimeMesh(node, document) : new THREE.Group();
  object.name = node.name;
  applyTransform(object, node.transform);
  Object.values(document.nodes)
    .filter((child) => child.parentId === node.id)
    .forEach((child) => {
      const childObject = buildExportObject(document, child.id);
      if (childObject) {
        object.add(childObject);
      }
    });
  return object;
}

function disposeExportObject(object: THREE.Object3D): void {
  object.traverse((entry) => {
    if (entry instanceof THREE.Mesh) {
      entry.geometry.dispose();
      disposeRuntimeMaterials(entry.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]);
    }
  });
}

async function waitForRuntimeTextures(object: THREE.Object3D): Promise<void> {
  const readiness: Promise<void>[] = [];
  object.traverse((entry) => {
    if (!(entry instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(entry.material) ? entry.material : [entry.material];
    materials.forEach((material) => {
      const ready = material.map?.userData.lowpolyTextureReady;
      if (ready instanceof Promise) {
        readiness.push(ready as Promise<void>);
      }
    });
  });
  await Promise.all(readiness);
}

function countHiddenNodes(document: SceneDocument): number {
  return Object.values(document.nodes).filter((node) => node.id !== document.rootId && node.hidden).length;
}

function visibleMeshCount(document: SceneDocument): number {
  return Object.values(document.nodes).filter((node) => node.type === 'mesh' && !node.hidden).length;
}

function boundsMatch(
  first: ReturnType<typeof getSubtreeWorldBounds>,
  second: ReturnType<typeof getSubtreeWorldBounds>,
  tolerance = 0.001,
): boolean {
  if (!first || !second) {
    return first === second;
  }
  return [
    first.min.x - second.min.x,
    first.min.y - second.min.y,
    first.min.z - second.min.z,
    first.max.x - second.max.x,
    first.max.y - second.max.y,
    first.max.z - second.max.z,
  ].every((difference) => Math.abs(difference) <= tolerance);
}

async function validateExportRoundTrip(document: SceneDocument, arrayBuffer: ArrayBuffer): Promise<void> {
  const reimported = await importGlb(arrayBuffer);
  if (visibleMeshCount(reimported.document) !== visibleMeshCount(document)) {
    throw new Error('Export verification found a different number of visible mesh nodes.');
  }
  if (
    !boundsMatch(
      getSubtreeWorldBounds(document, document.rootId),
      getSubtreeWorldBounds(reimported.document, reimported.document.rootId),
    )
  ) {
    throw new Error('Export verification found changed world bounds.');
  }
  const sourceUsesUnitScale = Object.values(document.nodes)
    .filter((node) => !node.hidden)
    .every(
      (node) => node.transform.scale.x === 1 && node.transform.scale.y === 1 && node.transform.scale.z === 1,
    );
  if (
    sourceUsesUnitScale &&
    !Object.values(reimported.document.nodes)
      .filter((node) => !node.hidden)
      .every(
        (node) =>
          node.transform.scale.x === 1 && node.transform.scale.y === 1 && node.transform.scale.z === 1,
      )
  ) {
    throw new Error('Export verification found a non-unit scale in a unit-scale asset.');
  }
  const sourceHasShadePivot = Object.values(document.nodes).some(
    (node) => !node.hidden && node.name.trim().toLowerCase() === 'shade_pivot',
  );
  const importedHasShadePivot = Object.values(reimported.document.nodes).some(
    (node) => !node.hidden && node.name.trim().toLowerCase() === 'shade_pivot',
  );
  if (sourceHasShadePivot && !importedHasShadePivot) {
    throw new Error('Export verification could not find shade_pivot after reimport.');
  }
}

export async function exportGlb(document: SceneDocument): Promise<ExportedGlb> {
  const exportDocument = bakeMirrorModifiersForExport(document);
  const root = buildExportObject(exportDocument, exportDocument.rootId);
  if (!root) {
    throw new Error('The asset root is hidden, so there is nothing to export.');
  }
  const exporter = new GLTFExporter();
  try {
    await waitForRuntimeTextures(root);
    const result = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        root,
        (output) => {
          if (output instanceof ArrayBuffer) {
            resolve(output);
            return;
          }
          reject(new Error('The exporter returned JSON instead of a binary GLB.'));
        },
        (error) => reject(new Error(error.message || 'Unable to export GLB.')),
        { binary: true, onlyVisible: false, trs: true },
      );
    });
    await validateExportRoundTrip(exportDocument, result);
    return { arrayBuffer: result, hiddenNodeCount: countHiddenNodes(exportDocument) };
  } finally {
    disposeExportObject(root);
  }
}

export function downloadGlb(fileName: string, arrayBuffer: ArrayBuffer): void {
  const link = window.document.createElement('a');
  const blob = new Blob([arrayBuffer], { type: GLB_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName.toLowerCase().endsWith('.glb') ? fileName : `${fileName}.glb`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
