import {
  createDocumentCommand,
  EMPTY_HISTORY,
  executeCommand,
  redoCommand,
  undoCommand,
  type CommandHistory,
} from '../commands/history';
import {
  createEmptyDocument,
  autoUvNodeGeometry,
  colorNodeFaces,
  createGroupNode,
  createPrimitiveNode,
  applyNodeScale,
  bevelNodeEdge,
  bendNodeGeometry,
  bakeNodeMirrorModifier,
  commitBooleanMesh,
  deleteNodeDegenerateFaces,
  deleteNodeEdges,
  deleteMeshFaces,
  deleteMeshVertices,
  extrudeNodeFaces,
  insetNodeFaces,
  loopCutNodeEdge,
  dissolveNodeEdges,
  flipMeshFaces,
  insertNode,
  mergeNodeVertices,
  mergeNodeVerticesByDistance,
  mergeNodeVertexGroups,
  mirrorNodeGeometry,
  moveNodeToGround,
  removeNode,
  renameNode,
  recalculateNodeNormals,
  resizeNodeGeometry,
  separateNodeFaces,
  setNodeParent,
  setNodeHidden,
  setGroundContactTolerance,
  setGroundReference,
  setNodeMirrorModifier,
  setMaterialTexture,
  setForwardConfirmed,
  subdivideNodeEdges,
  transformNodeGeometry,
  updateNodeTransform,
  updateMaterialProperties,
  updateMeshVertexPosition,
} from './document';
import type { GeometryTransformOrientation } from './document';
import type {
  EdgeSelection,
  BooleanPreview,
  EditorMode,
  FaceSelection,
  MaterialData,
  MaterialId,
  MirrorModifier,
  NodeId,
  PersistedEditorState,
  PrimitiveKind,
  PrimitiveOptions,
  SceneDocument,
  Transform,
  TransformTool,
  TextureData,
  VertexSelection,
} from './types';
import { getMergeableDuplicateVertexGroups, getMeshEdges } from '../geometry/topology';
import { getDegenerateFaceIds, inspectTrisToQuad, traceLoopCut } from '../geometry/mesh-operations';
import { getSubtreeWorldBounds } from '../geometry/world-bounds';
import type { BendAxis, MeshElementTransform } from '../geometry/mesh-operations';

export interface EditorState {
  document: SceneDocument;
  history: CommandHistory;
  selectedNodeIds: NodeId[];
  selectedVertexIds: VertexSelection[];
  selectedFaceIds: FaceSelection[];
  selectedEdgeIds: EdgeSelection[];
  mode: EditorMode;
  groundVisible: boolean;
  shadowPreview: boolean;
  pivotPreview: { nodeId: NodeId; rotationY: number } | null;
  booleanPreview: BooleanPreview | null;
  transformTool: TransformTool;
  activeTransaction: { label: string; before: SceneDocument; dirtyBefore: boolean } | null;
  dirty: boolean;
  facePaintColor: string;
  facePaintRecentColors: string[];
  textureBrushOpacity: number;
  textureBrushSize: number;
  texturePaintInFlight: boolean;
  texturePaintTool: 'brush' | 'eraser' | 'eyedropper';
  notice: { kind: 'info' | 'error'; message: string } | null;
}

export type EditorListener = () => void;

export interface EditorStore {
  getState: () => EditorState;
  subscribe: (listener: EditorListener) => () => void;
  addPrimitive: (primitive: PrimitiveKind, options?: PrimitiveOptions) => void;
  addPivot: (name?: string) => void;
  applyScale: (nodeId: NodeId) => void;
  autoUvSelected: () => void;
  bevelSelectedEdge: (width: number, segments?: number) => void;
  bendSelectedGeometry: (
    axis: BendAxis,
    angleRadians: number,
    origin: { x: number; y: number; z: number },
  ) => void;
  colorSelectedFaces: (hexColor: string) => void;
  paintFace: (selection: FaceSelection) => void;
  beginTransaction: (label: string) => void;
  cancelTransaction: () => void;
  commitTransaction: () => void;
  deleteSelected: () => void;
  deleteSelectedFaces: () => void;
  deleteSelectedEdges: () => void;
  deleteSelectedDegenerateFaces: (nodeId: NodeId) => void;
  deleteSelectedVertices: () => void;
  mergeSelectedVertices: () => void;
  mergeSelectedVerticesByDistance: (distance: number) => void;
  cleanupDuplicateVertices: (nodeId: NodeId, tolerance: number) => void;
  mirrorSelectedGeometry: (axis: BendAxis, seamTolerance: number) => void;
  setSelectedMirrorModifier: (modifier: MirrorModifier | null) => void;
  bakeSelectedMirrorModifier: () => void;
  setBooleanPreview: (preview: Omit<BooleanPreview, 'documentRevision'>) => void;
  clearBooleanPreview: () => void;
  commitBooleanPreview: () => void;
  moveSelectedToGround: () => void;
  dissolveSelectedEdges: () => void;
  loopCutSelectedEdge: (factor: number) => void;
  subdivideSelectedEdges: () => void;
  trisToQuadSelectedEdge: () => void;
  newDocument: () => void;
  renameNode: (nodeId: NodeId, name: string) => void;
  updateMaterial: (
    materialId: MaterialId,
    patch: Partial<Pick<MaterialData, 'baseColor' | 'flatShading' | 'metalness' | 'opacity' | 'roughness'>>,
  ) => void;
  setMaterialTexturePayload: (materialId: MaterialId, texture: TextureData | null) => void;
  paintTextureStroke: (
    nodeId: NodeId,
    materialId: MaterialId,
    points: Array<{ u: number; v: number }>,
  ) => Promise<void>;
  setTextureBrushOpacity: (opacity: number) => void;
  setTextureBrushSize: (size: number) => void;
  setTexturePaintTool: (tool: EditorState['texturePaintTool']) => void;
  flipSelectedFaces: () => void;
  extrudeSelectedFaces: (distance: number) => void;
  insetSelectedFaces: (factor: number) => void;
  selectNodes: (nodeIds: NodeId[]) => void;
  selectVertices: (selections: VertexSelection[]) => void;
  selectFaces: (selections: FaceSelection[]) => void;
  selectEdges: (selections: EdgeSelection[]) => void;
  setMode: (mode: EditorMode) => void;
  setGroundVisible: (visible: boolean) => void;
  setShadowPreview: (enabled: boolean) => void;
  setPivotPreview: (nodeId: NodeId, rotationY: number) => void;
  commitPivotPreview: () => void;
  cancelPivotPreview: () => void;
  setGroundContactTolerance: (tolerance: number) => void;
  setGroundReference: (groundReferenceY: number) => void;
  setGroundReferenceFromSelected: () => void;
  setFacePaintColor: (hexColor: string) => void;
  setForwardConfirmed: (confirmed: boolean) => void;
  setNodeHidden: (nodeId: NodeId, hidden: boolean) => void;
  setNodeParent: (nodeId: NodeId, parentId: NodeId) => void;
  resizeGeometry: (nodeId: NodeId, targetSize: { x: number; y: number; z: number }) => void;
  setTransform: (nodeId: NodeId, transform: Transform) => void;
  transformSelectedGeometry: (
    transform: MeshElementTransform,
    orientation?: GeometryTransformOrientation,
  ) => void;
  setVertexPosition: (selection: VertexSelection, position: { x: number; y: number; z: number }) => void;
  setTransformTool: (tool: TransformTool) => void;
  undo: () => void;
  redo: () => void;
  recalculateNormals: (nodeId: NodeId) => void;
  separateSelectedFaces: () => void;
  replaceDocument: (document: SceneDocument, selectedNodeIds?: NodeId[]) => void;
  replaceProject: (document: SceneDocument, editor: PersistedEditorState) => void;
  markSaved: () => void;
  setNotice: (notice: EditorState['notice']) => void;
}

