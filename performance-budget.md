# Performance Budget

## Reference workload

The current interactive reference mesh is a UV sphere created with the editor's allowed maximum `64 × 64` segment setting. It has 4,034 editable vertices and 4,032 polygon faces. This is the minimum supported performance target for the initial desktop editor; larger imports remain editable but are not yet covered by a performance promise.

## Automated budget

`tests/e2e/performance.spec.ts` measures a local Desktop Chrome run and attaches the raw timings as `performance-budget.json` to the Playwright result.

| Flow | Budget | Notes |
|---|---:|---|
| Empty editor startup to visible viewport | < 5 s | Includes local Vite page load and Three runtime initialization. |
| Create the 4,034-vertex reference sphere | < 10 s | Includes numeric primitive option edits and renderer synchronization; budget accommodates the parallel Chromium CI workload. |
| GLB export plus in-memory safety reimport | < 15 s | Includes the required visible-mesh, bounds, unit-scale, and `shade_pivot` verification gate. |
| JS heap after the flow | < 256 MiB, when Chromium exposes it | The browser may omit `performance.memory`; in that case the timing gates still run. |

## Measurement rules

- Run `npx playwright test tests/e2e/performance.spec.ts --reporter=list` on a warm local dependency cache before changing the limits.
- Treat a consistently exceeded budget as a regression: profile geometry rebuild, history snapshots, or GLB export before increasing the limit.
- Re-baseline with a separate fixture before advertising support for meshes larger than the 4K editable-vertex reference workload.
