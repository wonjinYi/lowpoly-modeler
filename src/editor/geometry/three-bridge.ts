import * as THREE from 'three';
import type { MaterialData, MeshData, MeshNode, SceneDocument, TextureData } from '../core/types';
import { getMirroredMeshPreview } from './mesh-operations';

export type RuntimeMaterial = THREE.MeshStandardMaterial;
export type RuntimeMesh = THREE.Mesh<THREE.BufferGeometry, RuntimeMaterial | RuntimeMaterial[]>;

export function meshDataToBufferGeometry(mesh: MeshData): {
  faceIds: string[];
  geometry: THREE.BufferGeometry;
  materialIds: string[];
} {
  const geometry = new THREE.BufferGeometry();
  const vertexIds = Object.keys(mesh.vertices);
  const vertexIndexById = new Map(vertexIds.map((vertexId, index) => [vertexId, index]));
  const positions = vertexIds.flatMap((vertexId) => {
    const position = mesh.vertices[vertexId].position;
    return [position.x, position.y, position.z];
  });
  const hasUvs = vertexIds.some((vertexId) => Boolean(mesh.vertices[vertexId].uv));
  const hasColors = vertexIds.some((vertexId) => Boolean(mesh.vertices[vertexId].color));
  const hasNormals = vertexIds.every((vertexId) => Boolean(mesh.vertices[vertexId].normal));
  const hasTangents = vertexIds.every((vertexId) => Boolean(mesh.vertices[vertexId].tangent));
  const uvs = hasUvs
    ? vertexIds.flatMap((vertexId) => {
        const uv = mesh.vertices[vertexId].uv ?? { u: 0, v: 0 };
        return [uv.u, uv.v];
      })
    : [];
  const colors = hasColors
    ? vertexIds.flatMap((vertexId) => {
        const color = mesh.vertices[vertexId].color ?? { r: 1, g: 1, b: 1 };
        return [color.r, color.g, color.b];
      })
    : [];
  const normals = hasNormals
    ? vertexIds.flatMap((vertexId) => {
        const normal = mesh.vertices[vertexId].normal!;
        return [normal.x, normal.y, normal.z];
      })
    : [];
  const tangents = hasTangents
    ? vertexIds.flatMap((vertexId) => {
        const tangent = mesh.vertices[vertexId].tangent!;
        return [tangent.x, tangent.y, tangent.z, tangent.w];
      })
    : [];
  const indices: number[] = [];
  const faceIds: string[] = [];
  const materialIds: string[] = [];
  let activeMaterialIndex = -1;
  let groupStart = 0;

  for (const face of Object.values(mesh.faces)) {
    const faceIndexes = face.vertexIds.map((vertexId) => vertexIndexById.get(vertexId));
    if (faceIndexes.length < 3 || faceIndexes.some((index) => index === undefined)) {
      continue;
    }
    let materialIndex = materialIds.indexOf(face.materialId);
    if (materialIndex === -1) {
      materialIds.push(face.materialId);
      materialIndex = materialIds.length - 1;
    }
    if (activeMaterialIndex !== materialIndex) {
      if (indices.length > groupStart) {
        geometry.addGroup(groupStart, indices.length - groupStart, activeMaterialIndex);
      }
      activeMaterialIndex = materialIndex;
      groupStart = indices.length;
    }
    for (let corner = 1; corner < faceIndexes.length - 1; corner += 1) {
      indices.push(faceIndexes[0]!, faceIndexes[corner]!, faceIndexes[corner + 1]!);
      faceIds.push(face.id);
    }
  }
  if (indices.length > groupStart) {
    geometry.addGroup(groupStart, indices.length - groupStart, activeMaterialIndex);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (hasUvs) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  if (hasColors) {
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  if (hasNormals) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  }
  if (hasTangents) {
    geometry.setAttribute('tangent', new THREE.Float32BufferAttribute(tangents, 4));
  }
  geometry.setIndex(indices);
  if (!hasNormals) {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  return { faceIds, geometry, materialIds };
}

function textureDataToThree(textureData: TextureData): THREE.Texture {
  const texture = new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = textureData.name;
  if (typeof Image === 'undefined') {
    texture.userData.lowpolyTextureReady = Promise.reject(
      new Error(`Texture "${textureData.name}" needs a browser image loader.`),
    );
    return texture;
  }
  const image = new Image();
  image.decoding = 'async';
  texture.userData.lowpolyTextureReady = new Promise<void>((resolve, reject) => {
    image.addEventListener('load', () => {
      texture.image = image;
      texture.needsUpdate = true;
      resolve();
    });
    image.addEventListener('error', () =>
      reject(new Error(`Texture "${textureData.name}" could not be loaded.`)),
    );
  });
  image.src = textureData.dataUrl;
  return texture;
}

export function materialDataToThree(
  material: MaterialData,
  hasVertexColors: boolean,
  texture?: TextureData,
): RuntimeMaterial {
  const runtimeMaterial = new THREE.MeshStandardMaterial({
    name: material.name,
    color: material.baseColor,
    roughness: material.roughness,
    metalness: material.metalness,
    opacity: material.opacity,
    transparent: material.opacity < 1,
    depthWrite: material.opacity >= 1,
    flatShading: material.flatShading,
    vertexColors: hasVertexColors,
  });
  if (texture) {
    runtimeMaterial.map = textureDataToThree(texture);
    runtimeMaterial.needsUpdate = true;
  }
  return runtimeMaterial;
}

export function disposeRuntimeMaterials(material: RuntimeMaterial | RuntimeMaterial[]): void {
  const disposedTextures = new Set<THREE.Texture>();
  (Array.isArray(material) ? material : [material]).forEach((entry) => {
    if (entry.map && !disposedTextures.has(entry.map)) {
      disposedTextures.add(entry.map);
      entry.map.dispose();
    }
    entry.dispose();
  });
}

export function createRuntimeMesh(node: MeshNode, document: SceneDocument): RuntimeMesh {
  const renderMesh = getMirroredMeshPreview(node.mesh, node.mirrorModifier);
  const { faceIds, geometry, materialIds } = meshDataToBufferGeometry(renderMesh);
  const hasVertexColors = Object.values(renderMesh.vertices).some((vertex) => Boolean(vertex.color));
  const resolvedMaterialIds = materialIds.length > 0 ? materialIds : ['material-1'];
  const materials = resolvedMaterialIds.map((materialId) => {
    const material = document.materials[materialId] ?? document.materials['material-1'];
    return materialDataToThree(
      material,
      hasVertexColors,
      material.baseColorTextureId ? document.textures[material.baseColorTextureId] : undefined,
    );
  });
  const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.name = node.name;
  mesh.userData.editorNodeId = node.id;
  mesh.userData.faceIds = faceIds;
  mesh.userData.meshData = renderMesh;
  mesh.userData.mirrorModifierKey = node.mirrorModifier
    ? `${node.mirrorModifier.axis}:${node.mirrorModifier.seamTolerance}`
    : null;
  mesh.userData.sourceMeshData = node.mesh;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
