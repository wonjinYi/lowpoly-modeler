import { describe, expect, it } from 'vitest';
import { createPrimitiveMesh } from '../../src/editor/geometry/mesh-data';
import {
  applyMeshScale,
  bevelMeshEdge,
  bendMeshGeometry,
  colorMeshFaces,
  deleteDegenerateMeshFaces,
  deleteMeshEdges,
  dissolveMeshEdges,
  extrudeMeshFaces,
  getMeshBounds,
  getDegenerateFaceIds,
  generateAutoUvMesh,
  mergeMeshVertices,
  mergeMeshVerticesByDistance,
  mirrorMeshGeometry,
  recalculateMeshNormals,
  insetMeshFaces,
  inspectTrisToQuad,
  loopCutMesh,
  resizeMeshGeometry,
  subdivideMeshEdges,
  transformMeshVertices,
  traceLoopCut,
} from '../../src/editor/geometry/mesh-operations';
import { getMeshEdges, inspectMeshDataInvariants } from '../../src/editor/geometry/topology';

function withCornerAttributes(mesh: ReturnType<typeof createPrimitiveMesh>) {
  return {
    ...mesh,
    vertices: Object.fromEntries(
      Object.entries(mesh.vertices).map(([vertexId, vertex], index) => [
        vertexId,
        {
          ...vertex,
          color: { b: index / 10, g: 0.5, r: 1 - index / 10 },
          normal: { x: 0, y: 1, z: 0 },
          tangent: { w: 1, x: 1, y: 0, z: 0 },
          uv: { u: index / 10, v: 1 - index / 10 },
        },
      ]),
    ),
  };
}

