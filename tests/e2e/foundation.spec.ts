import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createCubeGlb, createMeshyLikeGlb, createTriangleHierarchyGlb } from '../fixtures/glb-fixtures';

test('creates, transforms, undoes, and redoes a cube from the editor shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Outliner' })).toBeVisible();
  await expect(page.getByTestId('viewport-shell')).toBeVisible();
  await expect(page.getByText('No object selected')).toBeVisible();

  await page.getByTestId('add-cube').click();
  await expect(page.getByTestId('outliner-mesh-1')).toContainText('Cube');
  await expect(page.getByLabel('Position X')).toHaveValue('0');

  await page.getByLabel('Position X').fill('2');
  await page.getByLabel('Position X').press('Enter');
  await expect(page.getByLabel('Position X')).toHaveValue('2');
  await expect(page.getByTestId('history-status')).toContainText('Undo 2');

  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Position X')).toHaveValue('0');

  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByLabel('Position X')).toHaveValue('2');

  await page.getByTestId('transform-rotate').click();
  await expect(page.getByTestId('transform-rotate')).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('Object name').fill('Canopy');
  await page.getByLabel('Object name').press('Enter');
  await expect(page.getByTestId('outliner-mesh-1')).toContainText('Canopy');

  await page.getByRole('button', { name: 'Delete selected' }).click();
  await expect(page.getByTestId('outliner-mesh-1')).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('outliner-mesh-1')).toContainText('Canopy');

  await page.getByTestId('outliner-mesh-1').click();
  await page.getByTestId('add-cube').click();
  await page.getByTestId('outliner-mesh-1').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('status-bar')).toContainText('2 selected');
  await expect(page.getByText('2 objects selected.')).toBeVisible();
  await expect(
    page.getByText('Size and object-scale bake are edited one mesh at a time.', { exact: false }),
  ).toBeVisible();
});

test('keeps every textual Inspector button dark and legible, including disabled actions', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();

  const contrastFailures = await page.locator('.inspector-panel button').evaluateAll((buttons) => {
    const parseColor = (value: string): [number, number, number] | null => {
      const match = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    const luminance = ([red, green, blue]: [number, number, number]): number => {
      const linear = [red, green, blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    return buttons
      .filter((button) => button.textContent?.trim() && button.getClientRects().length > 0)
      .flatMap((button) => {
        const style = window.getComputedStyle(button);
        const background = parseColor(style.backgroundColor);
        const foreground = parseColor(style.color);
        if (!background || !foreground) {
          return [`${button.textContent?.trim()}: CSS color could not be measured`];
        }
        const contrast =
          (Math.max(luminance(background), luminance(foreground)) + 0.05) /
          (Math.min(luminance(background), luminance(foreground)) + 0.05);
        return luminance(background) > 0.18 || contrast < 4.5
          ? [
              `${button.textContent?.trim()}: background ${style.backgroundColor}, contrast ${contrast.toFixed(2)}`,
            ]
          : [];
      });
  });

  expect(contrastFailures).toEqual([]);
});

test('resizes desktop side panels while enforcing their minimum widths', async ({ page }) => {
  await page.goto('/');
  const outlinerHandle = page.getByRole('separator', { name: 'Resize Outliner' });
  const before = Number(await outlinerHandle.getAttribute('aria-valuenow'));
  const bounds = await outlinerHandle.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) {
    return;
  }

  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + 100);
  await page.mouse.up();

  await expect(outlinerHandle).toHaveAttribute('aria-valuenow', String(before + 80));
  await expect(page.getByRole('separator', { name: 'Resize Inspector' })).toHaveAttribute(
    'aria-valuemin',
    '254',
  );
});

test('resizes mesh vertices and applies object scale without leaving scale values behind', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();

  await expect(page.getByLabel('Size W')).toHaveValue('1');
  await page.getByLabel('Size H').fill('1.5');
  await page.getByLabel('Size H').press('Enter');
  await expect(page.getByLabel('Size W')).toHaveValue('1.5');
  await expect(page.getByLabel('Size D')).toHaveValue('1.5');

  await page.getByLabel('Keep proportions').uncheck();
  await page.getByLabel('Size W').fill('2');
  await page.getByLabel('Size W').press('Enter');
  await expect(page.getByLabel('Size H')).toHaveValue('1.5');

  await page.getByLabel('Scale X').fill('0.5');
  await page.getByLabel('Scale X').press('Enter');
  await page.getByRole('button', { name: 'Apply Scale to Geometry' }).click();
  await expect(page.getByLabel('Scale X')).toHaveValue('1');
  await expect(page.getByLabel('Size W')).toHaveValue('1');
  await expect(page.getByLabel('Size H')).toHaveValue('1.5');
});

