# Low-Poly Asset Editor 개발 계획

> 기준 문서: `codex-development-instruction.md` v1.0  
> 작성일: 2026-08-19  
> 현재 상태: Phase 0~5의 v1 범위를 구현했다. 2026-08-20에 unit 84개, Chromium E2E 49개, lint/typecheck, production/Pages build와 실제 Pages base-path smoke를 모두 통과했다.

## 0. 이 문서 사용법

- 실제 구현 순서는 위에서 아래로 진행한다.
- 작업을 완료하고 관련 테스트와 빌드까지 통과한 뒤에만 `[x]`로 바꾼다.
- 진행 중 작업은 항목 끝에 `(진행 중)`, 막힌 작업은 `(차단: 사유)`를 기록한다.
- 범위나 설계가 바뀌면 먼저 이 문서를 갱신한 다음 구현한다.
- 각 Phase 종료 조건을 모두 통과해야 다음 Phase를 완료로 판정한다. 단, 서로 독립적인 조사와 테스트 작성은 선행할 수 있다.

## 1. 개발 목표와 릴리스 기준

이 프로젝트는 게임 `Who Ordered Some Shade? / 그늘 시키신 분?`에 넣을 로우폴리 GLB를 브라우저에서 직접 만들거나 Meshy GLB를 정리하는 데 특화된 데스크톱 우선 웹 에디터다. 서버, 계정, 외부 API 없이 모든 파일 처리와 편집을 로컬 브라우저에서 수행한다.

핵심 사용자 흐름은 다음 두 가지다.

1. `Primitive → Modeling → Color/Material → 실제 크기 → Pivot → Validation → GLB`
2. `Meshy GLB → Cleanup/Edit → 실제 크기/방향 → Pivot/Shadow → Validation → GLB`

완성도를 다음 네 단계로 관리한다.

- **Core Alpha (Phase 0~1):** GLB와 Primitive를 장면에서 열고 배치하고 다시 GLB로 내보낼 수 있다.
- **Game Asset MVP (Phase 0~3):** 직접 메시 편집, 실제 크기 조정, `shade_pivot`, 그림자 검증까지 가능하다.
- **v1 (Phase 0~4):** 색/재질과 Meshy cleanup까지 포함해 두 핵심 흐름을 실사용할 수 있다.
- **v1.x (Phase 5):** Boolean, Texture Paint, Auto UV, 프로젝트 저장을 위험도 검증 후 추가한다.

초기 범위에서 Sculpt, Rigging, Animation, Skinning, Simulation, Geometry/Shader Nodes, 전체 UV Editor, CAD, 자동 Retopology, 고급 자동 Repair, Cloud/AI 기능은 제외한다.

Knife Tool은 요구사항대로 v1 우선순위에서 제외하고 Phase 5 이후 backlog에서 다시 평가한다.

## 2. 구현 원칙과 주요 설계 결정

### 2.1 기술 구성

- Vite + TypeScript `strict` 모드로 빌드한다.
- React는 메뉴, Outliner, Inspector, Status 등 UI 셸에 사용한다.
- Three.js는 Viewport 렌더링, picking, 카메라, 조명, GLB 입출력에 직접 사용한다.
- 편집 상태는 중앙 Editor Store가 소유하고, React UI와 Three.js Viewport는 같은 상태를 구독한다.
- 단위/통합 테스트는 Vitest, 실제 브라우저 흐름은 Playwright Chromium으로 검증한다.
- GitHub Pages의 하위 경로에서도 asset URL, worker/WASM 경로, 새로고침이 깨지지 않도록 Vite `base` 설정을 환경별로 둔다.
- 라이브러리 버전은 구현 시작 시 호환성을 확인해 고정하고 lockfile을 커밋한다.

### 2.2 핵심 아키텍처

UI, 편집 문서, 렌더링 객체를 분리한다.

```text
React UI
  └─ Editor Store / Selection / Tool State
       ├─ Command History (Undo / Redo)
       ├─ SceneDocument (직렬화 가능한 원본 데이터)
       ├─ Geometry Operations / Validation
       └─ Three Runtime Adapter
            └─ Scene / Mesh / Helpers / Picking / GLB I/O
```

- `SceneDocument`가 이름, hierarchy, transform, mesh, material, pivot을 보존하는 유일한 편집 원본이다.
- Three.js `Object3D`와 `BufferGeometry`는 렌더링용 파생 데이터다. 렌더 객체를 직접 수정해 문서 상태와 어긋나게 만들지 않는다.
- 편집 가능한 `MeshData`는 안정적인 vertex/face ID와 polygon face loop를 보유하고, edge/adjacency를 파생한다.
- 화면 표시와 GLB export 시 polygon을 삼각분할한 `BufferGeometry`를 생성한다.
- GLB 자체는 삼각형을 저장하므로 imported mesh는 우선 triangle face로 정확히 가져온다. Primitive는 Cube/Cylinder 측면 같은 논리적 polygon을 직접 생성한다.
- imported mesh의 Loop Cut이 필요하면 normal 각도, material, UV seam 조건으로 선택 영역의 triangle pair를 quad로 합치는 `Tris to Quads` preview를 먼저 거친다. 자동 추측으로 원본 topology를 조용히 변경하지 않는다.
- UV, vertex color, normal, material group은 face corner 단위 손실을 막을 수 있는 형태로 보존한다.
- Vertex/Edge/Face picking 결과는 렌더 index에서 안정적인 편집 ID로 역매핑한다.
- 모든 변경은 `Command`로 실행한다. 드래그 중 수십 개의 이력을 만들지 않고 pointer-down부터 pointer-up까지 한 transaction으로 묶는다.
- 초기 Undo는 영향을 받은 node/mesh의 before/after snapshot을 사용하고, 성능 측정 후 큰 geometry 작업만 delta 방식으로 바꾼다.

### 2.3 권장 폴더 구조

```text
src/
  app/                  # 앱 초기화, 전역 배치, 메뉴/단축키
  editor/
    core/               # SceneDocument, ID, 선택, editor store
    commands/           # 실행/취소 가능한 명령
    geometry/           # topology, mesh 연산, triangulation
    io/                 # GLB, 다운로드, drag & drop, project format
    validation/         # geometry/game asset 검사
  viewport/             # Three runtime, picking, gizmo, overlays
  ui/                   # Outliner, Inspector, toolbar, status panel
  styles/
tests/
  unit/
  integration/
  e2e/
  fixtures/             # 단순 GLB와 Meshy 유사 다중-node GLB
```

