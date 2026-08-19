import { describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/core/store';
import { SHADE_ASSET_VERSION, parseShadeAsset, serializeShadeAsset } from '../../src/editor/io/shadeasset';

describe('.shadeasset project files', () => {
  it('round-trips editable geometry, metadata, palette, and valid element selection', () => {
    const source = createEditorStore();
    source.addPrimitive('cube');
    const cubeId = source.getState().selectedNodeIds[0]!;
    const cube = source.getState().document.nodes[cubeId];
    if (cube?.type !== 'mesh') {
      throw new Error('Expected the inserted primitive to be a mesh.');
    }
    const faceId = Object.keys(cube.mesh.faces)[0]!;
    source.selectFaces([{ nodeId: cubeId, faceId }]);
    source.setMode('face');
    source.setFacePaintColor('#55C1B3');
    source.setGroundReference(1.25);
    source.setGroundContactTolerance(0.02);
    source.setForwardConfirmed(true);
    source.setSelectedMirrorModifier({ axis: 'z', seamTolerance: 0.005 });
    source.setMaterialTexturePayload('material-1', {
      colorSpace: 'srgb',
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WHJVmUAAAAASUVORK5CYII=',
      height: 1,
      id: 'texture-1',
      mimeType: 'image/png',
      name: 'Saved paint',
      width: 1,
    });

    const parsed = parseShadeAsset(serializeShadeAsset(source.getState().document, source.getState()));
    const restored = createEditorStore();
    restored.replaceProject(parsed.document, parsed.editor);

    expect(parsed.formatVersion).toBe(SHADE_ASSET_VERSION);
    expect(restored.getState()).toMatchObject({
      document: {
        metadata: {
          forwardConfirmed: true,
          groundReferenceY: 1.25,
          groundContactTolerance: 0.02,
        },
        nodes: {
          [cubeId]: { mirrorModifier: { axis: 'z', seamTolerance: 0.005 } },
        },
        materials: { 'material-1': { baseColorTextureId: 'texture-1' } },
        textures: { 'texture-1': { name: 'Saved paint', width: 1, height: 1, colorSpace: 'srgb' } },
      },
      selectedFaceIds: [{ nodeId: cubeId, faceId }],
      mode: 'face',
      facePaintColor: '#55c1b3',
      facePaintRecentColors: ['#55c1b3'],
      dirty: false,
    });
    expect(restored.getState().history.past).toEqual([]);
    expect(restored.getState().document.nodes[cubeId]?.type).toBe('mesh');
  });

  it('rejects corrupt, unsupported, and dangling-geometry manifests without producing a document', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const source = JSON.parse(serializeShadeAsset(store.getState().document, store.getState())) as Record<
      string,
      unknown
    >;
    const newer = { ...source, formatVersion: SHADE_ASSET_VERSION + 1 };
    const broken = JSON.parse(JSON.stringify(source)) as {
      document: { nodes: Record<string, { type?: string; mesh?: { vertices: Record<string, unknown> } }> };
    };
    const mesh = Object.values(broken.document.nodes).find((node) => node.type === 'mesh');
    if (!mesh?.mesh) {
      throw new Error('Expected a mesh in the saved project.');
    }
    delete mesh.mesh.vertices[Object.keys(mesh.mesh.vertices)[0]!];

    expect(() => parseShadeAsset('{')).toThrow('not valid JSON');
    expect(() => parseShadeAsset(JSON.stringify(newer))).toThrow('newer than this editor supports');
    expect(() => parseShadeAsset(JSON.stringify(broken))).toThrow('invalid editable geometry');
  });

  it('migrates a v1 JSON project by supplying the v2 texture payload defaults', () => {
    const store = createEditorStore();
    store.addPrimitive('cube');
    const legacy = JSON.parse(serializeShadeAsset(store.getState().document, store.getState())) as {
      document: Record<string, unknown>;
      editor: Record<string, unknown>;
      formatVersion: number;
    };
    legacy.formatVersion = 1;
    delete legacy.document.textures;
    delete legacy.editor.textureBrushOpacity;
    delete legacy.editor.textureBrushSize;
    delete legacy.editor.texturePaintTool;

    const migrated = parseShadeAsset(JSON.stringify(legacy));

    expect(migrated.formatVersion).toBe(2);
    expect(migrated.document.textures).toEqual({});
    expect(migrated.editor).toMatchObject({
      textureBrushOpacity: 1,
      textureBrushSize: 18,
      texturePaintTool: 'brush',
    });
  });
});