test('keeps the documented proportional W/H/D resize example at unit object scale', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByLabel('Keep proportions').uncheck();
  await page.getByLabel('Size W').fill('2');
  await page.getByLabel('Size W').press('Enter');
  await page.getByLabel('Size H').fill('4');
  await page.getByLabel('Size H').press('Enter');
  await page.getByLabel('Size D').fill('1');
  await page.getByLabel('Size D').press('Enter');
  await page.getByLabel('Keep proportions').check();
  await page.getByLabel('Size H').fill('1.5');
  await page.getByLabel('Size H').press('Enter');

  await expect(page.getByLabel('Size W')).toHaveValue('0.75');
  await expect(page.getByLabel('Size H')).toHaveValue('1.5');
  await expect(page.getByLabel('Size D')).toHaveValue('0.375');
  await expect(page.getByLabel('Scale X')).toHaveValue('1');
  await expect(page.getByLabel('Scale Y')).toHaveValue('1');
  await expect(page.getByLabel('Scale Z')).toHaveValue('1');
});

test('toggles the ground helper and moves a selected model onto world ground', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await expect(page.getByLabel('Show ground plane')).toBeChecked();
  await page.getByLabel('Show ground plane').uncheck();
  await expect(page.getByLabel('Show ground plane')).not.toBeChecked();

  await page.getByRole('button', { name: 'Move selection to ground' }).click();
  await expect(page.getByLabel('Position Y')).toHaveValue('0.5');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Position Y')).toHaveValue('0');
});

test('sets a selected bottom as custom ground reference and configures its contact tolerance', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();

  await page.getByRole('button', { name: 'Set selected bottom as ground reference' }).click();
  await expect(page.getByLabel('Ground reference Y')).toHaveValue('-0.5');
  await expect(page.getByText('✓ Ground contact')).toBeVisible();
  await page.getByLabel('Ground contact tolerance').fill('0.02');
  await page.getByLabel('Ground contact tolerance').press('Enter');
  await expect(page.getByLabel('Ground contact tolerance')).toHaveValue('0.02');
});

test('switches the viewport into directional-light Shadow Preview without changing document data', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByLabel('Show ground plane').uncheck();

  await page.getByLabel('Shadow Preview').check();
  await expect(page.getByLabel('Shadow Preview')).toBeChecked();
  await expect(page.getByTestId('shadow-preview-indicator')).toContainText('directional light');

  await page.getByLabel('Shadow Preview').uncheck();
  await expect(page.getByTestId('shadow-preview-indicator')).toHaveCount(0);
  await expect(page.getByTestId('history-status')).toContainText('Undo 1');
});

test('confirms the game forward direction in export validation', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();

  await expect(page.getByText('! +Z Forward confirmed')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm +Z Forward' }).click();
  await expect(page.getByText('✓ +Z Forward confirmed')).toBeVisible();
});

test('shows game axes and corrects an imported front direction to +Z', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Perspective · +Y Up · +Z Forward')).toBeVisible();
  await page.getByTestId('add-cube').click();

  await expect(page.getByText('+Y Up · +Z Forward', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Correct forward from +X' }).click();
  await expect(page.getByLabel('Rotation Y')).toHaveValue('-90');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Rotation Y')).toHaveValue('0');
});

test('applies Game Asset Check scale and shade pivot quick fixes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByLabel('Scale X').fill('0.5');
  await page.getByLabel('Scale X').press('Enter');
  await page.getByRole('button', { name: 'Apply scale for Cube' }).click();

  await expect(page.getByLabel('Scale X')).toHaveValue('1');
  await page.getByRole('button', { name: 'Add shade_pivot' }).click();
  await expect(page.getByTestId('outliner-group-1')).toContainText('shade_pivot');
});

test('asks before exporting unresolved warnings and returns to editing when cancelled', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();

  await expect(page.getByRole('status')).toContainText('Export cancelled so the warning can be resolved.');
});

test('verifies shade_pivot survives the export reimport safety gate', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: '+ shade_pivot', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exportedGlb = await readFile(downloadPath!);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'verified-pivot.glb',
    mimeType: 'model/gltf-binary',
    buffer: exportedGlb,
  });

  await expect(page.getByRole('button', { name: 'Select shade_pivot' })).toBeVisible();
});

test('preserves game-ready size, hierarchy, pivot, node name, and unit scale through GLB reopen', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByLabel('Object name').fill('canopy');
  await page.getByLabel('Object name').press('Enter');
  await page.getByLabel('Size W').fill('2');
  await page.getByLabel('Size W').press('Enter');
  await page.getByRole('button', { name: '+ shade_pivot', exact: true }).click();
  await page.getByTestId('outliner-mesh-1').click();
  await page.getByLabel('Parent object').selectOption('group-1');

  const downloadPromise = page.waitForEvent('download');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exportedGlb = await readFile(downloadPath!);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'game-ready.glb',
    mimeType: 'model/gltf-binary',
    buffer: exportedGlb,
  });
  await expect(page.getByTestId('outliner-node-1')).toContainText('shade_pivot');
  await page.getByTestId('outliner-node-2').click();
  await expect(page.getByLabel('Object name')).toHaveValue('canopy');
  await expect(page.getByLabel('Parent object')).toHaveValue('node-1');
  await expect(page.getByLabel('Size W')).toHaveValue('2');
  await expect(page.getByLabel('Size H')).toHaveValue('2');
  await expect(page.getByLabel('Size D')).toHaveValue('2');
  await expect(page.getByLabel('Scale X')).toHaveValue('1');
  await expect(page.getByLabel('Scale Y')).toHaveValue('1');
  await expect(page.getByLabel('Scale Z')).toHaveValue('1');
});

