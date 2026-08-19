import { describe, expect, it } from 'vitest';
import { importGlb } from '../../src/editor/io/gltf';
import { createPrimitiveMesh } from '../../src/editor/geometry/mesh-data';
import { runBooleanSpike, runNodeBooleanSpike } from '../../src/editor/geometry/boolean-spike';
import type { MeshData } from '../../src/editor/core/types';
import { createCubeGlb } from '../fixtures/glb-fixtures';
import { createEmptyDocument, createPrimitiveNode, insertNode } from '../../src/editor/core/document';

function translateMesh(mesh: MeshData, x: number, y = 0, z = 0): MeshData {
  return {
    ...mesh,
    vertices: Object.fromEntries(
      Object.entries(mesh.vertices).map(([vertexId, vertex]) => [
        vertexId,
        {
          ...vertex,
          position: { x: vertex.position.x + x, y: vertex.position.y + y, z: vertex.position.z + z },
        },
      ]),
    ),
  };
}

function asArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

describe('Boolean WASM technology spike', () => {
  it('runs difference, union, and intersection for closed primitive solids without mutating inputs', async () => {
    const cube = createPrimitiveMesh('cube', 'material-1');
    const cylinder = translateMesh(
      createPrimitiveMesh('cylinder', 'material-1', { radialSegments: 8 }),
      0.25,
    );
    const beforeCube = JSON.stringify(cube);
    const results = await Promise.all([
      runBooleanSpike('difference', cube, cylinder),
      runBooleanSpike('union', cube, cylinder),
      runBooleanSpike('intersection', cube, cylinder),
    ]);

    expect(JSON.stringify(cube)).toBe(beforeCube);
    results.forEach((result) => {
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(result.triangleCount).toBeGreaterThan(0);
      expect(Object.keys(result.mesh.faces)).toHaveLength(result.triangleCount);
    });
  });

  it('accepts a real imported closed GLB fixture and rejects open mesh input before WASM mutation', async () => {
    const imported = await importGlb(asArrayBuffer(createCubeGlb()));
    const importedCube = Object.values(imported.document.nodes).find((node) => node.type === 'mesh');
    if (!importedCube || importedCube.type !== 'mesh') {
      throw new Error('Expected the cube GLB fixture to import as a mesh.');
    }
    const result = await runBooleanSpike(
      'difference',
      importedCube.mesh,
      translateMesh(createPrimitiveMesh('cube', 'material-1'), 0.3),
    );
    const openPlane = createPrimitiveMesh('plane', 'material-1');

    expect(result.triangleCount).toBeGreaterThan(0);
    await expect(runBooleanSpike('difference', openPlane, importedCube.mesh)).rejects.toThrow(
      'closed, consistently wound manifold',
    );
  });

  it('converts the cutter from world space into the subject local space without changing source transforms', async () => {
    const empty = createEmptyDocument();
    const subject = createPrimitiveNode(empty, 'cube');
    const withSubject = insertNode(empty, {
      ...subject,
      transform: { ...subject.transform, position: { x: 3, y: 0.5, z: -2 } },
    });
    const cutter = createPrimitiveNode(withSubject, 'cylinder');
    const document = insertNode(withSubject, {
      ...cutter,
      transform: { ...cutter.transform, position: { x: 3.25, y: 0.5, z: -2 } },
    });
    const result = await runNodeBooleanSpike(document, 'difference', subject.id, cutter.id);

    expect(result.triangleCount).toBeGreaterThan(0);
    expect(document.nodes[subject.id]).toMatchObject({
      transform: { position: { x: 3, y: 0.5, z: -2 } },
    });
    expect(document.nodes[cutter.id]).toMatchObject({
      transform: { position: { x: 3.25, y: 0.5, z: -2 } },
    });
  });
});
