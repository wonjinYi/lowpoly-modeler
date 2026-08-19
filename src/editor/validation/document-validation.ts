import { isFiniteTransform, type NodeId, type SceneDocument } from '../core/types';
import { getDegenerateFaceIds } from '../geometry/mesh-operations';
import { getSubtreeWorldBounds } from '../geometry/world-bounds';

export interface ValidationIssue {
  code:
    | 'empty-scene'
    | 'geometry-invalid'
    | 'hidden-root'
    | 'invalid-transform'
    | 'missing-material'
    | 'missing-texture'
    | 'missing-shade-pivot'
    | 'non-unit-scale'
    | 'not-grounded'
    | 'orientation-unconfirmed';
  message: string;
  nodeId?: NodeId;
  severity: 'error' | 'warning' | 'info';
}

function hasUnitScale(scale: { x: number; y: number; z: number }): boolean {
  return scale.x === 1 && scale.y === 1 && scale.z === 1;
}

export function validateDocumentForExport(document: SceneDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodes = Object.values(document.nodes);
  const exportableMeshes = nodes.filter((node) => node.type === 'mesh' && !node.hidden);
  if (exportableMeshes.length === 0) {
    issues.push({
      code: 'empty-scene',
      nodeId: document.rootId,
      severity: 'error',
      message: 'Add or show at least one mesh before exporting.',
    });
  }
  const root = document.nodes[document.rootId];
  if (root?.hidden) {
    issues.push({
      code: 'hidden-root',
      nodeId: document.rootId,
      severity: 'error',
      message: 'The asset root is hidden and cannot be exported.',
    });
  }
  const missingTextureIds = new Set(
    Object.values(document.materials)
      .map((material) => material.baseColorTextureId)
      .filter((textureId): textureId is string => textureId !== undefined)
      .filter((textureId) => !document.textures[textureId]),
  );
  if (missingTextureIds.size > 0) {
    issues.push({
      code: 'missing-texture',
      nodeId: document.rootId,
      severity: 'error',
      message: `The document references ${missingTextureIds.size} missing base-color texture payload(s).`,
    });
  }
  nodes.forEach((node) => {
    if (!isFiniteTransform(node.transform)) {
      issues.push({
        code: 'invalid-transform',
        nodeId: node.id,
        severity: 'error',
        message: `"${node.name}" has an invalid transform value.`,
      });
    }
    if (node.id !== document.rootId && !node.hidden && !hasUnitScale(node.transform.scale)) {
      issues.push({
        code: 'non-unit-scale',
        nodeId: node.id,
        severity: 'warning',
        message: `"${node.name}" has non-unit scale; apply scale before a game-ready export.`,
      });
    }
    if (node.type !== 'mesh' || node.hidden) {
      return;
    }
    const invalidFaceCount = Object.values(node.mesh.faces).filter(
      (face) =>
        face.vertexIds.length < 3 ||
        new Set(face.vertexIds).size !== face.vertexIds.length ||
        face.vertexIds.some((vertexId) => !node.mesh.vertices[vertexId]),
    ).length;
    const degenerateFaceCount = getDegenerateFaceIds(node.mesh).length;
    if (invalidFaceCount > 0 || degenerateFaceCount > 0) {
      issues.push({
        code: 'geometry-invalid',
        nodeId: node.id,
        severity: 'error',
        message: `"${node.name}" has ${invalidFaceCount + degenerateFaceCount} invalid or degenerate face(s).`,
      });
    }
    const missingMaterialIds = new Set(
      Object.values(node.mesh.faces)
        .map((face) => face.materialId)
        .filter((materialId) => !document.materials[materialId]),
    );
    if (missingMaterialIds.size > 0) {
      issues.push({
        code: 'missing-material',
        nodeId: node.id,
        severity: 'error',
        message: `"${node.name}" references ${missingMaterialIds.size} missing material(s).`,
      });
    }
  });
  if (exportableMeshes.length > 0 && !document.metadata.forwardConfirmed) {
    issues.push({
      code: 'orientation-unconfirmed',
      nodeId: document.rootId,
      severity: 'warning',
      message: 'Confirm that +Z is the intended game forward direction.',
    });
  }
  if (
    exportableMeshes.length > 0 &&
    !nodes.some((node) => node.name.trim().toLowerCase() === 'shade_pivot')
  ) {
    issues.push({
      code: 'missing-shade-pivot',
      nodeId: document.rootId,
      severity: 'warning',
      message: 'No shade_pivot was found. Add one if the asset needs gameplay rotation.',
    });
  }
  const worldBounds = getSubtreeWorldBounds(document, document.rootId);
  const { groundContactTolerance, groundReferenceY } = document.metadata;
  const groundOffset = worldBounds ? worldBounds.min.y - groundReferenceY : 0;
  if (exportableMeshes.length > 0 && worldBounds && Math.abs(groundOffset) > groundContactTolerance) {
    issues.push({
      code: 'not-grounded',
      nodeId: document.rootId,
      severity: 'warning',
      message: `Asset ground contact is ${worldBounds.min.y.toFixed(3)} on Y; target is ${groundReferenceY.toFixed(3)} ± ${groundContactTolerance.toFixed(3)}.`,
    });
  }
  return issues;
}