test('edits material color, PBR values, opacity, and shading', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();

  await page.getByLabel('Material base color').fill('#ff8844');
  await expect(page.getByLabel('Material base color')).toHaveValue('#ff8844');
  await page.getByLabel('Material roughness').fill('0.25');
  await page.getByLabel('Material roughness').press('Enter');
  await expect(page.getByLabel('Material roughness')).toHaveValue('0.25');
  await page.getByLabel('Material metalness').fill('0.5');
  await page.getByLabel('Material metalness').press('Enter');
  await page.getByLabel('Material opacity').fill('0.4');
  await page.getByLabel('Material opacity').press('Enter');
  await expect(page.getByLabel('Material opacity')).toHaveValue('0.4');
  await page.getByLabel('Flat shading').uncheck();
  await expect(page.getByLabel('Flat shading')).not.toBeChecked();
});

test('colors selected face corners without creating new materials', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Face Color', exact: true }).click();
  await page.getByRole('button', { name: 'Select face 1' }).click();
  await page.getByLabel('Face color').fill('#ff8040');
  await page.getByRole('button', { name: 'Apply face color' }).click();

  await expect(page.getByTestId('history-status')).toContainText('Undo 2');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('history-status')).toContainText('Undo 1');
});

test('sets and reuses Face Color palette entries', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Face Color', exact: true }).click();
  await page.getByRole('button', { name: 'Set palette color #55c1b3' }).click();

  await expect(page.getByLabel('Face color')).toHaveValue('#55c1b3');
  await expect(page.getByRole('button', { name: 'Use recent color #55c1b3' })).toBeVisible();
});

test('reports protected coincident corners after Face Color creates a seam', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Face Color', exact: true }).click();
  await page.getByRole('button', { name: 'Select face 1' }).click();
  await page.getByRole('button', { name: 'Apply face color' }).click();

  await expect(page.getByText('Coincident vertex groups · 4')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Merge safe duplicates' })).toBeDisabled();
  await page.getByRole('button', { name: 'Separate component 1' }).click();
  await expect(page.getByTestId('outliner-mesh-2')).toContainText('Cube_part');
});

test('paints a clicked viewport face directly in Face Color mode', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Face Color', exact: true }).click();
  await page.getByLabel('Face color').fill('#ff8040');
  await page.locator('canvas.viewport-canvas').click({ position: { x: 400, y: 345 } });

  await expect(page.getByTestId('status-bar')).toContainText('1 face selected');
  await expect(page.getByTestId('history-status')).toContainText('Undo 2');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('history-status')).toContainText('Undo 1');
});

test('generates Auto UV and records a wrapped Texture Paint stroke as one Undo command', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await expect(page.getByRole('button', { name: 'Generate simple Auto UV' })).toBeVisible();
  await page.getByRole('button', { name: 'Generate simple Auto UV' }).click();
  await expect(page.getByTestId('texture-paint-status')).toHaveText('No texture yet');
  await page.getByRole('button', { name: 'Create blank layer' }).click();
  await expect(page.getByTestId('texture-paint-status')).toContainText('256×256 · sRGB');
  await page.getByLabel('Texture brush size').fill('24');
  await page.getByLabel('Texture brush size').press('Enter');
  await page.getByLabel('Texture brush opacity').fill('0.5');
  await page.getByLabel('Texture brush opacity').press('Enter');
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Eraser', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Eyedropper', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Eyedropper', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByRole('button', { name: 'Texture Paint', exact: true }).click();
  await page.locator('canvas.viewport-canvas').click({ position: { x: 400, y: 345 } });

  await expect(page.getByTestId('history-status')).toContainText('Undo 4');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('history-status')).toContainText('Undo 3');
});

test('exports and reopens a locally owned texture payload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Generate simple Auto UV' }).click();
  await page.getByRole('button', { name: 'Create blank layer' }).click();
  await expect(page.getByTestId('texture-paint-status')).toContainText('256×256 · sRGB');

  const downloadPromise = page.waitForEvent('download');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = await readFile(path!);
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'painted-cube.glb',
    mimeType: 'model/gltf-binary',
    buffer: exported,
  });

  await expect(page.getByTestId('texture-paint-status')).toContainText('256×256 · sRGB');
});

test('reports open topology and highlights it in edge mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ Plane', exact: true }).click();

  await expect(page.getByText('Open edges · 4')).toBeVisible();
  await expect(page.getByText('Non-manifold edges · 0')).toBeVisible();
  await page.getByRole('button', { name: 'Recalculate normals' }).click();
  await expect(page.getByRole('status')).toContainText('Recalculated normals for 4 vertices.');
  await expect(page.getByTestId('history-status')).toContainText('Undo 2');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('history-status')).toContainText('Undo 1');
  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  await expect(page.getByText('Open edges · 4')).toBeVisible();
});

