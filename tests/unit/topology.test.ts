import { describe, expect, it } from 'vitest';
import { createPrimitiveMesh } from '../../src/editor/geometry/mesh-data';
import {
  getCoincidentVertexGroups,
  getMergeableDuplicateVertexGroups,
  getMeshConnectedComponents,
  getMeshTopology,
  getMeshTopologyDiagnostics,
} from '../../src/editor/geometry/topology';

describe('topology diagnostics', () => {
  it('reports boundary edges for an open plane', () => {
    const plane = createPrimitiveMesh('plane', 'material-1');

    expect(getMeshTopologyDiagnostics(plane)).toMatchObject({
      edgeCount: 4,
      boundaryEdgeIds: expect.any(Array),
      inconsistentFaceIds: [],
      nonManifoldEdgeIds: [],
    });
    expect(getMeshTopologyDiagnostics(plane).boundaryEdgeIds).toHaveLength(4);
  });

  it('caches vertex-edge-face adjacency for each immutable mesh snapshot', () => {
    const plane = createPrimitiveMesh('plane', 'material-1');
    const topology = getMeshTopology(plane);

    expect(getMeshTopology(plane)).toBe(topology);
    expect(topology.edgeIdsByFace.f1).toHaveLength(4);
    expect(topology.edgeIdsByVertex.v1).toHaveLength(2);
    expect(topology.faceIdsByVertex.v1).toEqual(['f1']);

    const changedSnapshot = { ...plane, faces: { ...plane.faces } };
    expect(getMeshTopology(changedSnapshot)).not.toBe(topology);
  });

  it('reports edges shared by more than two faces as non-manifold', () => {
    const plane = createPrimitiveMesh('plane', 'material-1');
    const face = Object.values(plane.faces)[0]!;
    const nonManifold = {
      ...plane,
      faces: {
        ...plane.faces,
        'face-extra-1': { ...face, id: 'face-extra-1' },
        'face-extra-2': { ...face, id: 'face-extra-2' },
      },
    };

    expect(getMeshTopologyDiagnostics(nonManifold).nonManifoldEdgeIds).toHaveLength(4);
  });

  it('groups disconnected mesh islands into selectable components', () => {
    const plane = createPrimitiveMesh('plane', 'material-1');
    const looseVertices = Object.fromEntries(
      Object.entries(plane.vertices).map(([vertexId, vertex]) => [
        `loose-${vertexId}`,
        {
          ...vertex,
          id: `loose-${vertexId}`,
          position: { ...vertex.position, x: vertex.position.x + 5 },
        },
      ]),
    );
    const face = Object.values(plane.faces)[0]!;
    const disconnected = {
      vertices: { ...plane.vertices, ...looseVertices },
      faces: {
        ...plane.faces,
        'loose-face': {
          ...face,
          id: 'loose-face',
          vertexIds: face.vertexIds.map((vertexId) => `loose-${vertexId}`),
        },
      },
    };

    expect(getMeshConnectedComponents(disconnected)).toEqual([
      expect.objectContaining({ faceIds: ['f1'], vertexIds: ['v1', 'v2', 'v3', 'v4'] }),
      expect.objectContaining({
        faceIds: ['loose-face'],
        vertexIds: ['loose-v1', 'loose-v2', 'loose-v3', 'loose-v4'],
      }),
    ]);
  });

  it('reports faces whose shared edge winding is inconsistent', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const faceId = Object.keys(cube.faces)[0]!;
    const flipped = {
      ...cube,
      faces: {
        ...cube.faces,
        [faceId]: { ...cube.faces[faceId], vertexIds: [...cube.faces[faceId]!.vertexIds].reverse() },
      },
    };

    expect(getMeshTopologyDiagnostics(cube).inconsistentFaceIds).toEqual([]);
    expect(getMeshTopologyDiagnostics(flipped).inconsistentFaceIds).toContain(faceId);
  });

  it('detects coincident vertices but protects UV/color/normal seam variants from cleanup', () => {
    const plane = createPrimitiveMesh('plane', 'material-1');
    const source = plane.vertices.v1!;
    const withDuplicates = {
      ...plane,
      vertices: {
        ...plane.vertices,
        duplicate: { ...source, id: 'duplicate' },
        seam: { ...source, id: 'seam', color: { r: 1, g: 0, b: 0 } },
      },
    };

    expect(getCoincidentVertexGroups(withDuplicates)).toContainEqual({
      vertexIds: ['v1', 'duplicate', 'seam'],
    });
    expect(getMergeableDuplicateVertexGroups(withDuplicates)).toEqual([{ vertexIds: ['v1', 'duplicate'] }]);
  });
});