### 2.4 크기와 Transform 규칙

- Object Transform의 Position/Rotation/Scale과 실제 geometry 크기를 명확히 분리한다.
- `Resize Geometry`는 bounding size 비율을 계산해 vertex 좌표에 직접 반영한다.
- `Keep Proportions` 기본값은 ON이며 한 축 변경 시 세 축에 동일한 배율을 적용한다.
- OFF이면 W/H/D 축별 배율을 vertex에 적용한다.
- `Apply Scale`은 현재 object scale을 geometry에 bake한 뒤 scale을 `(1,1,1)`로 되돌린다.
- Rotation과 Position은 `Resize Geometry`/`Apply Scale`로 변경하지 않는다.
- 단일 mesh의 W/H/D는 local geometry 축 기준으로 표시하고, asset root/다중 선택 크기는 asset 좌표계 기준 bounds로 표시한다. 이 차이를 UI 라벨과 도움말로 드러낸다.
- 0 크기 축, 음수 scale, parent scale, 다중 material mesh에 대한 동작을 단위 테스트로 고정한다.

### 2.5 Pivot, 방향, Export 규칙

- Pivot은 Three.js Group에 대응하는 별도 scene node이며 mesh와 동일하게 이동/이름 변경/parenting할 수 있다.
- `shade_pivot`은 예약 강제가 아니라 게임 권장 이름으로 제공하고, 존재/이름/hierarchy를 검증한다.
- `+Y = UP`은 editor 좌표계로 고정한다.
- `+Z = FORWARD`는 geometry만 보고 의미상 정방향을 자동 판정할 수 없으므로 축 표시와 orientation 도구를 제공하고, 사용자가 확인한 상태를 project metadata에 저장한다.
- GLB export는 pivot hierarchy, 이름, material, vertex color를 보존한다. Hide는 editor 상태이므로 hidden node는 기본 export 대상에서 제외하고 제외 개수를 명시하며, `.shadeasset`에서는 visibility를 보존한다.
- scale이 `(1,1,1)`이 아닌 export 대상 node는 Warning 또는 차단 가능한 Error로 표시하고 `Apply Scale` 빠른 동작을 제공한다.
- 최종 export 결과는 메모리에서 다시 GLBLoader로 열어 필수 불변조건을 검사한 뒤 다운로드한다.

## 3. 공통 완료 조건

각 Phase는 아래 절차를 모두 거친다.

- Phase 시작 시 현재 코드와 이전 Phase의 미해결 문제를 조사한다.
- 구현 범위와 acceptance criteria를 이 문서에 최신화한다.
- 기능 구현과 함께 핵심 geometry/상태 로직의 단위 테스트를 작성한다.
- GLB import/export 또는 UI 경계를 포함하는 통합 테스트를 작성한다.
- 실제 Playwright Chromium에서 핵심 사용자 흐름을 실행한다.
- `production build`가 경고 정책을 포함해 통과한다.
- GitHub Pages용 base path 빌드와 정적 호스팅에서 직접 진입을 검증한다.
- 남은 문제, 의도된 제한, 다음 Phase로 넘긴 일을 이 문서에 기록한다.

## 4. 실행 체크리스트

### Phase 0 — 프로젝트 기반과 편집 코어

목표: 이후 geometry 기능을 덧붙여도 UI, 상태, Undo, GLB가 서로 얽히지 않는 기반을 만든다.

- [x] P0-001 개발지시서 전체 요구사항과 우선순위를 검토한다.
- [x] P0-002 저장소가 구현 전 초기 상태임을 확인한다.
- [x] P0-003 단계별 개발 계획과 추적 체크리스트를 작성한다.
- [x] P0-004 Vite + React + TypeScript 프로젝트를 생성하고 strict type check를 활성화한다.
- [x] P0-005 lint, format, unit test, E2E, build 스크립트를 정의한다.
- [x] P0-006 GitHub Pages base path와 배포 workflow를 구성한다.
- [x] P0-007 `SceneDocument`, node/mesh/material ID, transform 타입을 정의한다.
- [x] P0-008 Editor Store와 선택/tool/mode 상태를 정의한다.
- [x] P0-009 Command interface, transaction, Undo/Redo stack을 구현한다.
- [x] P0-010 Three runtime adapter와 document-to-runtime 동기화를 구현한다.
- [x] P0-011 오류 경계, 사용자 알림, 개발 진단 로그의 기본 틀을 만든다.
- [x] P0-012 테스트 fixture 생성 도구와 최소 cube/multi-node GLB fixture를 준비한다.
- [x] P0-013 지원할 기준 mesh 크기와 startup/edit/export 메모리·시간 예산을 fixture 측정 후 문서화한다.

완료 기준:

- [x] 빈 문서 생성, node 추가/이름 변경/삭제가 store와 Three scene에 동일하게 반영된다.
- [x] 명령 실행 → Undo → Redo가 동일한 문서 checksum을 재현한다.
- [x] unit test, Chromium smoke test, production/GitHub Pages build가 통과한다.

### Phase 1 — 기본 Editor (Core Alpha)

목표: GLB/Primitive를 열고 장면을 편집해 다시 GLB로 내보내는 첫 수직 흐름을 완성한다.

#### 화면과 Viewport

- [x] P1-001 상단 메뉴, 좌측 Outliner, 중앙 Viewport, 우측 Inspector, 하단 Status 레이아웃을 구현한다.
- [x] P1-002 반응형 최소 폭과 panel resize를 구현하되 desktop 사용성을 우선한다.
- [x] P1-003 perspective camera, OrbitControls, grid, ground, axis gizmo, 기본 조명을 구성한다.
- [x] P1-004 현재 Object mode와 선택 object를 명확히 표시한다.
- [x] P1-005 object raycast 선택, 다중 선택, 빈 공간 선택 해제를 구현한다.
- [x] P1-006 move/rotate/scale transform gizmo와 수치 입력을 구현한다.

#### 파일과 장면