test('creates a cylinder with the configured low-poly segment count', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Primitive radial segments').fill('6');
  await page.getByLabel('Primitive radial segments').press('Enter');
  await page.getByRole('button', { name: '+ Cylinder', exact: true }).click();
  await page.getByRole('button', { name: 'Face', exact: true }).click();

  await expect(page.getByText('Faces · 8')).toBeVisible();
});

test('creates a shade pivot and edits its group transform in pivot mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ shade_pivot', exact: true }).click();
  await expect(page.getByTestId('outliner-group-1')).toContainText('shade_pivot');

  await page.getByRole('button', { name: 'Pivot', exact: true }).click();
  await expect(page.getByTestId('status-bar')).toContainText('PIVOT MODE');
  await page.getByLabel('Position Y').fill('1.25');
  await page.getByLabel('Position Y').press('Enter');
  await expect(page.getByLabel('Position Y')).toHaveValue('1.25');
  await page.getByRole('button', { name: 'Set pivot Y to 90 degrees' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotation Y', exact: true })).toHaveValue('90');
  await page.getByLabel('Pivot rotation Y').fill('45');
  await expect(page.getByText('Preview only · original transform is unchanged.')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Rotation Y', exact: true })).toHaveValue('90');
  await page.getByRole('button', { name: 'Cancel pivot preview' }).click();
  await expect(page.getByRole('button', { name: 'Apply pivot preview' })).toHaveCount(0);

  await page.getByLabel('Pivot rotation Y').fill('45');
  await page.getByRole('button', { name: 'Apply pivot preview' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotation Y', exact: true })).toHaveValue('45');
});

test('keeps fixed_base static while shade_pivot rotates the canopy in Shadow Preview', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByLabel('Object name').fill('fixed_base');
  await page.getByLabel('Object name').press('Enter');
  await page.getByRole('button', { name: '+ shade_pivot', exact: true }).click();
  await page.getByTestId('add-cube').click();
  await page.getByLabel('Object name').fill('canopy');
  await page.getByLabel('Object name').press('Enter');
  await page.getByLabel('Parent object').selectOption('group-1');

  await page.getByTestId('outliner-group-1').click();
  await page.getByRole('button', { name: 'Pivot', exact: true }).click();
  await page.getByRole('button', { name: 'Set pivot Y to 90 degrees' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotation Y', exact: true })).toHaveValue('90');

  await page.getByTestId('outliner-mesh-1').click();
  await expect(page.getByLabel('Object name')).toHaveValue('fixed_base');
  await expect(page.getByLabel('Position X')).toHaveValue('0');
  await expect(page.getByLabel('Rotation Y')).toHaveValue('0');
  await page.getByLabel('Shadow Preview').check();
  await expect(page.getByTestId('shadow-preview-indicator')).toContainText('directional light');
});

test('selects and edits an individual mesh vertex in vertex mode', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Vertex', exact: true }).click();
  await page.getByRole('button', { name: 'Select vertex 1' }).click();

  await expect(page.getByTestId('status-bar')).toContainText('1 vertex selected');
  await expect(page.getByLabel('Vertex X')).toHaveValue('-0.5');
  await page.getByLabel('Vertex X').fill('0.25');
  await page.getByLabel('Vertex X').press('Enter');
  await expect(page.getByLabel('Vertex X')).toHaveValue('0.25');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Vertex X')).toHaveValue('-0.5');
  await page.getByRole('button', { name: 'Delete selected vertex' }).click();
  await expect(page.getByText('Vertices · 7')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Vertices · 8')).toBeVisible();
});

test('box-selects visible vertices with Shift drag in the viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Vertex', exact: true }).click();
  const canvas = page.locator('canvas.viewport-canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) {
    return;
  }

  await page.keyboard.down('Shift');
  await page.mouse.move(bounds.x + 8, bounds.y + 8);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 8, bounds.y + bounds.height - 8, { steps: 5 });
  await expect(page.locator('.viewport-selection-marquee')).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await expect(page.getByTestId('status-bar')).toContainText('8 vertices selected');
});

test('applies and undoes a selected-vertex local transform', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Vertex', exact: true }).click();
  await page.getByRole('button', { name: 'Select vertex 1' }).click();
  await page.getByLabel('Selection move X').fill('0.25');
  await page.getByLabel('Selection move X').press('Enter');
  await page.getByRole('button', { name: 'Apply selection transform' }).click();

  await expect(page.getByLabel('Vertex X')).toHaveValue('-0.25');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Vertex X')).toHaveValue('-0.5');
});

test('applies selected movement in World orientation through a rotated object', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByLabel('Rotation Z').fill('90');
  await page.getByLabel('Rotation Z').press('Enter');
  await page.getByRole('button', { name: 'Vertex', exact: true }).click();
  await page.getByRole('button', { name: 'Select vertex 1' }).click();
  await page.getByLabel('Selection orientation').selectOption('world');
  await page.getByLabel('Selection move X').fill('0.25');
  await page.getByLabel('Selection move X').press('Enter');
  await page.getByRole('button', { name: 'Apply selection transform' }).click();

  await expect(page.getByLabel('Vertex X')).toHaveValue('-0.5');
  await expect(page.getByLabel('Vertex Y')).toHaveValue('-0.75');
});