function nodeIdsPresentIn(document: SceneDocument, nodeIds: NodeId[]): NodeId[] {
  return nodeIds.filter((nodeId) => Boolean(document.nodes[nodeId]));
}

function vertexSelectionsPresentIn(
  document: SceneDocument,
  selections: VertexSelection[],
): VertexSelection[] {
  const seen = new Set<string>();
  return selections.filter((selection) => {
    const node = document.nodes[selection.nodeId];
    const key = `${selection.nodeId}:${selection.vertexId}`;
    if (seen.has(key) || node?.type !== 'mesh' || !node.mesh.vertices[selection.vertexId]) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function faceSelectionsPresentIn(document: SceneDocument, selections: FaceSelection[]): FaceSelection[] {
  const seen = new Set<string>();
  return selections.filter((selection) => {
    const node = document.nodes[selection.nodeId];
    const key = `${selection.nodeId}:${selection.faceId}`;
    if (seen.has(key) || node?.type !== 'mesh' || !node.mesh.faces[selection.faceId]) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function edgeSelectionsPresentIn(document: SceneDocument, selections: EdgeSelection[]): EdgeSelection[] {
  const seen = new Set<string>();
  return selections.filter((selection) => {
    const node = document.nodes[selection.nodeId];
    const key = `${selection.nodeId}:${selection.edgeId}`;
    if (
      seen.has(key) ||
      node?.type !== 'mesh' ||
      !getMeshEdges(node.mesh).some((edge) => edge.id === selection.edgeId)
    ) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function groupFacesByNode(selections: FaceSelection[]): Map<NodeId, FaceSelection[]> {
  return selections.reduce((groups, selection) => {
    const nodeSelections = groups.get(selection.nodeId) ?? [];
    nodeSelections.push(selection);
    groups.set(selection.nodeId, nodeSelections);
    return groups;
  }, new Map<NodeId, FaceSelection[]>());
}

function groupVerticesByNode(selections: VertexSelection[]): Map<NodeId, VertexSelection[]> {
  return selections.reduce((groups, selection) => {
    const nodeSelections = groups.get(selection.nodeId) ?? [];
    nodeSelections.push(selection);
    groups.set(selection.nodeId, nodeSelections);
    return groups;
  }, new Map<NodeId, VertexSelection[]>());
}

function groupEdgesByNode(selections: EdgeSelection[]): Map<NodeId, EdgeSelection[]> {
  return selections.reduce((groups, selection) => {
    const nodeSelections = groups.get(selection.nodeId) ?? [];
    nodeSelections.push(selection);
    groups.set(selection.nodeId, nodeSelections);
    return groups;
  }, new Map<NodeId, EdgeSelection[]>());
}

function selectedGeometryVertexIdsByNode(document: SceneDocument, state: EditorState): Map<NodeId, string[]> {
  const groups = new Map<NodeId, Set<string>>();
  const add = (nodeId: NodeId, vertexIds: string[]): void => {
    const node = document.nodes[nodeId];
    if (!node || node.type !== 'mesh') {
      return;
    }
    const ids = groups.get(nodeId) ?? new Set<string>();
    vertexIds.forEach((vertexId) => {
      if (node.mesh.vertices[vertexId]) {
        ids.add(vertexId);
      }
    });
    if (ids.size > 0) {
      groups.set(nodeId, ids);
    }
  };

  if (state.mode === 'vertex') {
    state.selectedVertexIds.forEach((selection) => add(selection.nodeId, [selection.vertexId]));
  } else if (state.mode === 'edge') {
    state.selectedEdgeIds.forEach((selection) => {
      const node = document.nodes[selection.nodeId];
      const edge =
        node?.type === 'mesh'
          ? getMeshEdges(node.mesh).find((item) => item.id === selection.edgeId)
          : undefined;
      if (edge) {
        add(selection.nodeId, [edge.vertexAId, edge.vertexBId]);
      }
    });
  } else if (state.mode === 'face') {
    state.selectedFaceIds.forEach((selection) => {
      const node = document.nodes[selection.nodeId];
      const face = node?.type === 'mesh' ? node.mesh.faces[selection.faceId] : undefined;
      if (face) {
        add(selection.nodeId, face.vertexIds);
      }
    });
  }

  return new Map([...groups.entries()].map(([nodeId, vertexIds]) => [nodeId, [...vertexIds]]));
}

function documentsMatch(left: SceneDocument, right: SceneDocument): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function booleanPreviewMatchesNodes(preview: BooleanPreview | null, nodeIds: NodeId[]): boolean {
  return (
    preview?.subjectNodeId === nodeIds[0] && preview?.cutterNodeId === nodeIds[1] && nodeIds.length === 2
  );
}

function meshVertexCount(document: SceneDocument): number {
  return Object.values(document.nodes).reduce(
    (count, node) => count + (node.type === 'mesh' ? Object.keys(node.mesh.vertices).length : 0),
    0,
  );
}

function nextTextureId(document: SceneDocument): string {
  let index = 1;
  while (document.textures[`texture-${index}`]) {
    index += 1;
  }
  return `texture-${index}`;
}

export function createEditorStore(initialDocument = createEmptyDocument()): EditorStore {
  let state: EditorState = {
    document: initialDocument,
    history: EMPTY_HISTORY,
    selectedNodeIds: [],
    selectedVertexIds: [],
    selectedFaceIds: [],
    selectedEdgeIds: [],
    mode: 'object',
    groundVisible: true,
    shadowPreview: false,
    pivotPreview: null,
    booleanPreview: null,
    transformTool: 'translate',
    activeTransaction: null,
    dirty: false,
    facePaintColor: '#f5a65b',
    facePaintRecentColors: [],
    textureBrushOpacity: 1,
    textureBrushSize: 18,
    texturePaintInFlight: false,
    texturePaintTool: 'brush',
    notice: null,
  };
  const listeners = new Set<EditorListener>();

  const emit = (): void => {
    listeners.forEach((listener) => listener());
  };

  const update = (nextState: EditorState): void => {
    const booleanPreview =
      nextState.booleanPreview?.documentRevision === nextState.document.revision
        ? nextState.booleanPreview
        : null;
    state = booleanPreview === nextState.booleanPreview ? nextState : { ...nextState, booleanPreview };
    emit();
  };

  const commit = (
    label: string,
    nextDocument: SceneDocument,
    selectedNodeIds = state.selectedNodeIds,
    selectedVertexIds = state.selectedVertexIds,
    selectedFaceIds = state.selectedFaceIds,
    selectedEdgeIds = state.selectedEdgeIds,
  ): boolean => {
    if (state.activeTransaction) {
      throw new Error(`Cannot run "${label}" while "${state.activeTransaction.label}" is in progress.`);
    }
    if (documentsMatch(state.document, nextDocument)) {
      return false;
    }
    const command = createDocumentCommand(label, state.document, nextDocument);
    const result = executeCommand(state.document, state.history, command);
    update({
      ...state,
      ...result,
      selectedNodeIds: nodeIdsPresentIn(result.document, selectedNodeIds),
      selectedVertexIds: vertexSelectionsPresentIn(result.document, selectedVertexIds),
      selectedFaceIds: faceSelectionsPresentIn(result.document, selectedFaceIds),
      selectedEdgeIds: edgeSelectionsPresentIn(result.document, selectedEdgeIds),
      dirty: true,
    });
    return true;
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addPrimitive: (primitive, options = {}) => {
      const node = createPrimitiveNode(state.document, primitive, state.document.rootId, options);
      commit(`Add ${node.name}`, insertNode(state.document, node), [node.id], [], [], []);
    },
    addPivot: (name = 'Pivot') => {
      const node = createGroupNode(state.document, name);
      commit(`Add ${node.name}`, insertNode(state.document, node), [node.id], [], [], []);
    },
    applyScale: (nodeId) => {
      commit('Apply object scale', applyNodeScale(state.document, nodeId));
    },
    autoUvSelected: () => {
      if (state.selectedNodeIds.length !== 1) {
        return;
      }
      const nodeId = state.selectedNodeIds[0]!;
      const node = state.document.nodes[nodeId];
      if (node?.type !== 'mesh') {
        return;
      }
      if (Object.values(node.mesh.vertices).some((vertex) => vertex.uv)) {
        update({
          ...state,
          notice: { kind: 'info', message: 'Auto UV keeps existing UV coordinates unchanged.' },
        });
        return;
      }
      if (commit('Generate Auto UV', autoUvNodeGeometry(state.document, nodeId))) {
        update({ ...state, notice: { kind: 'info', message: 'Generated per-face Auto UV seams.' } });
      }
    },
    bevelSelectedEdge: (width, segments = 1) => {
      if (!Number.isFinite(width) || width <= 0 || segments !== 1 || state.selectedEdgeIds.length !== 1) {
        if (segments !== 1) {
          update({ ...state, notice: { kind: 'info', message: 'Bevel currently supports 1 segment.' } });
        }
        return;
      }
      const selection = state.selectedEdgeIds[0]!;
      const node = state.document.nodes[selection.nodeId];
      if (!node || node.type !== 'mesh') {
        return;
      }
      const edge = getMeshEdges(node.mesh).find((candidate) => candidate.id === selection.edgeId);
      if (!edge || edge.faceIds.length !== 2) {
        update({ ...state, notice: { kind: 'error', message: 'Bevel requires one manifold edge.' } });
        return;
      }
      const firstFace = node.mesh.faces[edge.faceIds[0]!];
      const secondFace = node.mesh.faces[edge.faceIds[1]!];
      if (!firstFace || !secondFace || firstFace.materialId !== secondFace.materialId) {
        update({ ...state, notice: { kind: 'error', message: 'Bevel cannot cross a material seam.' } });
        return;
      }
      const nextDocument = bevelNodeEdge(state.document, node.id, selection.edgeId, width);
      const nextNode = nextDocument.nodes[node.id];
      if (nextNode?.type !== 'mesh') {
        return;
      }
      const bevelFaceIds = Object.keys(nextNode.mesh.faces)
        .filter((faceId) => !node.mesh.faces[faceId])
        .map((faceId) => ({ nodeId: node.id, faceId }));
      if (commit('Bevel edge', nextDocument, [node.id], [], bevelFaceIds, [])) {
        update({ ...state, mode: 'face', notice: null });
      }
    },
    bendSelectedGeometry: (axis, angleRadians, origin) => {
      if (
        !Number.isFinite(angleRadians) ||
        angleRadians === 0 ||
        ![origin.x, origin.y, origin.z].every(Number.isFinite)
      ) {
        return;
      }
      const meshNodeIds = state.selectedNodeIds.filter(
        (nodeId) => state.document.nodes[nodeId]?.type === 'mesh',
      );
      if (meshNodeIds.length === 0) {
        update({ ...state, notice: { kind: 'error', message: 'Select a mesh before using Bend.' } });
        return;
      }
      const nextDocument = meshNodeIds.reduce(
        (document, nodeId) => bendNodeGeometry(document, nodeId, axis, angleRadians, origin),
        state.document,
      );
      if (state.activeTransaction) {
        if (!documentsMatch(state.document, nextDocument)) {
          update({ ...state, document: nextDocument, dirty: true });
        }
        return;
      }
      commit('Bend geometry', nextDocument);
    },
    colorSelectedFaces: (hexColor) => {
      if (state.selectedFaceIds.length === 0) {
        return;
      }
      const nextDocument = [...groupFacesByNode(state.selectedFaceIds).entries()].reduce(
        (document, [nodeId, selections]) =>
          colorNodeFaces(
            document,
            nodeId,
            selections.map((selection) => selection.faceId),
            hexColor,
          ),
        state.document,
      );
      commit('Color selected faces', nextDocument);
    },
    paintFace: (selection) => {
      const node = state.document.nodes[selection.nodeId];
      if (node?.type !== 'mesh' || !node.mesh.faces[selection.faceId]) {
        return;
      }
      const nextDocument = colorNodeFaces(
        state.document,
        selection.nodeId,
        [selection.faceId],
        state.facePaintColor,
      );
      commit('Paint face color', nextDocument, [selection.nodeId], [], [selection], []);
    },
    beginTransaction: (label) => {
      if (!state.activeTransaction) {
        update({ ...state, activeTransaction: { label, before: state.document, dirtyBefore: state.dirty } });
      }
    },
    cancelTransaction: () => {
      if (!state.activeTransaction) {
        return;
      }
      update({
        ...state,
        document: state.activeTransaction.before,
        activeTransaction: null,
        selectedNodeIds: nodeIdsPresentIn(state.activeTransaction.before, state.selectedNodeIds),
        selectedVertexIds: vertexSelectionsPresentIn(state.activeTransaction.before, state.selectedVertexIds),
        selectedFaceIds: faceSelectionsPresentIn(state.activeTransaction.before, state.selectedFaceIds),
        selectedEdgeIds: edgeSelectionsPresentIn(state.activeTransaction.before, state.selectedEdgeIds),
        dirty: state.activeTransaction.dirtyBefore,
      });
    },
    commitTransaction: () => {
      const transaction = state.activeTransaction;
      if (!transaction) {
        return;
      }
      if (documentsMatch(transaction.before, state.document)) {
        update({ ...state, activeTransaction: null });
        return;
      }
      const command = createDocumentCommand(transaction.label, transaction.before, state.document);
      const result = executeCommand(transaction.before, state.history, command);
      update({
        ...state,
        ...result,
        activeTransaction: null,
        selectedNodeIds: nodeIdsPresentIn(result.document, state.selectedNodeIds),
        selectedVertexIds: vertexSelectionsPresentIn(result.document, state.selectedVertexIds),
        selectedFaceIds: faceSelectionsPresentIn(result.document, state.selectedFaceIds),
        selectedEdgeIds: edgeSelectionsPresentIn(result.document, state.selectedEdgeIds),
        dirty: true,
      });
    },
    deleteSelected: () => {
      const removableIds = state.selectedNodeIds.filter((nodeId) => nodeId !== state.document.rootId);
      if (removableIds.length === 0) {
        return;
      }
      const nextDocument = removableIds.reduce(
        (document, nodeId) => removeNode(document, nodeId),
        state.document,
      );
      commit('Delete selected objects', nextDocument, []);
    },
    deleteSelectedFaces: () => {
      if (state.selectedFaceIds.length === 0) {
        return;
      }
      const nextDocument = [...groupFacesByNode(state.selectedFaceIds).entries()].reduce(
        (document, [nodeId, selections]) =>
          deleteMeshFaces(
            document,
            nodeId,
            selections.map((selection) => selection.faceId),
          ),
        state.document,
      );
      commit('Delete selected faces', nextDocument, state.selectedNodeIds, [], [], []);
    },
    deleteSelectedEdges: () => {
      if (state.selectedEdgeIds.length === 0) {
        return;
      }
      const nextDocument = [...groupEdgesByNode(state.selectedEdgeIds).entries()].reduce(
        (document, [nodeId, selections]) =>
          deleteNodeEdges(
            document,
            nodeId,
            selections.map((selection) => selection.edgeId),
          ),
        state.document,
      );
      commit('Delete selected edges', nextDocument, state.selectedNodeIds, [], [], []);
    },
    deleteSelectedDegenerateFaces: (nodeId) => {
      const node = state.document.nodes[nodeId];
      const removedFaceCount = node?.type === 'mesh' ? getDegenerateFaceIds(node.mesh).length : 0;
      if (commit('Delete degenerate faces', deleteNodeDegenerateFaces(state.document, nodeId))) {
        update({
          ...state,
          notice: {
            kind: 'info',
            message: `Deleted ${removedFaceCount} degenerate face${removedFaceCount === 1 ? '' : 's'}.`,
          },
        });
      }
    },
    deleteSelectedVertices: () => {
      if (state.selectedVertexIds.length === 0) {
        return;
      }
      const nextDocument = [...groupVerticesByNode(state.selectedVertexIds).entries()].reduce(
        (document, [nodeId, selections]) =>
          deleteMeshVertices(
            document,
            nodeId,
            selections.map((selection) => selection.vertexId),
          ),
        state.document,
      );
      commit('Delete selected vertices', nextDocument, state.selectedNodeIds, [], [], []);
    },
    mergeSelectedVertices: () => {
      const selectionsByNode = [...groupVerticesByNode(state.selectedVertexIds).entries()].filter(
        ([, selections]) => selections.length > 1,
      );
      if (selectionsByNode.length === 0) {
        return;
      }
      const nextDocument = selectionsByNode.reduce(
        (document, [nodeId, selections]) =>
          mergeNodeVertices(
            document,
            nodeId,
            selections.map((selection) => selection.vertexId),
          ),
        state.document,
      );
      const survivorSelections = selectionsByNode.map(([nodeId, selections]) => ({
        nodeId,
        vertexId: selections[0]!.vertexId,
      }));
      commit('Merge selected vertices', nextDocument, state.selectedNodeIds, survivorSelections, [], []);
    },
    mergeSelectedVerticesByDistance: (distance) => {
      if (!Number.isFinite(distance) || distance < 0) {
        return;
      }
      const selectionsByNode = [...groupVerticesByNode(state.selectedVertexIds).entries()].filter(
        ([, selections]) => selections.length > 1,
      );
      if (selectionsByNode.length === 0) {
        return;
      }
      const nextDocument = selectionsByNode.reduce(
        (document, [nodeId, selections]) =>
          mergeNodeVerticesByDistance(
            document,
            nodeId,
            selections.map((selection) => selection.vertexId),
            distance,
          ),
        state.document,
      );
      const mergedVertexCount = meshVertexCount(state.document) - meshVertexCount(nextDocument);
      if (commit('Merge selected vertices by distance', nextDocument, state.selectedNodeIds)) {
        update({
          ...state,
          notice: {
            kind: 'info',
            message:
              mergedVertexCount === 1
                ? 'Merged 1 vertex by distance.'
                : `Merged ${mergedVertexCount} vertices by distance.`,
          },
        });
      } else {
        update({
          ...state,
          notice: { kind: 'info', message: 'No selected vertices were close enough to merge.' },
        });
      }
    },
    cleanupDuplicateVertices: (nodeId, tolerance) => {
      const node = state.document.nodes[nodeId];
      if (!node || node.type !== 'mesh' || !Number.isFinite(tolerance) || tolerance < 0) {
        return;
      }
      const duplicateGroups = getMergeableDuplicateVertexGroups(node.mesh, tolerance);
      if (duplicateGroups.length === 0) {
        update({
          ...state,
          notice: { kind: 'info', message: 'No merge-safe duplicate vertices were found.' },
        });
        return;
      }
      const mergedVertexCount = duplicateGroups.reduce(
        (count, group) => count + group.vertexIds.length - 1,
        0,
      );
      const survivorSelections = duplicateGroups.map((group) => ({ nodeId, vertexId: group.vertexIds[0]! }));
      if (
        commit(
          'Merge safe duplicate vertices',
          mergeNodeVertexGroups(
            state.document,
            nodeId,
            duplicateGroups.map((group) => group.vertexIds),
          ),
          [nodeId],
          survivorSelections,
          [],
          [],
        )
      ) {
        update({
          ...state,
          mode: 'vertex',
          notice: {
            kind: 'info',
            message: `Merged ${mergedVertexCount} duplicate vert${mergedVertexCount === 1 ? 'ex' : 'ices'}.`,
          },
        });
      }
    },
    mirrorSelectedGeometry: (axis, seamTolerance) => {
      if (!Number.isFinite(seamTolerance) || seamTolerance < 0) {
        return;
      }
      const meshNodeIds = state.selectedNodeIds.filter(
        (nodeId) => state.document.nodes[nodeId]?.type === 'mesh',
      );
      if (meshNodeIds.length === 0) {
        update({ ...state, notice: { kind: 'error', message: 'Select a mesh before using Mirror.' } });
        return;
      }
      const nextDocument = meshNodeIds.reduce(
        (document, nodeId) => mirrorNodeGeometry(document, nodeId, axis, seamTolerance),
        state.document,
      );
      if (state.activeTransaction) {
        if (!documentsMatch(state.document, nextDocument)) {
          update({ ...state, document: nextDocument, dirty: true });
        }
        return;
      }
      commit('Mirror geometry', nextDocument);
    },
    setSelectedMirrorModifier: (modifier) => {
      if (modifier !== null && (!Number.isFinite(modifier.seamTolerance) || modifier.seamTolerance < 0)) {
        return;
      }
      const meshNodeIds = state.selectedNodeIds.filter(
        (nodeId) => state.document.nodes[nodeId]?.type === 'mesh',
      );
      if (meshNodeIds.length === 0) {
        update({ ...state, notice: { kind: 'error', message: 'Select a mesh before using Live Mirror.' } });
        return;
      }
      const nextDocument = meshNodeIds.reduce(
        (document, nodeId) => setNodeMirrorModifier(document, nodeId, modifier),
        state.document,
      );
      commit(modifier ? 'Enable live mirror' : 'Disable live mirror', nextDocument);
    },
    bakeSelectedMirrorModifier: () => {
      const meshNodeIds = state.selectedNodeIds.filter(
        (nodeId) => state.document.nodes[nodeId]?.type === 'mesh',
      );
      const nextDocument = meshNodeIds.reduce(
        (document, nodeId) => bakeNodeMirrorModifier(document, nodeId),
        state.document,
      );
      commit('Bake live mirror', nextDocument);
    },
    setBooleanPreview: (preview) => {
      const subject = state.document.nodes[preview.subjectNodeId];
      const cutter = state.document.nodes[preview.cutterNodeId];
      if (
        state.activeTransaction ||
        subject?.type !== 'mesh' ||
        cutter?.type !== 'mesh' ||
        preview.subjectNodeId === preview.cutterNodeId
      ) {
        return;
      }
      const operationLabel =
        preview.operation === 'difference'
          ? 'Difference'
          : preview.operation === 'intersection'
            ? 'Intersection'
            : 'Union';
      update({
        ...state,
        booleanPreview: { ...preview, documentRevision: state.document.revision },
        notice: {
          kind: 'info',
          message: `${operationLabel} preview ready (${preview.triangleCount} triangles, ${preview.elapsedMs.toFixed(1)} ms).`,
        },
      });
    },
    clearBooleanPreview: () => {
      if (state.booleanPreview) {
        update({
          ...state,
          booleanPreview: null,
          notice: { kind: 'info', message: 'Boolean preview cancelled.' },
        });
      }
    },
    commitBooleanPreview: () => {
      const preview = state.booleanPreview;
      if (!preview || preview.documentRevision !== state.document.revision) {
        return;
      }
      const operationLabel =
        preview.operation === 'difference'
          ? 'Difference'
          : preview.operation === 'intersection'
            ? 'Intersection'
            : 'Union';
      if (
        commit(
          `Boolean ${operationLabel}`,
          commitBooleanMesh(state.document, preview.subjectNodeId, preview.cutterNodeId, preview.mesh),
          [preview.subjectNodeId],
          [],
          [],
          [],
        )
      ) {
        update({
          ...state,
          notice: { kind: 'info', message: `Committed Boolean ${operationLabel}; cutter removed.` },
        });
      } else {
        update({
          ...state,
          booleanPreview: null,
          notice: { kind: 'error', message: 'Boolean commit was rejected.' },
        });
      }
    },
    moveSelectedToGround: () => {
      if (state.selectedNodeIds.length !== 1) {
        return;
      }
      commit(
        'Move model to ground',
        moveNodeToGround(state.document, state.selectedNodeIds[0]!, state.document.metadata.groundReferenceY),
      );
    },
    dissolveSelectedEdges: () => {
      if (state.selectedEdgeIds.length === 0) {
        return;
      }
      const nextDocument = [...groupEdgesByNode(state.selectedEdgeIds).entries()].reduce(
        (document, [nodeId, selections]) =>
          dissolveNodeEdges(
            document,
            nodeId,
            selections.map((selection) => selection.edgeId),
          ),
        state.document,
      );
      commit('Dissolve selected edges', nextDocument, state.selectedNodeIds, [], [], []);
    },
    loopCutSelectedEdge: (factor) => {
      if (!Number.isFinite(factor) || factor <= 0 || factor >= 1 || state.selectedEdgeIds.length !== 1) {
        return;
      }
      const selection = state.selectedEdgeIds[0]!;
      const node = state.document.nodes[selection.nodeId];
      if (!node || node.type !== 'mesh') {
        return;
      }
      const path = traceLoopCut(node.mesh, selection.edgeId);
      if (path.reason) {
        update({ ...state, notice: { kind: 'error', message: path.reason } });
        return;
      }
      const nextDocument = loopCutNodeEdge(state.document, node.id, selection.edgeId, factor);
      const nextNode = nextDocument.nodes[node.id];
      if (nextNode?.type !== 'mesh') {
        return;
      }
      const newVertexIds = new Set(
        Object.keys(nextNode.mesh.vertices).filter((vertexId) => !node.mesh.vertices[vertexId]),
      );
      const cutEdges = getMeshEdges(nextNode.mesh)
        .filter((edge) => newVertexIds.has(edge.vertexAId) && newVertexIds.has(edge.vertexBId))
        .map((edge) => ({ nodeId: node.id, edgeId: edge.id }));
      if (state.activeTransaction) {
        if (!documentsMatch(state.document, nextDocument)) {
          update({
            ...state,
            document: nextDocument,
            selectedNodeIds: [node.id],
            selectedVertexIds: [],
            selectedFaceIds: [],
            selectedEdgeIds: cutEdges,
            mode: 'edge',
            dirty: true,
            notice: null,
          });
        }
        return;
      }
      if (commit('Loop cut', nextDocument, [node.id], [], [], cutEdges)) {
        update({ ...state, mode: 'edge', notice: null });
      }
    },
    trisToQuadSelectedEdge: () => {
      if (state.selectedEdgeIds.length !== 1) {
        return;
      }
      const selection = state.selectedEdgeIds[0]!;
      const node = state.document.nodes[selection.nodeId];
      if (!node || node.type !== 'mesh') {
        return;
      }
      const candidate = inspectTrisToQuad(node.mesh, selection.edgeId);
      if (candidate.reason) {
        update({ ...state, notice: { kind: 'error', message: candidate.reason } });
        return;
      }
      const nextDocument = dissolveNodeEdges(state.document, node.id, [selection.edgeId]);
      if (state.activeTransaction) {
        if (!documentsMatch(state.document, nextDocument)) {
          update({
            ...state,
            document: nextDocument,
            selectedNodeIds: [node.id],
            selectedVertexIds: [],
            selectedFaceIds: [],
            selectedEdgeIds: [],
            mode: 'edge',
            dirty: true,
            notice: null,
          });
        }
        return;
      }
      commit('Tris to Quads', nextDocument, [node.id], [], [], []);
    },
    transformSelectedGeometry: (transform, orientation = 'local') => {
      const vertexIdsByNode = selectedGeometryVertexIdsByNode(state.document, state);
      if (vertexIdsByNode.size === 0) {
        return;
      }
      const nextDocument = [...vertexIdsByNode.entries()].reduce(
        (document, [nodeId, vertexIds]) =>
          transformNodeGeometry(document, nodeId, vertexIds, transform, orientation),
        state.document,
      );
      commit('Transform selected geometry', nextDocument);
    },
    subdivideSelectedEdges: () => {
      if (state.selectedEdgeIds.length === 0) {
        return;
      }
      const nextDocument = [...groupEdgesByNode(state.selectedEdgeIds).entries()].reduce(
        (document, [nodeId, selections]) =>
          subdivideNodeEdges(
            document,
            nodeId,
            selections.map((selection) => selection.edgeId),
          ),
        state.document,
      );
      const selectedVertexIds = Object.entries(nextDocument.nodes).flatMap(([nodeId, node]) => {
        const before = state.document.nodes[nodeId];
        if (node.type !== 'mesh' || before?.type !== 'mesh') {
          return [];
        }
        return Object.keys(node.mesh.vertices)
          .filter((vertexId) => !before.mesh.vertices[vertexId])
          .map((vertexId) => ({ nodeId, vertexId }));
      });
      if (
        commit('Subdivide selected edges', nextDocument, state.selectedNodeIds, selectedVertexIds, [], [])
      ) {
        update({ ...state, mode: 'vertex' });
      }
    },
    newDocument: () => {
      update({
        document: createEmptyDocument(),
        history: EMPTY_HISTORY,
        selectedNodeIds: [],
        selectedVertexIds: [],
        selectedFaceIds: [],
        selectedEdgeIds: [],
        mode: 'object',
        groundVisible: true,
        shadowPreview: false,
        pivotPreview: null,
        booleanPreview: null,
        transformTool: 'translate',
        activeTransaction: null,
        dirty: false,
        facePaintColor: '#f5a65b',
        facePaintRecentColors: [],
        textureBrushOpacity: 1,
        textureBrushSize: 18,
        texturePaintInFlight: false,
        texturePaintTool: 'brush',
        notice: null,
      });
    },
    renameNode: (nodeId, name) => {
      commit('Rename object', renameNode(state.document, nodeId, name));
    },
    updateMaterial: (materialId, patch) => {
      commit('Update material', updateMaterialProperties(state.document, materialId, patch));
    },
    setMaterialTexturePayload: (materialId, texture) => {
      commit(
        texture ? 'Set material texture' : 'Clear material texture',
        setMaterialTexture(state.document, materialId, texture),
      );
    },
    paintTextureStroke: async (nodeId, materialId, points) => {
      const node = state.document.nodes[nodeId];
      const material = state.document.materials[materialId];
      if (
        state.texturePaintInFlight ||
        node?.type !== 'mesh' ||
        !material ||
        points.length === 0 ||
        !Object.values(node.mesh.vertices).some((vertex) => vertex.uv)
      ) {
        return;
      }
      const beforeDocument = state.document;
      const settings = {
        color: state.facePaintColor,
        opacity: state.textureBrushOpacity,
        size: state.textureBrushSize,
        tool: state.texturePaintTool,
      };
      update({ ...state, texturePaintInFlight: true });
      try {
        const { createBlankTexturePayload, paintTexturePayload, sampleTexturePayload } =
          await import('../geometry/texture-paint');
        const existing = material.baseColorTextureId
          ? beforeDocument.textures[material.baseColorTextureId]
          : undefined;
        const textureId = existing?.id ?? nextTextureId(beforeDocument);
        const texture = existing ?? createBlankTexturePayload(textureId, `${material.name} paint`);
        if (settings.tool === 'eyedropper') {
          const color = await sampleTexturePayload(texture, points[points.length - 1]!);
          if (state.document !== beforeDocument) {
            return;
          }
          const recent = [color, ...state.facePaintRecentColors.filter((entry) => entry !== color)].slice(
            0,
            8,
          );
          update({ ...state, facePaintColor: color, facePaintRecentColors: recent });
          return;
        }
        const painted = await paintTexturePayload(texture, textureId, points, settings);
        if (state.document !== beforeDocument) {
          return;
        }
        commit('Texture paint stroke', setMaterialTexture(beforeDocument, materialId, painted));
      } catch (error) {
        if (state.document === beforeDocument) {
          update({
            ...state,
            notice: {
              kind: 'error',
              message: `Texture Paint failed: ${error instanceof Error ? error.message : 'the source texture was preserved.'}`,
            },
          });
        }
      } finally {
        if (state.texturePaintInFlight) {
          update({ ...state, texturePaintInFlight: false });
        }
      }
    },
    setTextureBrushOpacity: (opacity) => {
      const clamped = Number.isFinite(opacity)
        ? Math.min(1, Math.max(0, opacity))
        : state.textureBrushOpacity;
      if (clamped !== state.textureBrushOpacity) {
        update({ ...state, textureBrushOpacity: clamped });
      }
    },
    setTextureBrushSize: (size) => {
      const clamped = Number.isFinite(size) ? Math.min(512, Math.max(1, size)) : state.textureBrushSize;
      if (clamped !== state.textureBrushSize) {
        update({ ...state, textureBrushSize: clamped });
      }
    },
    setTexturePaintTool: (tool) => {
      if (state.texturePaintTool !== tool) {
        update({ ...state, texturePaintTool: tool });
      }
    },
    flipSelectedFaces: () => {
      if (state.selectedFaceIds.length === 0) {
        return;
      }
      const nextDocument = [...groupFacesByNode(state.selectedFaceIds).entries()].reduce(
        (document, [nodeId, selections]) =>
          flipMeshFaces(
            document,
            nodeId,
            selections.map((selection) => selection.faceId),
          ),
        state.document,
      );
      commit('Flip selected face normals', nextDocument);
    },
    extrudeSelectedFaces: (distance) => {
      if (!Number.isFinite(distance) || distance === 0 || state.selectedFaceIds.length === 0) {
        return;
      }
      const nextDocument = [...groupFacesByNode(state.selectedFaceIds).entries()].reduce(
        (document, [nodeId, selections]) =>
          extrudeNodeFaces(
            document,
            nodeId,
            selections.map((selection) => selection.faceId),
            distance,
          ),
        state.document,
      );
      if (state.activeTransaction) {
        if (!documentsMatch(state.document, nextDocument)) {
          update({ ...state, document: nextDocument, dirty: true, notice: null });
        }
        return;
      }
      commit('Extrude selected faces', nextDocument);
    },
    insetSelectedFaces: (factor) => {
      if (!Number.isFinite(factor) || factor <= 0 || factor >= 1 || state.selectedFaceIds.length === 0) {
        return;
      }
      const nextDocument = [...groupFacesByNode(state.selectedFaceIds).entries()].reduce(
        (document, [nodeId, selections]) =>
          insetNodeFaces(
            document,
            nodeId,
            selections.map((selection) => selection.faceId),
            factor,
          ),
        state.document,
      );
      if (state.activeTransaction) {
        if (!documentsMatch(state.document, nextDocument)) {
          update({ ...state, document: nextDocument, dirty: true, notice: null });
        }
        return;
      }
      commit('Inset selected faces', nextDocument);
    },
    separateSelectedFaces: () => {
      const selectionsByNode = [...groupFacesByNode(state.selectedFaceIds).entries()];
      if (selectionsByNode.length !== 1) {
        return;
      }
      const [nodeId, selections] = selectionsByNode[0]!;
      const node = state.document.nodes[nodeId];
      if (!node || node.type !== 'mesh' || selections.length === Object.keys(node.mesh.faces).length) {
        return;
      }
      const nextDocument = separateNodeFaces(
        state.document,
        nodeId,
        selections.map((selection) => selection.faceId),
      );
      const separatedNodeId = Object.keys(nextDocument.nodes).find(
        (candidateId) => !state.document.nodes[candidateId],
      );
      if (separatedNodeId) {
        commit('Separate selected faces', nextDocument, [separatedNodeId], [], [], []);
      }
    },
    selectNodes: (nodeIds) => {
      const uniqueNodeIds = [...new Set(nodeIdsPresentIn(state.document, nodeIds))];
      if (
        JSON.stringify(uniqueNodeIds) === JSON.stringify(state.selectedNodeIds) &&
        state.selectedVertexIds.length === 0 &&
        state.selectedFaceIds.length === 0 &&
        state.selectedEdgeIds.length === 0
      ) {
        return;
      }
      update({
        ...state,
        selectedNodeIds: uniqueNodeIds,
        selectedVertexIds: [],
        selectedFaceIds: [],
        selectedEdgeIds: [],
        booleanPreview: booleanPreviewMatchesNodes(state.booleanPreview, uniqueNodeIds)
          ? state.booleanPreview
          : null,
      });
    },
    selectVertices: (selections) => {
      const selectedVertexIds = vertexSelectionsPresentIn(state.document, selections);
      const selectedNodeIds = [...new Set(selectedVertexIds.map((selection) => selection.nodeId))];
      if (
        JSON.stringify(selectedVertexIds) === JSON.stringify(state.selectedVertexIds) &&
        JSON.stringify(selectedNodeIds) === JSON.stringify(state.selectedNodeIds)
      ) {
        return;
      }
      update({
        ...state,
        selectedNodeIds,
        selectedVertexIds,
        selectedFaceIds: [],
        selectedEdgeIds: [],
        booleanPreview: null,
      });
    },
    selectFaces: (selections) => {
      const selectedFaceIds = faceSelectionsPresentIn(state.document, selections);
      const selectedNodeIds = [...new Set(selectedFaceIds.map((selection) => selection.nodeId))];
      if (
        JSON.stringify(selectedFaceIds) === JSON.stringify(state.selectedFaceIds) &&
        JSON.stringify(selectedNodeIds) === JSON.stringify(state.selectedNodeIds)
      ) {
        return;
      }
      update({
        ...state,
        selectedNodeIds,
        selectedVertexIds: [],
        selectedFaceIds,
        selectedEdgeIds: [],
        booleanPreview: null,
      });
    },
    selectEdges: (selections) => {
      const selectedEdgeIds = edgeSelectionsPresentIn(state.document, selections);
      const selectedNodeIds = [...new Set(selectedEdgeIds.map((selection) => selection.nodeId))];
      if (
        JSON.stringify(selectedEdgeIds) === JSON.stringify(state.selectedEdgeIds) &&
        JSON.stringify(selectedNodeIds) === JSON.stringify(state.selectedNodeIds)
      ) {
        return;
      }
      update({
        ...state,
        selectedNodeIds,
        selectedVertexIds: [],
        selectedFaceIds: [],
        selectedEdgeIds,
        booleanPreview: null,
      });
    },
    setMode: (mode) => {
      if (state.mode !== mode) {
        update({
          ...state,
          mode,
          selectedVertexIds: mode === 'vertex' ? state.selectedVertexIds : [],
          selectedFaceIds: mode === 'face' || mode === 'face-color' ? state.selectedFaceIds : [],
          selectedEdgeIds: mode === 'edge' ? state.selectedEdgeIds : [],
        });
      }
    },
    setGroundVisible: (visible) => {
      if (state.groundVisible !== visible) {
        update({ ...state, groundVisible: visible });
      }
    },
    setShadowPreview: (enabled) => {
      if (state.shadowPreview !== enabled) {
        update({ ...state, shadowPreview: enabled });
      }
    },
    setPivotPreview: (nodeId, rotationY) => {
      const node = state.document.nodes[nodeId];
      if (node?.type !== 'group' || !Number.isFinite(rotationY)) {
        return;
      }
      if (state.pivotPreview?.nodeId === nodeId && state.pivotPreview.rotationY === rotationY) {
        return;
      }
      update({ ...state, pivotPreview: { nodeId, rotationY } });
    },
    commitPivotPreview: () => {
      const preview = state.pivotPreview;
      const node = preview ? state.document.nodes[preview.nodeId] : undefined;
      if (!preview || node?.type !== 'group') {
        if (preview) {
          update({ ...state, pivotPreview: null });
        }
        return;
      }
      commit(
        'Rotate pivot',
        updateNodeTransform(state.document, node.id, {
          ...node.transform,
          rotation: { ...node.transform.rotation, y: preview.rotationY },
        }),
      );
      update({ ...state, pivotPreview: null });
    },
    cancelPivotPreview: () => {
      if (state.pivotPreview) {
        update({ ...state, pivotPreview: null });
      }
    },
    setGroundContactTolerance: (tolerance) => {
      commit('Set ground contact tolerance', setGroundContactTolerance(state.document, tolerance));
    },
    setGroundReference: (groundReferenceY) => {
      commit('Set ground reference', setGroundReference(state.document, groundReferenceY));
    },
    setGroundReferenceFromSelected: () => {
      if (state.selectedNodeIds.length !== 1) {
        return;
      }
      const groundReferenceY = getSubtreeWorldBounds(state.document, state.selectedNodeIds[0]!)?.min.y;
      if (groundReferenceY === undefined) {
        update({
          ...state,
          notice: { kind: 'error', message: 'Select a visible mesh or group to set ground.' },
        });
        return;
      }
      commit('Set ground reference from selection', setGroundReference(state.document, groundReferenceY));
    },
    setFacePaintColor: (hexColor) => {
      const normalizedColor = hexColor.toLowerCase();
      if (/^#[0-9a-f]{6}$/i.test(normalizedColor) && state.facePaintColor !== normalizedColor) {
        update({
          ...state,
          facePaintColor: normalizedColor,
          facePaintRecentColors: [
            normalizedColor,
            ...state.facePaintRecentColors.filter((color) => color !== normalizedColor),
          ].slice(0, 8),
        });
      }
    },
    setForwardConfirmed: (confirmed) => {
      commit(
        confirmed ? 'Confirm +Z forward' : 'Clear +Z forward confirmation',
        setForwardConfirmed(state.document, confirmed),
      );
    },
    setNodeHidden: (nodeId, hidden) => {
      commit(hidden ? 'Hide object' : 'Show object', setNodeHidden(state.document, nodeId, hidden));
    },
    setNodeParent: (nodeId, parentId) => {
      commit('Parent object', setNodeParent(state.document, nodeId, parentId));
    },
    resizeGeometry: (nodeId, targetSize) => {
      commit('Resize geometry', resizeNodeGeometry(state.document, nodeId, targetSize));
    },
    setTransform: (nodeId, transform) => {
      const nextDocument = updateNodeTransform(state.document, nodeId, transform);
      if (!state.activeTransaction) {
        commit('Transform object', nextDocument);
        return;
      }
      if (!documentsMatch(state.document, nextDocument)) {
        update({ ...state, document: nextDocument, dirty: true });
      }
    },
    setVertexPosition: (selection, position) => {
      commit(
        'Move vertex',
        updateMeshVertexPosition(state.document, selection.nodeId, selection.vertexId, position),
      );
    },
    setTransformTool: (tool) => {
      if (state.transformTool !== tool) {
        update({ ...state, transformTool: tool });
      }
    },
    undo: () => {
      if (state.activeTransaction) {
        return;
      }
      const result = undoCommand(state.document, state.history);
      if (!result) {
        return;
      }
      update({
        ...state,
        ...result,
        selectedNodeIds: nodeIdsPresentIn(result.document, state.selectedNodeIds),
        selectedVertexIds: vertexSelectionsPresentIn(result.document, state.selectedVertexIds),
        selectedFaceIds: faceSelectionsPresentIn(result.document, state.selectedFaceIds),
        selectedEdgeIds: edgeSelectionsPresentIn(result.document, state.selectedEdgeIds),
        dirty: result.history.past.length > 0,
      });
    },
    redo: () => {
      if (state.activeTransaction) {
        return;
      }
      const result = redoCommand(state.document, state.history);
      if (!result) {
        return;
      }
      update({
        ...state,
        ...result,
        selectedNodeIds: nodeIdsPresentIn(result.document, state.selectedNodeIds),
        selectedVertexIds: vertexSelectionsPresentIn(result.document, state.selectedVertexIds),
        selectedFaceIds: faceSelectionsPresentIn(result.document, state.selectedFaceIds),
        selectedEdgeIds: edgeSelectionsPresentIn(result.document, state.selectedEdgeIds),
        dirty: true,
      });
    },
    recalculateNormals: (nodeId) => {
      const node = state.document.nodes[nodeId];
      const vertexCount = node?.type === 'mesh' ? Object.keys(node.mesh.vertices).length : 0;
      if (commit('Recalculate normals', recalculateNodeNormals(state.document, nodeId))) {
        update({
          ...state,
          notice: {
            kind: 'info',
            message: `Recalculated normals for ${vertexCount} vert${vertexCount === 1 ? 'ex' : 'ices'}.`,
          },
        });
      }
    },
    replaceDocument: (document, selectedNodeIds = []) => {
      update({
        ...state,
        document,
        history: EMPTY_HISTORY,
        selectedNodeIds: nodeIdsPresentIn(document, selectedNodeIds),
        selectedVertexIds: [],
        selectedFaceIds: [],
        selectedEdgeIds: [],
        activeTransaction: null,
        pivotPreview: null,
        booleanPreview: null,
        dirty: false,
        facePaintColor: state.facePaintColor,
        texturePaintInFlight: false,
      });
    },
    replaceProject: (document, editor) => {
      update({
        ...state,
        document,
        history: EMPTY_HISTORY,
        selectedNodeIds: nodeIdsPresentIn(document, editor.selectedNodeIds),
        selectedVertexIds: vertexSelectionsPresentIn(document, editor.selectedVertexIds),
        selectedFaceIds: faceSelectionsPresentIn(document, editor.selectedFaceIds),
        selectedEdgeIds: edgeSelectionsPresentIn(document, editor.selectedEdgeIds),
        mode: editor.mode,
        groundVisible: editor.groundVisible,
        shadowPreview: false,
        pivotPreview: null,
        booleanPreview: null,
        transformTool: editor.transformTool,
        activeTransaction: null,
        dirty: false,
        facePaintColor: editor.facePaintColor,
        facePaintRecentColors: [...editor.facePaintRecentColors],
        textureBrushOpacity: editor.textureBrushOpacity,
        textureBrushSize: editor.textureBrushSize,
        texturePaintInFlight: false,
        texturePaintTool: editor.texturePaintTool,
      });
    },
    markSaved: () => {
      if (state.dirty) {
        update({ ...state, dirty: false });
      }
    },
    setNotice: (notice) => {
      if (state.notice?.kind !== notice?.kind || state.notice?.message !== notice?.message) {
        update({ ...state, notice });
      }
    },
  };
}

export const editorStore = createEditorStore();