- [x] P1-007 File Open으로 `.glb` ArrayBuffer를 로컬에서 읽는다.
- [x] P1-008 Viewport drag & drop `.glb` 열기를 구현한다.
- [x] P1-009 GLB scene hierarchy, node name, transform, mesh, material을 `SceneDocument`로 변환한다.
- [x] P1-010 unsupported animation/skin/morph 기능을 감지해 손실 가능성을 경고한다.
- [x] P1-011 Cube, Plane, Cylinder, Cone, Sphere, Icosphere를 editor `MeshData`로 생성하고 기본 저폴리 설정 UI를 구현한다.
- [x] P1-012 Outliner 선택, Rename, Hide/Show, Delete, Parent, Unparent를 구현한다.
- [x] P1-013 Inspector에서 Position/Rotation/Scale을 편집한다.
- [x] P1-014 File New/Open 시 미저장 변경 확인 흐름을 구현한다.
- [x] P1-015 GLTFExporter 기반 `.glb` 생성, hidden node 제외 요약, 브라우저 다운로드를 구현한다.
- [x] P1-016 메뉴, 단축키, gizmo, Outliner 작업을 Command/Undo/Redo와 연결한다.
- [x] P1-017 최소 validation으로 export 대상 없음, 비정상 값, non-unit scale을 표시한다.

완료 기준:

- [x] GLB Open → object transform → hierarchy 변경 → Export → Reopen이 성공한다.
- [x] Primitive 6종이 생성되고 각각 GLB round-trip 후 이름과 transform을 유지한다.
- [x] transform 드래그 한 번이 Undo history 한 항목으로 기록된다.
- [x] 잘못된 파일과 unsupported GLB가 앱 전체를 중단시키지 않고 명확한 오류를 표시한다.
- [x] Phase 1 공통 완료 조건을 모두 통과한다.

### Phase 2 — 직접 Modeling

목표: low-poly 제작에 필요한 Vertex/Edge/Face 연산과 Mirror/Bend를 안정적으로 제공한다.

#### 편집 topology와 선택

- [x] P2-001 GLB의 indexed/non-indexed triangle geometry를 editable `MeshData`로 손실 없이 변환한다.
- [x] P2-002 UV/material seam 때문에 분리된 corner attribute 보존 규칙을 구현한다.
- [x] P2-003 선택 영역 `Tris to Quads`의 normal/material/UV 조건, preview, 취소를 구현한다.
- [x] P2-004 adjacency(vertex-edge-face), boundary, manifold 정보를 계산하고 캐시 무효화한다.
- [x] P2-005 polygon triangulation과 편집 ID ↔ render index 매핑을 구현한다.
- [x] P2-006 Object/Vertex/Edge/Face mode 전환과 mode별 overlay를 구현한다.
- [x] P2-007 click, box, Shift add/remove 다중 선택을 구현한다.
- [x] P2-008 vertex/edge/face 선택의 move/rotate/scale과 local/world orientation을 구현한다.

#### 기본 topology 편집

- [x] P2-009 Vertex Merge와 Merge by Distance를 구현한다.
- [x] P2-010 vertex delete와 연결 face 정리 규칙을 구현한다.
- [x] P2-011 edge delete와 edge dissolve를 구분해 구현한다.
- [x] P2-012 face delete로 열린 구멍 생성을 구현한다.
- [x] P2-013 face normal flip을 구현한다.
- [x] P2-014 edge subdivide 단일/다중 선택을 구현하고 새 vertex를 선택한다.
- [x] P2-015 quad 중심의 loop 탐색과 Loop Cut preview/commit을 구현한다.
- [x] P2-016 loop가 pole/triangle/non-manifold에서 중단되는 위치와 이유를 UI에 표시한다.

#### 형태 생성 도구

- [x] P2-017 face Extrude preview/거리 입력/commit을 구현한다.
- [x] P2-018 face Inset preview/두께 입력/commit을 구현한다.
- [x] P2-019 edge Bevel 폭/segment 입력을 구현하고 초기 기본 segment는 1로 둔다.
- [x] P2-020 X Mirror live preview, seam merge tolerance, apply/disable을 구현한다.
- [x] P2-021 Mirror 상태를 프로젝트 편집 상태로 유지하고 GLB export 시 geometry에 bake한다.
- [x] P2-022 Bend axis/angle/origin preview와 commit을 구현한다.
- [x] P2-023 모든 topology 작업이 selection과 corner attribute를 일관되게 갱신하도록 한다.
- [x] P2-024 모든 modeling 작업을 Undo/Redo 명령으로 연결한다.

완료 기준:

- [x] Cube에서 Loop Cut → vertex 이동 → Extrude → Bevel → Mirror → Bend 흐름이 성공한다.
- [x] 각 연산 후 index 범위, 유한 좌표, face winding, adjacency invariant 검사가 통과한다.
- [x] boundary/non-manifold 입력에서 지원하지 않는 연산은 geometry를 훼손하지 않고 거부된다.
- [x] 연속 Undo로 원본 geometry checksum과 bounds를 복원하고 Redo로 결과를 재현한다.
- [x] Phase 2 공통 완료 조건을 모두 통과한다.

### Phase 3 — 게임 Asset 기능 (Game Asset MVP)

목표: 모델을 게임 좌표/실제 크기/hierarchy에 맞추고 `shade_pivot`과 그림자를 검증한다.

#### 실제 크기와 Scale

- [x] P3-001 Inspector에 read-only 계산값이 아닌 편집 가능한 W/H/D와 단위를 표시한다.
- [x] P3-002 `Keep Proportions = ON`을 기본값으로 구현한다.
- [x] P3-003 한 축 변경 시 동일 배율로 모든 vertex를 변경하고 scale을 `(1,1,1)`로 유지한다.
- [x] P3-004 Keep Proportions OFF에서 축별 배율을 geometry에 적용한다.
- [x] P3-005 `Apply Scale`로 object scale을 vertex와 normal/tangent 처리에 bake한다.
- [x] P3-006 parent scale, negative scale, 0-size axis, multi-selection의 예외 동작을 정의하고 UI에 안내한다.
- [x] P3-007 resize/apply scale 후 bounds와 transform 불변조건을 검사한다.

#### 방향, Ground, Pivot, Shadow

- [x] P3-008 +Y Up/+Z Forward 축 안내와 orientation 수정 도구를 제공한다.
- [x] P3-009 semantic forward 사용자 확인 상태를 project metadata에 저장한다.
- [x] P3-010 Ground Plane 표시/숨김과 `Move Model to Ground`를 구현한다.
- [x] P3-011 사용자 지정 `Set Ground Reference`와 ground contact tolerance를 구현한다.
- [x] P3-012 Create/Move/Rename Pivot과 local axis 표시를 구현한다.
- [x] P3-013 Parent Mesh/Unparent Mesh를 Outliner와 Pivot mode 양쪽에서 지원한다.
- [x] P3-014 `shade_pivot` 생성 shortcut과 권장 hierarchy 안내를 구현한다.
- [x] P3-015 pivot 0/45/90/180/270/360도 preset과 연속 slider preview를 구현한다.
- [x] P3-016 pivot preview를 원래 transform을 훼손하지 않는 임시 상태로 구현한다.
- [x] P3-017 Directional Light, cast/receive shadow, ground가 있는 Shadow Preview mode를 구현한다.