test('merges multiple selected vertices into one editable vertex', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Vertex', exact: true }).click();
  await page.getByRole('button', { name: 'Select vertex 1' }).click();
  await page.getByRole('button', { name: 'Select vertex 2' }).click({ modifiers: ['Shift'] });

  await expect(page.getByTestId('status-bar')).toContainText('2 vertices selected');
  await page.getByRole('button', { name: 'Merge selected vertices' }).click();
  await expect(page.getByTestId('status-bar')).toContainText('1 vertex selected');
  await expect(page.getByText('Vertices · 7')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Vertices · 8')).toBeVisible();
});

test('merges only selected vertices within the requested distance', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Vertex', exact: true }).click();
  await page.getByRole('button', { name: 'Select vertex 1' }).click();
  await page.getByRole('button', { name: 'Select vertex 2' }).click({ modifiers: ['Shift'] });
  await page.getByLabel('Merge distance').fill('1.01');
  await page.getByLabel('Merge distance').press('Enter');

  await page.getByRole('button', { name: 'Merge by distance' }).click();
  await expect(page.getByText('Vertices · 7')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Vertices · 8')).toBeVisible();
});

test('selects, flips, and deletes a face through face mode', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Face', exact: true }).click();
  await page.getByRole('button', { name: 'Select face 1' }).click();

  await expect(page.getByTestId('status-bar')).toContainText('1 face selected');
  await page.getByRole('button', { name: 'Flip normal' }).click();
  await expect(page.getByText(/Inconsistent normals · [1-9]/)).toBeVisible();
  await page.getByRole('button', { name: 'Select inconsistent faces' }).click();
  await expect(page.getByTestId('status-bar')).toContainText('5 faces selected');
  await page.getByRole('button', { name: 'Select face 1' }).click();
  await expect(page.getByTestId('history-status')).toContainText('Undo 2');
  await page.getByRole('button', { name: 'Delete face' }).click();
  await expect(page.getByText('Faces · 5')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Faces · 6')).toBeVisible();
  await page.getByRole('button', { name: 'Select face 1' }).click();
  await page.getByRole('button', { name: 'Preview extrude' }).click();
  await expect(page.getByRole('button', { name: 'Commit extrude' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel extrude preview' }).click();
  await expect(page.getByText('Faces · 6')).toBeVisible();
  await page.getByRole('button', { name: 'Preview extrude' }).click();
  await page.getByRole('button', { name: 'Commit extrude' }).click();
  await expect(page.getByText('Faces · 10')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Faces · 6')).toBeVisible();
  await page.getByRole('button', { name: 'Select face 1' }).click();
  await page.getByRole('button', { name: 'Preview inset' }).click();
  await expect(page.getByRole('button', { name: 'Commit inset' })).toBeVisible();
  await page.getByRole('button', { name: 'Commit inset' }).click();
  await expect(page.getByText('Faces · 10')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Faces · 6')).toBeVisible();
});

test('selects an edge and subdivides it into a midpoint vertex', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  await page.getByRole('button', { name: 'Select edge 1', exact: true }).click();

  await expect(page.getByTestId('status-bar')).toContainText('1 edge selected');
  await page.getByRole('button', { name: 'Subdivide selected edge' }).click();
  await expect(page.getByTestId('status-bar')).toContainText('VERTEX MODE');
  await expect(page.getByTestId('status-bar')).toContainText('1 vertex selected');
  await expect(page.getByText('Vertices · 9')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Vertices · 8')).toBeVisible();
});

test('cuts a closed quad edge loop and restores it through undo and redo', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  await page.getByRole('button', { name: 'Select edge 1', exact: true }).click();

  await expect(page.getByText('Closed quad path · 4 faces')).toBeVisible();
  await page.getByLabel('Loop cut position').fill('0.25');
  await page.getByLabel('Loop cut position').press('Enter');
  await page.getByRole('button', { name: 'Preview loop cut', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply loop cut' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply loop cut' }).click();
  await expect(page.getByTestId('status-bar')).toContainText('4 edges selected');
  await page.getByRole('button', { name: 'Face', exact: true }).click();
  await expect(page.getByText('Faces · 10')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Faces · 6')).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByText('Faces · 10')).toBeVisible();
});

test('runs the core low-poly modeling chain on one cube', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();

  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  await page.getByRole('button', { name: 'Select edge 1', exact: true }).click();
  await page.getByRole('button', { name: 'Preview loop cut', exact: true }).click();
  await page.getByRole('button', { name: 'Apply loop cut' }).click();

  await page.getByRole('button', { name: 'Vertex', exact: true }).click();
  await page.getByRole('button', { name: 'Select vertex 1', exact: true }).click();
  await page.getByLabel('Vertex X').fill('-0.25');
  await page.getByLabel('Vertex X').press('Enter');

  await page.getByRole('button', { name: 'Face', exact: true }).click();
  await page.getByRole('button', { name: 'Select face 1', exact: true }).click();
  await page.getByRole('button', { name: 'Preview extrude' }).click();
  await page.getByRole('button', { name: 'Commit extrude' }).click();

  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  await page.getByRole('button', { name: 'Select edge 1', exact: true }).click();
  await page.getByLabel('Bevel width').fill('0.05');
  await page.getByLabel('Bevel width').press('Enter');
  await page.getByRole('button', { name: 'Bevel edge', exact: true }).click();
  await expect(page.getByTestId('status-bar')).toContainText('FACE MODE');

  await page.getByRole('button', { name: 'Preview mirror' }).click();
  await page.getByRole('button', { name: 'Apply mirror' }).click();
  await page.getByRole('button', { name: 'Preview bend' }).click();
  await page.getByRole('button', { name: 'Commit bend' }).click();
  await expect(page.getByTestId('history-status')).toContainText('Undo 7');
});

test('converts a coplanar imported triangle pair into a quad preview', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'fixture-cube.glb',
    mimeType: 'model/gltf-binary',
    buffer: createCubeGlb(),
  });
  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  await page.getByRole('button', { name: 'Select edge 1', exact: true }).click();
  await page.getByRole('button', { name: 'Preview Tris to Quads', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply Tris to Quads' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply Tris to Quads' }).click();
  await page.getByRole('button', { name: 'Face', exact: true }).click();
  await expect(page.getByText('Faces · 11')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Faces · 12')).toBeVisible();
});

test('bevels one manifold edge and preserves the result through undo and redo', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  await page.getByRole('button', { name: 'Select edge 1', exact: true }).click();
  await page.getByLabel('Bevel width').fill('0.1');
  await page.getByLabel('Bevel width').press('Enter');
  await page.getByRole('button', { name: 'Bevel edge', exact: true }).click();

  await expect(page.getByTestId('status-bar')).toContainText('FACE MODE');
  await expect(page.getByText('Faces · 7')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Faces · 6')).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByText('Faces · 7')).toBeVisible();
});

test('previews, cancels, and commits a Bend as one history transaction', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await expect(page.getByLabel('Size W')).toHaveValue('1');
  await page.getByRole('button', { name: 'Preview bend' }).click();

  await expect(page.getByRole('button', { name: 'Commit bend' })).toBeVisible();
  await expect(page.getByLabel('Size W')).not.toHaveValue('1');
  await expect(page.getByTestId('history-status')).toContainText('Undo 1');
  await page.getByRole('button', { name: 'Cancel bend preview' }).click();
  await expect(page.getByLabel('Size W')).toHaveValue('1');

  await page.getByRole('button', { name: 'Preview bend' }).click();
  await page.getByRole('button', { name: 'Commit bend' }).click();
  await expect(page.getByTestId('history-status')).toContainText('Undo 2');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Size W')).toHaveValue('1');
});

test('previews, disables, and applies a baked Mirror transaction', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Preview mirror' }).click();
  await expect(page.getByRole('button', { name: 'Apply mirror' })).toBeVisible();
  await expect(page.getByTestId('history-status')).toContainText('Undo 1');
  await page.getByRole('button', { name: 'Disable mirror preview' }).click();
  await expect(page.getByRole('button', { name: 'Preview mirror' })).toBeVisible();

  await page.getByRole('button', { name: 'Preview mirror' }).click();
  await page.getByRole('button', { name: 'Apply mirror' }).click();
  await expect(page.getByTestId('history-status')).toContainText('Undo 2');
  await page.getByRole('button', { name: 'Face', exact: true }).click();
  await expect(page.getByText('Faces · 12')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Faces · 6')).toBeVisible();
});

test('keeps Boolean source geometry until commit, then restores cutter through Undo', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: '+ Cylinder', exact: true }).click();
  await page.getByTestId('outliner-mesh-1').click();
  await page.getByTestId('outliner-mesh-2').click({ modifiers: ['Shift'] });

  await expect(page.getByRole('heading', { name: 'Boolean', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview Difference', exact: true }).click();
  await expect(page.getByTestId('boolean-preview-status')).toContainText('source objects are unchanged', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('boolean-preview-indicator')).toContainText('cutter hidden until commit');
  await page.getByRole('button', { name: 'Commit difference', exact: true }).click();

  await expect(page.getByTestId('outliner-mesh-2')).toHaveCount(0);
  await expect(page.getByTestId('history-status')).toContainText('Undo 3');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('outliner-mesh-2')).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByTestId('outliner-mesh-2')).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exportedGlb = await readFile(downloadPath!);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'boolean-result.glb',
    mimeType: 'model/gltf-binary',
    buffer: exportedGlb,
  });
  await expect(page.getByRole('status')).toContainText('Opened boolean-result.glb');
  await expect(page.getByTestId('outliner-node-1')).toBeVisible();
});

