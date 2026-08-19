import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  createGroupNode,
  createPrimitiveNode,
  documentChecksum,
  getChildren,
  insertNode,
  applyNodeScale,
  bakeMirrorModifiersForExport,
  commitBooleanMesh,
  moveNodeToGround,
  removeNode,
  renameNode,
  resizeNodeGeometry,
  separateNodeFaces,
  setGroundReference,
  setNodeMirrorModifier,
  setMaterialTexture,
  updateMaterialProperties,
  updateNodeTransform,
} from '../../src/editor/core/document';
import { getMeshBounds } from '../../src/editor/geometry/mesh-operations';
import { getSubtreeWorldBounds } from '../../src/editor/geometry/world-bounds';

describe('SceneDocument', () => {
  it('creates an asset root and inserts a primitive below it', () => {
    const empty = createEmptyDocument();
    const cube = createPrimitiveNode(empty, 'cube');
    const document = insertNode(empty, cube);

    expect(document.rootId).toBe('asset_root');
    expect(getChildren(document, document.rootId)).toEqual([
      expect.objectContaining({ id: cube.id, name: 'Cube' }),
    ]);
    expect(document.revision).toBe(1);
    expect(Object.keys(cube.mesh.vertices)).toHaveLength(8);
    expect(Object.keys(cube.mesh.faces)).toHaveLength(6);
  });

  it('separates selected faces into a sibling mesh without changing local placement', () => {
    const empty = createEmptyDocument();
    const cube = createPrimitiveNode(empty, 'cube');
    const document = insertNode(empty, cube);
    const faceId = Object.keys(cube.mesh.faces)[0]!;
    const separated = separateNodeFaces(document, cube.id, [faceId]);
    const part = Object.values(separated.nodes).find((node) => node.id !== cube.id && node.type === 'mesh');

    expect((separated.nodes[cube.id] as typeof cube).mesh.faces[faceId]).toBeUndefined();
    expect(part).toMatchObject({
      name: 'Cube_part',
      parentId: cube.parentId,
      transform: cube.transform,
      type: 'mesh',
    });
    expect(part?.type === 'mesh' ? Object.keys(part.mesh.faces) : []).toEqual([faceId]);
  });

  it('updates transforms and names immutably', () => {
    const empty = createEmptyDocument();
    const cube = createPrimitiveNode(empty, 'cube');
    const withCube = insertNode(empty, cube);
    const renamed = renameNode(withCube, cube.id, 'Canopy');
    const transformed = updateNodeTransform(renamed, cube.id, {
      position: { x: 1.25, y: 0, z: -0.5 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 2, y: 1, z: 2 },
    });

    expect(withCube.nodes[cube.id].name).toBe('Cube');
    expect(transformed.nodes[cube.id]).toMatchObject({
      name: 'Canopy',
      transform: { position: { x: 1.25, y: 0, z: -0.5 }, scale: { x: 2, y: 1, z: 2 } },
    });
  });

  it('does not remove the asset root and produces a stable checksum', () => {
    const empty = createEmptyDocument();
    const cube = createPrimitiveNode(empty, 'cube');
    const withCube = insertNode(empty, cube);

    expect(removeNode(withCube, withCube.rootId)).toBe(withCube);
    expect(documentChecksum(withCube)).toBe(documentChecksum(withCube));
    expect(removeNode(withCube, cube.id).nodes[cube.id]).toBeUndefined();
  });

  it('commits a Boolean mesh by replacing the subject and removing only the childless cutter', () => {
    const empty = createEmptyDocument();
    const subject = createPrimitiveNode(empty, 'cube');
    const withSubject = insertNode(empty, subject);
    const cutter = createPrimitiveNode(withSubject, 'cylinder');
    const document = insertNode(withSubject, cutter);
    const replacement = createPrimitiveNode(document, 'cone').mesh;
    const committed = commitBooleanMesh(document, subject.id, cutter.id, replacement);

    expect(document.nodes[subject.id]).toMatchObject({ type: 'mesh', mesh: subject.mesh });
    expect(committed.nodes[cutter.id]).toBeUndefined();
    expect(committed.nodes[subject.id]).toMatchObject({
      type: 'mesh',
      mesh: replacement,
      transform: subject.transform,
    });
  });

  it('owns a material texture payload in the document and removes stale payloads when replaced', () => {
    const document = createEmptyDocument();
    const texture = {
      colorSpace: 'srgb' as const,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      height: 1,
      id: 'texture-1',
      mimeType: 'image/png' as const,
      name: 'Paint layer',
      width: 1,
    };
    const textured = setMaterialTexture(document, 'material-1', texture);
    const replaced = setMaterialTexture(textured, 'material-1', {
      ...texture,
      id: 'texture-2',
      name: 'Updated',
    });

    expect(textured.materials['material-1']?.baseColorTextureId).toBe('texture-1');
    expect(textured.textures['texture-1']).toEqual(texture);
    expect(replaced.textures['texture-1']).toBeUndefined();
    expect(replaced.textures['texture-2']?.name).toBe('Updated');
  });

  it('keeps a texture payload while another material still references it', () => {
    const document = createEmptyDocument();
    const texture = {
      colorSpace: 'srgb' as const,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      height: 1,
      id: 'texture-1',
      mimeType: 'image/png' as const,
      name: 'Shared layer',
      width: 1,
    };
    const textured = setMaterialTexture(document, 'material-1', texture);
    const shared = {
      ...textured,
      materials: {
        ...textured.materials,
        'material-2': { ...textured.materials['material-1']!, id: 'material-2', name: 'Shared material' },
      },
    };
    const cleared = setMaterialTexture(shared, 'material-1', null);

    expect(cleared.materials['material-1']?.baseColorTextureId).toBeUndefined();
    expect(cleared.materials['material-2']?.baseColorTextureId).toBe('texture-1');
    expect(cleared.textures['texture-1']).toEqual(texture);
  });

  it('bakes current object scale before changing editable geometry size', () => {
    const empty = createEmptyDocument();
    const cube = createPrimitiveNode(empty, 'cube');
    const withCube = insertNode(empty, {
      ...cube,
      transform: { ...cube.transform, scale: { x: 2, y: 1, z: 1 } },
    });
    const resized = resizeNodeGeometry(withCube, cube.id, { x: 3, y: 2, z: 1 });

    expect(resized.nodes[cube.id]).toMatchObject({ transform: { scale: { x: 1, y: 1, z: 1 } } });
    const mesh = resized.nodes[cube.id];
    expect(mesh.type).toBe('mesh');
    if (mesh.type === 'mesh') {
      expect(Object.values(mesh.mesh.vertices).some((vertex) => vertex.position.x === 1.5)).toBe(true);
    }
  });

  it('preserves placement while scale baking keeps world bounds and resize sets local bounds', () => {
    const empty = createEmptyDocument();
    const cube = createPrimitiveNode(empty, 'cube');
    const transform = {
      position: { x: 4, y: -2, z: 1.5 },
      rotation: { x: 0.2, y: -0.5, z: 0.1 },
      scale: { x: 2, y: 0.5, z: 3 },
    };
    const withCube = insertNode(empty, { ...cube, transform });
    const beforeBounds = getSubtreeWorldBounds(withCube, cube.id);
    const baked = applyNodeScale(withCube, cube.id);
    const bakedNode = baked.nodes[cube.id];
    const afterBounds = getSubtreeWorldBounds(baked, cube.id);

    expect(bakedNode).toMatchObject({
      transform: {
        position: transform.position,
        rotation: transform.rotation,
        scale: { x: 1, y: 1, z: 1 },
      },
    });
    expect(afterBounds?.min).toEqual({
      x: expect.closeTo(beforeBounds!.min.x),
      y: expect.closeTo(beforeBounds!.min.y),
      z: expect.closeTo(beforeBounds!.min.z),
    });
    expect(afterBounds?.max).toEqual({
      x: expect.closeTo(beforeBounds!.max.x),
      y: expect.closeTo(beforeBounds!.max.y),
      z: expect.closeTo(beforeBounds!.max.z),
    });

    const resized = resizeNodeGeometry(baked, cube.id, { x: 4, y: 2, z: 6 });
    const resizedNode = resized.nodes[cube.id];
    expect(resizedNode).toMatchObject({
      transform: {
        position: transform.position,
        rotation: transform.rotation,
        scale: { x: 1, y: 1, z: 1 },
      },
    });
    expect(resizedNode.type).toBe('mesh');
    if (resizedNode.type === 'mesh') {
      expect(getMeshBounds(resizedNode.mesh)?.size).toEqual({ x: 4, y: 2, z: 6 });
    }
  });

  it('creates pivots as editable hierarchy groups', () => {
    const empty = createEmptyDocument();
    const pivot = createGroupNode(empty, 'shade_pivot');
    const document = insertNode(empty, pivot);

    expect(document.nodes[pivot.id]).toMatchObject({
      type: 'group',
      name: 'shade_pivot',
      parentId: document.rootId,
    });
  });

  it('moves a nested mesh to the world ground plane despite parent scale', () => {
    const empty = createEmptyDocument();
    const pivot = createGroupNode(empty, 'shade_pivot');
    const withPivot = insertNode(empty, {
      ...pivot,
      transform: { ...pivot.transform, position: { x: 0, y: 3, z: 0 }, scale: { x: 1, y: 2, z: 1 } },
    });
    const cube = createPrimitiveNode(withPivot, 'cube', pivot.id);
    const document = insertNode(withPivot, {
      ...cube,
      transform: { ...cube.transform, position: { x: 0, y: 2, z: 0 } },
    });
    const grounded = moveNodeToGround(document, cube.id);

    expect(grounded.nodes[cube.id].transform.position.y).toBe(-1);
    expect(getSubtreeWorldBounds(grounded, cube.id)?.min.y).toBeCloseTo(0);
  });

  it('moves a selected subtree to a custom ground reference stored in metadata', () => {
    const empty = createEmptyDocument();
    const cube = createPrimitiveNode(empty, 'cube');
    const document = setGroundReference(
      insertNode(empty, {
        ...cube,
        transform: { ...cube.transform, position: { x: 0, y: 3, z: 0 } },
      }),
      1.25,
    );
    const grounded = moveNodeToGround(document, cube.id);

    expect(grounded.nodes[cube.id].transform.position.y).toBeCloseTo(1.75);
    expect(getSubtreeWorldBounds(grounded, cube.id)?.min.y).toBeCloseTo(1.25);
  });

  it('updates serializable material properties with normalized numeric limits', () => {
    const empty = createEmptyDocument();
    const updated = updateMaterialProperties(empty, 'material-1', {
      baseColor: '#ff8844',
      roughness: -1,
      metalness: 2,
      opacity: 0.4,
      flatShading: false,
    });

    expect(updated.materials['material-1']).toMatchObject({
      baseColor: '#ff8844',
      roughness: 0,
      metalness: 1,
      opacity: 0.4,
      flatShading: false,
    });
    expect(empty.materials['material-1'].baseColor).toBe('#7fcf98');
  });

  it('keeps a live Mirror modifier in the editable document and bakes it only for export', () => {
    const empty = createEmptyDocument();
    const cube = createPrimitiveNode(empty, 'cube');
    const source = insertNode(empty, cube);
    const withLiveMirror = setNodeMirrorModifier(source, cube.id, { axis: 'x', seamTolerance: 0.001 });
    const baked = bakeMirrorModifiersForExport(withLiveMirror);

    expect(withLiveMirror.nodes[cube.id]).toMatchObject({
      mirrorModifier: { axis: 'x', seamTolerance: 0.001 },
    });
    expect(Object.keys((withLiveMirror.nodes[cube.id] as typeof cube).mesh.faces)).toHaveLength(6);
    expect(baked.nodes[cube.id]).toMatchObject({ mirrorModifier: undefined });
    expect(Object.keys((baked.nodes[cube.id] as typeof cube).mesh.faces)).toHaveLength(12);
  });
});
