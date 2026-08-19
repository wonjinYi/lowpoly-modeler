# Low-Poly Asset Editor
## Codex 개발지시서 — 간소화 v1.0

## 1. 목적

`Who Ordered Some Shade? / 그늘 시키신 분?` 개발에 사용할 **로우폴리 3D 모델 제작·수정 웹 애플리케이션**을 만든다.

게임 자체에 포함되는 기능은 아니다.

주요 용도는 두 가지다.

1. Primitive부터 간단한 low-poly asset을 직접 제작
2. Meshy AI에서 생성한 GLB를 가져와 게임용으로 수정·정리

Blender 전체를 복제하지 않는다.

**게임 에셋 제작에 실제로 필요한 기능만 구현한다.**

---

# 2. 실행 조건

- Vite
- TypeScript
- Three.js
- Desktop browser 우선
- GitHub Pages 배포
- 서버 없음
- 로그인 없음
- 외부 API 없음
- 파일 업로드 서버 없음

GLB, texture, project file 등 모든 파일은 사용자의 로컬 파일을 직접 읽는다.

모델링, texture 처리, GLB export 등 모든 작업은 브라우저 안에서 수행한다.

---

# 3. 기본 화면

대략 다음 구조로 만든다.

```text
┌─────────────────────────────────────────────┐
│ File / Edit / Mode / Tools                  │
├──────────┬─────────────────────┬────────────┤
│          │                     │            │
│ Outliner │     3D Viewport     │ Inspector  │
│          │                     │            │
├──────────┴─────────────────────┴────────────┤
│ Status / Validation                        │
└─────────────────────────────────────────────┘
```

3D Viewport가 화면에서 가장 큰 영역이어야 한다.

---

# 4. 지원 파일

## Open

우선 지원:

- `.glb`

향후 필요하면 `.gltf` 추가.

Drag & Drop도 지원한다.

## Export

게임 투입용:

- `.glb`

## Project Save

작업을 이어가기 위한 별도 프로젝트 파일도 제공한다.

가칭:

```text
.shadeasset
```

GLB와 프로젝트 파일은 목적이 다르다.

---

# 5. Modeling Mode

다음 Mode를 제공한다.

- Object
- Vertex
- Edge
- Face
- Pivot
- Face Color
- Texture Paint

현재 Mode를 화면에서 명확하게 표시한다.

---

# 6. Primitive 생성

다음 기본 모델을 새로 만들 수 있어야 한다.

- Cube
- Plane
- Cylinder
- Cone
- Sphere
- Icosphere

간단한 low-poly prop은 여기서부터 직접 제작한다.

---

# 7. Vertex / Edge / Face 편집

## Vertex

- 선택
- 다중 선택
- 이동
- 회전
- 크기 변형
- Merge
- Delete

## Edge

- 선택
- 이동
- Delete
- Dissolve
- Bevel
- Subdivide

## Face

- 선택
- 이동
- 회전
- 크기 변형
- Extrude
- Inset
- Delete
- Flip Normal

---

# 8. Subdivide / Loop Cut

직접 모델링에서 중요하므로 v1 필수 기능으로 취급한다.

## Subdivide

선 하나 또는 여러 개를 나누어 중간에 새로운 vertex를 만든다.

예:

```text
A────────B
```

↓

```text
A────C────B
```

새로 생긴 C를 이동하여 형태를 세밀하게 바꿀 수 있어야 한다.

## Loop Cut

연결된 mesh를 한 바퀴 따라 edge loop를 추가한다.

옷, 기둥, 몸통 등의 형태를 만들 때 사용한다.

예:

```text
┌─────────┐
│         │
├─────────┤
│         │
├─────────┤
│         │
└─────────┘
```

이후 각 vertex를 움직여 어깨, 허리, 밑단 등의 실루엣을 만든다.

Knife Tool은 후순위로 둔다.

---

# 9. Mirror

Mirror 기능은 필수다.

옷, 캐릭터 부품, 피아노, 가구 등 좌우 대칭 모델을 쉽게 제작할 수 있어야 한다.

지원:

- X Mirror 우선
- 필요하면 Y/Z 추가

한쪽 geometry를 수정하면 반대쪽에 대칭 결과가 표시되어야 한다.