test('persists Live Mirror in a project and bakes it into a GLB export', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Enable live mirror', exact: true }).click();
  await expect(
    page.getByText('Live X Mirror is saved in the project and baked only for GLB export.'),
  ).toBeVisible();

  const projectDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Project', exact: true }).click();
  const projectDownload = await projectDownloadPromise;
  const projectPath = await projectDownload.path();
  expect(projectPath).not.toBeNull();
  const projectFile = await readFile(projectPath!);
  await page.getByRole('button', { name: 'File / New', exact: true }).click();
  await page.getByTestId('open-shadeasset-input').setInputFiles({
    name: 'live-mirror.shadeasset',
    mimeType: 'application/vnd.lowpoly-modeler.shadeasset+json',
    buffer: projectFile,
  });
  await expect(
    page.getByText('Live X Mirror is saved in the project and baked only for GLB export.'),
  ).toBeVisible();

  const glbDownloadPromise = page.waitForEvent('download');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const glbDownload = await glbDownloadPromise;
  const glbPath = await glbDownload.path();
  expect(glbPath).not.toBeNull();
  const exportedGlb = await readFile(glbPath!);
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'live-mirror.glb',
    mimeType: 'model/gltf-binary',
    buffer: exportedGlb,
  });
  await page.getByRole('button', { name: 'Face', exact: true }).click();
  await expect(page.getByText('Faces · 24')).toBeVisible();
});

