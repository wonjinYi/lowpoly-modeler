import { describe, expect, it } from 'vitest';
import {
  createCubeGlb,
  createMeshyLikeGlb,
  createTangentTriangleGlb,
  createTriangleHierarchyGlb,
} from '../fixtures/glb-fixtures';

describe('GLB fixtures', () => {
  it.each([
    ['cube', createCubeGlb],
    ['hierarchy triangle', createTriangleHierarchyGlb],
    ['tangent triangle', createTangentTriangleGlb],
    ['Meshy-like multi-mesh material', createMeshyLikeGlb],
  ])('creates a valid %s GLB header', (_name, createFixture) => {
    const fixture = createFixture();

    expect(fixture.readUInt32LE(0)).toBe(0x46546c67);
    expect(fixture.readUInt32LE(4)).toBe(2);
    expect(fixture.readUInt32LE(8)).toBe(fixture.byteLength);
    expect(fixture.readUInt32LE(16)).toBe(0x4e4f534a);
  });
});
