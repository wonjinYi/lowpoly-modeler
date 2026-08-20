# Low-Poly Asset Editor — User Guide

**[한국어](USER_GUIDE.md) | English**  
Readme: **[한국어](README.md) | [English](README_EN.md)**

## 1. Getting started

The editor contains an Outliner on the left, a 3D Viewport in the center, an Inspector on the right, and Status / Validation information at the bottom.

1. To create a new asset, press `+ Cube` in the top bar or choose a primitive from the left panel.
2. To open an existing model, press `Open GLB` or drag a `.glb` file onto the viewport.
3. Select an object in the Outliner to show its transform, geometry, material, and topology tools in the Inspector.
4. Every change is recorded in Undo / Redo.

Use `Save Project` to keep an editable `.shadeasset` while you work. Use `Export GLB` to create the file for the game.

![Default editor layout: Outliner, Viewport, and Inspector](docs/images/editor-overview.png)

The following is a real workflow that builds an asymmetric low-poly fountain using only primitives, transforms, and Face Color. Watch it once for the overall flow before reading the individual tools.

![Continuous workflow for creating an asymmetric low-poly fountain with primitives and Face Color](docs/images/editor-workflow.gif)

## 2. Basic controls

| Task                  | How                                                                 |
| --------------------- | ------------------------------------------------------------------- |
| Select an object      | Click it in the viewport or select it in the Outliner               |
| Multi-select          | Hold `Shift` while clicking                                         |
| Box select            | In Vertex / Edge / Face mode, hold `Shift` and drag in the viewport |
| Move / rotate / scale | Use the Transform controls at the top or numeric Inspector inputs   |
| Undo                  | `Ctrl/Cmd + Z`                                                      |
| Redo                  | `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y`                            |
| Delete selection      | `Delete` or `Backspace`                                             |

For numeric inputs, type a value and press `Enter`, or click elsewhere to apply it. Press `Esc` to revert the value currently being entered.

In Object mode, use the Inspector to read and edit the selected primitive's Position, Rotation, and Scale. Use the gizmo for quick visual placement and the numeric inputs for precise placement.

