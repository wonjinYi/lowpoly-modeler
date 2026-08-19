import * as THREE from 'three';
import type { EditorNode, NodeId, SceneDocument, Transform, Vec3 } from '../core/types';
import { getMirroredMeshPreview } from './mesh-operations';

export interface WorldBounds {
  max: Vec3;
  min: Vec3;
}

function matrixFromTransform(transform: Transform): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(transform.position.x, transform.position.y, transform.position.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(transform.rotation.x, transform.rotation.y, transform.rotation.z),
    ),
    new THREE.Vector3(transform.scale.x, transform.scale.y, transform.scale.z),
  );
}

export function getNodeWorldMatrix(document: SceneDocument, nodeId: NodeId): THREE.Matrix4 | null {
  const node = document.nodes[nodeId];
  if (!node) {
    return null;
  }
  const chain: EditorNode[] = [];
  const seen = new Set<NodeId>();
  let current: EditorNode | undefined = node;
  while (current) {
    if (seen.has(current.id)) {
      return null;
    }
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? document.nodes[current.parentId] : undefined;
  }
  return chain.reduce(
    (worldMatrix, entry) => worldMatrix.multiply(matrixFromTransform(entry.transform)),
    new THREE.Matrix4(),
  );
}

function isDescendantOrSelf(document: SceneDocument, node: EditorNode, ancestorId: NodeId): boolean {
  const seen = new Set<NodeId>();
  let current: EditorNode | undefined = node;
  while (current) {
    if (current.id === ancestorId) {
      return true;
    }
    if (seen.has(current.id)) {
      return false;
    }
    seen.add(current.id);
    current = current.parentId ? document.nodes[current.parentId] : undefined;
  }
  return false;
}

export function getSubtreeWorldBounds(document: SceneDocument, nodeId: NodeId): WorldBounds | null {
  let min: Vec3 | null = null;
  let max: Vec3 | null = null;
  Object.values(document.nodes).forEach((node) => {
    if (node.type !== 'mesh' || !isDescendantOrSelf(document, node, nodeId)) {
      return;
    }
    const worldMatrix = getNodeWorldMatrix(document, node.id);
    if (!worldMatrix) {
      return;
    }
    Object.values(getMirroredMeshPreview(node.mesh, node.mirrorModifier).vertices).forEach((vertex) => {
      const worldPosition = new THREE.Vector3(
        vertex.position.x,
        vertex.position.y,
        vertex.position.z,
      ).applyMatrix4(worldMatrix);
      if (!min || !max) {
        min = { x: worldPosition.x, y: worldPosition.y, z: worldPosition.z };
        max = { ...min };
        return;
      }
      min.x = Math.min(min.x, worldPosition.x);
      min.y = Math.min(min.y, worldPosition.y);
      min.z = Math.min(min.z, worldPosition.z);
      max.x = Math.max(max.x, worldPosition.x);
      max.y = Math.max(max.y, worldPosition.y);
      max.z = Math.max(max.z, worldPosition.z);
    });
  });
  return min && max ? { min, max } : null;
}

export function getGroundTranslationInParentSpace(
  document: SceneDocument,
  nodeId: NodeId,
  groundReferenceY = 0,
): Vec3 | null {
  const node = document.nodes[nodeId];
  const bounds = getSubtreeWorldBounds(document, nodeId);
  if (!node || !bounds || !Number.isFinite(groundReferenceY) || bounds.min.y === groundReferenceY) {
    return null;
  }
  const parentWorldMatrix = node.parentId ? getNodeWorldMatrix(document, node.parentId) : new THREE.Matrix4();
  if (!parentWorldMatrix) {
    return null;
  }
  const parentLinearMatrix = new THREE.Matrix3().setFromMatrix4(parentWorldMatrix);
  if (parentLinearMatrix.determinant() === 0) {
    return null;
  }
  const localTranslation = new THREE.Vector3(0, groundReferenceY - bounds.min.y, 0).applyMatrix3(
    parentLinearMatrix.invert(),
  );
  return { x: localTranslation.x, y: localTranslation.y, z: localTranslation.z };
}
