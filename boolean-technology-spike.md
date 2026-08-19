# Boolean 기술 검증 기록

2026-08-20 기준 Phase 5 Boolean 후보를 비교한 뒤 `manifold-3d`를 채택해 editor에 연결했다. 이 문서는 채택 근거와 계속 적용되는 안전 정책을 기록한다.

## 후보 비교

| 후보 | 버전 | 라이선스 | npm unpacked size | 직접성/강점 | 현재 보류 사유 |
|---|---:|---|---:|---|---|
| `three-bvh-csg` | 0.0.18 | MIT | 1.39 MB | Three.js `BufferGeometry`와 가장 직접적으로 연결 | `three-mesh-bvh` peer가 추가되며, 복잡한 imported topology의 실패/attribute 정책을 별도 검증해야 함 |
| `manifold-3d` | 3.5.1 | Apache-2.0 | 2.76 MB | WASM 기반, closed solid의 robust manifold output과 Difference/Union/Intersection API 제공 | result가 triangle mesh이며 material/UV/tangent 재매핑 정책과 lazy-load bundle gate가 필요 |
| `@jscad/modeling` | 2.13.0 | MIT | 1.59 MB | 성숙한 CSG API | editor `MeshData`/Three.js bridge가 직접적이지 않고 의존성 및 renderer conversion 범위가 큼 |

`manifold-3d`는 Triangle mesh를 `Mesh`로 넣고 `Manifold.ofMesh()`로 closed solid를 검증한다. `add`, `subtract`, `intersect` 결과에서 `getMesh()`로 triangle output을 읽는다. WASM object는 반드시 `delete()`로 해제한다.

## Spike 결과와 안전 정책

- `src/editor/geometry/boolean-spike.ts`는 source `SceneDocument`를 절대 변경하지 않고 `MeshData` 결과만 반환한다.
- cube/cylinder에서 Difference, Union, Intersection을 실행했고, imported GLB cube fixture도 Difference를 통과했다.
- open plane, dangling reference, non-finite attribute, degenerate loop, inconsistent winding, boundary/non-manifold edge는 WASM 호출 전에 거부한다.
- result도 dangling reference, non-finite data, degenerate triangle, winding invariant를 다시 검사한다. 실패나 empty result는 command를 만들지 않는 에러가 된다.
- 결과는 subject의 첫 face material ID를 사용한 triangle mesh가 된다. runtime bridge가 missing normal을 재계산하고, 기존 UV/vertex color/tangent의 per-face 재투영은 결과물에 보장하지 않는다. 이 제한은 Boolean panel에 preview/commit이 가능한 closed-solid workflow 범위로 고정한다.
- UI는 선택 순서상 첫 mesh를 subject, 두 번째 mesh를 cutter로 사용한다. Difference/Union/Intersection preview는 transient 상태이며 Commit만 subject 교체·cutter 제거를 단일 Undo command로 기록한다.
- Chromium E2E는 preview 원본 보존, Commit, Undo/Redo, GLB export/reopen을 검증한다.

## Release gate 결과

1. Dynamic import와 production bundle 측정을 통과했다. Boolean bridge는 약 1.75 KiB gzip, WASM은 필요 시에만 약 207.94 KiB gzip으로 로드된다.
2. Cutter selection/preview는 source document를 바꾸지 않으며 Commit은 하나의 Undo command다.
3. Triangle output의 subject material ID, normal 생성, Undo/Redo, GLB reopen을 Chromium에서 통과했다.
4. Invalid input, empty result, WASM initialization failure는 source/cutter를 보존하고 구체적인 notice를 표시한다.