#### 게임용 Export Validation

- [x] P3-018 Geometry valid, 방향 확인, unit scale, ground contact, material, `shade_pivot` 검사를 구현한다.
- [x] P3-019 validation 결과를 Error/Warning/Info로 분류하고 관련 node 선택/빠른 수정 동작을 제공한다.
- [x] P3-020 GLB export 직전 validation 정책과 경고 무시 흐름을 구현한다.
- [x] P3-021 export한 GLB를 메모리에서 다시 열어 scale, hierarchy, pivot name, bounds를 검사한다.

완료 기준:

- [x] 지침 예제 `W=2,H=4,D=1 → H=1.5`가 `0.75,1.5,0.375`가 되고 scale은 unit이다.
- [x] `fixed_base`는 고정된 채 `shade_pivot` 아래 arm/canopy만 회전한다.
- [x] ground 이동 후 world bounds의 minimum Y가 tolerance 안에서 0이다.
- [x] pivot 회전별 shadow silhouette을 Chromium에서 확인할 수 있다.
- [x] Export → Reopen 후 실제 크기, hierarchy, pivot, node name과 unit scale이 유지된다.
- [x] Phase 3 공통 완료 조건을 모두 통과한다.

### Phase 4 — 색, Material, Shading, Meshy Cleanup (v1)

목표: material 폭증 없이 로우폴리 색을 편집하고 Meshy 결과의 흔한 문제를 검사/수정한다.

#### Face Color와 Material

- [x] P4-001 geometry에 vertex color가 없을 때 안전하게 생성한다.
- [x] P4-002 Face Color mode의 click paint와 selected faces paint를 구현한다.
- [x] P4-003 색상 picker, eyedropper, palette, recent colors를 구현한다.
- [x] P4-004 face color가 UV/material을 불필요하게 복제하지 않도록 vertex/corner color로 저장한다.
- [x] P4-005 Base Color, Roughness, Metalness, Opacity 편집 UI를 구현한다.
- [x] P4-006 opacity에 따른 transparent/depthWrite 정책과 export 결과를 검증한다.
- [x] P4-007 mesh 또는 선택 face의 Flat/Smooth shading을 구현한다.

#### 검사와 간단한 Repair

- [x] P4-008 open edge와 non-manifold edge 검사를 구현하고 Viewport에서 강조한다.
- [x] P4-009 inconsistent/flipped normal 검사를 구현한다.
- [x] P4-010 degenerate face와 duplicate vertex 검사를 구현한다.
- [x] P4-011 connected component를 계산해 작은 분리 geometry를 목록화하고 선택한다.
- [x] P4-012 Merge by Distance를 cleanup action으로 노출한다.
- [x] P4-013 Recalculate Normals와 Delete Degenerate Faces를 구현한다.
- [x] P4-014 작은 분리 component를 object로 분리하거나 삭제하는 흐름을 구현한다.
- [x] P4-015 검사/수정 전후 결과와 변경 개수를 Status panel에 표시한다.

#### Meshy 실사용 검증

- [x] P4-016 다중 mesh/material/texture를 가진 익명화된 Meshy 유사 fixture를 준비한다.
- [x] P4-017 불필요 mesh 삭제, hierarchy 정리, geometry 수정, color/material 정리를 검증한다.
- [x] P4-018 Meshy workflow 전체 E2E와 GLB round-trip 회귀 테스트를 추가한다.

완료 기준:

- [x] 여러 face 색을 바꿔도 face 수에 비례해 material 수가 증가하지 않는다.
- [x] vertex color, material, flat/smooth 결과가 GLB 재로드 후 유지된다.
- [x] 각 validation marker에서 문제 element를 선택할 수 있고 repair는 Undo 가능하다.
- [x] 직접 제작과 Meshy 후처리 두 핵심 workflow가 모두 Chromium E2E로 통과한다.
- [x] Phase 4 공통 완료 조건을 모두 통과한다.

### Phase 5 — 고급 기능 (v1.x)

Phase 5 항목은 핵심 v1 안정화 후 각각 별도 기술 검증과 release gate를 거친다.

#### Boolean

- [x] P5-001 browser/WASM 후보를 Difference/Union/Intersection, 속도, bundle 크기, 라이선스 기준으로 비교한다.
- [x] P5-002 closed manifold cube/cylinder와 실제 imported mesh fixture로 spike를 실행한다.
- [x] P5-003 실패/비-manifold 결과를 감지하고 원본을 보존하는 정책을 정한다.
- [x] P5-004 cutter 선택과 Difference/Union/Intersection preview/commit을 구현한다.
- [x] P5-005 Boolean 결과의 material, normal, Undo/Redo, export를 검증한다.

#### Texture Paint와 Auto UV

- [x] P5-006 기존 UV/texture의 color space와 image source를 안전하게 편집 canvas로 가져온다.
- [x] P5-007 UV 기반 brush projection과 seam을 포함한 stroke 처리를 구현한다.
- [x] P5-008 Paint Brush, Eraser, Eyedropper, Brush Size, Opacity UI를 구현한다.
- [x] P5-009 texture stroke를 Undo/Redo transaction으로 처리한다.
- [x] P5-010 변경 texture가 포함된 GLB export/reopen을 검증한다.
- [x] P5-011 UV가 없는 mesh에 대한 단순 Auto UV 전략을 기술 검증한다.
- [x] P5-012 Auto UV 품질이 기준을 만족할 때만 정식 기능으로 노출한다.

#### 프로젝트 저장

- [x] P5-013 `.shadeasset` versioned manifest schema와 migration 규칙을 정의한다.
- [x] P5-014 SceneDocument, editor metadata, non-destructive Mirror 상태, palette를 저장한다.
- [x] P5-015 texture/binary payload를 포함하는 컨테이너 형식을 구현한다.
- [x] P5-016 project Save/Open과 손상/미지원 버전 오류 처리를 구현한다.
- [x] P5-017 project round-trip 후 Undo 기준점, hierarchy, selection 가능한 geometry를 검증한다.

