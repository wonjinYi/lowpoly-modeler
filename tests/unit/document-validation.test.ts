import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  createPrimitiveNode,
  insertNode,
  setForwardConfirmed,
  setGroundContactTolerance,
  setGroundReference,
  setNodeHidden,
} from '../../src/editor/core/document';
import { validateDocumentForExport } from '../../src/editor/validation/document-validation';

describe('export validation', () => {
  it('requires a visible mesh and warns about non-unit scale', () => {
    const empty = createEmptyDocument();
    expect(validateDocumentForExport(empty)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'empty-scene', severity: 'error' })]),
    );

    const cube = createPrimitiveNode(empty, 'cube');
    const withCube = insertNode(empty, {
      ...cube,
      transform: { ...cube.transform, scale: { x: 2, y: 1, z: 1 } },
    });
    expect(validateDocumentForExport(withCube)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'non-unit-scale', nodeId: cube.id, severity: 'warning' }),
      ]),
    );
    expect(validateDocumentForExport(setNodeHidden(withCube, cube.id, true))).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'empty-scene' })]),
    );
  });

  it('checks geometry, forward confirmation, ground contact, and shade pivot readiness', () => {
    const empty = createEmptyDocument();
    const cube = createPrimitiveNode(empty, 'cube');
    const document = insertNode(empty, {
      ...cube,
      transform: { ...cube.transform, position: { x: 0, y: 1, z: 0 } },
    });

    expect(validateDocumentForExport(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'orientation-unconfirmed', severity: 'warning' }),
        expect.objectContaining({ code: 'not-grounded', severity: 'warning' }),
        expect.objectContaining({ code: 'missing-shade-pivot', severity: 'warning' }),
      ]),
    );
    expect(validateDocumentForExport(setForwardConfirmed(document, true))).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'orientation-unconfirmed' })]),
    );
  });

  it('uses the configured ground reference and tolerance for contact validation', () => {
    const empty = createEmptyDocument();
    const cube = createPrimitiveNode(empty, 'cube');
    const document = insertNode(empty, {
      ...cube,
      transform: { ...cube.transform, position: { x: 0, y: 1, z: 0 } },
    });
    const withinTolerance = setGroundContactTolerance(setGroundReference(document, 0.48), 0.021);
    const outsideTolerance = setGroundContactTolerance(withinTolerance, 0.019);

    expect(validateDocumentForExport(withinTolerance)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'not-grounded' })]),
    );
    expect(validateDocumentForExport(outsideTolerance)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'not-grounded',
          message: expect.stringContaining('target is 0.480 ± 0.019'),
        }),
      ]),
    );
  });

  it('blocks export when a material points to a missing texture payload', () => {
    const document = createEmptyDocument();
    const invalid = {
      ...document,
      materials: {
        ...document.materials,
        'material-1': { ...document.materials['material-1']!, baseColorTextureId: 'missing-texture' },
      },
    };

    expect(validateDocumentForExport(invalid)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing-texture', severity: 'error' })]),
    );
  });
});