test('keeps edge delete and dissolve as distinct modeling operations', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  await page.getByRole('button', { name: 'Select edge 1', exact: true }).click();
  await page.getByRole('button', { name: 'Dissolve edge' }).click();
  await page.getByRole('button', { name: 'Face', exact: true }).click();
  await expect(page.getByText('Faces · 5')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Faces · 6')).toBeVisible();

  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  await page.getByRole('button', { name: 'Select edge 1', exact: true }).click();
  await page.getByRole('button', { name: 'Delete edge' }).click();
  await page.getByRole('button', { name: 'Face', exact: true }).click();
  await expect(page.getByText('Faces · 4')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Faces · 6')).toBeVisible();
});

test('opens a GLB as editable mesh data and exports a GLB download', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: createTriangleHierarchyGlb(),
  });

  await expect(page.getByTestId('outliner-node-1')).toContainText('Pivot_Anchor');
  await expect(page.getByTestId('outliner-node-2')).toContainText('Imported_Triangle');
  await expect(page.getByLabel('Position X')).toHaveValue('0');
  await expect(page.getByRole('status')).toContainText('Opened triangle.glb with 2 node(s).');

  await page.getByTestId('add-cube').click();
  await page.getByLabel('Parent object').selectOption('node-1');
  await expect(page.getByLabel('Parent object')).toHaveValue('node-1');
  await page.getByRole('button', { name: 'Unparent to asset root' }).click();
  await expect(page.getByLabel('Parent object')).toHaveValue('asset_root');
  await page.getByLabel('Position X').fill('2');
  await page.getByLabel('Position X').press('Enter');
  await page.getByLabel('Material base color').fill('#ff8040');
  await page.getByLabel('Material roughness').fill('0.35');
  await page.getByLabel('Material roughness').press('Enter');
  await page.getByLabel('Material opacity').fill('0.4');
  await page.getByLabel('Material opacity').press('Enter');
  await page.getByRole('button', { name: 'Face Color', exact: true }).click();
  await page.getByRole('button', { name: 'Select face 1' }).click();
  await page.getByRole('button', { name: 'Apply face color' }).click();

  const downloadPromise = page.waitForEvent('download');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('asset_root.glb');

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exportedGlb = await readFile(downloadPath!);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'roundtrip.glb',
    mimeType: 'model/gltf-binary',
    buffer: exportedGlb,
  });
  await expect(page.getByRole('status')).toContainText('Opened roundtrip.glb');
  await expect(page.getByRole('button', { name: 'Select Pivot_Anchor' })).toBeVisible();
  await page.getByRole('button', { name: 'Select Cube' }).click();
  await expect(page.getByLabel('Position X')).toHaveValue('2');
  await expect(page.getByLabel('Material base color')).toHaveValue('#ff8040');
  await expect(page.getByLabel('Material roughness')).toHaveValue('0.35');
  await expect(page.getByLabel('Material opacity')).toHaveValue('0.4');
  await page.getByRole('button', { name: 'Vertex', exact: true }).click();
  await expect(page.getByText('Vertices · 12')).toBeVisible();
});

