import { useEffect, useRef, useState, type DragEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  createRuntimeMesh,
  disposeRuntimeMaterials,
  type RuntimeMaterial,
  type RuntimeMesh,
} from '../editor/geometry/three-bridge';
import { editorStore } from '../editor/core/store';
import type {
  EditorNode,
  EditorMode,
  BooleanPreview,
  EdgeSelection,
  FaceSelection,
  MeshNode,
  NodeId,
  SceneDocument,
  Transform,
  TransformTool,
  VertexSelection,
} from '../editor/core/types';
import { useEditorState } from '../editor/core/use-editor-state';
import { getMeshEdges, getMeshTopologyDiagnostics } from '../editor/geometry/topology';

function setSelectionEmission(material: RuntimeMaterial | RuntimeMaterial[], selected: boolean): void {
  (Array.isArray(material) ? material : [material]).forEach((entry) => {
    entry.emissive.set(selected ? '#123724' : '#000000');
  });
}

function applyTransform(object: THREE.Object3D, transform: Transform): void {
  object.position.set(transform.position.x, transform.position.y, transform.position.z);
  object.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
}

function readTransform(object: THREE.Object3D): Transform {
  return {
    position: { x: object.position.x, y: object.position.y, z: object.position.z },
    rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
    scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
  };
}