완료 기준:

- [x] 각 고급 기능이 실패해도 기존 문서와 export 가능한 geometry가 보존된다.
- [x] texture 및 `.shadeasset`을 포함한 round-trip E2E가 통과한다.
- [x] bundle 크기와 대형 파일 메모리 사용량이 정한 예산 안에 든다.
- [x] Phase 5 공통 완료 조건을 모두 통과한다.

## 5. 필수 테스트 매트릭스

### Unit

- [x] topology 생성/삭제/adjacency/triangulation invariant
- [x] Vertex Merge, Edge Dissolve/Subdivide, Loop Cut 경계 조건
- [x] Extrude, Inset, Bevel, Mirror seam, Bend 수치 결과
- [x] bounds, proportional/non-proportional resize, Apply Scale
- [x] Command transaction, Undo/Redo checksum
- [x] open/non-manifold/normal/degenerate/duplicate/component 검사
- [x] validation severity와 빠른 수정 결과

### Integration

- [x] BufferGeometry ↔ MeshData attribute 보존
- [x] GLB import → SceneDocument → GLB export → reimport
- [x] node name, hierarchy, pivot, material, vertex color, texture 보존
- [x] indexed/non-indexed, multi-material, nested transform fixture
- [x] malformed/unsupported GLB의 비파괴 오류 처리

### Chromium E2E

- [x] Primitive 직접 제작 전체 흐름
- [x] Meshy 유사 GLB 후처리 전체 흐름
- [x] drag & drop, 메뉴/단축키, Outliner/Inspector 동기화
- [x] mode 전환과 Vertex/Edge/Face 선택 정확도
- [x] Shadow Preview와 pivot rotation preview
- [x] 다운로드한 GLB 재업로드 round-trip
- [x] GitHub Pages 하위 경로에서 새 세션으로 동일 흐름

### 최종 Round-trip 불변조건

- [x] 실제 W/H/D가 허용 오차 안에서 일치한다.
- [x] vertex/face 수와 의도한 geometry 변경이 유지된다.
- [x] face color, material 속성, shading이 유지된다.
- [x] hierarchy, pivot, node name이 유지된다.
- [x] 모든 게임 export 대상 Object Scale이 `(1,1,1)`이다.
- [x] +Y Up과 사용자 확인 +Z Forward 상태가 검증 UI에 반영된다.
- [x] ground contact와 `shade_pivot` 상태가 동일하게 재검사된다.

## 6. 위험 요소와 대응

| 위험                                             | 영향                                   | 대응/검증                                                                      |
| ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------ |
| Three.js BufferGeometry만으로 topology 편집 구현 | Loop Cut/Inset/Bevel이 불안정해짐      | stable ID를 가진 별도 polygon topology와 adjacency를 Phase 2 전에 완성         |
| GLB가 원래 quad 정보를 저장하지 않음             | imported mesh의 Loop Cut 경로가 모호함 | 원본 triangle을 보존하고 명시적 `Tris to Quads` preview/확정 후 quad 도구 사용 |
| GLB import 시 UV seam/material group 손실        | Meshy asset 외형 훼손                  | corner attribute 보존 fixture와 import/export 통합 테스트를 Phase 1부터 추가   |
| 큰 mesh snapshot Undo의 메모리 증가              | 브라우저 멈춤/탭 종료                  | drag transaction 병합, history 예산 측정, 큰 연산 delta 전환                   |
| Resize와 object/parent scale 혼동                | 게임에서 크기 불일치                   | 크기 규칙을 단위 테스트로 고정하고 export reimport에서 unit scale 강제 검증    |
| Mirror/preview 상태와 GLB 불일치                 | 편집 화면과 결과물 차이                | runtime 파생 geometry와 export bake가 같은 생성 함수를 사용                    |
| +Z Forward 자동 판정 불가능                      | 잘못된 방향을 정상으로 오인            | 사용자 확인형 validation과 축/ground/shadow preview 제공                       |
| Boolean의 비-manifold/성능 문제                  | 전체 편집 안정성 저하                  | Phase 5 격리 spike, 원본 보존, timeout/실패 처리 후 채택                       |
| Texture 메모리와 CORS/codec 제약                 | Paint/Export 실패                      | 로컬 ArrayBuffer/Blob 소유권 유지, 해상도 예산과 codec fixture 검증            |
| GitHub Pages 하위 경로                           | production에서 worker/asset 로드 실패  | preview가 아닌 실제 base path 정적 호스팅 E2E를 매 Phase gate에 포함           |

## 7. 최종 구현 상태 (2026-08-20)

Phase 0~5 체크리스트와 완료 기준을 모두 충족했다. 이 구현은 Primitive 기반 직접 제작과 Meshy GLB 정리라는 두 핵심 흐름을 모두 지원한다.

- Boolean은 `manifold-3d` WASM을 필요할 때만 불러온다. Difference/Union/Intersection은 closed manifold 입력만 허용하며 preview 동안 원본 subject/cutter를 보존하고, Commit·Undo/Redo·GLB 재열기까지 검증한다.
- Texture Paint는 GLB의 embedded base-color image를 로컬 PNG/sRGB payload로 소유한다. Brush/Eraser/Eyedropper, 크기/불투명도, UV seam wrapping, 한 stroke당 한 Undo, 2,048px 상한을 제공한다.
- UV가 없는 mesh에는 기존 UV를 덮어쓰지 않는 단순 face-projection Auto UV를 제공한다. 이는 low-poly 편집용 보수적 기본 전략이며, 정밀 packing/UV editor는 명시적으로 범위 밖이다.
- `.shadeasset` v2는 document texture payload와 paint 설정을 저장하며 v1 project를 안전하게 migration한다. dangling texture reference는 export Error로 차단한다.
- 검증 결과: Vitest 84개, Playwright Chromium 49개, ESLint, TypeScript, production build, Pages build를 통과했다. 4,034-vertex sphere의 startup/edit/export/heap budget E2E도 통과했다.
- Pages build를 실제 `http://127.0.0.1:4174/lowpoly-modeler/` 정적 preview에서 새 세션으로 열어 Cube 생성까지 확인했다.
- build 산출물에서 Boolean은 지연 청크로 분리된다(bridge 약 1.75 KiB gzip, WASM 약 207.94 KiB gzip). Vite의 `node:module` externalization 안내는 `manifold-3d` 번들 분석 메시지이며, 실제 Chromium Boolean 회귀는 통과했다.
- 루트 `README.md`와 `USER_GUIDE.md`를 작성해 설치·검증 명령, 파일 형식, 권장 workflow, mode별 작업, export validation, 제한 사항을 사용자 관점에서 문서화했다.
- Inspector의 모든 텍스트 버튼을 대상으로 어두운 배경과 최소 4.5:1 대비를 Chromium에서 확인하는 회귀 테스트를 추가했다.