test('saves and opens a .shadeasset without losing editable state', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  await page.getByLabel('Position X').fill('2');
  await page.getByLabel('Position X').press('Enter');
  await page.getByRole('button', { name: 'Generate simple Auto UV' }).click();
  await page.getByRole('button', { name: 'Create blank layer' }).click();
  await expect(page.getByTestId('texture-paint-status')).toContainText('256×256 · sRGB');
  await page.getByRole('button', { name: 'Face', exact: true }).click();
  await page.getByRole('button', { name: 'Select face 1' }).click();
  await page.getByRole('button', { name: 'Face Color', exact: true }).click();
  await page.getByRole('button', { name: 'Set palette color #55c1b3' }).click();
  await page.getByRole('button', { name: 'Face', exact: true }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Project', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('asset_root.shadeasset');
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const projectFile = await readFile(downloadPath!);

  await page.getByRole('button', { name: 'File / New', exact: true }).click();
  await expect(page.getByTestId('outliner-mesh-1')).toHaveCount(0);
  await page.getByTestId('open-shadeasset-input').setInputFiles({
    name: 'saved-canopy.shadeasset',
    mimeType: 'application/vnd.lowpoly-modeler.shadeasset+json',
    buffer: projectFile,
  });

  await expect(page.getByRole('status')).toContainText(
    'Opened project saved-canopy.shadeasset with 1 node(s).',
  );
  await expect(page.getByLabel('Position X')).toHaveValue('2');
  await expect(page.getByTestId('status-bar')).toContainText('FACE MODE');
  await expect(page.getByTestId('status-bar')).toContainText('1 face selected');
  await expect(page.getByTestId('history-status')).toContainText('Undo 0');
  await expect(page.getByTestId('dirty-status')).toContainText('Saved state');
  await expect(page.getByTestId('texture-paint-status')).toContainText('256×256 · sRGB');
  await page.getByRole('button', { name: 'Vertex', exact: true }).click();
  await expect(page.getByText('Vertices · 24')).toBeVisible();
});

test('round-trips every built-in primitive with its editable transform', async ({ page }) => {
  await page.goto('/');
  const primitives = [
    { label: 'Cube', positionX: 0 },
    { label: 'Plane', positionX: 1 },
    { label: 'Cylinder', positionX: 2 },
    { label: 'Cone', positionX: 3 },
    { label: 'Sphere', positionX: 4 },
    { label: 'Icosphere', positionX: 5 },
  ];

  for (const { label, positionX } of primitives) {
    if (label === 'Cube') {
      await page.getByTestId('add-cube').click();
    } else {
      await page.getByRole('button', { name: `+ ${label}`, exact: true }).click();
    }
    await page.getByLabel('Position X').fill(String(positionX));
    await page.getByLabel('Position X').press('Enter');
  }

  const downloadPromise = page.waitForEvent('download');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exportedGlb = await readFile(downloadPath!);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'all-primitives.glb',
    mimeType: 'model/gltf-binary',
    buffer: exportedGlb,
  });
  await expect(page.getByRole('status')).toContainText('Opened all-primitives.glb with 6 node(s).');

  for (const { label, positionX } of primitives) {
    await page.getByRole('button', { name: `Select ${label}`, exact: true }).click();
    await expect(page.getByLabel('Position X')).toHaveValue(String(positionX));
  }
});

test('keeps the editor usable after a corrupt GLB import fails', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'corrupt.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from([0, 1, 2, 3]),
  });

  await expect(page.getByRole('status')).toContainText('Open failed:');
  await expect(page.getByTestId('viewport-shell')).toBeVisible();
  await page.getByTestId('add-cube').click();
  await expect(page.getByTestId('outliner-mesh-1')).toContainText('Cube');
});

test('keeps the current asset when a corrupt .shadeasset project fails to open', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-cube').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('open-shadeasset-input').setInputFiles({
    name: 'corrupt.shadeasset',
    mimeType: 'application/vnd.lowpoly-modeler.shadeasset+json',
    buffer: Buffer.from('{this is not json'),
  });

  await expect(page.getByRole('status')).toContainText(
    'Project open failed: Project file is not valid JSON.',
  );
  await expect(page.getByTestId('outliner-mesh-1')).toContainText('Cube');
  await expect(page.getByTestId('viewport-shell')).toBeVisible();
});

test('cleans an anonymized Meshy-like multi-mesh GLB and round-trips the remaining asset', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'meshy-like.glb',
    mimeType: 'model/gltf-binary',
    buffer: createMeshyLikeGlb(),
  });

  await expect(page.getByRole('status')).toContainText('Opened meshy-like.glb with 3 node(s).');
  await expect(page.getByTestId('outliner-node-2')).toContainText(/Canopy/);
  await expect(page.getByTestId('outliner-node-3')).toContainText(/Accent/);
  await page.getByTestId('outliner-node-2').click();
  await expect(page.getByTestId('texture-paint-status')).toContainText('1×1 · sRGB');
  await page.getByTestId('outliner-node-3').click();
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await expect(page.getByTestId('outliner-node-3')).toHaveCount(0);

  await page.getByTestId('outliner-node-2').click();
  await page.getByRole('button', { name: 'Face Color', exact: true }).click();
  await page.getByRole('button', { name: 'Select face 1' }).click();
  await page.getByRole('button', { name: 'Set palette color #93c47d' }).click();
  await page.getByRole('button', { name: 'Apply face color' }).click();

  const downloadPromise = page.waitForEvent('download');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exportedGlb = await readFile(downloadPath!);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('open-glb-input').setInputFiles({
    name: 'meshy-clean.glb',
    mimeType: 'model/gltf-binary',
    buffer: exportedGlb,
  });
  await expect(page.getByRole('status')).toContainText('Opened meshy-clean.glb');
  await expect(page.getByRole('button', { name: /Select .*Canopy/ })).toBeVisible();
});
