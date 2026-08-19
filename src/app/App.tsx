import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as THREE from 'three';
import { getChildren } from '../editor/core/document';
import { editorStore } from '../editor/core/store';
import type { EditorMode, EditorNode, PrimitiveKind, Transform, Vec3 } from '../editor/core/types';
import {
  getDegenerateFaceIds,
  getMeshBounds,
  inspectTrisToQuad,
  traceLoopCut,
} from '../editor/geometry/mesh-operations';
import {
  getCoincidentVertexGroups,
  getMeshConnectedComponents,
  getMeshEdges,
  getMeshTopologyDiagnostics,
  getMergeableDuplicateVertexGroups,
} from '../editor/geometry/topology';
import { useEditorState } from '../editor/core/use-editor-state';
import { validateDocumentForExport } from '../editor/validation/document-validation';
import type { BooleanOperation } from '../editor/core/types';

const Viewport = lazy(async () => {
  const module = await import('../viewport/Viewport');
  return { default: module.Viewport };
});

const PRIMITIVES: Array<{ kind: PrimitiveKind; label: string }> = [
  { kind: 'cube', label: 'Cube' },
  { kind: 'plane', label: 'Plane' },
  { kind: 'cylinder', label: 'Cylinder' },
  { kind: 'cone', label: 'Cone' },
  { kind: 'sphere', label: 'Sphere' },
  { kind: 'icosphere', label: 'Icosphere' },
];

const FACE_COLOR_PALETTE = [
  '#f5a65b',
  '#f07178',
  '#e9c46a',
  '#93c47d',
  '#55c1b3',
  '#5da9e9',
  '#8a7dce',
  '#c985c9',
  '#f3f1e8',
  '#a7b4ad',
  '#6f7d85',
  '#334e5c',
];

type EyeDropperConstructor = new () => { open: () => Promise<{ sRGBHex: string }> };

type ResizablePanel = 'inspector' | 'outliner';

const MODES: Array<{ id: EditorMode; label: string; available: boolean }> = [
  { id: 'object', label: 'Object', available: true },
  { id: 'vertex', label: 'Vertex', available: true },
  { id: 'edge', label: 'Edge', available: true },
  { id: 'face', label: 'Face', available: true },
  { id: 'pivot', label: 'Pivot', available: true },
  { id: 'face-color', label: 'Face Color', available: true },
  { id: 'texture-paint', label: 'Texture Paint', available: true },
];

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function updateAxis(vector: Vec3, axis: keyof Vec3, value: number): Vec3 {
  return { ...vector, [axis]: value };
}

function updateTransform(
  transform: Transform,
  property: keyof Transform,
  axis: keyof Vec3,
  value: number,
): Transform {
  return { ...transform, [property]: updateAxis(transform[property], axis, value) };
}

function isDescendantOf(
  document: { nodes: Record<string, EditorNode> },
  nodeId: string,
  ancestorId: string,
): boolean {
  let current = document.nodes[nodeId];
  while (current?.parentId) {
    if (current.parentId === ancestorId) {
      return true;
    }
    current = document.nodes[current.parentId];
  }
  return false;
}

function hasNonUnitAncestorScale(document: { nodes: Record<string, EditorNode> }, node: EditorNode): boolean {
  let current = node.parentId ? document.nodes[node.parentId] : undefined;
  while (current) {
    const { scale } = current.transform;
    if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) {
      return true;
    }
    current = current.parentId ? document.nodes[current.parentId] : undefined;
  }
  return false;
}

function NumberField({
  label,
  value,
  step = 0.1,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  onCommit: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(() => formatNumber(value));

  const commit = (): void => {
    const nextValue = Number(draft);
    if (Number.isFinite(nextValue)) {
      onCommit(nextValue);
    } else {
      setDraft(formatNumber(value));
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      setDraft(formatNumber(value));
      event.currentTarget.blur();
    }
  };

  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        aria-label={label}
        inputMode="decimal"
        min={-100000}
        max={100000}
        step={step}
        type="number"
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    </label>
  );
}

function PanelResizeHandle({
  panel,
  value,
  onResizeStart,
}: {
  panel: ResizablePanel;
  value: number;
  onResizeStart: (panel: ResizablePanel, event: ReactPointerEvent<HTMLDivElement>) => void;
}): JSX.Element {
  const minimum = panel === 'outliner' ? 208 : 254;
  return (
    <div
      aria-label={`Resize ${panel === 'outliner' ? 'Outliner' : 'Inspector'}`}
      aria-orientation="vertical"
      aria-valuemax={480}
      aria-valuemin={minimum}
      aria-valuenow={value}
      className={`panel-resize-handle panel-resize-handle-${panel}`}
      onPointerDown={(event) => onResizeStart(panel, event)}
      role="separator"
      tabIndex={0}
    />
  );
}