초기 구현에서는 복잡한 Blender Modifier Stack 전체를 만들 필요는 없다.

---

# 10. Bend

선택한 geometry를 간단히 구부릴 수 있어야 한다.

필요 항목:

- Bend Axis
- Bend Angle
- Bend Origin

옷, 천 형태, 곡선형 prop 등에 사용한다.

---

# 11. 구멍 만들기

두 방식을 모두 지원한다.

## A. Face 삭제

Face를 삭제해서 열린 구멍을 만든다.

## B. Boolean Difference

Cylinder나 Cube 같은 cutter를 사용해서 실제로 관통된 구멍을 만든다.

Boolean은 다음을 지원한다.

- Difference
- Union
- Intersection

Boolean 구현은 안정적인 browser/WASM library를 기술 검증한 뒤 채택한다.

Boolean 때문에 프로그램 전체 구조를 지나치게 복잡하게 만들지 않는다.

---

# 12. Object Transform

일반적인 작업용 Transform을 제공한다.

- Position
- Rotation
- Scale

단 여기서 `Scale`은 **작업 중 Transform Scale**이다.

다음의 실제 크기 조절 기능과 절대 혼동하지 않는다.

---

# 13. 실제 모델 크기 변경 — 매우 중요

별도의 **Size / Resize Geometry** 기능을 만든다.

이 기능은 Object의 `scale` 숫자만 바꾸는 기능이 아니다.

**vertex 위치 자체를 변경하여 geometry의 실제 크기를 바꾼다.**

최종 GLB를 Three.js에서 불러왔을 때:

```ts
model.scale.x === 1
model.scale.y === 1
model.scale.z === 1
```

이어야 한다.

게임 코드에서 별도의 scale 보정을 하지 않고 사용할 수 있어야 한다.

---

# 14. W / H / D 크기 입력

Inspector에 실제 Bounding Size를 표시한다.

```text
SIZE

W  [ 0.80 ]
H  [ 1.50 ]
D  [ 0.60 ]

🔒 Keep Proportions
```

- W = Width
- H = Height
- D = Depth

기본적으로 `Keep Proportions`는 ON이다.

---

# 15. 하나의 값만 입력하는 크기 조절

`Keep Proportions = ON` 상태에서는 W / H / D 중 **하나만 변경하면 나머지 두 값도 같은 비율로 자동 변경**한다.

예:

현재:

```text
W = 2
H = 4
D = 1
```

사용자가:

```text
H = 1.5
```

입력.

배율:

```text
1.5 / 4 = 0.375
```

결과:

```text
W = 0.75
H = 1.50
D = 0.375
```

이어야 한다.

이 값을 Object Scale에 넣는 것이 아니다.

모든 vertex 좌표를 같은 비율로 변경한다.

처리 후:

```text
Scale X = 1
Scale Y = 1
Scale Z = 1
```

이어야 한다.

---

# 16. Apply Scale

작업 과정에서 Object Scale을 사용했다면:

**Apply Scale**

기능을 제공한다.

예:

```text
Scale = 0.5, 0.5, 0.5
```

↓

Apply Scale

↓

geometry vertex 자체가 절반 크기로 변경되고:

```text
Scale = 1, 1, 1
```

이 된다.

GLB export 전 Object Scale이 `(1,1,1)`이 아니면 경고한다.

---

# 17. 비율 잠금 해제

`Keep Proportions`를 OFF 하면 W/H/D를 독립적으로 변경할 수도 있다.

예:

```text
W = 1.2
H = 2.0
D = 0.5
```

각 축에 맞게 실제 vertex geometry를 변경한다.

하지만 기본값은 항상:

**Keep Proportions ON**

으로 한다.

---

# 18. Meshy GLB 수정

Meshy GLB를 불러온 뒤 최소 다음을 할 수 있어야 한다.

- 불필요한 mesh 삭제
- object 분리/정리
- vertex 수정
- edge 수정
- face 수정
- Subdivide
- Loop Cut
- Extrude
- Inset
- Bevel
- Mirror
- Bend
- 실제 크기 조정
- 색상 변경
- material 수정
- pivot 지정
- hierarchy 수정
- GLB export

---

# 19. 간단한 Mesh Cleanup

초기 버전에서 복잡한 자동 topology repair를 만들 필요는 없다.