function isMeshNode(node: EditorNode): node is MeshNode {
  return node.type === 'mesh';
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface ScreenRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

function pointIsInsideRect(point: ScreenPoint, rect: ScreenRect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function isBoxSelectableMode(mode: EditorMode): boolean {
  return mode === 'object' || mode === 'vertex' || mode === 'edge' || mode === 'face';
}

function createEdgeGeometry(node: MeshNode, selectedEdgeIds: Set<string>): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const edgeIds: string[] = [];
  const selectedColor = new THREE.Color('#ffd166');
  const unselectedColor = new THREE.Color('#74ddb0');
  const boundaryColor = new THREE.Color('#ff7a6e');
  const nonManifoldColor = new THREE.Color('#f09cff');
  const diagnostics = getMeshTopologyDiagnostics(node.mesh);
  const boundaryEdgeIds = new Set(diagnostics.boundaryEdgeIds);
  const nonManifoldEdgeIds = new Set(diagnostics.nonManifoldEdgeIds);
  getMeshEdges(node.mesh).forEach((edge) => {
    const first = node.mesh.vertices[edge.vertexAId]?.position;
    const second = node.mesh.vertices[edge.vertexBId]?.position;
    if (!first || !second) {
      return;
    }
    const color = selectedEdgeIds.has(edge.id)
      ? selectedColor
      : nonManifoldEdgeIds.has(edge.id)
        ? nonManifoldColor
        : boundaryEdgeIds.has(edge.id)
          ? boundaryColor
          : unselectedColor;
    positions.push(first.x, first.y, first.z, second.x, second.y, second.z);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    edgeIds.push(edge.id);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.userData.edgeIds = edgeIds;
  return geometry;
}

class ViewportRuntime {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly orbit: OrbitControls;
  private readonly transformControls: TransformControls;
  private readonly grid: THREE.GridHelper;
  private readonly ground: THREE.Mesh;
  private readonly axes: THREE.AxesHelper;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly meshes = new Map<NodeId, RuntimeMesh>();
  private readonly nodeObjects = new Map<NodeId, THREE.Object3D>();
  private readonly vertexPoints = new Map<NodeId, THREE.Points>();
  private readonly edgeLines = new Map<NodeId, THREE.LineSegments>();
  private readonly selectionBox = new THREE.BoxHelper(new THREE.Group(), 0xa8f3ce);
  private readonly selectionMarquee: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver;
  private boxSelectionStart: ScreenPoint | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private transformStart: Transform | null = null;
  private activeTransformNodeId: NodeId | null = null;
  private isTransformDragging = false;
  private textureStroke: {
    materialId: string;
    nodeId: NodeId;
    points: Array<{ u: number; v: number }>;
  } | null = null;

  constructor(private readonly container: HTMLDivElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'viewport-canvas';
    this.renderer.domElement.setAttribute('aria-label', '3D asset viewport');
    this.renderer.domElement.tabIndex = 0;
    this.container.appendChild(this.renderer.domElement);
    this.selectionMarquee = document.createElement('div');
    this.selectionMarquee.className = 'viewport-selection-marquee';
    this.selectionMarquee.hidden = true;
    this.container.appendChild(this.selectionMarquee);
    this.raycaster.params.Points.threshold = 0.1;
    this.raycaster.params.Line.threshold = 0.08;

    this.scene.background = new THREE.Color('#111a20');
    this.camera.position.set(4.5, 3.3, 5.5);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.5, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxDistance = 30;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setSpace('world');
    this.scene.add(this.transformControls.getHelper());
    this.transformControls.addEventListener('dragging-changed', (event) => {
      const isDragging = (event as { value: boolean }).value;
      this.isTransformDragging = isDragging;
      this.orbit.enabled = !isDragging;
    });
    this.transformControls.addEventListener('mouseDown', () => {
      const object = this.transformControls.object;
      const nodeId = object?.userData.editorNodeId as NodeId | undefined;
      if (object && nodeId) {
        this.activeTransformNodeId = nodeId;
        this.transformStart = readTransform(object);
        editorStore.beginTransaction('Transform object');
      }
    });
    this.transformControls.addEventListener('mouseUp', () => {
      const object = this.transformControls.object;
      if (object && this.activeTransformNodeId && this.transformStart) {
        editorStore.setTransform(this.activeTransformNodeId, readTransform(object));
      }
      editorStore.commitTransaction();
      this.activeTransformNodeId = null;
      this.transformStart = null;
    });

    this.grid = new THREE.GridHelper(20, 20, 0x32505b, 0x1d3037);
    this.grid.position.y = 0;
    this.scene.add(this.grid);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ color: '#000000', opacity: 0.24 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.axes = new THREE.AxesHelper(1.25);
    this.scene.add(this.axes);

    this.hemisphere = new THREE.HemisphereLight('#d9efff', '#20352b', 1.6);
    this.scene.add(this.hemisphere);

    this.keyLight = new THREE.DirectionalLight('#fff1d6', 2.4);
    this.keyLight.position.set(4, 7, 4);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.left = -8;
    this.keyLight.shadow.camera.right = 8;
    this.keyLight.shadow.camera.top = 8;
    this.keyLight.shadow.camera.bottom = -8;
    this.scene.add(this.keyLight);

    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove, true);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp, true);
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel, true);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  sync(
    document: SceneDocument,
    selectedNodeIds: NodeId[],
    selectedVertexIds: VertexSelection[],
    selectedFaceIds: FaceSelection[],
    selectedEdgeIds: EdgeSelection[],
    transformTool: TransformTool,
    mode: EditorMode,
    groundVisible: boolean,
    groundReferenceY: number,
    shadowPreview: boolean,
    pivotPreview: { nodeId: NodeId; rotationY: number } | null,
    booleanPreview: BooleanPreview | null,
  ): void {
    this.ground.visible = groundVisible || shadowPreview;
    this.ground.position.y = groundReferenceY;
    this.grid.visible = !shadowPreview;
    this.grid.position.y = groundReferenceY;
    this.axes.visible = !shadowPreview;
    this.hemisphere.intensity = shadowPreview ? 0.65 : 1.6;
    this.keyLight.intensity = shadowPreview ? 3.2 : 2.4;
    (this.ground.material as THREE.ShadowMaterial).opacity = shadowPreview ? 0.42 : 0.24;
    this.scene.background = new THREE.Color(shadowPreview ? '#081116' : '#111a20');
    this.transformControls.setMode(transformTool);
    this.transformControls.setSpace(mode === 'pivot' ? 'local' : 'world');
    const expectedNodeIds = new Set(Object.keys(document.nodes));

    for (const [nodeId, object] of this.nodeObjects) {
      if (!expectedNodeIds.has(nodeId)) {
        object.parent?.remove(object);
        const mesh = this.meshes.get(nodeId);
        if (mesh) {
          const points = this.vertexPoints.get(nodeId);
          if (points) {
            mesh.remove(points);
            (points.material as THREE.PointsMaterial).dispose();
            this.vertexPoints.delete(nodeId);
          }
          const lines = this.edgeLines.get(nodeId);
          if (lines) {
            mesh.remove(lines);
            lines.geometry.dispose();
            (lines.material as THREE.LineBasicMaterial).dispose();
            this.edgeLines.delete(nodeId);
          }
          mesh.geometry.dispose();
          disposeRuntimeMaterials(mesh.material);
          this.meshes.delete(nodeId);
        }
        this.nodeObjects.delete(nodeId);
      }
    }

    for (const node of Object.values(document.nodes)) {
      if (!isMeshNode(node)) {
        if (!this.nodeObjects.has(node.id)) {
          const group = new THREE.Group();
          group.userData.editorNodeId = node.id;
          this.nodeObjects.set(node.id, group);
        }
        continue;
      }

      let mesh = this.meshes.get(node.id);
      const isBooleanPreviewSubject = booleanPreview?.subjectNodeId === node.id;
      const isBooleanPreviewCutter = booleanPreview?.cutterNodeId === node.id;
      const renderNode = isBooleanPreviewSubject
        ? { ...node, mesh: booleanPreview.mesh, mirrorModifier: undefined }
        : node;
      const mirrorModifierKey = renderNode.mirrorModifier
        ? `${renderNode.mirrorModifier.axis}:${renderNode.mirrorModifier.seamTolerance}`
        : null;
      const booleanPreviewKey = isBooleanPreviewSubject
        ? `${booleanPreview.documentRevision}:${booleanPreview.operation}:${booleanPreview.triangleCount}`
        : null;
      if (!mesh) {
        mesh = createRuntimeMesh(renderNode, document);
        this.meshes.set(node.id, mesh);
        this.nodeObjects.set(node.id, mesh);
      } else if (
        mesh.userData.sourceMeshData !== renderNode.mesh ||
        mesh.userData.mirrorModifierKey !== mirrorModifierKey ||
        mesh.userData.booleanPreviewKey !== booleanPreviewKey ||
        mesh.userData.documentMaterials !== document.materials
      ) {
        const replacement = createRuntimeMesh(renderNode, document);
        mesh.geometry.dispose();
        disposeRuntimeMaterials(mesh.material);
        mesh.geometry = replacement.geometry;
        mesh.material = replacement.material;
        mesh.userData.meshData = replacement.userData.meshData;
        mesh.userData.sourceMeshData = replacement.userData.sourceMeshData;
        mesh.userData.mirrorModifierKey = replacement.userData.mirrorModifierKey;
      }
      mesh.userData.booleanPreviewKey = booleanPreviewKey;
      mesh.userData.documentMaterials = document.materials;
      mesh.name = node.name;
      mesh.visible = !node.hidden && !isBooleanPreviewCutter;
      applyTransform(
        mesh,
        pivotPreview?.nodeId === node.id
          ? { ...node.transform, rotation: { ...node.transform.rotation, y: pivotPreview.rotationY } }
          : node.transform,
      );

      const isSelected =
        selectedNodeIds.includes(node.id) ||
        selectedFaceIds.some((selection) => selection.nodeId === node.id);
      setSelectionEmission(mesh.material, isSelected);

      let points = this.vertexPoints.get(node.id);
      if (!points) {
        points = new THREE.Points(
          mesh.geometry,
          new THREE.PointsMaterial({
            color: '#8eeeb2',
            depthTest: false,
            size: 7,
            sizeAttenuation: false,
          }),
        );
        points.renderOrder = 5;
        points.userData.editorNodeId = node.id;
        mesh.add(points);
        this.vertexPoints.set(node.id, points);
      }
      if (points.geometry !== mesh.geometry) {
        points.geometry = mesh.geometry;
      }
      points.userData.vertexIds = Object.keys(renderNode.mesh.vertices);
      points.visible = mode === 'vertex' && !node.hidden && !node.mirrorModifier && !booleanPreview;
      (points.material as THREE.PointsMaterial).color.set(
        selectedVertexIds.some((selection) => selection.nodeId === node.id) ? '#ffd166' : '#8eeeb2',
      );

      const nodeSelectedEdgeIds = new Set(
        selectedEdgeIds
          .filter((selection) => selection.nodeId === node.id)
          .map((selection) => selection.edgeId),
      );
      const edgeSelectionKey = [...nodeSelectedEdgeIds].sort().join(',');
      let lines = this.edgeLines.get(node.id);
      if (!lines) {
        lines = new THREE.LineSegments(
          createEdgeGeometry(node, nodeSelectedEdgeIds),
          new THREE.LineBasicMaterial({
            color: '#ffffff',
            depthTest: false,
            transparent: true,
            opacity: 0.92,
            vertexColors: true,
          }),
        );
        lines.renderOrder = 4;
        lines.userData.editorNodeId = node.id;
        mesh.add(lines);
        this.edgeLines.set(node.id, lines);
      } else if (
        lines.userData.meshData !== node.mesh ||
        lines.userData.edgeSelectionKey !== edgeSelectionKey
      ) {
        lines.geometry.dispose();
        lines.geometry = createEdgeGeometry(node, nodeSelectedEdgeIds);
      }
      lines.userData.meshData = node.mesh;
      lines.userData.edgeSelectionKey = edgeSelectionKey;
      lines.userData.edgeIds = lines.geometry.userData.edgeIds;
      lines.visible = mode === 'edge' && !node.hidden && !node.mirrorModifier && !booleanPreview;
    }

    for (const node of Object.values(document.nodes)) {
      const object = this.nodeObjects.get(node.id);
      const parent = node.parentId ? this.nodeObjects.get(node.parentId) : this.scene;
      if (!object || !parent) {
        continue;
      }
      if (object.parent !== parent) {
        parent.add(object);
      }
      object.name = node.name;
      object.visible = !node.hidden && node.id !== booleanPreview?.cutterNodeId;
      applyTransform(
        object,
        pivotPreview?.nodeId === node.id
          ? { ...node.transform, rotation: { ...node.transform.rotation, y: pivotPreview.rotationY } }
          : node.transform,
      );
    }

    const selectedObject =
      mode === 'vertex' ||
      mode === 'edge' ||
      mode === 'face' ||
      mode === 'face-color' ||
      mode === 'texture-paint' ||
      booleanPreview ||
      selectedNodeIds.length !== 1
        ? undefined
        : this.nodeObjects.get(selectedNodeIds[0]);
    if (selectedObject) {
      this.transformControls.attach(selectedObject);
      this.selectionBox.setFromObject(selectedObject);
      this.selectionBox.visible = true;
    } else {
      this.transformControls.detach();
      this.selectionBox.visible = false;
    }
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove, true);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp, true);
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerCancel, true);
    this.orbit.dispose();
    this.transformControls.dispose();
    this.selectionBox.dispose();
    for (const mesh of this.meshes.values()) {
      const points = this.vertexPoints.get(mesh.userData.editorNodeId as NodeId);
      if (points) {
        (points.material as THREE.PointsMaterial).dispose();
      }
      const lines = this.edgeLines.get(mesh.userData.editorNodeId as NodeId);
      if (lines) {
        lines.geometry.dispose();
        (lines.material as THREE.LineBasicMaterial).dispose();
      }
      mesh.geometry.dispose();
      disposeRuntimeMaterials(mesh.material);
    }
    this.meshes.clear();
    this.vertexPoints.clear();
    this.edgeLines.clear();
    this.nodeObjects.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.selectionMarquee.remove();
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private render(): void {
    this.orbit.update();
    if (this.selectionBox.visible) {
      this.selectionBox.update();
    }
    this.renderer.render(this.scene, this.camera);
  }

  private getScreenRect(start: ScreenPoint, end: ScreenPoint): ScreenRect {
    return {
      left: Math.min(start.x, end.x),
      right: Math.max(start.x, end.x),
      top: Math.min(start.y, end.y),
      bottom: Math.max(start.y, end.y),
    };
  }

  private updateSelectionMarquee(start: ScreenPoint, end: ScreenPoint): void {
    const rect = this.getScreenRect(start, end);
    const canvasBounds = this.renderer.domElement.getBoundingClientRect();
    this.selectionMarquee.hidden = false;
    this.selectionMarquee.style.left = `${rect.left - canvasBounds.left}px`;
    this.selectionMarquee.style.top = `${rect.top - canvasBounds.top}px`;
    this.selectionMarquee.style.width = `${rect.right - rect.left}px`;
    this.selectionMarquee.style.height = `${rect.bottom - rect.top}px`;
  }

  private clearBoxSelection(): void {
    this.boxSelectionStart = null;
    this.selectionMarquee.hidden = true;
    this.orbit.enabled = !this.isTransformDragging;
  }

  private getTexturePaintHit(event: PointerEvent): {
    materialId: string;
    nodeId: NodeId;
    uv: { u: number; v: number };
  } | null {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster
      .intersectObjects([...this.meshes.values()], false)
      .find((intersection) => intersection.object.visible && Boolean(intersection.uv));
    const mesh = hit?.object as RuntimeMesh | undefined;
    const nodeId = mesh?.userData.editorNodeId as NodeId | undefined;
    const faceId =
      mesh && typeof hit?.faceIndex === 'number'
        ? (mesh.userData.faceIds as string[] | undefined)?.[hit.faceIndex]
        : undefined;
    const meshData = mesh?.userData.meshData as MeshNode['mesh'] | undefined;
    const materialId = faceId ? meshData?.faces[faceId]?.materialId : undefined;
    if (
      !mesh ||
      mesh.userData.mirrorModifierKey ||
      mesh.userData.booleanPreviewKey ||
      !nodeId ||
      !materialId ||
      !hit?.uv
    ) {
      return null;
    }
    return { nodeId, materialId, uv: { u: hit.uv.x, v: hit.uv.y } };
  }

  private projectWorldPoint(worldPosition: THREE.Vector3): ScreenPoint | null {
    const point = worldPosition.clone().project(this.camera);
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z) ||
      point.z < -1 ||
      point.z > 1
    ) {
      return null;
    }
    const bounds = this.renderer.domElement.getBoundingClientRect();
    return {
      x: bounds.left + ((point.x + 1) / 2) * bounds.width,
      y: bounds.top + ((1 - point.y) / 2) * bounds.height,
    };
  }

  private projectLocalPoint(
    mesh: RuntimeMesh,
    position: { x: number; y: number; z: number },
  ): ScreenPoint | null {
    return this.projectWorldPoint(mesh.localToWorld(new THREE.Vector3(position.x, position.y, position.z)));
  }

  private selectInsideBox(start: ScreenPoint, end: ScreenPoint): void {
    const state = editorStore.getState();
    if (!isBoxSelectableMode(state.mode)) {
      return;
    }
    const rect = this.getScreenRect(start, end);
    this.scene.updateMatrixWorld(true);

    if (state.mode === 'vertex') {
      const selections: VertexSelection[] = [];
      for (const [nodeId, mesh] of this.meshes) {
        const meshData = mesh.userData.meshData as MeshNode['mesh'] | undefined;
        if (!mesh.visible || !meshData || mesh.userData.mirrorModifierKey) {
          continue;
        }
        Object.values(meshData.vertices).forEach((vertex) => {
          const point = this.projectLocalPoint(mesh, vertex.position);
          if (point && pointIsInsideRect(point, rect)) {
            selections.push({ nodeId, vertexId: vertex.id });
          }
        });
      }
      const existing = new Set(
        state.selectedVertexIds.map((selection) => `${selection.nodeId}:${selection.vertexId}`),
      );
      editorStore.selectVertices([
        ...state.selectedVertexIds,
        ...selections.filter((selection) => !existing.has(`${selection.nodeId}:${selection.vertexId}`)),
      ]);
      return;
    }

    if (state.mode === 'edge') {
      const selections: EdgeSelection[] = [];
      for (const [nodeId, mesh] of this.meshes) {
        const meshData = mesh.userData.meshData as MeshNode['mesh'] | undefined;
        if (!mesh.visible || !meshData || mesh.userData.mirrorModifierKey) {
          continue;
        }
        getMeshEdges(meshData).forEach((edge) => {
          const first = meshData.vertices[edge.vertexAId]?.position;
          const second = meshData.vertices[edge.vertexBId]?.position;
          if (!first || !second) {
            return;
          }
          const point = this.projectLocalPoint(mesh, {
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
            z: (first.z + second.z) / 2,
          });
          if (point && pointIsInsideRect(point, rect)) {
            selections.push({ nodeId, edgeId: edge.id });
          }
        });
      }
      const existing = new Set(
        state.selectedEdgeIds.map((selection) => `${selection.nodeId}:${selection.edgeId}`),
      );
      editorStore.selectEdges([
        ...state.selectedEdgeIds,
        ...selections.filter((selection) => !existing.has(`${selection.nodeId}:${selection.edgeId}`)),
      ]);
      return;
    }

    if (state.mode === 'face') {
      const selections: FaceSelection[] = [];
      for (const [nodeId, mesh] of this.meshes) {
        const meshData = mesh.userData.meshData as MeshNode['mesh'] | undefined;
        if (!mesh.visible || !meshData || mesh.userData.mirrorModifierKey) {
          continue;
        }
        Object.values(meshData.faces).forEach((face) => {
          const positions = face.vertexIds.map((vertexId) => meshData.vertices[vertexId]?.position);
          if (positions.length === 0 || positions.some((position) => !position)) {
            return;
          }
          const point = this.projectLocalPoint(
            mesh,
            positions.reduce(
              (sum, position) => ({
                x: sum.x + position!.x / positions.length,
                y: sum.y + position!.y / positions.length,
                z: sum.z + position!.z / positions.length,
              }),
              { x: 0, y: 0, z: 0 },
            ),
          );
          if (point && pointIsInsideRect(point, rect)) {
            selections.push({ nodeId, faceId: face.id });
          }
        });
      }
      const existing = new Set(
        state.selectedFaceIds.map((selection) => `${selection.nodeId}:${selection.faceId}`),
      );
      editorStore.selectFaces([
        ...state.selectedFaceIds,
        ...selections.filter((selection) => !existing.has(`${selection.nodeId}:${selection.faceId}`)),
      ]);
      return;
    }

    const nodeIds = [...this.meshes.entries()]
      .filter(([, mesh]) => mesh.visible)
      .filter(([, mesh]) =>
        pointIsInsideRect(
          this.projectWorldPoint(new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3())) ?? {
            x: -Infinity,
            y: -Infinity,
          },
          rect,
        ),
      )
      .map(([nodeId]) => nodeId);
    editorStore.selectNodes([...new Set([...state.selectedNodeIds, ...nodeIds])]);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
    const state = editorStore.getState();
    if (
      event.button === 0 &&
      !event.shiftKey &&
      state.mode === 'texture-paint' &&
      !state.texturePaintInFlight
    ) {
      const hit = this.getTexturePaintHit(event);
      if (hit) {
        this.textureStroke = { ...hit, points: [hit.uv] };
        this.orbit.enabled = false;
        this.renderer.domElement.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    if (
      event.button !== 0 ||
      !event.shiftKey ||
      !isBoxSelectableMode(state.mode) ||
      this.isTransformDragging
    ) {
      return;
    }
    this.boxSelectionStart = { x: event.clientX, y: event.clientY };
    this.orbit.enabled = false;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.textureStroke) {
      const hit = this.getTexturePaintHit(event);
      if (
        hit &&
        hit.nodeId === this.textureStroke.nodeId &&
        hit.materialId === this.textureStroke.materialId
      ) {
        const previous = this.textureStroke.points[this.textureStroke.points.length - 1];
        if (!previous || Math.hypot(hit.uv.u - previous.u, hit.uv.v - previous.v) > 0.002) {
          this.textureStroke.points.push(hit.uv);
        }
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!this.boxSelectionStart) {
      return;
    }
    const distance = Math.hypot(
      event.clientX - this.boxSelectionStart.x,
      event.clientY - this.boxSelectionStart.y,
    );
    if (distance > 4) {
      this.updateSelectionMarquee(this.boxSelectionStart, { x: event.clientX, y: event.clientY });
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private handlePointerCancel = (): void => {
    this.pointerDown = null;
    this.textureStroke = null;
    this.clearBoxSelection();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const pointerDown = this.pointerDown;
    this.pointerDown = null;
    const textureStroke = this.textureStroke;
    this.textureStroke = null;
    if (textureStroke) {
      this.orbit.enabled = !this.isTransformDragging;
      event.preventDefault();
      event.stopImmediatePropagation();
      void editorStore.paintTextureStroke(
        textureStroke.nodeId,
        textureStroke.materialId,
        textureStroke.points,
      );
      return;
    }
    const boxSelectionStart = this.boxSelectionStart;
    if (boxSelectionStart) {
      const distance = Math.hypot(event.clientX - boxSelectionStart.x, event.clientY - boxSelectionStart.y);
      this.clearBoxSelection();
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pointerDown && !this.isTransformDragging && distance > 4) {
        this.selectInsideBox(boxSelectionStart, { x: event.clientX, y: event.clientY });
        return;
      }
    }
    if (
      !pointerDown ||
      this.isTransformDragging ||
      Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4
    ) {
      return;
    }

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const state = editorStore.getState();
    if (state.mode === 'vertex') {
      const intersections = this.raycaster.intersectObjects([...this.vertexPoints.values()], false);
      const hit = intersections.find((intersection) => intersection.object.visible);
      const points = hit?.object as THREE.Points | undefined;
      const nodeId = points?.userData.editorNodeId as NodeId | undefined;
      const vertexId =
        points && nodeId && typeof hit?.index === 'number'
          ? (points.userData.vertexIds as string[] | undefined)?.[hit.index]
          : undefined;
      if (!nodeId || !vertexId) {
        if (!event.shiftKey) {
          editorStore.selectVertices([]);
        }
        return;
      }
      const currentSelection = state.selectedVertexIds;
      const selection = { nodeId, vertexId };
      const isSelected = currentSelection.some(
        (current) => current.nodeId === nodeId && current.vertexId === vertexId,
      );
      editorStore.selectVertices(
        event.shiftKey
          ? isSelected
            ? currentSelection.filter((current) => current.nodeId !== nodeId || current.vertexId !== vertexId)
            : [...currentSelection, selection]
          : [selection],
      );
      return;
    }
    if (state.mode === 'edge') {
      const intersections = this.raycaster.intersectObjects([...this.edgeLines.values()], false);
      const hit = intersections.find((intersection) => intersection.object.visible);
      const lines = hit?.object as THREE.LineSegments | undefined;
      const nodeId = lines?.userData.editorNodeId as NodeId | undefined;
      const edgeId =
        lines && typeof hit?.index === 'number'
          ? (lines.userData.edgeIds as string[] | undefined)?.[Math.floor(hit.index / 2)]
          : undefined;
      if (!nodeId || !edgeId) {
        if (!event.shiftKey) {
          editorStore.selectEdges([]);
        }
        return;
      }
      const currentSelection = state.selectedEdgeIds;
      const isSelected = currentSelection.some(
        (current) => current.nodeId === nodeId && current.edgeId === edgeId,
      );
      editorStore.selectEdges(
        event.shiftKey
          ? isSelected
            ? currentSelection.filter((current) => current.nodeId !== nodeId || current.edgeId !== edgeId)
            : [...currentSelection, { nodeId, edgeId }]
          : [{ nodeId, edgeId }],
      );
      return;
    }
    const intersections = this.raycaster.intersectObjects([...this.meshes.values()], false);
    if (state.mode === 'face' || state.mode === 'face-color') {
      const hit = intersections.find((intersection) => intersection.object.visible);
      const mesh = hit?.object as RuntimeMesh | undefined;
      if (mesh?.userData.mirrorModifierKey || mesh?.userData.booleanPreviewKey) {
        if (!event.shiftKey) {
          editorStore.selectFaces([]);
        }
        return;
      }
      const nodeId = mesh?.userData.editorNodeId as NodeId | undefined;
      const faceId =
        mesh && typeof hit?.faceIndex === 'number'
          ? (mesh.userData.faceIds as string[] | undefined)?.[hit.faceIndex]
          : undefined;
      if (!nodeId || !faceId) {
        if (!event.shiftKey) {
          editorStore.selectFaces([]);
        }
        return;
      }
      if (state.mode === 'face-color' && !event.shiftKey) {
        editorStore.paintFace({ nodeId, faceId });
        return;
      }
      const currentSelection = state.selectedFaceIds;
      const isSelected = currentSelection.some(
        (current) => current.nodeId === nodeId && current.faceId === faceId,
      );
      editorStore.selectFaces(
        event.shiftKey
          ? isSelected
            ? currentSelection.filter((current) => current.nodeId !== nodeId || current.faceId !== faceId)
            : [...currentSelection, { nodeId, faceId }]
          : [{ nodeId, faceId }],
      );
      return;
    }
    const selected = intersections.find((intersection) => intersection.object.visible)?.object;
    const nodeId = selected?.userData.editorNodeId as NodeId | undefined;
    const currentSelection = state.selectedNodeIds;
    if (!nodeId) {
      if (!event.shiftKey) {
        editorStore.selectNodes([]);
      }
      return;
    }
    if (!event.shiftKey) {
      editorStore.selectNodes([nodeId]);
      return;
    }
    editorStore.selectNodes(
      currentSelection.includes(nodeId)
        ? currentSelection.filter((selectedNodeId) => selectedNodeId !== nodeId)
        : [...currentSelection, nodeId],
    );
  };
}

export function Viewport({
  groundReferenceY,
  groundVisible,
  mode,
  onOpenGlb,
  pivotPreview,
  shadowPreview,
  booleanPreview,
}: {
  groundReferenceY: number;
  groundVisible: boolean;
  mode: EditorMode;
  onOpenGlb: (file: File) => void;
  pivotPreview: { nodeId: NodeId; rotationY: number } | null;
  shadowPreview: boolean;
  booleanPreview: BooleanPreview | null;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewportRuntime | null>(null);
  const { document, selectedEdgeIds, selectedFaceIds, selectedNodeIds, selectedVertexIds, transformTool } =
    useEditorState();
  const [isFileDragActive, setIsFileDragActive] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const runtime = new ViewportRuntime(container);
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.sync(
      document,
      selectedNodeIds,
      selectedVertexIds,
      selectedFaceIds,
      selectedEdgeIds,
      transformTool,
      mode,
      groundVisible,
      groundReferenceY,
      shadowPreview,
      pivotPreview,
      booleanPreview,
    );
  }, [
    document,
    groundReferenceY,
    groundVisible,
    mode,
    pivotPreview,
    booleanPreview,
    selectedEdgeIds,
    selectedFaceIds,
    selectedNodeIds,
    selectedVertexIds,
    transformTool,
    shadowPreview,
  ]);

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      setIsFileDragActive(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsFileDragActive(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsFileDragActive(false);
    const file = [...event.dataTransfer.files].find((candidate) =>
      candidate.name.toLowerCase().endsWith('.glb'),
    );
    if (file) {
      onOpenGlb(file);
      return;
    }
    editorStore.setNotice({
      kind: 'error',
      message: 'Drop failed: drag a binary .glb file into the viewport.',
    });
  };

  return (
    <div
      className={`viewport-shell${isFileDragActive ? ' is-file-drag-active' : ''}`}
      data-testid="viewport-shell"
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="viewport-overlay viewport-title">Perspective · +Y Up · +Z Forward</div>
      {shadowPreview && (
        <div className="viewport-overlay viewport-shadow-preview" data-testid="shadow-preview-indicator">
          Shadow Preview · directional light · cast/receive
        </div>
      )}
      {booleanPreview && (
        <div className="viewport-overlay viewport-shadow-preview" data-testid="boolean-preview-indicator">
          Boolean preview · {booleanPreview.operation} · cutter hidden until commit
        </div>
      )}
      <div className="viewport-overlay viewport-hint">
        Click to select · Shift+drag to box select · Drag gizmo to transform
      </div>
      {isFileDragActive && <div className="viewport-drop-target">Drop GLB to open locally</div>}
      <div className="viewport-mount" ref={containerRef} />
    </div>
  );
}