v1 범위의 기능 작업은 완료했다. 이후 작업은 실제 게임 에셋으로의 사용자 수용 테스트, 고해상도/복잡 import의 별도 성능 baseline, 범위 밖 UV 편집 기능, 또는 아래의 Face Bend 후속 계획에서 다룬다.

## 8. 2026-08-19 구현 이력

2026-08-19 기준 세 번째 수직 slice를 완료했다.

- Serializable `MeshData`(vertex/face/material ID)로 Cube, Plane, Cylinder, Cone, Sphere, Icosphere를 생성하며, Three.js runtime bridge가 이를 직접 렌더링한다.
- Desktop layout은 980px minimum viewport를 보장하며 Outliner/Inspector divider를 drag해 각각의 minimum width 안에서 208–480px, 254–480px로 조절할 수 있다. 좁은 화면에서는 각각의 safe minimum으로 고정한다.
- transform gizmo drag는 preview 중 history를 쌓지 않고 mouse-up 때 단일 transaction으로 commit한다. 취소 시 이전 dirty 상태와 document를 복구한다.
- Header command, Outliner/Inspector mutation, gizmo drag는 document command로 남고 Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y로 Undo/Redo할 수 있다.
- GLB reimport는 자체 export의 단일 `asset_root` wrapper를 document root로 정규화해 hierarchy를 한 단계 더 만들지 않는다. Chromium은 기본 primitive 6종의 이름과 editable Position X가 export/reopen 후 그대로인 것을 검증한다.
- [`performance-budget.md`](performance-budget.md)는 현재 최대 primitive setting인 4,034-vertex UV sphere를 기준 fixture로 정하고 startup, edit, export safety gate, JS heap 예산을 Playwright artifact로 측정한다.
- Error Boundary, local status notification, GLB Open/drag & drop, hierarchy/material/geometry import, export download, hidden-node 제외 요약, 애니메이션/skin/morph 손실 경고를 구현했다.
- Inspector에 Parent 및 Unparent를 추가했고, 최소 export validation(빈 scene, hidden root, invalid transform, non-unit scale)을 표시한다.
- fixture generator로 cube, 2-node hierarchy 및 익명화된 Meshy 유사 GLB를 생성한다. 현재 검증: Vitest 77개, Playwright Chromium 45개, ESLint, Prettier, production build, GitHub Pages base-path build를 통과했다. GLB E2E는 2-node pivot hierarchy import → primitive parenting/unparenting → transform/material/face color → GLB download → reopen과 Meshy-like cleanup round-trip을 검증한다.
- W/H/D는 editable vertex geometry로 동작하며 Keep Proportions 기본 ON/OFF, non-uniform resize, object scale bake와 normal/tangent 재정규화를 테스트했다. GLB tangent attribute는 editable vertex data와 runtime `BufferGeometry`의 VEC4 tangent로 import/render한다. Pivot/shade_pivot 생성과 group transform도 동작한다.
- `Apply Scale`은 non-uniform scale을 geometry/normal에 bake하면서 position과 rotation을 유지하고, bake 전후 world bounds를 고정한다. `Resize Geometry`도 position/rotation을 바꾸지 않으며 target local bounds와 unit scale을 unit test로 검증한다.
- Size Inspector는 parent scale을 local size edit에서 제외한다고 밝히며, negative scale은 absolute size로 보여 주고 reflection bake 시 face winding을 보정한다. zero-size/zero-scale axis는 resize를 중지하고 복구 방법을 표시하며, multi-selection은 shared gizmo transform만 허용하고 per-mesh size/bake를 명시적으로 막는다.
- Ground Plane은 표시/숨김할 수 있고, 선택 node/subtree의 world-space minimum Y가 0이 되도록 parent transform을 역산해 `Move selection to ground`로 정렬한다.
- Ground panel은 selected subtree의 current bottom을 custom ground reference로 저장하고, grid/ground plane/`Move selection to ground`/export validation이 같은 reference Y와 contact tolerance를 사용하도록 연결한다.
- Shadow Preview는 document/history에 영향을 주지 않는 viewport state다. 활성화하면 grid/axis helper를 숨기고, ground를 강제 표시하며 directional key light와 receive-shadow contrast를 높여 pivot rotation의 silhouette을 확인할 수 있다.
- Pivot mode는 0/45/90/180/270/360도 Y축 preset과 연속 rotation slider를 제공한다. Slider는 document를 바꾸지 않는 temporary preview로 viewport에만 반영되며 Apply에서만 한 Undo command로 확정되고 Cancel은 원 transform을 유지한다.
- Viewport와 Inspector는 게임 좌표계 `+Y Up · +Z Forward`를 항상 안내한다. Inspector의 Forward correction은 선택 object의 원본 front가 +Z/+X/-Z/-X 중 어디를 향하는지에 맞춰 Y yaw를 0/-90/180/90도로 보정하고, 사용자는 Game Asset Check에서 semantic +Z 방향을 별도로 확인한다.
- Vertex/Edge/Face mode는 MeshData selection, viewport overlay/클릭, Inspector 목록을 제공한다. Vertex 좌표 이동/삭제(연결 face 정리), Vertex Merge/Merge by Distance, edge midpoint subdivide(새 vertex 선택), Edge Delete/Dissolve, face normal flip/delete, 거리 입력 Extrude가 모두 command history와 연결된다.
- Topology는 immutable `MeshData` snapshot을 key로 vertex→face, vertex→edge, face→edge adjacency와 edge manifold 정보를 WeakMap cache에 저장한다. 새 mesh snapshot은 새 cache entry를 사용하므로 modeling operation 뒤 stale adjacency를 재사용하지 않는다.
- Viewport selection은 click, Shift click toggle과 Shift drag marquee를 지원한다. Marquee는 Object, Vertex, Edge, Face mode에서 화면상 element center가 사각형 안에 있는 항목을 기존 선택에 추가한다.
- Vertex/Edge/Face selection은 Inspector의 Selection Transform에서 move/rotate/scale을 한 Undo 항목으로 적용한다. Local과 World orientation을 전환할 수 있으며, World 조작은 node 및 parent transform을 역산해 editable local mesh에 저장한다.
- Edge mode의 Loop Cut은 선택한 quad edge에서 반대 edge를 따라 closed/open strip을 trace하고 위치 입력값에 맞춰 새 edge ring을 preview한다. Apply는 단일 history transaction으로 확정하고 Cancel은 원본 geometry를 복구한다. 생성된 ring을 선택하며, triangle/pole 또는 non-manifold 구간은 face ID를 포함한 이유를 표시하고 geometry를 변경하지 않는다.
- GLB import는 indexed와 non-indexed triangle input 모두를 stable editable vertex/face ID로 변환한다. 공유 position이라도 UV 또는 material corner가 달라 별도 accessor vertex인 경우 병합하지 않으며, normal/color/tangent도 각 vertex에 그대로 보존한다.
- Chromium core modeling E2E는 하나의 Cube에서 Loop Cut → vertex move → Face Extrude → one-segment Bevel → Mirror → Bend를 연속 적용하고 정확히 7개의 history command가 쌓이는 것을 확인한다.
- Edge mode의 Bevel은 one-segment manifold edge chamfer를 폭 입력으로 생성하고 새 bevel face를 선택한다. 경계, non-manifold edge, material seam은 거부한다. Topology panel은 loose component 수와 각 component의 face/vertex 수를 보여 주며, 목록에서 해당 component를 face selection으로 전환할 수 있다.
- Topology panel은 shared edge가 같은 방향으로 연결된 face winding 불일치도 검사한다. 문제가 있는 face는 Face mode에서 한 번에 선택할 수 있어 뒤집힌 normal을 확인하고 수정하기 쉽다.
- Bend는 X/Y/Z 축, 각도, local origin을 받아 선택 mesh를 circular arc로 미리보기한다. preview는 history에 기록되지 않으며 Commit으로 단일 Undo 항목이 되고 Cancel은 원본 geometry를 복구한다. Merge by Distance, Recalculate Normals, Delete Degenerate Faces는 실제 변경 수를 status message로 남긴다.
- Game Asset Check는 geometry, +Z forward 사용자 확인, unit scale, ground contact, material 참조, `shade_pivot`을 export 전 검사한다. `forwardConfirmed` metadata는 document에 저장되며 export는 Error에서만 차단하고 Warning은 결과 message에 유지한다.
- Game Asset Check는 Error/Warning/Info 의미를 구분해 표시하며, validation marker에서 관련 node를 선택할 수 있다. +Z Forward 확인, non-unit scale bake, ground 정렬, `shade_pivot` 추가는 quick fix로 제공한다.
- GLB export는 Error를 차단하고 Warning은 명시적 확인창으로 사용자에게 무시 또는 취소를 선택하게 한다. export 완료 notice에는 승인한 첫 Warning을 함께 표시한다.
- Export 전 safety gate는 메모리의 GLB를 다시 import해 visible mesh 수, world bounds, unit-scale invariant와 `shade_pivot` 보존을 확인한다. 실패하면 다운로드하지 않고 오류를 표시한다.
- Face Color mode는 현재 선택한 paint color로 viewport의 clicked face를 즉시 color하며, selected-face 일괄 paint도 유지한다. opacity가 1보다 낮으면 runtime material은 transparent/depthWrite false 정책을 사용하고, GLB round-trip E2E가 opacity 보존을 검증한다.
- Mirror는 X/Y/Z axis live preview와 seam tolerance를 제공한다. Cancel은 원본을 복구하고 Apply는 mirrored face winding을 보정한 geometry를 bake해 GLB export 대상에 그대로 사용한다. non-destructive project persistence는 Phase 5 project save와 함께 남아 있다.
- Imported triangle mesh는 Edge mode에서 Tris to Quads preview를 제공한다. shared editable edge(따라서 UV split seam 아님), 동일 material, nearly-coplanar normal 조건을 모두 통과한 pair만 quad로 합치고 Apply/Cancel은 transaction으로 처리한다.
- Face Extrude와 Inset은 거리/factor 입력으로 preview를 만들고, Commit에서 단일 history command를 생성한다. Cancel은 원본 geometry와 기존 selection을 복구한다.
- Material Inspector에서 Base Color, Roughness, Metalness, Opacity, Flat/Smooth shading을 편집하며 renderer와 GLB export가 같은 `MaterialData`를 사용한다.
- Face Color mode는 선택 face의 corner vertices에 RGB를 적용해 material 수 증가 없이 색을 저장한다. color picker, 12색 palette, 최근 8색과 지원 브라우저의 screen eyedropper를 제공하며 viewport direct paint도 유지한다.
- Topology panel은 open/non-manifold edge 및 degenerate face 수를 표시한다. Edge mode에서는 문제 edge를 구분해 강조하고, Recalculate Normals/Delete Degenerate Faces repair는 모두 Undo 가능하다.
- Topology panel은 coincident vertex group과 지정 tolerance 내 merge-safe duplicate group도 검사한다. normal/UV/color가 다른 corner seam은 보존하며, safe groups만 Merge safe duplicates cleanup으로 한 Undo 항목에서 병합한다.
- Loose component 목록에서는 해당 face group을 선택하거나 sibling mesh object로 분리할 수 있다. 분리된 object는 source의 parent, transform, material reference를 보존한다.
- 익명화된 Meshy-like fixture는 hierarchy, 다중 mesh/PBR material, UV/normal, embedded texture를 포함한다. E2E는 import 후 불필요 mesh 삭제, Face Color cleanup, export/reopen까지 회귀 검증한다.
- Primitive panel은 radial/latitude segments와 icosphere subdivisions를 설정해 Cylinder/Cone/Sphere/Icosphere의 기본 low-poly 밀도를 선택할 수 있다.
- `.shadeasset` v1은 strict JSON manifest(`format`, `formatVersion`, `document`, `editor`)로 SceneDocument와 hidden hierarchy, game metadata, valid element selection, mode/tool, ground visibility, paint color/recent palette, live Mirror modifier를 저장한다. 열기는 corrupt/dangling geometry와 미지원 버전을 원본 document를 바꾸기 전에 거부하며, reopen은 history를 비운 안전한 Undo 기준점으로 시작한다. texture/binary payload는 남은 컨테이너 확장 작업이다.
- 모든 modeling entry point는 공통 snapshot-command commit 경로를 사용한다. mixed Loop Cut → Extrude → Mirror → Bend chain은 연속 Undo에서 원본 checksum/world bounds를, 연속 Redo에서 결과 checksum/world bounds를 정확히 재현하는 unit test로 고정했다.
- Chromium Game Asset E2E는 지침의 proportional W/H/D 수치, `fixed_base` + `shade_pivot` hierarchy에서 90° pivot rotation과 Shadow Preview, 그리고 GLB reopen 뒤 2×2×2 editable size/name/parent/unit scale 보존을 확인한다. Ground의 world minimum Y는 nested-parent unit test에서 custom tolerance까지 검증한다.
- Topology가 새 vertex를 만드는 Subdivide/Loop Cut/Bevel은 normal·UV·color와 normalized tangent를 보간한다. Mirror는 reflected tangent axis와 handedness를 반전하고, vertex transform/Bend/Recalculate Normals는 stale tangent를 명시적으로 제거한다. 공통 command selection filtering과 operation별 생성 요소 selection도 이 attribute rules와 함께 회귀 테스트한다.
- `inspectMeshDataInvariants`는 supported operation 결과의 dangling vertex reference, non-finite attribute, degenerate face loop, same-direction shared-edge winding을 분리해 검사한다. Boundary/non-manifold Bevel/Dissolve/Loop Cut 거부도 원본 reference를 유지하는 unit test로 보장한다.
- Live Mirror는 source `MeshData`와 axis/seam tolerance를 project document에 유지한다. Viewport/world bounds는 같은 derived mesh를 사용하고, GLB export는 별도 document snapshot에서 modifier를 bake해 source document를 변경하지 않는다. Chromium은 project reopen 뒤 live modifier를 확인하고 GLB reopen에서 baked triangle face 수를 검증한다.
- [`boolean-technology-spike.md`](boolean-technology-spike.md)는 `three-bvh-csg`, `manifold-3d`, `@jscad/modeling`의 라이선스/패키지 크기/bridge 범위를 비교한다. `manifold-3d` WASM spike는 closed cube/cylinder와 imported cube GLB에서 세 Boolean 연산을 실행하고, open/non-manifold 입력은 SceneDocument mutation 전에 차단한다.