대신 최소 다음을 지원한다.

### 검사

- open edge
- non-manifold edge
- 이상한 normal
- degenerate face
- 작은 분리 geometry
- duplicate vertex

### 간단한 수정

- Merge by Distance
- Recalculate Normals
- Delete Degenerate Faces
- 작은 분리 object 선택/삭제

고급 자동 복원 기능은 후순위다.

---

# 20. Flat / Smooth Shading

Mesh 또는 선택 Face에:

- Flat
- Smooth

를 설정할 수 있어야 한다.

Low-poly asset 제작에서 자주 사용할 기능이다.

---

# 21. 면별 색칠

Face Color Mode를 제공한다.

Face를 클릭하고 색을 선택하여 바로 칠할 수 있어야 한다.

필수:

- Face Click Paint
- Selected Faces Paint
- Eyedropper
- Palette
- Recent Colors

단순 색상 때문에 Material을 수십 개 생성하지 않는다.

가능하면 vertex color를 활용한다.

---

# 22. Material

간단한 material 수정만 제공한다.

- Base Color
- Roughness
- Metalness
- Opacity

복잡한 Shader Node Editor는 만들지 않는다.

게임 asset은 기본적으로:

- opaque
- matte
- low metalness

를 권장한다.

현재 게임 아트 역시 큰 color block과 matte surface를 핵심으로 사용한다.

---

# 23. Texture Paint

Texture Paint도 필요하지만 **v1 핵심 모델링 기능보다 우선하지 않는다.**

지원 목표:

- Paint Brush
- Eraser
- Eyedropper
- Brush Size
- Opacity

기존 UV가 있는 GLB는 그 UV 위에 직접 그린다.

UV가 없을 경우 자동 UV 생성 기능은 후속 단계에서 추가한다.

본격적인 Blender식 UV Editor는 만들지 않는다.

---

# 24. Pivot / Origin

여러 Pivot을 만들 수 있어야 한다.

기능:

- Create Pivot
- Move Pivot
- Rename Pivot
- Parent Mesh
- Unparent Mesh
- Local Axis 표시

게임용 회전축으로 다음 이름을 사용할 수 있어야 한다.

```text
shade_pivot
```

---

# 25. `shade_pivot`

예:

```text
asset_root
├── fixed_base
└── shade_pivot
    ├── arm
    └── canopy
```

`shade_pivot`을 Y축으로 돌리면:

- arm 회전
- canopy 회전
- fixed_base 고정

이어야 한다.

Pivot을 bounding box center로 강제하지 않는다.

사용자가 직접 정확한 위치를 지정한다.

---

# 26. Pivot Rotation Preview

Pivot을 선택하고:

```text
0°
45°
90°
180°
270°
360°
```

또는 Slider로 돌려볼 수 있어야 한다.

실제 geometry hierarchy가 올바른지 바로 확인한다.

---

# 27. 방향

게임용 GLB 기본 규칙:

```text
+Y = UP
+Z = FORWARD
```

Viewport에서 축을 항상 확인할 수 있어야 한다.

Meshy에서 가져온 모델의 원래 방향을 그대로 신뢰하지 않는다.

사용자가 semantic forward를 확인하고 수정할 수 있게 한다.

---

# 28. Ground

Ground Plane을 보여준다.

Asset이 바닥에 제대로 닿는지 확인할 수 있어야 한다.

기능:

- Move Model to Ground
- Set Ground Reference

---

# 29. Outliner

GLB hierarchy를 볼 수 있어야 한다.

예:

```text
Parasol
├─ Base
├─ Pole
└─ shade_pivot
   ├─ Arm
   └─ Canopy
```

지원:

- 선택
- Rename
- Hide
- Delete
- Parent
- Unparent

---

# 30. Undo / Redo

모델링 도구에서는 필수다.

최소 다음 작업을 Undo/Redo 할 수 있어야 한다.

- Transform
- Resize Geometry
- Apply Scale
- Vertex Edit
- Edge Edit
- Face Edit
- Extrude
- Inset
- Bevel
- Subdivide
- Loop Cut
- Mirror
- Bend
- Color
- Pivot
- Delete

---

# 31. Shadow Preview

이 게임에서는 그림자가 gameplay에 직접 사용되므로 별도 Preview를 제공한다.