function TransformFields({ node }: { node: EditorNode }): JSX.Element {
  const update = (property: keyof Transform, axis: keyof Vec3, value: number): void => {
    editorStore.setTransform(node.id, updateTransform(node.transform, property, axis, value));
  };

  const sections: Array<{ label: string; property: keyof Transform; inDegrees?: boolean }> = [
    { label: 'Position', property: 'position' },
    { label: 'Rotation', property: 'rotation', inDegrees: true },
    { label: 'Scale', property: 'scale' },
  ];

  return (
    <div className="transform-fields">
      {sections.map(({ label, property, inDegrees }) => (
        <section className="inspector-section" key={property}>
          <h3>{label}</h3>
          <div className="axis-grid">
            {(['x', 'y', 'z'] as const).map((axis) => {
              const rawValue = node.transform[property][axis];
              const shownValue = inDegrees ? THREE.MathUtils.radToDeg(rawValue) : rawValue;
              return (
                <NumberField
                  key={`${axis}-${shownValue}`}
                  label={`${label} ${axis.toUpperCase()}`}
                  step={property === 'rotation' ? 5 : 0.1}
                  value={shownValue}
                  onCommit={(value) =>
                    update(property, axis, inDegrees ? THREE.MathUtils.degToRad(value) : value)
                  }
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function PivotRotationControls({ node }: { node: EditorNode }): JSX.Element | null {
  const state = useEditorState();
  if (state.mode !== 'pivot' || node.type !== 'group') {
    return null;
  }
  const previewRotationY =
    state.pivotPreview?.nodeId === node.id ? state.pivotPreview.rotationY : node.transform.rotation.y;
  const degrees = THREE.MathUtils.radToDeg(previewRotationY);
  const isPreviewing = state.pivotPreview?.nodeId === node.id;
  const setRotation = (nextDegrees: number): void => {
    editorStore.cancelPivotPreview();
    editorStore.setTransform(node.id, {
      ...node.transform,
      rotation: { ...node.transform.rotation, y: THREE.MathUtils.degToRad(nextDegrees) },
    });
  };
  const setPreview = (nextDegrees: number): void => {
    editorStore.setPivotPreview(node.id, THREE.MathUtils.degToRad(nextDegrees));
  };

  return (
    <section className="inspector-section">
      <h3>Pivot rotation Y</h3>
      <div className="pivot-preset-grid">
        {[0, 45, 90, 180, 270, 360].map((value) => (
          <button
            aria-label={`Set pivot Y to ${value} degrees`}
            key={value}
            onClick={() => setRotation(value)}
            type="button"
          >
            {value}°
          </button>
        ))}
      </div>
      <label className="pivot-slider-field">
        <span>{Math.round(degrees)}°</span>
        <input
          aria-label="Pivot rotation Y"
          max={360}
          min={0}
          onChange={(event) => setPreview(Number(event.target.value))}
          onPointerCancel={() => editorStore.cancelPivotPreview()}
          onPointerDown={() => setPreview(degrees)}
          step={1}
          type="range"
          value={Math.round(degrees)}
        />
      </label>
      {isPreviewing && (
        <div className="pivot-preview-actions">
          <p>Preview only · original transform is unchanged.</p>
          <button onClick={() => editorStore.commitPivotPreview()} type="button">
            Apply pivot preview
          </button>
          <button onClick={() => editorStore.cancelPivotPreview()} type="button">
            Cancel pivot preview
          </button>
        </div>
      )}
    </section>
  );
}

function OrientationCorrectionPanel({ node }: { node: EditorNode }): JSX.Element {
  const currentYaw = Math.round(THREE.MathUtils.radToDeg(node.transform.rotation.y));
  const corrections = [
    { source: '+Z', yaw: 0 },
    { source: '+X', yaw: -90 },
    { source: '-Z', yaw: 180 },
    { source: '-X', yaw: 90 },
  ];
  const correctForward = (yaw: number): void => {
    editorStore.setTransform(node.id, {
      ...node.transform,
      rotation: { ...node.transform.rotation, y: THREE.MathUtils.degToRad(yaw) },
    });
  };

  return (
    <section className="inspector-section orientation-panel">
      <h3>Game orientation</h3>
      <p className="orientation-axis-guide">
        <strong>+Y</strong> Up <span>·</span> <strong>+Z</strong> Forward
      </p>
      <p>
        Correct the selected object&apos;s yaw when its original front points along a different axis. Use the
        asset root for a complete imported model.
      </p>
      <div aria-label="Forward orientation correction" className="orientation-preset-grid">
        {corrections.map(({ source, yaw }) => (
          <button
            aria-label={`Correct forward from ${source}`}
            key={source}
            onClick={() => correctForward(yaw)}
            type="button"
          >
            Front {source}
          </button>
        ))}
      </div>
      <p className="orientation-current-yaw">
        Current yaw: {currentYaw}° · Confirm the semantic +Z direction in Game asset check.
      </p>
    </section>
  );
}

function GeometrySizeFields({ node }: { node: EditorNode }): JSX.Element | null {
  const state = useEditorState();
  const [keepProportions, setKeepProportions] = useState(true);
  if (node.type !== 'mesh') {
    return null;
  }
  const rawBounds = getMeshBounds(node.mesh);
  if (!rawBounds) {
    return null;
  }
  const bounds = {
    ...rawBounds,
    size: {
      x: rawBounds.size.x * Math.abs(node.transform.scale.x),
      y: rawBounds.size.y * Math.abs(node.transform.scale.y),
      z: rawBounds.size.z * Math.abs(node.transform.scale.z),
    },
  };
  const canResize = [bounds.size.x, bounds.size.y, bounds.size.z].every(
    (size) => Number.isFinite(size) && size > 0,
  );

  const updateSize = (axis: keyof Vec3, value: number): void => {
    if (!canResize) {
      return;
    }
    const current = bounds.size;
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    const target = { ...current, [axis]: value };
    if (keepProportions) {
      const ratio = value / current[axis];
      target.x = current.x * ratio;
      target.y = current.y * ratio;
      target.z = current.z * ratio;
    }
    editorStore.resizeGeometry(node.id, target);
  };

  const labels: Array<{ axis: keyof Vec3; label: string }> = [
    { axis: 'x', label: 'W' },
    { axis: 'y', label: 'H' },
    { axis: 'z', label: 'D' },
  ];
  const hasObjectScale =
    node.transform.scale.x !== 1 || node.transform.scale.y !== 1 || node.transform.scale.z !== 1;
  const hasZeroObjectScale = [node.transform.scale.x, node.transform.scale.y, node.transform.scale.z].some(
    (scale) => scale === 0,
  );
  const hasNegativeObjectScale = [
    node.transform.scale.x,
    node.transform.scale.y,
    node.transform.scale.z,
  ].some((scale) => scale < 0);
  const hasParentScale = hasNonUnitAncestorScale(state.document, node);

  return (
    <section className="inspector-section geometry-size-section">
      <div className="section-title-row">
        <h3>Size</h3>
        <label className="toggle-field">
          <input
            checked={keepProportions}
            onChange={(event) => setKeepProportions(event.target.checked)}
            type="checkbox"
          />
          Keep proportions
        </label>
      </div>
      {canResize ? (
        <div className="axis-grid">
          {labels.map(({ axis, label }) => (
            <NumberField
              key={`${node.id}-${axis}-${bounds.size[axis]}`}
              label={`Size ${label}`}
              step={0.1}
              value={bounds.size[axis]}
              onCommit={(value) => updateSize(axis, value)}
            />
          ))}
        </div>
      ) : (
        <p className="geometry-size-help geometry-size-warning">
          A zero local size or scale axis cannot be resized. Restore a non-zero Scale axis, or add geometry
          along the missing axis first.
        </p>
      )}
      {hasNegativeObjectScale && (
        <p className="geometry-size-help">
          Negative scale is shown as an absolute size. Applying it bakes the reflection and preserves outward
          face winding.
        </p>
      )}
      {hasParentScale && (
        <p className="geometry-size-help">
          Size edits use this mesh&apos;s local scale only. Parent scale remains hierarchy state; select the
          parent to correct it before export.
        </p>
      )}
      {hasObjectScale && !hasZeroObjectScale && (
        <button className="apply-scale-button" onClick={() => editorStore.applyScale(node.id)} type="button">
          Apply Scale to Geometry
        </button>
      )}
    </section>
  );
}

function VertexPositionFields(): JSX.Element | null {
  const state = useEditorState();
  const selection =
    state.mode === 'vertex' && state.selectedVertexIds.length === 1 ? state.selectedVertexIds[0] : undefined;
  const node = selection ? state.document.nodes[selection.nodeId] : undefined;
  const vertex = node?.type === 'mesh' && selection ? node.mesh.vertices[selection.vertexId] : undefined;
  if (!selection || !vertex) {
    return null;
  }

  return (
    <section className="inspector-section">
      <h3>Vertex position</h3>
      <div className="axis-grid">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <NumberField
            key={`${selection.nodeId}-${selection.vertexId}-${axis}-${vertex.position[axis]}`}
            label={`Vertex ${axis.toUpperCase()}`}
            value={vertex.position[axis]}
            onCommit={(value) =>
              editorStore.setVertexPosition(selection, { ...vertex.position, [axis]: value })
            }
          />
        ))}
      </div>
    </section>
  );
}

function SelectionTransformPanel({ node }: { node: EditorNode }): JSX.Element | null {
  const state = useEditorState();
  const [translation, setTranslation] = useState<Vec3>({ x: 0, y: 0, z: 0 });
  const [rotationDegrees, setRotationDegrees] = useState<Vec3>({ x: 0, y: 0, z: 0 });
  const [scale, setScale] = useState<Vec3>({ x: 1, y: 1, z: 1 });
  const [orientation, setOrientation] = useState<'local' | 'world'>('local');
  if (node.type !== 'mesh' || !['vertex', 'edge', 'face'].includes(state.mode)) {
    return null;
  }
  const selectedCount =
    state.mode === 'vertex'
      ? state.selectedVertexIds.filter((selection) => selection.nodeId === node.id).length
      : state.mode === 'edge'
        ? state.selectedEdgeIds.filter((selection) => selection.nodeId === node.id).length
        : state.selectedFaceIds.filter((selection) => selection.nodeId === node.id).length;
  if (selectedCount === 0) {
    return null;
  }
  const invalidScale =
    ![scale.x, scale.y, scale.z].every(Number.isFinite) || scale.x === 0 || scale.y === 0 || scale.z === 0;

  return (
    <section className="inspector-section selection-transform-panel">
      <h3>Selection transform</h3>
      <label className="name-field">
        <span>Orientation</span>
        <select
          aria-label="Selection orientation"
          onChange={(event) => setOrientation(event.target.value as 'local' | 'world')}
          value={orientation}
        >
          <option value="local">Local</option>
          <option value="world">World</option>
        </select>
      </label>
      <p>
        {selectedCount} selected {state.mode}
        {selectedCount === 1 ? '' : 's'} · {orientation} center
      </p>
      <div className="axis-grid">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <NumberField
            key={`move-${axis}`}
            label={`Selection move ${axis.toUpperCase()}`}
            value={translation[axis]}
            onCommit={(value) => setTranslation((current) => updateAxis(current, axis, value))}
          />
        ))}
      </div>
      <div className="axis-grid">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <NumberField
            key={`rotate-${axis}`}
            label={`Selection rotation ${axis.toUpperCase()}`}
            step={5}
            value={rotationDegrees[axis]}
            onCommit={(value) => setRotationDegrees((current) => updateAxis(current, axis, value))}
          />
        ))}
      </div>
      <div className="axis-grid">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <NumberField
            key={`scale-${axis}`}
            label={`Selection scale ${axis.toUpperCase()}`}
            value={scale[axis]}
            onCommit={(value) => setScale((current) => updateAxis(current, axis, value))}
          />
        ))}
      </div>
      <button
        disabled={invalidScale}
        onClick={() =>
          editorStore.transformSelectedGeometry(
            {
              translation,
              rotation: {
                x: THREE.MathUtils.degToRad(rotationDegrees.x),
                y: THREE.MathUtils.degToRad(rotationDegrees.y),
                z: THREE.MathUtils.degToRad(rotationDegrees.z),
              },
              scale,
            },
            orientation,
          )
        }
        type="button"
      >
        Apply selection transform
      </button>
    </section>
  );
}

function VertexSelectionPanel({ node }: { node: EditorNode }): JSX.Element | null {
  const state = useEditorState();
  const [mergeDistance, setMergeDistance] = useState(0.01);
  if (state.mode !== 'vertex' || node.type !== 'mesh') {
    return null;
  }
  const vertexIds = Object.keys(node.mesh.vertices);
  const shownVertexIds = vertexIds.slice(0, 24);
  return (
    <section className="inspector-section vertex-selection-panel">
      <h3>Vertices · {vertexIds.length}</h3>
      <div className="vertex-selection-grid">
        {shownVertexIds.map((vertexId, index) => {
          const selected = state.selectedVertexIds.some(
            (selection) => selection.nodeId === node.id && selection.vertexId === vertexId,
          );
          return (
            <button
              aria-label={`Select vertex ${index + 1}`}
              className={selected ? 'is-selected' : ''}
              key={vertexId}
              onClick={(event) => {
                const currentSelection = editorStore.getState().selectedVertexIds;
                const isSelected = currentSelection.some(
                  (selection) => selection.nodeId === node.id && selection.vertexId === vertexId,
                );
                editorStore.selectVertices(
                  event.shiftKey
                    ? isSelected
                      ? currentSelection.filter(
                          (selection) => selection.nodeId !== node.id || selection.vertexId !== vertexId,
                        )
                      : [...currentSelection, { nodeId: node.id, vertexId }]
                    : [{ nodeId: node.id, vertexId }],
                );
              }}
              type="button"
            >
              V{index + 1}
            </button>
          );
        })}
      </div>
      {vertexIds.length > shownVertexIds.length && (
        <p>Showing the first 24 vertices. Select the remaining vertices in the viewport.</p>
      )}
      <button
        className="vertex-delete-button"
        disabled={state.selectedVertexIds.length === 0}
        onClick={() => editorStore.deleteSelectedVertices()}
        type="button"
      >
        Delete selected vertex
      </button>
      <button
        disabled={state.selectedVertexIds.filter((selection) => selection.nodeId === node.id).length < 2}
        onClick={() => editorStore.mergeSelectedVertices()}
        type="button"
      >
        Merge selected vertices
      </button>
      <div className="face-extrude-field">
        <NumberField label="Merge distance" step={0.01} value={mergeDistance} onCommit={setMergeDistance} />
        <button
          disabled={
            mergeDistance < 0 ||
            state.selectedVertexIds.filter((selection) => selection.nodeId === node.id).length < 2
          }
          onClick={() => editorStore.mergeSelectedVerticesByDistance(mergeDistance)}
          type="button"
        >
          Merge by distance
        </button>
      </div>
    </section>
  );
}