이 시점의 후속 작업 목록은 이후 Phase 2~5 구현과 최종 검증으로 모두 완료됐다. 현재 상태는 위의 「최종 구현 상태」를 기준으로 한다.

## 9. 후속 개발 계획 — Face Bend / Extrude + Rotate (v1.1 후보)

### 배경과 목표

현재 Face mode는 선택 면의 수치 기반 `Selection transform`과 직선 `Extrude`를 제공하지만, 새 끝면을 축 기준으로 연속 회전시키는 조작은 제공하지 않는다. 따라서 캔디 케인, 갈고리, 식물 줄기처럼 **직선 몸통은 유지하면서 끝부분만 연속적으로 휘는 튜브 형태**를 자연스럽게 만들기 어렵다.

이 Phase의 목표는 선택한 끝면을 반복적으로 밀고 회전해, 끊김 없는 저폴리 곡선을 만드는 `Face Bend` 워크플로를 제공하는 것이다. Spline/노드 기반 모델러 전체를 도입하는 것은 이 Phase의 범위가 아니다.

### 사용자 흐름

1. Face mode에서 닫힌 튜브의 끝면(cap)을 선택한다.
2. `Face Bend`에서 길이, 회전축, 각도를 정하고 Preview를 확인한다.
3. 회전 gizmo 또는 수치 입력으로 원하는 각도를 조절하고 Commit한다.
4. 새로 생성된 끝면은 자동 선택된 상태로 남는다.
5. 같은 동작을 반복해 갈고리·캔디 케인·굽은 줄기를 만든다.