구성:

- Ground Plane
- Directional Light
- Cast Shadow
- Receive Shadow
- Orbit Camera

모델을 돌려가며 그림자 실루엣을 확인할 수 있어야 한다.

특히 `shade_pivot` 회전 중 그림자 변화 확인이 중요하다.

---

# 32. GLB Export Validation

Export 전에 최소 다음을 검사한다.

```text
GAME ASSET CHECK

✓ Geometry valid
✓ +Y Up
✓ +Z Forward
✓ Scale = 1 / 1 / 1
✓ Ground contact
✓ Materials
✓ shade_pivot

! Open edge detected
```

모든 항목을 무조건 Error 처리하지 않는다.

Error와 Warning을 구분한다.

---

# 33. 가장 중요한 Scale Export 규칙

게임용 GLB export에서 **최종 Object Scale은 원칙적으로 `(1,1,1)`이어야 한다.**

사용자가 실제 크기를 바꾸면:

```text
Bounding Size 변경
        ↓
Vertex Position 변경
        ↓
Geometry 실제 크기 변경
        ↓
Transform Scale = 1 / 1 / 1
```

형태로 처리한다.

게임 코드에서:

```ts
model.scale.set(...)
```

를 해야 정상 크기가 되는 asset을 기본 결과물로 만들지 않는다.

---

# 34. 개발 우선순위

## Phase 1 — 기본 Editor

- Three.js Viewport
- GLB Open
- Primitive 생성
- Outliner
- Object Transform
- Undo / Redo
- GLB Export

## Phase 2 — 직접 Modeling

- Vertex
- Edge
- Face
- Subdivide
- Loop Cut
- Extrude
- Inset
- Bevel
- Merge
- Mirror
- Bend

## Phase 3 — 게임 Asset 기능

- 실제 W/H/D Resize
- Apply Scale
- +Y/+Z
- Ground
- Pivot
- `shade_pivot`
- hierarchy
- Shadow Preview

## Phase 4 — 색 / Meshy Cleanup

- Face Color
- Material
- Flat/Smooth
- 간단한 Mesh 검사
- 간단한 Repair

## Phase 5 — 고급 기능

- Boolean
- Texture Paint
- Auto UV
- Project Save

---

# 35. 처음부터 만들지 않을 것

초기 범위 제외:

- Sculpt
- Rigging
- Animation
- Skinning
- Cloth Simulation
- Physics
- Geometry Nodes
- Shader Nodes
- Full UV Editor
- CAD 기능
- 복잡한 자동 Retopology
- 고급 자동 Topology Repair
- Cloud Save
- AI Generation

---

# 36. Codex 구현 원칙

한 번에 전체 기능을 구현하지 않는다.

각 Phase마다:

1. 현재 코드 조사
2. 구현 계획
3. 구현
4. Unit Test
5. 실제 Chromium에서 테스트
6. Production Build
7. GitHub Pages 환경 검증
8. 남은 문제 보고

순서로 진행한다.

---

# 37. 테스트에서 가장 중요한 것

다음 round-trip을 반드시 검증한다.

```text
GLB Open
→ Edit
→ Resize
→ Pivot 설정
→ Color 수정
→ Export GLB
→ 다시 Open
```

다시 열었을 때:

- 실제 크기
- geometry
- color
- material
- hierarchy
- pivot
- node name

이 유지되어야 한다.

특히 최종 GLB는:

```text
Scale = 1 / 1 / 1
```

인지 확인한다.

---

# 38. 최종 목표

이 프로그램에서 다음 작업이 가능해야 한다.

## 직접 제작

```text
Primitive
→ Subdivide / Loop Cut
→ Vertex / Face 수정
→ Extrude
→ Bevel
→ Mirror / Bend
→ Face Color
→ 실제 크기 지정
→ Pivot
→ GLB
```

## Meshy 후처리

```text
Meshy GLB
→ Open
→ Geometry 수정
→ 필요 없는 부분 삭제
→ 형태 보정
→ 색/Material 정리
→ 실제 크기 지정
→ +Y / +Z 정리
→ Pivot 지정
→ Shadow 확인
→ GLB Export
```

이 두 workflow가 빠르고 안정적으로 동작하는 것을 최우선 목표로 한다.