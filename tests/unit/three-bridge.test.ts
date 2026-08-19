import { describe, expect, it } from 'vitest';
import { DEFAULT_MATERIAL } from '../../src/editor/core/types';
import { createPrimitiveMesh } from '../../src/editor/geometry/mesh-data';
import { materialDataToThree, meshDataToBufferGeometry } from '../../src/editor/geometry/three-bridge';

describe('runtime material policy', () => {
  it('uses transparent rendering without depth writes below full opacity', () => {
    const transparent = materialDataToThree({ ...DEFAULT_MATERIAL, opacity: 0.4 }, false);
    const opaque = materialDataToThree({ ...DEFAULT_MATERIAL, opacity: 1 }, false);

    expect(transparent.transparent).toBe(true);
    expect(transparent.depthWrite).toBe(false);
    expect(opaque.transparent).toBe(false);
    expect(opaque.depthWrite).toBe(true);

    transparent.dispose();
    opaque.dispose();
  });

  it('writes editable four-component tangents to runtime geometry', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const mesh = {
      ...cube,
      vertices: Object.fromEntries(
        Object.entries(cube.vertices).map(([vertexId, vertex]) => [
          vertexId,
          { ...vertex, tangent: { x: 1, y: 0, z: 0, w: -1 } },
        ]),
      ),
    };
    const { geometry } = meshDataToBufferGeometry(mesh);
    const tangents = geometry.getAttribute('tangent');

    expect(tangents).toBeDefined();
    expect(tangents.itemSize).toBe(4);
    expect(tangents.getW(0)).toBe(-1);
    geometry.dispose();
  });
});
