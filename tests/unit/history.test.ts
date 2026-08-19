import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  createPrimitiveNode,
  documentChecksum,
  insertNode,
} from '../../src/editor/core/document';
import {
  createDocumentCommand,
  EMPTY_HISTORY,
  executeCommand,
  redoCommand,
  undoCommand,
} from '../../src/editor/commands/history';
import { createEditorStore } from '../../src/editor/core/store';
import { getMeshEdges } from '../../src/editor/geometry/topology';
import { getSubtreeWorldBounds } from '../../src/editor/geometry/world-bounds';

describe('CommandHistory', () => {
  it('replays a snapshot command through undo and redo', () => {
    const before = createEmptyDocument();
    const cube = createPrimitiveNode(before, 'cube');
    const after = insertNode(before, cube);
    const command = createDocumentCommand('Add Cube', before, after);
    const executed = executeCommand(before, EMPTY_HISTORY, command);
    const undone = undoCommand(executed.document, executed.history);

    expect(executed.document.nodes[cube.id]).toBeDefined();
    expect(undone?.document.nodes[cube.id]).toBeUndefined();

    const redone = redoCommand(undone!.document, undone!.history);
    expect(redone?.document.nodes[cube.id]).toMatchObject({ name: 'Cube' });
    expect(redone?.history.past).toHaveLength(1);
    expect(redone?.history.future).toHaveLength(0);
  });

  it('keeps selection and dirty state aligned with store history', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const cubeId = store.getState().selectedNodeIds[0];

    expect(store.getState().dirty).toBe(true);
    expect(store.getState().history.past).toHaveLength(1);
    expect(cubeId).toBeDefined();

    store.setTransform(cubeId, {
      position: { x: 2, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(store.getState().document.nodes[cubeId].transform.position.x).toBe(2);

    store.undo();
    expect(store.getState().document.nodes[cubeId].transform.position.x).toBe(0);
    store.undo();
    expect(store.getState().document.nodes[cubeId]).toBeUndefined();
    expect(store.getState().selectedNodeIds).toEqual([]);
    expect(store.getState().dirty).toBe(false);
  });

  it('commits a transform drag as one transaction and can cancel its preview', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const cubeId = store.getState().selectedNodeIds[0]!;
    const historyLengthBeforeDrag = store.getState().history.past.length;

    store.beginTransaction('Transform object');
    store.setTransform(cubeId, {
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    store.setTransform(cubeId, {
      position: { x: 3, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });

    expect(store.getState().history.past).toHaveLength(historyLengthBeforeDrag);
    expect(store.getState().document.nodes[cubeId].transform.position.x).toBe(3);

    store.commitTransaction();
    expect(store.getState().history.past).toHaveLength(historyLengthBeforeDrag + 1);
    store.undo();
    expect(store.getState().document.nodes[cubeId].transform.position.x).toBe(0);

    store.beginTransaction('Transform object');
    store.setTransform(cubeId, {
      position: { x: 8, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    store.cancelTransaction();
    expect(store.getState().document.nodes[cubeId].transform.position.x).toBe(0);
  });

  it('tracks vertex selection and moves one editable vertex through undo', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const cubeId = store.getState().selectedNodeIds[0]!;
    const node = store.getState().document.nodes[cubeId];
    expect(node.type).toBe('mesh');
    if (node.type !== 'mesh') {
      return;
    }
    const vertexId = Object.keys(node.mesh.vertices)[0]!;
    const initialX = node.mesh.vertices[vertexId].position.x;

    store.setMode('vertex');
    store.selectVertices([{ nodeId: cubeId, vertexId }]);
    store.setVertexPosition({ nodeId: cubeId, vertexId }, { x: 1.25, y: -0.5, z: -0.5 });

    expect(store.getState().selectedVertexIds).toEqual([{ nodeId: cubeId, vertexId }]);
    expect((store.getState().document.nodes[cubeId] as typeof node).mesh.vertices[vertexId].position.x).toBe(
      1.25,
    );
    store.undo();
    expect((store.getState().document.nodes[cubeId] as typeof node).mesh.vertices[vertexId].position.x).toBe(
      initialX,
    );
    store.deleteSelectedVertices();
    expect(Object.keys((store.getState().document.nodes[cubeId] as typeof node).mesh.vertices)).toHaveLength(
      7,
    );
    expect(Object.keys((store.getState().document.nodes[cubeId] as typeof node).mesh.faces)).toHaveLength(3);
    store.undo();
    expect(Object.keys((store.getState().document.nodes[cubeId] as typeof node).mesh.vertices)).toHaveLength(
      8,
    );
  });

  it('flips and deletes selected faces through the command history', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const cubeId = store.getState().selectedNodeIds[0]!;
    const node = store.getState().document.nodes[cubeId];
    expect(node.type).toBe('mesh');
    if (node.type !== 'mesh') {
      return;
    }
    const faceId = Object.keys(node.mesh.faces)[0]!;
    const originalVertexIds = [...node.mesh.faces[faceId].vertexIds];

    store.setMode('face');
    store.selectFaces([{ nodeId: cubeId, faceId }]);
    store.flipSelectedFaces();
    expect((store.getState().document.nodes[cubeId] as typeof node).mesh.faces[faceId].vertexIds).toEqual(
      [...originalVertexIds].reverse(),
    );
    store.undo();
    expect((store.getState().document.nodes[cubeId] as typeof node).mesh.faces[faceId].vertexIds).toEqual(
      originalVertexIds,
    );

    store.deleteSelectedFaces();
    expect((store.getState().document.nodes[cubeId] as typeof node).mesh.faces[faceId]).toBeUndefined();
    store.undo();
    expect((store.getState().document.nodes[cubeId] as typeof node).mesh.faces[faceId]).toBeDefined();
  });

  it('subdivides selected edges and hands the new midpoint to vertex mode', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const cubeId = store.getState().selectedNodeIds[0]!;
    const cube = store.getState().document.nodes[cubeId];
    expect(cube.type).toBe('mesh');
    if (cube.type !== 'mesh') {
      return;
    }
    const edgeId = getMeshEdges(cube.mesh)[0]!.id;

    store.setMode('edge');
    store.selectEdges([{ nodeId: cubeId, edgeId }]);
    store.subdivideSelectedEdges();

    expect(store.getState().mode).toBe('vertex');
    expect(store.getState().selectedVertexIds).toHaveLength(1);
    expect(Object.keys((store.getState().document.nodes[cubeId] as typeof cube).mesh.vertices)).toHaveLength(
      9,
    );
    store.undo();
    expect(Object.keys((store.getState().document.nodes[cubeId] as typeof cube).mesh.vertices)).toHaveLength(
      8,
    );
  });

  it('transforms vertex, edge, and face selections as one undoable geometry command', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const cubeId = store.getState().selectedNodeIds[0]!;
    const cube = store.getState().document.nodes[cubeId];
    expect(cube.type).toBe('mesh');
    if (cube.type !== 'mesh') {
      return;
    }
    const edge = getMeshEdges(cube.mesh)[0]!;
    const originalEdgePosition = cube.mesh.vertices[edge.vertexAId]!.position.x;

    store.setMode('edge');
    store.selectEdges([{ nodeId: cubeId, edgeId: edge.id }]);
    store.transformSelectedGeometry({
      translation: { x: 0.25, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(
      (store.getState().document.nodes[cubeId] as typeof cube).mesh.vertices[edge.vertexAId]!.position.x,
    ).toBe(originalEdgePosition + 0.25);
    store.undo();
    expect(
      (store.getState().document.nodes[cubeId] as typeof cube).mesh.vertices[edge.vertexAId]!.position.x,
    ).toBe(originalEdgePosition);

    const faceId = Object.keys(cube.mesh.faces)[0]!;
    const faceVertexId = cube.mesh.faces[faceId]!.vertexIds[0]!;
    const originalFacePosition = cube.mesh.vertices[faceVertexId]!.position.z;
    store.setMode('face');
    store.selectFaces([{ nodeId: cubeId, faceId }]);
    store.transformSelectedGeometry({
      translation: { x: 0, y: 0, z: 0.5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(
      (store.getState().document.nodes[cubeId] as typeof cube).mesh.vertices[faceVertexId]!.position.z,
    ).toBe(originalFacePosition + 0.5);
  });

  it('maps World selection movement back through the selected node transform', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const cubeId = store.getState().selectedNodeIds[0]!;
    const cube = store.getState().document.nodes[cubeId];
    expect(cube.type).toBe('mesh');
    if (cube.type !== 'mesh') {
      return;
    }
    const vertexId = Object.keys(cube.mesh.vertices)[0]!;
    const original = cube.mesh.vertices[vertexId]!.position;
    store.setTransform(cubeId, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: Math.PI / 2 },
      scale: { x: 1, y: 1, z: 1 },
    });
    store.setMode('vertex');
    store.selectVertices([{ nodeId: cubeId, vertexId }]);
    store.transformSelectedGeometry(
      {
        translation: { x: 0.25, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      'world',
    );

    const moved = (store.getState().document.nodes[cubeId] as typeof cube).mesh.vertices[vertexId]!.position;
    expect(moved.x).toBeCloseTo(original.x);
    expect(moved.y).toBeCloseTo(original.y - 0.25);
  });

  it('keeps face extrude and inset previews outside history until commit', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const cubeId = store.getState().selectedNodeIds[0]!;
    const cube = store.getState().document.nodes[cubeId];
    expect(cube.type).toBe('mesh');
    if (cube.type !== 'mesh') {
      return;
    }
    const faceId = Object.keys(cube.mesh.faces)[0]!;
    const historyLength = store.getState().history.past.length;
    store.setMode('face');
    store.selectFaces([{ nodeId: cubeId, faceId }]);

    store.beginTransaction('Extrude selected faces');
    store.extrudeSelectedFaces(0.25);
    expect(Object.keys((store.getState().document.nodes[cubeId] as typeof cube).mesh.faces)).toHaveLength(10);
    expect(store.getState().history.past).toHaveLength(historyLength);
    store.cancelTransaction();
    expect(Object.keys((store.getState().document.nodes[cubeId] as typeof cube).mesh.faces)).toHaveLength(6);

    store.beginTransaction('Inset selected faces');
    store.insetSelectedFaces(0.2);
    expect(Object.keys((store.getState().document.nodes[cubeId] as typeof cube).mesh.faces)).toHaveLength(10);
    store.commitTransaction();
    expect(store.getState().history.past).toHaveLength(historyLength + 1);
    store.undo();
    expect(Object.keys((store.getState().document.nodes[cubeId] as typeof cube).mesh.faces)).toHaveLength(6);
  });

  it('keeps normalized recent face colors for palette reuse', () => {
    const store = createEditorStore();
    store.setFacePaintColor('#55C1B3');
    store.setFacePaintColor('#f07178');
    store.setFacePaintColor('#55c1b3');

    expect(store.getState().facePaintColor).toBe('#55c1b3');
    expect(store.getState().facePaintRecentColors).toEqual(['#55c1b3', '#f07178']);
  });

  it('merges merge-safe duplicate vertices through cleanup history and restores them with undo', () => {
    const store = createEditorStore();
    store.addPrimitive('plane');
    const planeId = store.getState().selectedNodeIds[0]!;
    const plane = store.getState().document.nodes[planeId];
    expect(plane.type).toBe('mesh');
    if (plane.type !== 'mesh') {
      return;
    }
    const source = plane.mesh.vertices.v1!;
    store.replaceDocument(
      {
        ...store.getState().document,
        nodes: {
          ...store.getState().document.nodes,
          [planeId]: {
            ...plane,
            mesh: {
              ...plane.mesh,
              vertices: {
                ...plane.mesh.vertices,
                duplicate: {
                  ...source,
                  id: 'duplicate',
                  position: { ...source.position, x: source.position.x + 0.001 },
                },
              },
            },
          },
        },
      },
      [planeId],
    );

    store.cleanupDuplicateVertices(planeId, 0.01);
    expect(
      Object.keys((store.getState().document.nodes[planeId] as typeof plane).mesh.vertices),
    ).toHaveLength(4);
    expect(store.getState().history.past).toHaveLength(1);
    store.undo();
    expect(
      Object.keys((store.getState().document.nodes[planeId] as typeof plane).mesh.vertices),
    ).toHaveLength(5);
  });

  it('merges selected vertices through the command history', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const cubeId = store.getState().selectedNodeIds[0]!;
    const cube = store.getState().document.nodes[cubeId];
    expect(cube.type).toBe('mesh');
    if (cube.type !== 'mesh') {
      return;
    }
    const edge = getMeshEdges(cube.mesh)[0]!;

    store.setMode('vertex');
    store.selectVertices([
      { nodeId: cubeId, vertexId: edge.vertexAId },
      { nodeId: cubeId, vertexId: edge.vertexBId },
    ]);
    store.mergeSelectedVertices();

    expect(store.getState().selectedVertexIds).toEqual([{ nodeId: cubeId, vertexId: edge.vertexAId }]);
    expect(Object.keys((store.getState().document.nodes[cubeId] as typeof cube).mesh.vertices)).toHaveLength(
      7,
    );
    store.undo();
    expect(Object.keys((store.getState().document.nodes[cubeId] as typeof cube).mesh.vertices)).toHaveLength(
      8,
    );
  });

  it('restores and replays a mixed topology command chain by checksum and world bounds', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const cubeId = store.getState().selectedNodeIds[0]!;
    const before = store.getState().document;
    const beforeChecksum = documentChecksum(before);
    const beforeBounds = getSubtreeWorldBounds(before, cubeId);
    const cube = before.nodes[cubeId];
    expect(cube?.type).toBe('mesh');
    if (cube?.type !== 'mesh') {
      return;
    }

    store.setMode('edge');
    store.selectEdges([{ nodeId: cubeId, edgeId: getMeshEdges(cube.mesh)[0]!.id }]);
    store.loopCutSelectedEdge(0.35);

    const cutCube = store.getState().document.nodes[cubeId];
    expect(cutCube?.type).toBe('mesh');
    if (cutCube?.type !== 'mesh') {
      return;
    }
    store.setMode('face');
    store.selectFaces([{ nodeId: cubeId, faceId: Object.keys(cutCube.mesh.faces)[0]! }]);
    store.extrudeSelectedFaces(0.2);
    store.selectNodes([cubeId]);
    store.mirrorSelectedGeometry('x', 0.001);
    store.bendSelectedGeometry('z', Math.PI / 8, { x: 0, y: 0, z: 0 });

    const after = store.getState().document;
    const afterChecksum = documentChecksum(after);
    const afterBounds = getSubtreeWorldBounds(after, cubeId);
    const operationCount = store.getState().history.past.length - 1;
    expect(operationCount).toBe(4);
    expect(afterChecksum).not.toBe(beforeChecksum);

    for (let index = 0; index < operationCount; index += 1) {
      store.undo();
    }
    expect(documentChecksum(store.getState().document)).toBe(beforeChecksum);
    expect(getSubtreeWorldBounds(store.getState().document, cubeId)).toEqual(beforeBounds);

    for (let index = 0; index < operationCount; index += 1) {
      store.redo();
    }
    expect(documentChecksum(store.getState().document)).toBe(afterChecksum);
    expect(getSubtreeWorldBounds(store.getState().document, cubeId)).toEqual(afterBounds);
  });
});