![Object mode with a Cylinder's Position, Rotation, and Scale visible in the Inspector](docs/images/object-transform.png)

## 3. Working by mode

### Object

Select, move, rotate, and scale objects. The Outliner also supports renaming, showing or hiding, deleting, parenting, and unparenting objects.

Object Scale is a temporary transform while working. For the asset's real in-game size, use the `Size` tool described below.

### Vertex

Select vertices to edit coordinates, or select multiple vertices to Merge, Merge by Distance, or Delete. Selection Transform can also move, rotate, or scale the selection in Local or World orientation.

### Edge

Select edges to Subdivide, Delete, Dissolve, or Bevel them. With quad topology, a selected edge can create a Loop Cut preview; adjust its position and then apply it.

GLB stores triangle meshes, so an imported triangle pair must first meet the `Tris to Quads` conditions before it can become a Loop Cut target. UV seams, material seams, poles, and boundary or non-manifold areas are rejected for safety.

### Face

Select faces to Delete, Flip Normal, Extrude, or Inset. Deleting a face is the most direct way to create an open hole.

Once a face is selected, the Inspector shows Extrude and Inset controls. Use `Preview` first, confirm the shape, and then Commit it as one Undo operation.

![Face mode with a Cylinder cap selected and the Extrude and Inset tools visible](docs/images/face-extrude.png)

### Pivot

Create a Pivot group and edit its position and name. `shade_pivot` is the recommended name for a part that will rotate in the game.

Use a rotation preset or slider to preview the result, then Apply it to save a single Undo operation. A preview alone does not modify the document.

### Face Color

Click a face in the viewport to paint it, or apply a palette / color-picker color to selected faces. Colors are stored as vertex/corner colors, so painting does not create one material per face.

Choose an exact face from the face list, select a palette or color-picker color, then press `Apply face color`. As shown below, a single Icosphere can use several colors while keeping one material.

![Face Color mode painting selected Icosphere faces with coral and cyan](docs/images/face-color.png)

### Texture Paint

Use Brush, Eraser, and Eyedropper on meshes that have UVs.

1. If the mesh has no UVs, press `Generate simple Auto UV`. Existing UVs are not overwritten.
2. Create an editable texture with `Create blank layer`, or choose `Import local image`.
3. Set brush color, size, and opacity.
4. Switch to `Texture Paint` mode and drag across the viewport.

One stroke is one Undo operation. A brush that crosses a UV 0/1 boundary continues onto the opposite boundary.

## 4. Real size and game coordinates

### Size (W / H / D)

The Inspector's `Size W/H/D` changes vertex geometry itself; it does not merely change Object Scale. When `Keep proportions` is enabled (the default), changing one axis changes the others by the same ratio.

For a game export, the recommended Object Scale is `1 / 1 / 1`. If you used Object Scale while modeling, choose `Apply Scale to Geometry`.

### Orientation and ground

- The game coordinate convention is `+Y = Up` and `+Z = Forward`.
- `Move selection to ground` in the Ground panel aligns an object's or subtree's bottom with the ground reference.
- `Set Ground Reference` stores the selected bottom height as the reference value.
- Shadow Preview is a viewing mode with a ground plane, directional light, and cast / receive shadows for checking the silhouette.

The Inspector's Bend and Mirror tools offer non-destructive previews for the selected object. Apply or Bake only after the preview looks correct, so it becomes real geometry only when intended.

![Inspector area containing Bend and Mirror tools](docs/images/modeling-tools.png)

## 5. Materials and cleanup

Use the Material panel to edit Base Color, Roughness, Metalness, Opacity, and Flat Shading. Unless a different look is intentional, low-poly game assets usually benefit from higher roughness and lower metalness.

The Topology panel checks for:

- Open edges, non-manifold edges, and inconsistent normals
- Degenerate faces and duplicate / coincident vertices
- Small loose components

When needed, use Merge by Distance, Recalculate Normals, Delete Degenerate Faces, or split/delete a loose component. Repair operations are also undoable.

## 6. Making holes with Boolean operations

Unlike Face Delete, Boolean operations cut or combine actual volumes.

1. Select the mesh that will be the subject.
2. Hold `Shift` and select the cutter as the second object.
3. In the Inspector's Boolean panel, choose Difference, Union, or Intersection and run Preview.
4. If the result is correct, Commit it. Use Cancel Boolean preview to discard it.

Safety rules:

- Both objects must be closed manifold solids. Repair open planes, non-manifold meshes, and degenerate geometry first.
- Bake or disable Live Mirror before running a Boolean operation.
- A cutter cannot have child objects. The cutter object is removed on Commit.
- Preview does not modify source geometry. Commit creates one Undo operation.
- A Boolean result is a triangle mesh using the source subject's first material. Detailed multi-material transfer and UV reprojection are outside this version's scope.

## 7. Saving and exporting files

### Open GLB

Use `Open GLB` or drag and drop. Information outside static low-poly editing, such as animation, skinning, and morph targets, is imported in its current form with a warning.

### Save Project

`Save Project` downloads a `.shadeasset`. It contains editable meshes, hierarchy, selectable topology, palettes, texture-paint payloads, live Mirror data, and editor settings.

When reopened with `Open Project`, it starts from a safe new Undo baseline.

### Export a game-ready GLB

`Export GLB` checks:

- That there is at least one visible mesh to export
- That geometry and texture references are valid
- That transforms are finite
- Non-unit scale, ground contact, `shade_pivot`, and +Z-forward confirmation

Errors block export. Warnings can be reviewed and then continued or cancelled. Before download, the editor reopens the in-memory GLB to validate its visible mesh count, bounds, scale, and hierarchy.

## 8. Troubleshooting

| Symptom                      | What to check                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Size does not change         | Check whether the selected object's local size or scale axis is zero, then restore it to a non-zero value first.                  |
| Loop Cut is rejected         | The target may be a triangle, pole, UV/material seam, boundary, or non-manifold area. Use Tris to Quads or another modeling tool. |
| Boolean preview fails        | Confirm that both meshes are closed manifolds, Live Mirror is disabled, and the cutter has no children.                           |
| Texture Paint is unavailable | Generate UVs or select a mesh that already has them, then prepare a blank or imported texture.                                    |
| Export is blocked            | Fix the Error entries in Game Asset Check. Review Warnings to decide whether they fit the intended game asset.                    |
| Worried about losing work    | Save a `.shadeasset` before and after GLB export and before large edits.                                                          |

## 9. Features outside the current scope

This editor focuses on simple game-asset production. It does not provide sculpting, rigging, animation editing, skinning, cloth / physics, a shader node editor, precise UV editing or packing, CAD, or automatic retopology.

For development and verification information, see the **[English README](README_EN.md)**, the **[Korean README](README.md)**, the [development plan](codex-development-plan.md), and the [performance budget](performance-budget.md).
