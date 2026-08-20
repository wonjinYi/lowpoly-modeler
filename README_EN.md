# Low-Poly Asset Editor

**[한국어](README.md) | English**  
User guide: **[한국어](USER_GUIDE.md) | [English](USER_GUIDE_EN.md)**

A desktop-first 3D editor for creating and cleaning up low-poly GLB assets for `Who Ordered Some Shade? / 그늘 시키신 분?` directly in the browser.

It is not a general-purpose DCC replacement for Blender. It is designed for making simple game assets from primitives, or for cleaning unnecessary parts from Meshy-generated GLBs and preparing their scale, pivot, and materials for in-game use.

![Continuous workflow: complete an asymmetric low-poly fountain with Primitives, Transform, and Face Color](docs/images/editor-workflow.gif)

A turntable of the finished asset is also included, using a full orbit of the actual viewport camera.

![360-degree turntable of the finished asymmetric low-poly fountain](docs/images/fountain-turntable.gif)

## Key features

- Create Cube, Plane, Cylinder, Cone, Sphere, and Icosphere primitives
- Object / Vertex / Edge / Face editing, multi-selection, Undo / Redo
- Merge, Delete, Subdivide, Loop Cut, Extrude, Inset, Bevel, Mirror, and Bend
- W/H/D geometry sizing and Apply Scale for actual game-ready dimensions
- Hierarchy editing, Pivot, `shade_pivot`, Ground, and Shadow Preview
- Face Color, PBR material editing, flat / smooth shading, topology checks, and basic repair
- Open, drag and drop, export, and round-trip validation for GLB files
- Boolean Difference / Union / Intersection for closed manifold meshes
- Texture Paint, simple Auto UV, and local texture import
- `.shadeasset` v2 project Save / Open for editable work

All GLB, image, and project files are handled locally in the browser. No server, account, or external API is used.

## Quick start

Requirement: Node.js 24 or newer.

```bash
npm install
npm run dev
```

Open the displayed local address in a browser and press `+ Cube` to start.

For step-by-step instructions, see the **[English User Guide](USER_GUIDE_EN.md)** or the **[Korean User Guide](USER_GUIDE.md)**.

## File formats

| Purpose       | Format                         | Description                                                                     |
| ------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| Import        | `.glb`                         | A game model to edit or clean up                                                |
| Working save  | `.shadeasset`                  | Stores hierarchy, editable meshes, Mirror state, palettes, and texture payloads |
| Game export   | `.glb`                         | The validated final asset, excluding hidden nodes                               |
| Texture Paint | A browser-readable local image | Converts PNG/JPEG/WebP and similar files into a PNG/sRGB paint payload          |

Use `.shadeasset` to resume work. Use `.glb` for the final file that goes into the game.

## Recommended workflows

### Create an asset from primitives

1. Add primitives.
2. Shape them in Vertex / Edge / Face mode.
3. Finish colors and materials with Face Color or Material.
4. Set actual dimensions with W/H/D and run Apply Scale when needed.
5. Check `shade_pivot`, Ground, Shadow Preview, and Game Asset Check.
6. Export the GLB.

### Clean up a Meshy GLB

1. Open a file with `Open GLB` or drag it onto the viewport.
2. Delete unnecessary meshes and organize the hierarchy in the Outliner.
3. Adjust shape and color with topology tools and Face Color / Material.
4. Set scale, orientation, Ground, and Pivot for the game.
5. Review validation warnings, then export the GLB.

![Inspector modeling tools, including Bend and Mirror](docs/images/modeling-tools.png)

## Development commands

```bash
# Code checks
npm run format:check
npm run lint
npm run typecheck

# Tests
npm test
npm run test:e2e

# Production builds
npm run build
npm run build:pages
```

## GitHub Pages deployment

`.github/workflows/deploy-pages.yml` builds and deploys a GitHub Pages artifact on pushes to `main` and on manual runs. Vite uses the repository path supplied by GitHub Pages so assets and WASM files resolve correctly on a project page.

Set this up once in the GitHub repository:

1. Open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Push to `main`, or run **Actions → Deploy GitHub Pages → Run workflow**.
3. Once the workflow's `deploy` job completes, GitHub displays the Pages URL. The default project-page URL for this repository is `https://wonjinyi.github.io/lowpoly-modeler/`.

To check the same subpath build locally, run:

```bash
npm run build:pages
npm run preview -- --mode pages
```

Automatic deployment runs only on pushes to `main`. Pull requests run the [Quality workflow](.github/workflows/quality.yml), which performs checks and a Pages build without deploying.

## Validation status

- 84 Vitest unit tests pass
- 49 Playwright Chromium E2E tests pass
- Lint, typecheck, formatting, production build, and GitHub Pages build pass
- A fresh session was checked against a static preview at the GitHub Pages subpath

Performance budgets and measurements are recorded in [performance-budget.md](performance-budget.md).

## Scope and limits

- Desktop browsers are the primary target.
- Only GLB can be imported directly; `.gltf` is not supported yet.
- Boolean operations require closed manifold solids with consistent winding. The result is a triangle mesh using the source subject's default material ID.
- Auto UV uses simple face projection for low-poly editing. UV packing and a Blender-style UV editor are out of scope.
- Sculpting, rigging, animation, skinning, cloth / physics, shader nodes, CAD, and automatic retopology are out of scope.

## Documentation

- **User guides:** [한국어](USER_GUIDE.md) | [English](USER_GUIDE_EN.md)
- **Readmes:** [한국어](README.md) | English
- [Development plan and completion checklist](codex-development-plan.md)
- [Development instruction](codex-development-instruction.md)
- [Boolean technology spike](boolean-technology-spike.md)
- [Performance budget](performance-budget.md)

## License

[MIT License](LICENSE)
