import { describe, expect, it } from 'vitest';
import { createPrimitiveMesh, meshStatistics } from '../../src/editor/geometry/mesh-data';
import type { PrimitiveKind } from '../../src/editor/core/types';

describe('editable MeshData primitives', () => {
  it.each(['cube', 'plane', 'cylinder', 'cone', 'sphere', 'icosphere'] as PrimitiveKind[])(
    'creates a valid %s mesh',
    (primitive) => {
      const mesh = createPrimitiveMesh(primitive, 'material-1');
      const statistics = meshStatistics(mesh);

      expect(statistics.vertices).toBeGreaterThan(0);
      expect(statistics.faces).toBeGreaterThan(0);
      Object.values(mesh.faces).forEach((face) => {
        expect(face.vertexIds.length).toBeGreaterThanOrEqual(3);
        expect(face.materialId).toBe('material-1');
        face.vertexIds.forEach((vertexId) => expect(mesh.vertices[vertexId]).toBeDefined());
      });
    },
  );

  it('keeps the cube as six editable quad faces', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');

    expect(meshStatistics(cube)).toEqual({ vertices: 8, faces: 6 });
    expect(Object.values(cube.faces).every((face) => face.vertexIds.length === 4)).toBe(true);
  });

  it('honors low-poly segment and subdivision settings', () => {
    const cylinder = createPrimitiveMesh('cylinder', 'material-1', { radialSegments: 6 });
    const sphere = createPrimitiveMesh('sphere', 'material-1', { radialSegments: 6, latitudeSegments: 4 });
    const icosphere = createPrimitiveMesh('icosphere', 'material-1', { subdivisions: 0 });

    expect(meshStatistics(cylinder)).toEqual({ vertices: 12, faces: 8 });
    expect(meshStatistics(sphere)).toEqual({ vertices: 20, faces: 24 });
    expect(meshStatistics(icosphere)).toEqual({ vertices: 12, faces: 20 });
  });
});
