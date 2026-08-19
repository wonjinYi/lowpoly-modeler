import { expect, test } from '@playwright/test';

test('stays within the documented startup, 4K-vertex edit, and GLB export budgets', async ({
  page,
}, testInfo) => {
  const metrics: Record<string, number | null> = {};

  let startedAt = performance.now();
  await page.goto('/');
  await expect(page.getByTestId('viewport-shell')).toBeVisible();
  metrics.startupMs = Math.round(performance.now() - startedAt);

  startedAt = performance.now();
  await page.getByLabel('Primitive radial segments').fill('64');
  await page.getByLabel('Primitive radial segments').press('Enter');
  await page.getByLabel('Primitive latitude segments').fill('64');
  await page.getByLabel('Primitive latitude segments').press('Enter');
  await page.getByRole('button', { name: '+ Sphere', exact: true }).click();
  await expect(page.getByTestId('outliner-mesh-1')).toContainText('Sphere');
  metrics.edit4kVertexMeshMs = Math.round(performance.now() - startedAt);

  startedAt = performance.now();
  const downloadPromise = page.waitForEvent('download');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Export GLB', exact: true }).click();
  await downloadPromise;
  metrics.exportAndSafetyGateMs = Math.round(performance.now() - startedAt);
  metrics.usedJsHeapBytes = await page.evaluate(() => {
    const memory = (window.performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    return memory?.usedJSHeapSize ?? null;
  });

  expect(metrics.startupMs).toBeLessThan(5_000);
  expect(metrics.edit4kVertexMeshMs).toBeLessThan(10_000);
  expect(metrics.exportAndSafetyGateMs).toBeLessThan(15_000);
  if (metrics.usedJsHeapBytes !== null) {
    expect(metrics.usedJsHeapBytes).toBeLessThan(256 * 1024 * 1024);
  }
  await testInfo.attach('performance-budget.json', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
});
