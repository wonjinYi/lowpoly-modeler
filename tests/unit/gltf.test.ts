import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { importBufferGeometry, importGlb } from '../../src/editor/io/gltf';
import { createTangentTriangleGlb } from '../fixtures/glb-fixtures';

describe('GLB tangent attributes', () => {
  it('imports a non-indexed triangle without inventing an index buffer', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const material = new THREE.MeshStandardMaterial();
    const mesh = importBufferGeometry(geometry, material, () => 'material-1', 'node-1');

    expect(mesh).toMatchObject({
      faces: {
        'node-1-face-1': {
          vertexIds: ['node-1-vertex-1', 'node-1-vertex-2', 'node-1-vertex-3'],
        },
      },
    });
    expect(mesh && Object.keys(mesh.vertices)).toHaveLength(3);
    geometry.dispose();
    material.dispose();
  });

  it('preserves duplicated UV corners and material groups from indexed geometry', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
    );
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0.5, 0, 1, 1, 0.5, 1], 2),
    );
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    geometry.addGroup(0, 3, 0);
    geometry.addGroup(3, 3, 1);
    const firstMaterial = new THREE.MeshStandardMaterial();
    const secondMaterial = new THREE.MeshStandardMaterial();
    const mesh = importBufferGeometry(
      geometry,
      [firstMaterial, secondMaterial],
      (material) => (material === firstMaterial ? 'material-1' : 'material-2'),
      'node-1',
    );

    expect(mesh && Object.keys(mesh.vertices)).toHaveLength(6);
    expect(mesh?.vertices['node-1-vertex-2']?.uv).toEqual({ u: 1, v: 0 });
    expect(mesh?.vertices['node-1-vertex-4']?.uv).toEqual({ u: 0.5, v: 0 });
    expect(mesh?.faces['node-1-face-1']?.materialId).toBe('material-1');
    expect(mesh?.faces['node-1-face-2']?.materialId).toBe('material-2');
    geometry.dispose();
    firstMaterial.dispose();
    secondMaterial.dispose();
  });

  it('imports four-component tangent data into editable vertices', async () => {
    const fixture = createTangentTriangleGlb();
    const arrayBuffer = fixture.buffer.slice(
      fixture.byteOffset,
      fixture.byteOffset + fixture.byteLength,
    ) as ArrayBuffer;
    const { document } = await importGlb(arrayBuffer);
    const mesh = Object.values(document.nodes).find((node) => node.type === 'mesh');

    expect(mesh?.type).toBe('mesh');
    if (mesh?.type === 'mesh') {
      expect(Object.values(mesh.mesh.vertices).map((vertex) => vertex.tangent)).toEqual([
        { x: 1, y: 0, z: 0, w: 1 },
        { x: 1, y: 0, z: 0, w: 1 },
        { x: 1, y: 0, z: 0, w: 1 },
      ]);
    }
  });
});