describe('mesh geometry operations', () => {
  it('creates per-face UV seams for an unwrapped cube and never overwrites existing UVs', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const autoUv = generateAutoUvMesh(cube);
    const repeatedCornerIds = Object.values(autoUv.faces).flatMap((face) => face.vertexIds);

    expect(Object.values(autoUv.vertices).every((vertex) => Boolean(vertex.uv))).toBe(true);
    expect(new Set(repeatedCornerIds).size).toBe(repeatedCornerIds.length);
    expect(Object.keys(autoUv.vertices)).toHaveLength(24);
    expect(generateAutoUvMesh(autoUv)).toBe(autoUv);
  });

  it('resizes editable vertices around the mesh center instead of object scale', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const resized = resizeMeshGeometry(cube, { x: 2, y: 3, z: 4 });

    expect(getMeshBounds(cube)?.size).toEqual({ x: 1, y: 1, z: 1 });
    expect(getMeshBounds(resized)?.size).toEqual({ x: 2, y: 3, z: 4 });
    expect(getMeshBounds(resized)?.center).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('bakes an object scale into mesh vertices', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const firstVertexId = Object.keys(cube.vertices)[0]!;
    const withNormal = {
      ...cube,
      vertices: {
        ...cube.vertices,
        [firstVertexId]: {
          ...cube.vertices[firstVertexId],
          normal: { x: 1, y: 1, z: 0 },
          tangent: { x: 1, y: 1, z: 0, w: 1 },
        },
      },
    };
    const baked = applyMeshScale(withNormal, { x: 2, y: 0.5, z: 3 });

    expect(getMeshBounds(baked)?.size).toEqual({ x: 2, y: 0.5, z: 3 });
    expect(baked.vertices[firstVertexId].normal).toEqual(
      expect.objectContaining({ x: expect.closeTo(0.242536), y: expect.closeTo(0.970143), z: 0 }),
    );
    expect(baked.vertices[firstVertexId].tangent).toEqual(
      expect.objectContaining({ x: expect.closeTo(0.970143), y: expect.closeTo(0.242536), z: 0, w: 1 }),
    );
  });

  it('reverses face winding when baking an odd negative scale reflection', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const faceId = Object.keys(cube.faces)[0]!;
    const firstVertexId = Object.keys(cube.vertices)[0]!;
    const baked = applyMeshScale(
      {
        ...cube,
        vertices: {
          ...cube.vertices,
          [firstVertexId]: { ...cube.vertices[firstVertexId], tangent: { x: 1, y: 0, z: 0, w: 1 } },
        },
      },
      { x: -1, y: 1, z: 1 },
    );

    expect(baked.faces[faceId]!.vertexIds).toEqual([...cube.faces[faceId]!.vertexIds].reverse());
    expect(baked.vertices[firstVertexId]!.position.x).toBeCloseTo(-cube.vertices[firstVertexId]!.position.x);
    expect(baked.vertices[firstVertexId]!.tangent).toEqual({ x: -1, y: 0, z: 0, w: -1 });
  });

  it('transforms only selected editable vertices around their shared local center', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const selectedEdge = getMeshEdges(cube)[0]!;
    const first = cube.vertices[selectedEdge.vertexAId]!;
    const second = cube.vertices[selectedEdge.vertexBId]!;
    const untouchedVertexId = Object.keys(cube.vertices).find(
      (vertexId) => vertexId !== first.id && vertexId !== second.id,
    )!;
    const center = {
      x: (first.position.x + second.position.x) / 2,
      y: (first.position.y + second.position.y) / 2,
      z: (first.position.z + second.position.z) / 2,
    };
    const transformed = transformMeshVertices(
      {
        ...cube,
        vertices: { ...cube.vertices, [first.id]: { ...first, normal: { x: 1, y: 0, z: 0 } } },
      },
      [first.id, second.id],
      {
        translation: { x: 0.25, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: Math.PI },
        scale: { x: 1, y: 1, z: 1 },
      },
    );

    expect(transformed.vertices[first.id]!.position).toEqual({
      x: expect.closeTo(center.x - (first.position.x - center.x) + 0.25),
      y: expect.closeTo(center.y - (first.position.y - center.y)),
      z: expect.closeTo(first.position.z),
    });
    expect(transformed.vertices[first.id]!.normal).toBeUndefined();
    expect(transformed.vertices[first.id]!.tangent).toBeUndefined();
    expect(transformed.vertices[untouchedVertexId]).toBe(cube.vertices[untouchedVertexId]);
    expect(
      transformMeshVertices(cube, [], {
        translation: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      }),
    ).toBe(cube);
  });

  it('extrudes a quad face into a top face and four side faces', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const faceId = Object.keys(cube.faces)[0]!;
    const extruded = extrudeMeshFaces(cube, [faceId], 0.25);

    expect(Object.keys(extruded.vertices)).toHaveLength(12);
    expect(Object.keys(extruded.faces)).toHaveLength(10);
    expect(extruded.faces[faceId].vertexIds).not.toEqual(cube.faces[faceId].vertexIds);
  });

  it('insets a selected quad while preserving an inner face and ring', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const faceId = Object.keys(cube.faces)[0]!;
    const sourceVertexId = cube.faces[faceId]!.vertexIds[0]!;
    const source = cube.vertices[sourceVertexId]!.position;
    const sourcePositions = cube.faces[faceId]!.vertexIds.map(
      (vertexId) => cube.vertices[vertexId]!.position,
    );
    const center = sourcePositions.reduce(
      (sum, position) => ({
        x: sum.x + position.x / sourcePositions.length,
        y: sum.y + position.y / sourcePositions.length,
        z: sum.z + position.z / sourcePositions.length,
      }),
      { x: 0, y: 0, z: 0 },
    );
    const inset = insetMeshFaces(cube, [faceId], 0.25);
    const innerVertex = inset.vertices[inset.faces[faceId]!.vertexIds[0]!]?.position;

    expect(Object.keys(inset.vertices)).toHaveLength(12);
    expect(Object.keys(inset.faces)).toHaveLength(10);
    expect(inset.faces[faceId]!.vertexIds).not.toContain(sourceVertexId);
    expect(innerVertex).toEqual({
      x: source.x + (center.x - source.x) * 0.25,
      y: source.y + (center.y - source.y) * 0.25,
      z: source.z + (center.z - source.z) * 0.25,
    });
  });

  it('colors only the selected face by duplicating its editable corners', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const faceId = Object.keys(cube.faces)[0]!;
    const colored = colorMeshFaces(cube, [faceId], '#ff8040');
    const coloredFace = colored.faces[faceId]!;

    expect(Object.keys(colored.vertices)).toHaveLength(12);
    expect(coloredFace.vertexIds).not.toEqual(cube.faces[faceId]!.vertexIds);
    expect(coloredFace.vertexIds.map((vertexId) => colored.vertices[vertexId]!.color)).toEqual([
      { r: 1, g: 128 / 255, b: 64 / 255 },
      { r: 1, g: 128 / 255, b: 64 / 255 },
      { r: 1, g: 128 / 255, b: 64 / 255 },
      { r: 1, g: 128 / 255, b: 64 / 255 },
    ]);
    expect(Object.values(colored.vertices).filter((vertex) => vertex.color)).toHaveLength(4);
  });

  it('subdivides a selected shared edge by inserting one editable midpoint', () => {
    const cube = withCornerAttributes(createPrimitiveMesh('cube', 'material-1'));
    const selectedEdge = getMeshEdges(cube)[0]!;
    const subdivided = subdivideMeshEdges(cube, [selectedEdge.id]);
    const midpoint = Object.values(subdivided.vertices).find((vertex) => !cube.vertices[vertex.id]);
    const first = cube.vertices[selectedEdge.vertexAId]!.position;
    const second = cube.vertices[selectedEdge.vertexBId]!.position;

    expect(getMeshEdges(cube)).toHaveLength(12);
    expect(Object.keys(subdivided.vertices)).toHaveLength(9);
    expect(getMeshEdges(subdivided)).toHaveLength(13);
    expect(midpoint?.position).toEqual({
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      z: (first.z + second.z) / 2,
    });
    expect(
      Object.values(subdivided.faces).filter((face) => face.vertexIds.includes(midpoint!.id)),
    ).toHaveLength(2);
    expect(midpoint).toMatchObject({
      color: { b: expect.any(Number), g: 0.5, r: expect.any(Number) },
      normal: { x: 0, y: 1, z: 0 },
      tangent: { w: 1, x: 1, y: 0, z: 0 },
      uv: { u: expect.any(Number), v: expect.any(Number) },
    });
  });

  it('traces a closed quad loop and inserts a selectable edge ring', () => {
    const cube = withCornerAttributes(createPrimitiveMesh('cube', 'material-1'));
    const selectedEdge = getMeshEdges(cube)[0]!;
    const path = traceLoopCut(cube, selectedEdge.id);
    const cut = loopCutMesh(cube, selectedEdge.id, 0.25);
    const createdVertexIds = Object.keys(cut.vertices).filter((vertexId) => !cube.vertices[vertexId]);
    const cutEdges = getMeshEdges(cut).filter(
      (edge) => createdVertexIds.includes(edge.vertexAId) && createdVertexIds.includes(edge.vertexBId),
    );

    expect(path).toMatchObject({ isClosed: true, reason: null });
    expect(path.faces).toHaveLength(4);
    expect(Object.keys(cut.vertices)).toHaveLength(12);
    expect(Object.keys(cut.faces)).toHaveLength(10);
    expect(cutEdges).toHaveLength(4);
    expect(Object.values(cut.faces).every((face) => face.vertexIds.length === 4)).toBe(true);
    expect(createdVertexIds.every((vertexId) => Boolean(cut.vertices[vertexId]!.tangent))).toBe(true);
    expect(createdVertexIds.every((vertexId) => Boolean(cut.vertices[vertexId]!.uv))).toBe(true);
    expect(createdVertexIds.every((vertexId) => Boolean(cut.vertices[vertexId]!.color))).toBe(true);
  });

  it('supports an open Loop Cut across a quad boundary and rejects triangles without mutation', () => {
    const plane = createPrimitiveMesh('plane', 'material-1');
    const planeEdge = getMeshEdges(plane)[0]!;
    const openPath = traceLoopCut(plane, planeEdge.id);
    const cutPlane = loopCutMesh(plane, planeEdge.id);
    const triangleMesh = createPrimitiveMesh('icosphere', 'material-1', { subdivisions: 0 });
    const triangleEdge = getMeshEdges(triangleMesh)[0]!;

    expect(openPath).toMatchObject({ isClosed: false, reason: null });
    expect(Object.keys(cutPlane.vertices)).toHaveLength(6);
    expect(Object.keys(cutPlane.faces)).toHaveLength(2);
    expect(traceLoopCut(triangleMesh, triangleEdge.id).reason).toContain('not a quad');
    expect(loopCutMesh(triangleMesh, triangleEdge.id)).toBe(triangleMesh);
  });

  it('bevels one manifold edge into a chamfer face without leaving the source edge', () => {
    const cube = withCornerAttributes(createPrimitiveMesh('cube', 'material-1'));
    const selectedEdge = getMeshEdges(cube)[0]!;
    const beveled = bevelMeshEdge(cube, selectedEdge.id, 0.1);

    expect(Object.keys(beveled.vertices)).toHaveLength(12);
    expect(Object.keys(beveled.faces)).toHaveLength(7);
    expect(getMeshEdges(beveled).some((edge) => edge.id === selectedEdge.id)).toBe(false);
    expect(getDegenerateFaceIds(beveled)).toEqual([]);
    expect(Object.values(beveled.vertices).filter((vertex) => !cube.vertices[vertex.id])).toEqual(
      expect.arrayContaining([expect.objectContaining({ tangent: { w: 1, x: 1, y: 0, z: 0 } })]),
    );
  });

  it('refuses to bevel a boundary edge', () => {
    const plane = createPrimitiveMesh('plane', 'material-1');
    const edge = getMeshEdges(plane)[0]!;

    expect(bevelMeshEdge(plane, edge.id, 0.1)).toBe(plane);
  });

  it('bends selected editable geometry around a local origin and clears stale normals', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const firstVertexId = Object.keys(cube.vertices)[0]!;
    const withNormal = {
      ...cube,
      vertices: {
        ...cube.vertices,
        [firstVertexId]: {
          ...cube.vertices[firstVertexId],
          normal: { x: 1, y: 0, z: 0 },
          tangent: { w: 1, x: 1, y: 0, z: 0 },
        },
      },
    };
    const bent = bendMeshGeometry(withNormal, 'x', Math.PI / 2, { x: 0, y: 0, z: 0 });

    expect(bent.vertices[firstVertexId].position).not.toEqual(withNormal.vertices[firstVertexId].position);
    expect(bent.vertices[firstVertexId].normal).toBeUndefined();
    expect(bent.vertices[firstVertexId].tangent).toBeUndefined();
    expect(bendMeshGeometry(cube, 'x', 0, { x: 0, y: 0, z: 0 })).toBe(cube);
  });

  it('mirrors a half mesh and reuses vertices on the mirror seam', () => {
    const plane = withCornerAttributes(createPrimitiveMesh('plane', 'material-1'));
    const halfPlane = {
      ...plane,
      vertices: Object.fromEntries(
        Object.entries(plane.vertices).map(([vertexId, vertex]) => [
          vertexId,
          { ...vertex, position: { ...vertex.position, x: vertex.position.x < 0 ? 0 : 1 } },
        ]),
      ),
    };
    const mirrored = mirrorMeshGeometry(halfPlane, 'x', 0.001);

    expect(Object.keys(mirrored.vertices)).toHaveLength(6);
    expect(Object.keys(mirrored.faces)).toHaveLength(2);
    expect(Object.values(mirrored.vertices).some((vertex) => vertex.position.x === -1)).toBe(true);
    expect(getDegenerateFaceIds(mirrored)).toEqual([]);
    expect(Object.values(mirrored.vertices)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          position: { x: -1, y: 0, z: -0.5 },
          tangent: { w: -1, x: -1, y: 0, z: 0 },
        }),
      ]),
    );
  });

  it('identifies only coplanar, same-material triangle pairs for Tris to Quads', () => {
    const triangles = {
      vertices: {
        a: { id: 'a', position: { x: 0, y: 0, z: 0 } },
        b: { id: 'b', position: { x: 1, y: 0, z: 0 } },
        c: { id: 'c', position: { x: 1, y: 1, z: 0 } },
        d: { id: 'd', position: { x: 0, y: 1, z: 0 } },
      },
      faces: {
        'face-a': { id: 'face-a', materialId: 'material-1', vertexIds: ['a', 'b', 'c'] },
        'face-b': { id: 'face-b', materialId: 'material-1', vertexIds: ['c', 'd', 'a'] },
      },
    };
    const diagonal = getMeshEdges(triangles).find((edge) => edge.faceIds.length === 2)!;

    expect(inspectTrisToQuad(triangles, diagonal.id)).toEqual({
      faceIds: ['face-a', 'face-b'],
      reason: null,
    });
    expect(Object.keys(dissolveMeshEdges(triangles, [diagonal.id]).faces)).toHaveLength(1);
    expect(
      inspectTrisToQuad(
        {
          ...triangles,
          faces: { ...triangles.faces, 'face-b': { ...triangles.faces['face-b'], materialId: 'other' } },
        },
        diagonal.id,
      ).reason,
    ).toContain('material seam');
  });

  it('merges selected vertices at their center without creating degenerate faces', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const edge = getMeshEdges(cube)[0]!;
    const first = cube.vertices[edge.vertexAId]!.position;
    const second = cube.vertices[edge.vertexBId]!.position;
    const merged = mergeMeshVertices(cube, [edge.vertexAId, edge.vertexBId]);

    expect(Object.keys(merged.vertices)).toHaveLength(7);
    expect(Object.keys(merged.faces)).toHaveLength(6);
    expect(merged.vertices[edge.vertexAId]?.position).toEqual({
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      z: (first.z + second.z) / 2,
    });
    expect(Object.values(merged.faces).every((face) => new Set(face.vertexIds).size >= 3)).toBe(true);
  });

  it('merges only selected vertices that are within the requested distance', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const edge = getMeshEdges(cube)[0]!;

    expect(mergeMeshVerticesByDistance(cube, [edge.vertexAId, edge.vertexBId], 0.99)).toBe(cube);
    expect(
      Object.keys(mergeMeshVerticesByDistance(cube, [edge.vertexAId, edge.vertexBId], 1.01).vertices),
    ).toHaveLength(7);
  });

  it('distinguishes deleting an edge from dissolving its two manifold faces', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const edge = getMeshEdges(cube)[0]!;
    const deleted = deleteMeshEdges(cube, [edge.id]);
    const dissolved = dissolveMeshEdges(cube, [edge.id]);

    expect(Object.keys(deleted.faces)).toHaveLength(4);
    expect(Object.keys(dissolved.faces)).toHaveLength(5);
    expect(getMeshEdges(dissolved)).toHaveLength(11);
    expect(Object.values(dissolved.faces).some((face) => face.vertexIds.length === 6)).toBe(true);
  });

  it('refuses to dissolve a boundary edge', () => {
    const plane = createPrimitiveMesh('plane', 'material-1');
    const boundaryEdge = getMeshEdges(plane)[0]!;

    expect(dissolveMeshEdges(plane, [boundaryEdge.id])).toBe(plane);
  });

  it('rejects non-manifold edge operations without mutating the source mesh', () => {
    const nonManifold = {
      vertices: {
        a: { id: 'a', position: { x: 0, y: 0, z: 0 } },
        b: { id: 'b', position: { x: 1, y: 0, z: 0 } },
        c: { id: 'c', position: { x: 0, y: 1, z: 0 } },
        d: { id: 'd', position: { x: 1, y: 1, z: 0 } },
        e: { id: 'e', position: { x: 0.5, y: 0, z: 1 } },
      },
      faces: {
        'face-1': { id: 'face-1', materialId: 'material-1', vertexIds: ['a', 'b', 'c'] },
        'face-2': { id: 'face-2', materialId: 'material-1', vertexIds: ['b', 'a', 'd'] },
        'face-3': { id: 'face-3', materialId: 'material-1', vertexIds: ['a', 'b', 'e'] },
      },
    };
    const sharedEdge = getMeshEdges(nonManifold).find((edge) => edge.faceIds.length === 3)!;

    expect(bevelMeshEdge(nonManifold, sharedEdge.id, 0.1)).toBe(nonManifold);
    expect(dissolveMeshEdges(nonManifold, [sharedEdge.id])).toBe(nonManifold);
    expect(traceLoopCut(nonManifold, sharedEdge.id).reason).toContain('non-manifold');
  });

  it('recalculates normalized vertex normals from valid polygon faces', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const withInvalidNormals = {
      ...cube,
      vertices: Object.fromEntries(
        Object.entries(cube.vertices).map(([vertexId, vertex]) => [
          vertexId,
          { ...vertex, normal: { x: 0, y: 0, z: 0 }, tangent: { w: 1, x: 1, y: 0, z: 0 } },
        ]),
      ),
    };
    const recalculated = recalculateMeshNormals(withInvalidNormals);

    expect(
      Object.values(recalculated.vertices).every(
        (vertex) => Math.hypot(vertex.normal!.x, vertex.normal!.y, vertex.normal!.z) > 0.99,
      ),
    ).toBe(true);
    expect(Object.values(recalculated.vertices).every((vertex) => vertex.tangent === undefined)).toBe(true);
  });

  it('detects and removes degenerate faces without removing valid geometry', () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const [firstVertexId, secondVertexId] = Object.keys(cube.vertices);
    const withDegenerateFace = {
      ...cube,
      faces: {
        ...cube.faces,
        'face-degenerate': {
          id: 'face-degenerate',
          materialId: 'material-1',
          vertexIds: [firstVertexId!, firstVertexId!, secondVertexId!],
        },
      },
    };

    expect(getDegenerateFaceIds(withDegenerateFace)).toEqual(['face-degenerate']);
    expect(Object.keys(deleteDegenerateMeshFaces(withDegenerateFace).faces)).toHaveLength(6);
  });

  it('keeps supported topology results free of dangling, non-finite, degenerate, and winding errors', () => {
    const cube = withCornerAttributes(createPrimitiveMesh('cube', 'material-1'));
    const edge = getMeshEdges(cube)[0]!;
    const faceId = Object.keys(cube.faces)[0]!;
    const halfPlane = withCornerAttributes(createPrimitiveMesh('plane', 'material-1'));
    const oneSidePlane = {
      ...halfPlane,
      vertices: Object.fromEntries(
        Object.entries(halfPlane.vertices).map(([vertexId, vertex]) => [
          vertexId,
          { ...vertex, position: { ...vertex.position, x: vertex.position.x < 0 ? 0 : 1 } },
        ]),
      ),
    };
    const results = [
      colorMeshFaces(cube, [faceId], '#ff8040'),
      subdivideMeshEdges(cube, [edge.id]),
      loopCutMesh(cube, edge.id, 0.35),
      extrudeMeshFaces(cube, [faceId], 0.2),
      insetMeshFaces(cube, [faceId], 0.25),
      bevelMeshEdge(cube, edge.id, 0.1),
      bendMeshGeometry(cube, 'z', Math.PI / 8, { x: 0, y: 0, z: 0 }),
      mirrorMeshGeometry(oneSidePlane, 'x', 0.001),
    ];

    results.forEach((result) => {
      expect(inspectMeshDataInvariants(result)).toEqual({
        danglingVertexReferenceFaceIds: [],
        degenerateFaceIds: [],
        inconsistentFaceIds: [],
        invalidVertexIds: [],
        nonFiniteVertexIds: [],
      });
    });
  });
});