function FaceSelectionPanel({ node }: { node: EditorNode }): JSX.Element | null {
  const state = useEditorState();
  const [extrudeDistance, setExtrudeDistance] = useState(0.25);
  const [insetFactor, setInsetFactor] = useState(0.2);
  const isFaceColorMode = state.mode === 'face-color';
  if ((state.mode !== 'face' && !isFaceColorMode) || node.type !== 'mesh') {
    return null;
  }
  const faceIds = Object.keys(node.mesh.faces);
  const shownFaceIds = faceIds.slice(0, 24);
  const selectedFaceCount = state.selectedFaceIds.length;
  const extrudePreviewing = state.activeTransaction?.label === 'Extrude selected faces';
  const insetPreviewing = state.activeTransaction?.label === 'Inset selected faces';
  return (
    <section className="inspector-section vertex-selection-panel">
      <h3>
        {isFaceColorMode ? 'Face colors' : 'Faces'} · {faceIds.length}
      </h3>
      <div className="vertex-selection-grid">
        {shownFaceIds.map((faceId, index) => {
          const selected = state.selectedFaceIds.some(
            (selection) => selection.nodeId === node.id && selection.faceId === faceId,
          );
          return (
            <button
              aria-label={`Select face ${index + 1}`}
              className={selected ? 'is-selected' : ''}
              key={faceId}
              onClick={() => editorStore.selectFaces([{ nodeId: node.id, faceId }])}
              type="button"
            >
              F{index + 1}
            </button>
          );
        })}
      </div>
      {faceIds.length > shownFaceIds.length && (
        <p>Showing the first 24 faces. Select more in the viewport.</p>
      )}
      {isFaceColorMode ? (
        <div className="face-color-tools">
          <div className="face-color-field">
            <label className="color-field">
              <span>Face color</span>
              <input
                aria-label="Face color"
                onChange={(event) => editorStore.setFacePaintColor(event.target.value)}
                type="color"
                value={state.facePaintColor}
              />
            </label>
            <button
              disabled={selectedFaceCount === 0}
              onClick={() => editorStore.colorSelectedFaces(state.facePaintColor)}
              type="button"
            >
              Apply face color
            </button>
          </div>
          <button
            onClick={() => {
              const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper;
              if (!EyeDropper) {
                editorStore.setNotice({
                  kind: 'info',
                  message: 'Screen eyedropper is not available in this browser.',
                });
                return;
              }
              void new EyeDropper()
                .open()
                .then(({ sRGBHex }) => editorStore.setFacePaintColor(sRGBHex))
                .catch(() => undefined);
            }}
            type="button"
          >
            Pick screen color
          </button>
          <div aria-label="Palette" className="face-color-swatches" role="group">
            {FACE_COLOR_PALETTE.map((color) => (
              <button
                aria-label={`Set palette color ${color}`}
                className={state.facePaintColor === color ? 'is-active' : ''}
                key={color}
                onClick={() => editorStore.setFacePaintColor(color)}
                style={{ backgroundColor: color }}
                title={color}
                type="button"
              />
            ))}
          </div>
          {state.facePaintRecentColors.length > 0 && (
            <div aria-label="Recent colors" className="face-color-swatches recent-face-colors" role="group">
              {state.facePaintRecentColors.map((color) => (
                <button
                  aria-label={`Use recent color ${color}`}
                  className={state.facePaintColor === color ? 'is-active' : ''}
                  key={color}
                  onClick={() => editorStore.setFacePaintColor(color)}
                  style={{ backgroundColor: color }}
                  title={`Recent ${color}`}
                  type="button"
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="face-extrude-field">
            <NumberField
              label="Extrude distance"
              step={0.05}
              value={extrudeDistance}
              onCommit={setExtrudeDistance}
            />
            {extrudePreviewing ? (
              <>
                <button onClick={() => editorStore.commitTransaction()} type="button">
                  Commit extrude
                </button>
                <button onClick={() => editorStore.cancelTransaction()} type="button">
                  Cancel extrude preview
                </button>
              </>
            ) : (
              <button
                disabled={
                  selectedFaceCount === 0 || extrudeDistance === 0 || Boolean(state.activeTransaction)
                }
                onClick={() => {
                  editorStore.beginTransaction('Extrude selected faces');
                  editorStore.extrudeSelectedFaces(extrudeDistance);
                }}
                type="button"
              >
                Preview extrude
              </button>
            )}
          </div>
          <div className="face-extrude-field">
            <NumberField label="Inset factor" step={0.05} value={insetFactor} onCommit={setInsetFactor} />
            {insetPreviewing ? (
              <>
                <button onClick={() => editorStore.commitTransaction()} type="button">
                  Commit inset
                </button>
                <button onClick={() => editorStore.cancelTransaction()} type="button">
                  Cancel inset preview
                </button>
              </>
            ) : (
              <button
                disabled={
                  selectedFaceCount === 0 ||
                  insetFactor <= 0 ||
                  insetFactor >= 1 ||
                  Boolean(state.activeTransaction)
                }
                onClick={() => {
                  editorStore.beginTransaction('Inset selected faces');
                  editorStore.insetSelectedFaces(insetFactor);
                }}
                type="button"
              >
                Preview inset
              </button>
            )}
          </div>
          <div className="face-action-row">
            <button
              disabled={selectedFaceCount === 0}
              onClick={() => editorStore.flipSelectedFaces()}
              type="button"
            >
              Flip normal
            </button>
            <button
              disabled={selectedFaceCount === 0}
              onClick={() => editorStore.deleteSelectedFaces()}
              type="button"
            >
              Delete face
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function EdgeSelectionPanel({ node }: { node: EditorNode }): JSX.Element | null {
  const state = useEditorState();
  const [bevelSegments, setBevelSegments] = useState(1);
  const [bevelWidth, setBevelWidth] = useState(0.1);
  const [loopCutPosition, setLoopCutPosition] = useState(0.5);
  if (state.mode !== 'edge' || node.type !== 'mesh') {
    return null;
  }
  const edges = getMeshEdges(node.mesh);
  const shownEdges = edges.slice(0, 24);
  const selectedEdgeCount = state.selectedEdgeIds.length;
  const selectedEdge =
    selectedEdgeCount === 1 && state.selectedEdgeIds[0]?.nodeId === node.id
      ? state.selectedEdgeIds[0]
      : undefined;
  const loopCutPath = selectedEdge ? traceLoopCut(node.mesh, selectedEdge.edgeId) : null;
  const loopCutPreviewing = state.activeTransaction?.label === 'Loop cut';
  const trisToQuadCandidate = selectedEdge ? inspectTrisToQuad(node.mesh, selectedEdge.edgeId) : null;
  const trisToQuadPreviewing = state.activeTransaction?.label === 'Tris to Quads';
  const previewLoopCut = (): void => {
    editorStore.beginTransaction('Loop cut');
    editorStore.loopCutSelectedEdge(loopCutPosition);
  };

  return (
    <section className="inspector-section vertex-selection-panel">
      <h3>Edges · {edges.length}</h3>
      <div className="vertex-selection-grid">
        {shownEdges.map((edge, index) => {
          const selected = state.selectedEdgeIds.some(
            (selection) => selection.nodeId === node.id && selection.edgeId === edge.id,
          );
          return (
            <button
              aria-label={`Select edge ${index + 1}`}
              className={selected ? 'is-selected' : ''}
              key={edge.id}
              onClick={() => editorStore.selectEdges([{ nodeId: node.id, edgeId: edge.id }])}
              type="button"
            >
              E{index + 1}
            </button>
          );
        })}
      </div>
      {edges.length > shownEdges.length && <p>Showing the first 24 edges. Select more in the viewport.</p>}
      <button
        disabled={selectedEdgeCount === 0}
        onClick={() => editorStore.subdivideSelectedEdges()}
        type="button"
      >
        Subdivide selected edge
      </button>
      <p>Subdivide inserts a midpoint and selects the new vertex for the next edit.</p>
      <div className="face-extrude-field">
        {trisToQuadPreviewing ? (
          <>
            <button onClick={() => editorStore.commitTransaction()} type="button">
              Apply Tris to Quads
            </button>
            <button onClick={() => editorStore.cancelTransaction()} type="button">
              Cancel Tris to Quads preview
            </button>
          </>
        ) : (
          <button
            disabled={!selectedEdge || Boolean(trisToQuadCandidate?.reason)}
            onClick={() => {
              editorStore.beginTransaction('Tris to Quads');
              editorStore.trisToQuadSelectedEdge();
            }}
            type="button"
          >
            Preview Tris to Quads
          </button>
        )}
      </div>
      {selectedEdge && trisToQuadCandidate?.reason && <p>{trisToQuadCandidate.reason}</p>}
      <div className="face-extrude-field">
        <NumberField
          label="Loop cut position"
          step={0.05}
          value={loopCutPosition}
          onCommit={setLoopCutPosition}
        />
        {loopCutPreviewing ? (
          <>
            <button onClick={() => editorStore.commitTransaction()} type="button">
              Apply loop cut
            </button>
            <button onClick={() => editorStore.cancelTransaction()} type="button">
              Cancel loop cut preview
            </button>
          </>
        ) : (
          <button
            disabled={
              !selectedEdge || Boolean(loopCutPath?.reason) || loopCutPosition <= 0 || loopCutPosition >= 1
            }
            onClick={previewLoopCut}
            type="button"
          >
            Preview loop cut
          </button>
        )}
      </div>
      {loopCutPath?.reason ? (
        <p className="has-topology-issue">{loopCutPath.reason}</p>
      ) : selectedEdge && loopCutPath ? (
        <p>
          {loopCutPath.isClosed ? 'Closed' : 'Open'} quad path · {loopCutPath.faces.length} faces
        </p>
      ) : (
        <p>Select one quad edge to trace a Loop Cut.</p>
      )}
      <div className="face-extrude-field">
        <NumberField label="Bevel width" step={0.01} value={bevelWidth} onCommit={setBevelWidth} />
        <NumberField label="Bevel segments" step={1} value={bevelSegments} onCommit={setBevelSegments} />
        <button
          disabled={!selectedEdge || bevelWidth <= 0 || !Number.isInteger(bevelSegments) || bevelSegments < 1}
          onClick={() => editorStore.bevelSelectedEdge(bevelWidth, bevelSegments)}
          type="button"
        >
          Bevel edge
        </button>
      </div>
      <p>Bevel supports a single manifold edge and one segment in this release.</p>
      <div className="face-action-row">
        <button
          disabled={selectedEdgeCount === 0}
          onClick={() => editorStore.dissolveSelectedEdges()}
          type="button"
        >
          Dissolve edge
        </button>
        <button
          disabled={selectedEdgeCount === 0}
          onClick={() => editorStore.deleteSelectedEdges()}
          type="button"
        >
          Delete edge
        </button>
      </div>
    </section>
  );
}

function BendPanel({ node }: { node: EditorNode }): JSX.Element | null {
  const state = useEditorState();
  const [angleDegrees, setAngleDegrees] = useState(45);
  const [axis, setAxis] = useState<'x' | 'y' | 'z'>('x');
  const [origin, setOrigin] = useState<Vec3>({ x: 0, y: 0, z: 0 });
  if (node.type !== 'mesh') {
    return null;
  }
  const previewing = state.activeTransaction?.label === 'Bend geometry';
  const preview = (): void => {
    editorStore.beginTransaction('Bend geometry');
    editorStore.bendSelectedGeometry(axis, (angleDegrees * Math.PI) / 180, origin);
  };
  return (
    <section className="inspector-section bend-panel">
      <h3>Bend</h3>
      <label className="name-field">
        <span>Bend axis</span>
        <select
          aria-label="Bend axis"
          disabled={previewing}
          onChange={(event) => setAxis(event.target.value as 'x' | 'y' | 'z')}
          value={axis}
        >
          <option value="x">X → +Y</option>
          <option value="y">Y → +Z</option>
          <option value="z">Z → +Y</option>
        </select>
      </label>
      <NumberField label="Bend angle" step={5} value={angleDegrees} onCommit={setAngleDegrees} />
      <div className="axis-grid">
        {(['x', 'y', 'z'] as const).map((coordinate) => (
          <NumberField
            key={coordinate}
            label={`Bend origin ${coordinate.toUpperCase()}`}
            step={0.1}
            value={origin[coordinate]}
            onCommit={(value) => setOrigin((current) => updateAxis(current, coordinate, value))}
          />
        ))}
      </div>
      {previewing ? (
        <div className="face-action-row">
          <button onClick={() => editorStore.commitTransaction()} type="button">
            Commit bend
          </button>
          <button onClick={() => editorStore.cancelTransaction()} type="button">
            Cancel bend preview
          </button>
        </div>
      ) : (
        <button
          disabled={angleDegrees === 0 || state.selectedNodeIds.length === 0}
          onClick={preview}
          type="button"
        >
          Preview bend
        </button>
      )}
    </section>
  );
}

function MirrorPanel({ node }: { node: EditorNode }): JSX.Element | null {
  const state = useEditorState();
  const [axis, setAxis] = useState<'x' | 'y' | 'z'>(
    node.type === 'mesh' ? (node.mirrorModifier?.axis ?? 'x') : 'x',
  );
  const [seamTolerance, setSeamTolerance] = useState(
    node.type === 'mesh' ? (node.mirrorModifier?.seamTolerance ?? 0.0001) : 0.0001,
  );
  if (node.type !== 'mesh') {
    return null;
  }
  const previewing = state.activeTransaction?.label === 'Mirror geometry';
  const liveSettingsMatch =
    node.mirrorModifier?.axis === axis && node.mirrorModifier?.seamTolerance === seamTolerance;
  const preview = (): void => {
    editorStore.beginTransaction('Mirror geometry');
    editorStore.mirrorSelectedGeometry(axis, seamTolerance);
  };
  return (
    <section className="inspector-section mirror-panel">
      <h3>Mirror</h3>
      <label className="name-field">
        <span>Mirror axis</span>
        <select
          aria-label="Mirror axis"
          disabled={previewing}
          onChange={(event) => setAxis(event.target.value as 'x' | 'y' | 'z')}
          value={axis}
        >
          <option value="x">X</option>
          <option value="y">Y</option>
          <option value="z">Z</option>
        </select>
      </label>
      <NumberField
        label="Mirror seam tolerance"
        step={0.0001}
        value={seamTolerance}
        onCommit={setSeamTolerance}
      />
      {previewing ? (
        <div className="face-action-row">
          <button onClick={() => editorStore.commitTransaction()} type="button">
            Apply mirror
          </button>
          <button onClick={() => editorStore.cancelTransaction()} type="button">
            Disable mirror preview
          </button>
        </div>
      ) : (
        <button disabled={seamTolerance < 0} onClick={preview} type="button">
          Preview mirror
        </button>
      )}
      <div className="face-action-row">
        <button
          disabled={previewing || seamTolerance < 0}
          onClick={() =>
            editorStore.setSelectedMirrorModifier(
              node.mirrorModifier && liveSettingsMatch ? null : { axis, seamTolerance },
            )
          }
          type="button"
        >
          {node.mirrorModifier
            ? liveSettingsMatch
              ? 'Disable live mirror'
              : 'Update live mirror'
            : 'Enable live mirror'}
        </button>
        {node.mirrorModifier && (
          <button
            disabled={previewing}
            onClick={() => editorStore.bakeSelectedMirrorModifier()}
            type="button"
          >
            Bake live mirror
          </button>
        )}
      </div>
      <p>
        {node.mirrorModifier
          ? `Live ${node.mirrorModifier.axis.toUpperCase()} Mirror is saved in the project and baked only for GLB export.`
          : 'Apply bakes geometry now. Live Mirror keeps the source mesh editable and stores its settings in .shadeasset.'}
      </p>
    </section>
  );
}

function MaterialPanel({ node }: { node: EditorNode }): JSX.Element | null {
  const state = useEditorState();
  if (node.type !== 'mesh') {
    return null;
  }
  const selectedFace = state.selectedFaceIds.find((selection) => selection.nodeId === node.id);
  const materialId =
    (selectedFace ? node.mesh.faces[selectedFace.faceId]?.materialId : undefined) ??
    Object.values(node.mesh.faces)[0]?.materialId;
  const material = materialId ? state.document.materials[materialId] : undefined;
  if (!material || !materialId) {
    return null;
  }

  return (
    <section className="inspector-section material-panel">
      <div className="section-title-row">
        <h3>Material</h3>
        <span className="type-badge">{material.name}</span>
      </div>
      <label className="color-field">
        <span>Base color</span>
        <input
          aria-label="Material base color"
          onChange={(event) => editorStore.updateMaterial(materialId, { baseColor: event.target.value })}
          type="color"
          value={material.baseColor}
        />
      </label>
      <div className="axis-grid material-number-grid">
        <NumberField
          label="Material roughness"
          step={0.05}
          value={material.roughness}
          onCommit={(roughness) => editorStore.updateMaterial(materialId, { roughness })}
        />
        <NumberField
          label="Material metalness"
          step={0.05}
          value={material.metalness}
          onCommit={(metalness) => editorStore.updateMaterial(materialId, { metalness })}
        />
        <NumberField
          label="Material opacity"
          step={0.05}
          value={material.opacity}
          onCommit={(opacity) => editorStore.updateMaterial(materialId, { opacity })}
        />
      </div>
      <label className="toggle-field material-shading-toggle">
        <input
          aria-label="Flat shading"
          checked={material.flatShading}
          onChange={(event) => editorStore.updateMaterial(materialId, { flatShading: event.target.checked })}
          type="checkbox"
        />
        Flat shading
      </label>
    </section>
  );
}

function TexturePaintPanel({ node }: { node: EditorNode }): JSX.Element | null {
  const state = useEditorState();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  if (node.type !== 'mesh') {
    return null;
  }
  const selectedFace = state.selectedFaceIds.find((selection) => selection.nodeId === node.id);
  const materialId =
    (selectedFace ? node.mesh.faces[selectedFace.faceId]?.materialId : undefined) ??
    Object.values(node.mesh.faces)[0]?.materialId;
  const material = materialId ? state.document.materials[materialId] : undefined;
  const texture = material?.baseColorTextureId
    ? state.document.textures[material.baseColorTextureId]
    : undefined;
  const hasUvs = Object.values(node.mesh.vertices).some((vertex) => vertex.uv);
  const nextTextureId = (): string => {
    let index = 1;
    while (state.document.textures[`texture-${index}`]) {
      index += 1;
    }
    return `texture-${index}`;
  };
  const createBlankTexture = async (): Promise<void> => {
    if (!materialId || !material) {
      return;
    }
    setIsLoading(true);
    try {
      const { createBlankTexturePayload } = await import('../editor/geometry/texture-paint');
      const id = material.baseColorTextureId ?? nextTextureId();
      editorStore.setMaterialTexturePayload(
        materialId,
        createBlankTexturePayload(id, `${material.name} paint`),
      );
    } catch (error) {
      editorStore.setNotice({
        kind: 'error',
        message: `Texture create failed: ${error instanceof Error ? error.message : 'the material was preserved.'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };
  const importTexture = async (file: File): Promise<void> => {
    if (!materialId || !material) {
      return;
    }
    setIsLoading(true);
    try {
      const { createTexturePayloadFromFile } = await import('../editor/geometry/texture-paint');
      const id = material.baseColorTextureId ?? nextTextureId();
      editorStore.setMaterialTexturePayload(materialId, await createTexturePayloadFromFile(id, file));
    } catch (error) {
      editorStore.setNotice({
        kind: 'error',
        message: `Texture import failed: ${error instanceof Error ? error.message : 'the material was preserved.'}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="inspector-section texture-paint-panel">
      <h3>Texture Paint</h3>
      {!material || !materialId ? (
        <p className="texture-warning">This mesh has no paintable material.</p>
      ) : !hasUvs ? (
        <>
          <p className="texture-warning">
            Texture Paint needs UV coordinates. Existing UVs are never overwritten.
          </p>
          <button onClick={() => editorStore.autoUvSelected()} type="button">
            Generate simple Auto UV
          </button>
        </>
      ) : (
        <>
          <p data-testid="texture-paint-status">
            {texture
              ? `Texture · ${texture.name} · ${texture.width}×${texture.height} · sRGB`
              : 'No texture yet'}
          </p>
          <input
            accept="image/*"
            aria-label="Texture image file"
            data-testid="texture-file-input"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) {
                void importTexture(file);
              }
            }}
            ref={inputRef}
            type="file"
          />
          <div className="face-action-row">
            <button disabled={isLoading} onClick={() => void createBlankTexture()} type="button">
              {isLoading ? 'Loading texture…' : texture ? 'New blank layer' : 'Create blank layer'}
            </button>
            <button disabled={isLoading} onClick={() => inputRef.current?.click()} type="button">
              Import local image
            </button>
          </div>
          {texture && (
            <button onClick={() => editorStore.setMaterialTexturePayload(materialId, null)} type="button">
              Clear texture
            </button>
          )}
          <div className="texture-tool-row" aria-label="Texture Paint tool">
            {(['brush', 'eraser', 'eyedropper'] as const).map((tool) => (
              <button
                aria-pressed={state.texturePaintTool === tool}
                className={state.texturePaintTool === tool ? 'is-active' : ''}
                key={tool}
                onClick={() => editorStore.setTexturePaintTool(tool)}
                type="button"
              >
                {tool === 'brush' ? 'Brush' : tool === 'eraser' ? 'Eraser' : 'Eyedropper'}
              </button>
            ))}
          </div>
          <label className="color-field">
            <span>Texture brush color</span>
            <input
              aria-label="Texture brush color"
              onChange={(event) => editorStore.setFacePaintColor(event.target.value)}
              type="color"
              value={state.facePaintColor}
            />
          </label>
          <div className="axis-grid">
            <NumberField
              label="Texture brush size"
              step={1}
              value={state.textureBrushSize}
              onCommit={(value) => editorStore.setTextureBrushSize(value)}
            />
            <NumberField
              label="Texture brush opacity"
              step={0.05}
              value={state.textureBrushOpacity}
              onCommit={(value) => editorStore.setTextureBrushOpacity(value)}
            />
          </div>
          <p className="texture-note">
            In Texture Paint mode, drag on the viewport. Brush wrapping preserves strokes across 0/1 UV seams.
          </p>
        </>
      )}
    </section>
  );
}

function TopologyPanel({ node }: { node: EditorNode }): JSX.Element | null {
  const [duplicateTolerance, setDuplicateTolerance] = useState(0.0001);
  if (node.type !== 'mesh') {
    return null;
  }
  const diagnostics = getMeshTopologyDiagnostics(node.mesh);
  const degenerateFaceIds = getDegenerateFaceIds(node.mesh);
  const components = getMeshConnectedComponents(node.mesh);
  const coincidentVertexGroups = getCoincidentVertexGroups(node.mesh, duplicateTolerance);
  const mergeableDuplicateGroups = getMergeableDuplicateVertexGroups(node.mesh, duplicateTolerance);
  return (
    <section className="inspector-section topology-panel">
      <div className="section-title-row">
        <h3>Topology</h3>
        <span className="type-badge">{diagnostics.edgeCount} edges</span>
      </div>
      <p className={diagnostics.boundaryEdgeIds.length > 0 ? 'has-topology-issue' : ''}>
        Open edges · {diagnostics.boundaryEdgeIds.length}
      </p>
      <p className={diagnostics.nonManifoldEdgeIds.length > 0 ? 'has-topology-issue' : ''}>
        Non-manifold edges · {diagnostics.nonManifoldEdgeIds.length}
      </p>
      <p className={diagnostics.inconsistentFaceIds.length > 0 ? 'has-topology-issue' : ''}>
        Inconsistent normals · {diagnostics.inconsistentFaceIds.length}
      </p>
      <p className={degenerateFaceIds.length > 0 ? 'has-topology-issue' : ''}>
        Degenerate faces · {degenerateFaceIds.length}
      </p>
      <p className={coincidentVertexGroups.length > 0 ? 'has-topology-issue' : ''}>
        Coincident vertex groups · {coincidentVertexGroups.length}
      </p>
      <p className={components.length > 1 ? 'has-topology-issue' : ''}>
        Loose components · {components.length}
      </p>
      {(diagnostics.boundaryEdgeIds.length > 0 ||
        diagnostics.nonManifoldEdgeIds.length > 0 ||
        diagnostics.inconsistentFaceIds.length > 0 ||
        degenerateFaceIds.length > 0 ||
        coincidentVertexGroups.length > 0) && (
        <small>Switch to Edge mode to inspect highlighted topology.</small>
      )}
      <div className="topology-action-row">
        <button onClick={() => editorStore.recalculateNormals(node.id)} type="button">
          Recalculate normals
        </button>
        <button
          disabled={degenerateFaceIds.length === 0}
          onClick={() => editorStore.deleteSelectedDegenerateFaces(node.id)}
          type="button"
        >
          Delete degenerate faces
        </button>
      </div>
      <div className="face-extrude-field">
        <NumberField
          label="Duplicate tolerance"
          step={0.0001}
          value={duplicateTolerance}
          onCommit={setDuplicateTolerance}
        />
        <button
          disabled={mergeableDuplicateGroups.length === 0 || duplicateTolerance < 0}
          onClick={() => editorStore.cleanupDuplicateVertices(node.id, duplicateTolerance)}
          type="button"
        >
          Merge safe duplicates
        </button>
      </div>
      {coincidentVertexGroups.length > mergeableDuplicateGroups.length && (
        <small>Corner attributes differ in some coincident groups, so they are preserved as seams.</small>
      )}
      {diagnostics.inconsistentFaceIds.length > 0 && (
        <button
          onClick={() => {
            editorStore.setMode('face');
            editorStore.selectFaces(
              diagnostics.inconsistentFaceIds.map((faceId) => ({ nodeId: node.id, faceId })),
            );
          }}
          type="button"
        >
          Select inconsistent faces
        </button>
      )}
      {components.length > 1 && (
        <div className="topology-component-list">
          {components.map((component, index) => (
            <div className="topology-component-actions" key={component.id}>
              <button
                onClick={() => {
                  editorStore.setMode('face');
                  editorStore.selectFaces(component.faceIds.map((faceId) => ({ nodeId: node.id, faceId })));
                }}
                type="button"
              >
                Select component {index + 1} · {component.faceIds.length} faces / {component.vertexIds.length}{' '}
                vertices
              </button>
              <button
                onClick={() => {
                  editorStore.setMode('face');
                  editorStore.selectFaces(component.faceIds.map((faceId) => ({ nodeId: node.id, faceId })));
                  editorStore.separateSelectedFaces();
                }}
                type="button"
              >
                Separate component {index + 1}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function GameAssetCheckPanel(): JSX.Element {
  const state = useEditorState();
  const issues = validateDocumentForExport(state.document);
  const checks = [
    { codes: ['geometry-invalid'], label: 'Geometry valid' },
    { codes: ['orientation-unconfirmed'], label: '+Z Forward confirmed' },
    { codes: ['non-unit-scale'], label: 'Scale = 1 / 1 / 1' },
    { codes: ['not-grounded'], label: 'Ground contact' },
    { codes: ['missing-material'], label: 'Materials resolved' },
    { codes: ['missing-shade-pivot'], label: 'shade_pivot' },
  ];
  const quickFixLabel = (code: string, nodeName: string | undefined): string | null => {
    if (code === 'orientation-unconfirmed') {
      return 'Confirm +Z Forward';
    }
    if (code === 'non-unit-scale') {
      return nodeName ? `Apply scale for ${nodeName}` : null;
    }
    if (code === 'not-grounded') {
      return 'Move asset to ground';
    }
    if (code === 'missing-shade-pivot') {
      return 'Add shade_pivot';
    }
    return null;
  };
  return (
    <section className="inspector-section game-asset-check-panel">
      <h3>Game asset check</h3>
      {checks.map((check) => {
        const issue = issues.find((candidate) => check.codes.includes(candidate.code));
        const issueNode = issue?.nodeId ? state.document.nodes[issue.nodeId] : undefined;
        const quickFix = issue ? quickFixLabel(issue.code, issueNode?.name) : null;
        return (
          <div className="game-asset-check-item" key={check.label}>
            <p className={issue ? `validation-${issue.severity}` : 'validation-pass'}>
              {issue ? `! ${check.label}` : `✓ ${check.label}`}
            </p>
            {issue?.nodeId && (
              <button onClick={() => editorStore.selectNodes([issue.nodeId!])} type="button">
                Select related node
              </button>
            )}
            {issue && quickFix && (
              <button
                onClick={() => {
                  if (issue.code === 'orientation-unconfirmed') {
                    editorStore.setForwardConfirmed(true);
                  } else if (issue.code === 'non-unit-scale' && issueNode?.type === 'mesh') {
                    editorStore.applyScale(issueNode.id);
                  } else if (issue.code === 'not-grounded') {
                    editorStore.selectNodes([state.document.rootId]);
                    editorStore.moveSelectedToGround();
                  } else if (issue.code === 'missing-shade-pivot') {
                    editorStore.addPivot('shade_pivot');
                  }
                }}
                type="button"
              >
                {quickFix}
              </button>
            )}
          </div>
        );
      })}
      <p className="validation-info">
        Info · Errors block export; warnings are included in the export notice.
      </p>
    </section>
  );
}

function OutlinerNode({ node, depth }: { node: EditorNode; depth: number }): JSX.Element {
  const state = useEditorState();
  const isSelected = state.selectedNodeIds.includes(node.id);
  const children = getChildren(state.document, node.id);

  return (
    <li>
      <div
        className={`outliner-row ${isSelected ? 'is-selected' : ''}`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
      >
        <button
          aria-label={`Select ${node.name}`}
          className="outliner-name"
          data-testid={`outliner-${node.id}`}
          onClick={(event) => {
            const currentSelection = editorStore.getState().selectedNodeIds;
            if (!event.shiftKey) {
              editorStore.selectNodes([node.id]);
              return;
            }
            editorStore.selectNodes(
              currentSelection.includes(node.id)
                ? currentSelection.filter((selectedNodeId) => selectedNodeId !== node.id)
                : [...currentSelection, node.id],
            );
          }}
          type="button"
        >
          <span aria-hidden="true">{node.type === 'group' ? '◇' : '◆'}</span>
          {node.name}
        </button>
        {node.id !== state.document.rootId && (
          <button
            aria-label={node.hidden ? `Show ${node.name}` : `Hide ${node.name}`}
            className="icon-button"
            onClick={() => editorStore.setNodeHidden(node.id, !node.hidden)}
            type="button"
          >
            {node.hidden ? '○' : '◉'}
          </button>
        )}
      </div>
      {children.length > 0 && (
        <ul className="outliner-tree">
          {children.map((child) => (
            <OutlinerNode depth={depth + 1} key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Outliner({
  onResizeStart,
  width,
}: {
  onResizeStart: (panel: ResizablePanel, event: ReactPointerEvent<HTMLDivElement>) => void;
  width: number;
}): JSX.Element {
  const state = useEditorState();
  const rootNode = state.document.nodes[state.document.rootId];
  const [radialSegments, setRadialSegments] = useState(8);
  const [latitudeSegments, setLatitudeSegments] = useState(8);
  const [icosphereSubdivisions, setIcosphereSubdivisions] = useState(1);
  const addPrimitive = (primitive: PrimitiveKind): void => {
    editorStore.addPrimitive(primitive, {
      radialSegments,
      latitudeSegments,
      subdivisions: icosphereSubdivisions,
    });
  };

  return (
    <aside aria-label="Outliner" className="panel outliner-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SCENE</span>
          <h2>Outliner</h2>
        </div>
        <span className="node-count">{Object.keys(state.document.nodes).length}</span>
      </div>
      <ul className="outliner-tree root-tree">
        <OutlinerNode depth={0} node={rootNode} />
      </ul>
      <div className="primitive-panel">
        <span className="eyebrow">ADD PRIMITIVE</span>
        <div className="primitive-options-grid">
          <NumberField
            label="Primitive radial segments"
            step={1}
            value={radialSegments}
            onCommit={setRadialSegments}
          />
          <NumberField
            label="Primitive latitude segments"
            step={1}
            value={latitudeSegments}
            onCommit={setLatitudeSegments}
          />
          <NumberField
            label="Icosphere subdivisions"
            step={1}
            value={icosphereSubdivisions}
            onCommit={setIcosphereSubdivisions}
          />
        </div>
        <div className="primitive-grid">
          {PRIMITIVES.map(({ kind, label }) => (
            <button key={kind} onClick={() => addPrimitive(kind)} type="button">
              + {label}
            </button>
          ))}
        </div>
        <button className="pivot-add-button" onClick={() => editorStore.addPivot()} type="button">
          + Pivot
        </button>
        <button
          className="pivot-add-button"
          onClick={() => editorStore.addPivot('shade_pivot')}
          type="button"
        >
          + shade_pivot
        </button>
      </div>
      <PanelResizeHandle onResizeStart={onResizeStart} panel="outliner" value={width} />
    </aside>
  );
}

function BooleanPanel(): JSX.Element {
  const state = useEditorState();
  const [operation, setOperation] = useState<BooleanOperation>('difference');
  const [isCalculating, setIsCalculating] = useState(false);
  const [subjectNodeId, cutterNodeId] = state.selectedNodeIds;
  const subject = subjectNodeId ? state.document.nodes[subjectNodeId] : undefined;
  const cutter = cutterNodeId ? state.document.nodes[cutterNodeId] : undefined;
  const preview = state.booleanPreview;
  const previewMatchesSelection =
    preview?.subjectNodeId === subjectNodeId && preview.cutterNodeId === cutterNodeId;
  const operationLabel =
    operation === 'difference' ? 'Difference' : operation === 'intersection' ? 'Intersection' : 'Union';

  const createPreview = async (): Promise<void> => {
    if (!subjectNodeId || !cutterNodeId || state.activeTransaction) {
      return;
    }
    const revision = state.document.revision;
    setIsCalculating(true);
    try {
      const { runNodeBooleanSpike } = await import('../editor/geometry/boolean-spike');
      const result = await runNodeBooleanSpike(state.document, operation, subjectNodeId, cutterNodeId);
      const latest = editorStore.getState();
      if (
        latest.document.revision !== revision ||
        latest.selectedNodeIds[0] !== subjectNodeId ||
        latest.selectedNodeIds[1] !== cutterNodeId
      ) {
        return;
      }
      editorStore.setBooleanPreview({
        cutterNodeId,
        elapsedMs: result.elapsedMs,
        mesh: result.mesh,
        operation,
        subjectNodeId,
        triangleCount: result.triangleCount,
      });
    } catch (error) {
      editorStore.setNotice({
        kind: 'error',
        message: `Boolean preview failed: ${error instanceof Error ? error.message : 'the source geometry was preserved.'}`,
      });
    } finally {
      setIsCalculating(false);
    }
  };

  return (
    <section className="inspector-section boolean-panel">
      <h3>Boolean</h3>
      <p>
        Subject: <strong>{subject?.name ?? '—'}</strong> · Cutter: <strong>{cutter?.name ?? '—'}</strong>
      </p>
      <label className="name-field">
        <span>Operation</span>
        <select
          aria-label="Boolean operation"
          disabled={isCalculating || Boolean(previewMatchesSelection)}
          onChange={(event) => setOperation(event.target.value as BooleanOperation)}
          value={operation}
        >
          <option value="difference">Difference (subject − cutter)</option>
          <option value="union">Union</option>
          <option value="intersection">Intersection</option>
        </select>
      </label>
      {previewMatchesSelection ? (
        <>
          <p className="boolean-preview-info" data-testid="boolean-preview-status">
            {preview.triangleCount} triangles · {preview.elapsedMs.toFixed(1)} ms · source objects are
            unchanged
          </p>
          <div className="face-action-row">
            <button onClick={() => editorStore.commitBooleanPreview()} type="button">
              Commit {preview.operation}
            </button>
            <button onClick={() => editorStore.clearBooleanPreview()} type="button">
              Cancel Boolean preview
            </button>
          </div>
        </>
      ) : (
        <button
          disabled={isCalculating || state.activeTransaction !== null}
          onClick={() => void createPreview()}
          type="button"
        >
          {isCalculating ? `Calculating ${operationLabel}…` : `Preview ${operationLabel}`}
        </button>
      )}
      <p className="boolean-note">
        Select subject first and cutter second. Both inputs must be closed manifolds; Live Mirror must be
        baked first.
      </p>
    </section>
  );
}

function Inspector({
  onResizeStart,
  width,
}: {
  onResizeStart: (panel: ResizablePanel, event: ReactPointerEvent<HTMLDivElement>) => void;
  width: number;
}): JSX.Element {
  const state = useEditorState();
  const selectedNode =
    state.selectedNodeIds.length === 1 ? state.document.nodes[state.selectedNodeIds[0]] : undefined;

  if (state.selectedNodeIds.length > 1) {
    return (
      <aside aria-label="Inspector" className="panel inspector-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">PROPERTIES</span>
            <h2>Inspector</h2>
          </div>
        </div>
        <div className="empty-panel">
          <span className="empty-icon">◎</span>
          <p>{state.selectedNodeIds.length} objects selected.</p>
          <p>
            Size and object-scale bake are edited one mesh at a time. Use the transform gizmo for a shared
            transform.
          </p>
          {state.selectedNodeIds.length === 2 ? <BooleanPanel /> : null}
        </div>
        <PanelResizeHandle onResizeStart={onResizeStart} panel="inspector" value={width} />
      </aside>
    );
  }

  if (!selectedNode) {
    return (
      <aside aria-label="Inspector" className="panel inspector-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">PROPERTIES</span>
            <h2>Inspector</h2>
          </div>
        </div>
        <div className="empty-panel">
          <span className="empty-icon">◎</span>
          <p>Select an object in the viewport or Outliner.</p>
        </div>
        <PanelResizeHandle onResizeStart={onResizeStart} panel="inspector" value={width} />
      </aside>
    );
  }

  const eligibleParents = Object.values(state.document.nodes).filter(
    (node) =>
      node.type === 'group' &&
      node.id !== selectedNode.id &&
      !isDescendantOf(state.document, node.id, selectedNode.id),
  );

  return (
    <aside aria-label="Inspector" className="panel inspector-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PROPERTIES</span>
          <h2>Inspector</h2>
        </div>
        <span className="type-badge">{selectedNode.type}</span>
      </div>
      <section className="inspector-section">
        <label className="name-field">
          <span>Name</span>
          <input
            aria-label="Object name"
            defaultValue={selectedNode.name}
            key={`${selectedNode.id}-${selectedNode.name}`}
            onBlur={(event) => editorStore.renameNode(selectedNode.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                event.currentTarget.value = selectedNode.name;
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        {selectedNode.id !== state.document.rootId && (
          <label className="name-field parent-field">
            <span>Parent</span>
            <select
              aria-label="Parent object"
              onChange={(event) => editorStore.setNodeParent(selectedNode.id, event.target.value)}
              value={selectedNode.parentId ?? state.document.rootId}
            >
              {eligibleParents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      <TransformFields node={selectedNode} />
      <OrientationCorrectionPanel node={selectedNode} />
      <PivotRotationControls node={selectedNode} />
      <VertexSelectionPanel node={selectedNode} />
      <EdgeSelectionPanel node={selectedNode} />
      <BendPanel node={selectedNode} />
      <MirrorPanel
        key={`${selectedNode.id}:${selectedNode.type === 'mesh' ? JSON.stringify(selectedNode.mirrorModifier) : ''}`}
        node={selectedNode}
      />
      <FaceSelectionPanel node={selectedNode} />
      <VertexPositionFields />
      <SelectionTransformPanel node={selectedNode} />
      <GeometrySizeFields node={selectedNode} />
      <MaterialPanel node={selectedNode} />
      <TexturePaintPanel node={selectedNode} />
      <TopologyPanel node={selectedNode} />
      <GameAssetCheckPanel />
      <section className="inspector-section ground-section">
        <h3>Ground</h3>
        <label className="toggle-field">
          <input
            aria-label="Show ground plane"
            checked={state.groundVisible}
            onChange={(event) => editorStore.setGroundVisible(event.target.checked)}
            type="checkbox"
          />
          Show ground plane
        </label>
        <label className="toggle-field shadow-preview-toggle">
          <input
            aria-label="Shadow Preview"
            checked={state.shadowPreview}
            onChange={(event) => editorStore.setShadowPreview(event.target.checked)}
            type="checkbox"
          />
          Shadow Preview
        </label>
        <div className="ground-settings-grid">
          <NumberField
            key={`ground-reference-${state.document.metadata.groundReferenceY}`}
            label="Ground reference Y"
            step={0.1}
            value={state.document.metadata.groundReferenceY}
            onCommit={(value) => editorStore.setGroundReference(value)}
          />
          <NumberField
            key={`ground-tolerance-${state.document.metadata.groundContactTolerance}`}
            label="Ground contact tolerance"
            step={0.001}
            value={state.document.metadata.groundContactTolerance}
            onCommit={(value) => editorStore.setGroundContactTolerance(value)}
          />
        </div>
        <button onClick={() => editorStore.setGroundReferenceFromSelected()} type="button">
          Set selected bottom as ground reference
        </button>
        <button onClick={() => editorStore.moveSelectedToGround()} type="button">
          Move selection to ground
        </button>
      </section>
      <section className="inspector-section action-section">
        <h3>Object</h3>
        <button
          disabled={selectedNode.id === state.document.rootId}
          onClick={() => editorStore.deleteSelected()}
          type="button"
        >
          Delete selected
        </button>
        {selectedNode.id !== state.document.rootId && (
          <button
            disabled={selectedNode.parentId === state.document.rootId}
            onClick={() => editorStore.setNodeParent(selectedNode.id, state.document.rootId)}
            type="button"
          >
            Unparent to asset root
          </button>
        )}
      </section>
      <PanelResizeHandle onResizeStart={onResizeStart} panel="inspector" value={width} />
    </aside>
  );
}

function StatusBar(): JSX.Element {
  const state = useEditorState();
  const selectedCount = state.selectedNodeIds.length;
  const selectedVertexCount = state.selectedVertexIds.length;
  const selectedFaceCount = state.selectedFaceIds.length;
  const selectedEdgeCount = state.selectedEdgeIds.length;
  const validationIssue = validateDocumentForExport(state.document)[0];

  return (
    <footer className="status-bar" data-testid="status-bar">
      <div>
        <span className="status-dot good" /> Local-only editor runtime
        {state.notice && <span role="status">{state.notice.message}</span>}
        {!state.notice && validationIssue && <span>{validationIssue.message}</span>}
      </div>
      <div>
        <span>{state.mode.toUpperCase()} MODE</span>
        <span>
          {state.mode === 'vertex'
            ? selectedVertexCount === 0
              ? 'No vertices selected'
              : `${selectedVertexCount} ${selectedVertexCount === 1 ? 'vertex' : 'vertices'} selected`
            : state.mode === 'face' || state.mode === 'face-color'
              ? selectedFaceCount === 0
                ? 'No faces selected'
                : `${selectedFaceCount} face${selectedFaceCount === 1 ? '' : 's'} selected`
              : state.mode === 'edge'
                ? selectedEdgeCount === 0
                  ? 'No edges selected'
                  : `${selectedEdgeCount} edge${selectedEdgeCount === 1 ? '' : 's'} selected`
                : selectedCount === 0
                  ? 'No selection'
                  : `${selectedCount} selected`}
        </span>
        <span data-testid="history-status">
          Undo {state.history.past.length} · Redo {state.history.future.length}
        </span>
        <span data-testid="dirty-status">{state.dirty ? 'Unsaved changes' : 'Saved state'}</span>
      </div>
    </footer>
  );
}

function AppHeader({
  isOpening,
  onOpenGlb,
  onOpenProject,
}: {
  isOpening: boolean;
  onOpenGlb: (file: File) => void;
  onOpenProject: (file: File) => void;
}): JSX.Element {
  const state = useEditorState();
  const glbFileInputRef = useRef<HTMLInputElement>(null);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const meshCount = Object.values(state.document.nodes).filter((node) => node.type === 'mesh').length;

  const confirmNewDocument = (): void => {
    if (!state.dirty || window.confirm('Discard the current local edits and create a new asset?')) {
      editorStore.newDocument();
    }
  };

  const requestOpen = (): void => {
    glbFileInputRef.current?.click();
  };

  const requestOpenProject = (): void => {
    projectFileInputRef.current?.click();
  };

  const selectGlb = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }
    onOpenGlb(file);
  };

  const selectProject = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }
    onOpenProject(file);
  };

  const saveProject = async (): Promise<void> => {
    setIsSavingProject(true);
    try {
      const { downloadShadeAsset, serializeShadeAsset } = await import('../editor/io/shadeasset');
      const rawName = state.document.nodes[state.document.rootId]?.name || 'low-poly-asset';
      const safeName = rawName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'low-poly-asset';
      downloadShadeAsset(`${safeName}.shadeasset`, serializeShadeAsset(state.document, state));
      editorStore.markSaved();
      editorStore.setNotice({ kind: 'info', message: `Saved ${safeName}.shadeasset.` });
    } catch (error) {
      editorStore.setNotice({
        kind: 'error',
        message: `Project save failed: ${error instanceof Error ? error.message : 'the project could not be saved.'}`,
      });
    } finally {
      setIsSavingProject(false);
    }
  };

  const exportCurrentGlb = async (): Promise<void> => {
    setIsExporting(true);
    try {
      const validationIssues = validateDocumentForExport(state.document);
      const blockingIssue = validationIssues.find((issue) => issue.severity === 'error');
      const warningIssue = validationIssues.find((issue) => issue.severity === 'warning');
      if (blockingIssue) {
        editorStore.setNotice({ kind: 'error', message: `Export blocked: ${blockingIssue.message}` });
        return;
      }
      if (
        warningIssue &&
        !window.confirm(
          `Export with warning?\n\n${warningIssue.message}\n\nChoose OK to export or Cancel to return to the editor.`,
        )
      ) {
        editorStore.setNotice({ kind: 'info', message: 'Export cancelled so the warning can be resolved.' });
        return;
      }
      const { downloadGlb, exportGlb } = await import('../editor/io/gltf');
      const exported = await exportGlb(state.document);
      const rawName = state.document.nodes[state.document.rootId]?.name || 'low-poly-asset';
      const safeName = rawName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'low-poly-asset';
      downloadGlb(`${safeName}.glb`, exported.arrayBuffer);
      editorStore.setNotice({
        kind: 'info',
        message: `Exported ${safeName}.glb.${exported.hiddenNodeCount ? ` ${exported.hiddenNodeCount} hidden node(s) omitted.` : ''}${warningIssue ? ` ${warningIssue.message}` : ''}`,
      });
    } catch (error) {
      editorStore.setNotice({
        kind: 'error',
        message: `Export failed: ${error instanceof Error ? error.message : 'the asset could not be exported.'}`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <header className="app-header">
      <div className="brand">
        <span aria-hidden="true" className="brand-mark">
          ◒
        </span>
        <div>
          <strong>Low-Poly Asset Editor</strong>
          <span>GAME ASSET WORKBENCH</span>
        </div>
      </div>
      <nav aria-label="Editor commands" className="command-bar">
        <button onClick={confirmNewDocument} type="button">
          File / New
        </button>
        <input
          accept=".glb,model/gltf-binary"
          aria-label="GLB file to open"
          data-testid="open-glb-input"
          hidden
          onChange={selectGlb}
          ref={glbFileInputRef}
          type="file"
        />
        <button disabled={isOpening} onClick={requestOpen} type="button">
          {isOpening ? 'Opening…' : 'Open GLB'}
        </button>
        <input
          accept=".shadeasset,application/vnd.lowpoly-modeler.shadeasset+json,application/json"
          aria-label="Project file to open"
          data-testid="open-shadeasset-input"
          hidden
          onChange={selectProject}
          ref={projectFileInputRef}
          type="file"
        />
        <button disabled={isOpening} onClick={requestOpenProject} type="button">
          {isOpening ? 'Opening…' : 'Open Project'}
        </button>
        <button disabled={isSavingProject} onClick={() => void saveProject()} type="button">
          {isSavingProject ? 'Saving…' : 'Save Project'}
        </button>
        <button disabled={meshCount === 0 || isExporting} onClick={exportCurrentGlb} type="button">
          {isExporting ? 'Exporting…' : 'Export GLB'}
        </button>
        <span className="command-divider" />
        <button
          className="accent-button"
          data-testid="add-cube"
          onClick={() => editorStore.addPrimitive('cube')}
          type="button"
        >
          + Cube
        </button>
        <button disabled={!state.history.past.length} onClick={() => editorStore.undo()} type="button">
          Undo
        </button>
        <button disabled={!state.history.future.length} onClick={() => editorStore.redo()} type="button">
          Redo
        </button>
      </nav>
      <div className="phase-chip">Foundation · active</div>
    </header>
  );
}

function ModeToolbar(): JSX.Element {
  const state = useEditorState();

  return (
    <div className="mode-toolbar" aria-label="Modeling mode">
      <span className="eyebrow">MODE</span>
      {MODES.map(({ id, label, available }) => (
        <button
          className={state.mode === id ? 'is-active' : ''}
          disabled={!available}
          key={id}
          onClick={() => editorStore.setMode(id)}
          title={available ? `${label} mode` : `${label} mode is planned for a later phase`}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TransformToolbar(): JSX.Element {
  const state = useEditorState();
  const tools = [
    { id: 'translate', label: 'Move' },
    { id: 'rotate', label: 'Rotate' },
    { id: 'scale', label: 'Scale' },
  ] as const;

  return (
    <div aria-label="Transform tool" className="transform-toolbar">
      {tools.map(({ id, label }) => (
        <button
          aria-pressed={state.transformTool === id}
          className={state.transformTool === id ? 'is-active' : ''}
          data-testid={`transform-${id}`}
          key={id}
          onClick={() => editorStore.setTransformTool(id)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function App(): JSX.Element {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      const withModifier = event.ctrlKey || event.metaKey;
      if (withModifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          editorStore.redo();
        } else {
          editorStore.undo();
        }
      }
      if (withModifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        editorStore.redo();
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (editorStore.getState().mode === 'vertex') {
          editorStore.deleteSelectedVertices();
        } else if (editorStore.getState().mode === 'edge') {
          editorStore.deleteSelectedEdges();
        } else if (editorStore.getState().mode === 'face') {
          editorStore.deleteSelectedFaces();
        } else if (editorStore.getState().mode === 'face-color') {
          return;
        } else {
          editorStore.deleteSelected();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const state = useEditorState();
  const [isOpening, setIsOpening] = useState(false);
  const [outlinerWidth, setOutlinerWidth] = useState(() =>
    Math.max(208, Math.round(window.innerWidth * 0.16)),
  );
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    Math.max(254, Math.round(window.innerWidth * 0.2)),
  );
  const selectedName = useMemo(
    () => state.document.nodes[state.selectedNodeIds[0]]?.name,
    [state.document, state.selectedNodeIds],
  );
  const beginPanelResize = (panel: ResizablePanel, event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel === 'outliner' ? outlinerWidth : inspectorWidth;
    const minimum = panel === 'outliner' ? 208 : 254;
    const setWidth = panel === 'outliner' ? setOutlinerWidth : setInspectorWidth;
    const direction = panel === 'outliner' ? 1 : -1;
    const handlePointerMove = (moveEvent: PointerEvent): void => {
      setWidth(Math.min(480, Math.max(minimum, startWidth + (moveEvent.clientX - startX) * direction)));
    };
    const handlePointerUp = (): void => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  const openGlbFile = async (file: File): Promise<void> => {
    if (!file.name.toLowerCase().endsWith('.glb')) {
      editorStore.setNotice({ kind: 'error', message: 'Open failed: select a binary .glb file.' });
      return;
    }
    if (state.dirty && !window.confirm('Discard the current local edits and open this GLB?')) {
      return;
    }
    setIsOpening(true);
    try {
      const { importGlb } = await import('../editor/io/gltf');
      const imported = await importGlb(await file.arrayBuffer());
      const firstMesh = Object.values(imported.document.nodes).find((node) => node.type === 'mesh');
      editorStore.replaceDocument(imported.document, firstMesh ? [firstMesh.id] : []);
      const warning = imported.warnings.length > 0 ? ` ${imported.warnings[0]}` : '';
      editorStore.setNotice({
        kind: 'info',
        message: `Opened ${file.name} with ${Object.keys(imported.document.nodes).length - 1} node(s).${warning}`,
      });
    } catch (error) {
      editorStore.setNotice({
        kind: 'error',
        message: `Open failed: ${error instanceof Error ? error.message : 'the file could not be read.'}`,
      });
    } finally {
      setIsOpening(false);
    }
  };

  const openProjectFile = async (file: File): Promise<void> => {
    if (!file.name.toLowerCase().endsWith('.shadeasset')) {
      editorStore.setNotice({ kind: 'error', message: 'Project open failed: select a .shadeasset file.' });
      return;
    }
    if (state.dirty && !window.confirm('Discard the current local edits and open this project?')) {
      return;
    }
    setIsOpening(true);
    try {
      const { parseShadeAsset } = await import('../editor/io/shadeasset');
      const project = parseShadeAsset(await file.text());
      editorStore.replaceProject(project.document, project.editor);
      editorStore.setNotice({
        kind: 'info',
        message: `Opened project ${file.name} with ${Object.keys(project.document.nodes).length - 1} node(s).`,
      });
    } catch (error) {
      editorStore.setNotice({
        kind: 'error',
        message: `Project open failed: ${error instanceof Error ? error.message : 'the file could not be read.'}`,
      });
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <main
      className="app-shell"
      style={
        {
          '--inspector-width': `${inspectorWidth}px`,
          '--outliner-width': `${outlinerWidth}px`,
        } as CSSProperties
      }
    >
      <AppHeader
        isOpening={isOpening}
        onOpenGlb={(file) => void openGlbFile(file)}
        onOpenProject={(file) => void openProjectFile(file)}
      />
      <ModeToolbar />
      <Outliner onResizeStart={beginPanelResize} width={outlinerWidth} />
      <section className="workspace" aria-label="3D workspace">
        <Suspense fallback={<div className="viewport-loading">Loading 3D viewport…</div>}>
          <Viewport
            groundReferenceY={state.document.metadata.groundReferenceY}
            groundVisible={state.groundVisible}
            mode={state.mode}
            onOpenGlb={(file) => void openGlbFile(file)}
            booleanPreview={state.booleanPreview}
            pivotPreview={state.pivotPreview}
            shadowPreview={state.shadowPreview}
          />
        </Suspense>
        <TransformToolbar />
        <div className="workspace-readout">
          <span>{selectedName ? `Selected: ${selectedName}` : 'No object selected'}</span>
          <span>Transform gizmo: {state.transformTool}</span>
        </div>
      </section>
      <Inspector onResizeStart={beginPanelResize} width={inspectorWidth} />
      <StatusBar />
    </main>
  );
}