### 체크리스트

- [ ] P6-001 Face Bend의 geometry 규칙을 설계한다: source cap, 새 tip ring, side face 생성, local frame, 회전 pivot 및 winding/normal 규칙을 문서화한다.
- [ ] P6-002 기존 `Extrude`가 Commit 뒤 새 tip face를 안정적으로 선택하도록 selection 계약을 보완한다.
- [ ] P6-003 Face Bend preview transaction을 구현한다. distance, local X/Y/Z bend axis, signed angle, cancel/commit을 지원한다.
- [ ] P6-004 Face mode에서 선택 끝면에만 표시되는 move/rotate gizmo를 구현한다. drag 한 번은 하나의 preview transaction으로 유지한다.
- [ ] P6-005 numeric angle 입력과 gizmo 조작이 같은 geometry 연산을 사용하도록 연결한다.
- [ ] P6-006 연속 Face Bend가 새 tip face를 자동 선택하고, 직전 local frame을 이어 받아 반복 작업할 수 있게 한다.
- [ ] P6-007 UV, vertex color, normal, tangent, material corner attribute를 새 side face와 tip ring에 보간·복제하는 규칙을 구현한다.
- [ ] P6-008 과도한 각도, 0 거리, self-intersection 가능성, 비정상 cap, open/non-manifold 입력을 preview 단계에서 안전하게 거부하거나 경고한다.
- [ ] P6-009 Unit test를 추가한다: 단일 bend bounds, 연속 bend의 face/vertex invariant, attribute 보존, Cancel, Undo/Redo checksum 복원.
- [ ] P6-010 Chromium E2E를 추가한다: Cylinder cap 선택 → 10~20° 반복 Face Bend → 연속 곡선 확인 → Face Color → GLB export/reopen.
- [ ] P6-011 Inspector 도움말, README, USER_GUIDE에 직선 Extrude와 Face Bend의 차이 및 캔디 케인 예제를 문서화한다.
- [ ] P6-012 성능 기준을 추가한다: 12면 tube에서 24회 연속 bend preview/commit이 UI 응답성과 history 예산을 넘지 않는지 측정한다.

### 완료 기준

- [ ] 12면 Cylinder의 cap을 10~20°씩 반복 Face Bend해, 직선 몸통과 연속된 갈고리가 연결된 저폴리 캔디 케인을 만들 수 있다.
- [ ] 각 단계가 별도 Undo 항목이며, 연속 Undo/Redo가 원본과 최종 mesh checksum을 정확히 복원한다.
- [ ] Preview/Cancel은 source mesh와 selection을 훼손하지 않고, Commit 뒤에는 새 tip face가 선택돼 있다.
- [ ] 생성된 결과가 유한 좌표, 유효 face loop, winding, normal, UV/color/tangent 불변조건을 만족하며 GLB 재열기까지 통과한다.
