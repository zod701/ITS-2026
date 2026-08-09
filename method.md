# 파이프라인 방법론 정리

## 개요

360° 파노라마 스트리트뷰 이미지에서 자율주행 시야 차단 구조물을 탐지하고, Bird's Eye View(BEV) 투영 및 레이캐스팅으로 음영 영역(blind zone)을 계측하는 4단계 파이프라인이다.

```
00_preprocess → 01_segmentation → 02_depth_estimation → 03_bev_shadow
   (4방향 크롭)     (ADE20K 세그멘테이션)    (단안 깊이 추정)        (BEV 투영 + 음영 계측)
```

---

## Step 0: 파노라마 전처리 (`00_preprocess.ipynb`)

### 목표
360° 파노라마(256×1536)는 좌·정면·우·후방·바닥·하늘 순서로 정확히 수평 6등분되어 있다. 이 중 바닥·하늘(오른쪽 2/6)은 버리고, 왼쪽 4/6(좌·정면·우·후)만 방향별 크롭 이미지로 추출한다.

### 입력
- `img/*.jpg` — 360° 파노라마 이미지 (36,367장, `exclude/` 하위는 비재귀 glob으로 자연 제외)

### 출력
- `output/00_front/{stem}_{dir}.jpg` — 방향별 크롭 이미지 (파노라마당 4장, 총 145,468장)
- `output/00_front/{stem}_{dir}_cam.json` — 핀홀 카메라 파라미터 (K, hfov, direction, yaw_deg)

### 방법

#### 1. 4방향 분할
파노라마를 수평 6등분하여 앞의 4구간(좌·정면·우·후방, 각 90°)만 사용한다.

| 인덱스 | 방향 | yaw_deg |
|--------|------|---------|
| 0      | left  | −90°   |
| 1      | front | 0°     |
| 2      | right | +90°   |
| 3      | back  | 180°   |

#### 2. 핀홀 카메라 파라미터 계산
각 90° 크롭에 대해 핀홀 intrinsics를 계산한다.

- HFOV = 90° (전체 360° ÷ 4)
- `fx = (W/2) / tan(HFOV/2)`
- `cx = W/2, cy = H/2`
- 행렬 K = `[[fx, 0, cx], [0, fx, cy], [0, 0, 1]]`

카메라 파라미터는 Step 3 BEV 투영 시 역투영에 사용된다.

---

## Step 1: 시맨틱 세그멘테이션 (`01_segmentation.ipynb`)

### 목표
각 방향 크롭에서 자율주행 시야를 차단하는 정적 구조물(건물, 벽, 울타리, 가로수, 기둥 등)을 픽셀 단위로 분리한다.

### 입력
- `output/00_front/*_{left,front,right,back}.jpg` — Step 0 4방향 크롭 (145,468장)

### 출력
- `output/01_seg/{stem}_{dir}_masks.npz` — `masks` (구조물 마스크), `ground_mask`, `vehicle_mask`, `road_mask`, `sidewalk_mask` (방향별 개별 저장)
- `output/01_seg/{stem}_{dir}_meta.json` — 클래스별 면적 등 메타데이터 (방향별 개별 저장)
- `output/01_seg/{stem}_{dir}_seg_vis.jpg` — 방향별 세그멘테이션 시각화
- `output/01_seg_merged/{stem}.jpg` — **[웹 업로드용]** 같은 파노라마의 left/front/right/back 시각화 4장을 yaw 순서(-90/0/90/180)대로 가로로 이어붙인 이미지. Google Drive 업로드 파일 개수를 줄이고 웹에서 파노라마와 정렬하기 쉽도록 별도 생성. 방향별 `_masks.npz`/`_meta.json`은 03 BEV가 그대로 쓰므로 삭제하지 않고 유지.

### 방법

#### 1. 모델: ADE20K Mask2Former Swin-Large
- 모델: `facebook/mask2former-swin-large-ade-semantic`
- 데이터셋: ADE20K (150클래스)
- 성능: mIoU ~56 (SegFormer-b5 mIoU ~51.8 대비 향상)
- 장점: 기둥·가장자리 등 미세 구조 분리 정확도 우수
- 하드웨어: NVIDIA RTX 3070 Ti GPU (CUDA), batch 1 추론 (~12.4 it/s)

#### 2. 클래스 분류

**시야 차단 구조물 (32클래스, `masks`):**
건물/벽/집/마천루/탑, 울타리/헤지/난간/기둥/지주/배너, 캐노피/grandstand/게시판, 나무/식물/야자수/꽃, 가로등/표지판/부스/다리/조각물/깃발, 산/언덕/바위, 텐트, 계단/계단로, 스크린 도어

**지면/하늘 클래스 (`ground_mask`, BEV 투영 제외 대상):**
sky, floor, road, grass, sidewalk, earth, field, path, runway, dirt track, land, kitchen island

**차량 클래스 (`vehicle_mask`):**
car, bus, truck, van, minibike, bicycle

**도로(차도) / 보도(인도) (`road_mask`, `sidewalk_mask`):**
BEV 시각화에서 차도 코리도로 별도 표시

#### 3. 처리 순서
1. 이미지를 RGB로 변환 후 processor를 통해 전처리
2. Mask2Former 모델로 시맨틱 세그멘테이션 추론
3. `post_process_semantic_segmentation`으로 원본 해상도 라벨맵 복원
4. 라벨맵에서 각 클래스 그룹별 마스크 생성
5. 200px 미만 소규모 영역은 노이즈로 무시
6. `.npz` 형식으로 압축 저장 (VRAM 절약을 위해 추론 직후 GPU 텐서 해제)
7. **[웹 업로드용 합치기]** 같은 파노라마(stem)의 left/front/right/back 4장이 모두 존재하면 `cv2.hconcat`으로 가로로 이어붙여 `01_seg_merged/{stem}.jpg`로 저장. 4방향 중 일부만 처리된 파노라마는 건너뛰고 다음 실행에서 재시도(이어서 실행 지원).

---

## Step 2: 단안 깊이 추정 (`02_depth_estimation.ipynb`)

### 목표
각 방향 크롭에서 픽셀별 깊이(`depth_norm`)를 추정하여 저장한다. 깊이는 Step 3 BEV에서 구조물 occluder 거리 보정에 활용된다.

### 입력
- `output/00_front/*_{left,front,right,back}.jpg` — Step 0 4방향 크롭 (145,468장)

### 출력
- `output/02_depth/{stem}_{dir}_depth.npz` — `depth_norm` (0=가깝다, 1=멀다), 방향별 개별 저장
- `output/02_depth/{stem}_{dir}_depth_vis.jpg` — plasma colormap 시각화, 방향별 개별 저장
- `output/02_depth/{stem}_{dir}_depth_meta.json` — 이미지 크기, 스케일 정보
- `output/02_depth_merged/{stem}.jpg` — **[웹 업로드용]** 01_seg_merged와 동일한 방식으로 4방향 depth 시각화를 가로로 이어붙인 이미지. `_depth.npz`/`_depth_meta.json`은 03 BEV가 그대로 쓰므로 유지.

### 방법

#### 1. 모델: Depth Anything V2 Large
- 모델: `depth-anything/Depth-Anything-V2-Large-hf`
- 파라미터: 335M
- VRAM: ~5GB
- HuggingFace `pipeline(task="depth-estimation")` 사용

#### 2. 깊이 규약
Depth Anything V2의 원시 출력은 **disparity**(값이 클수록 가까움)이다. 이를 직관적인 깊이로 변환한다.

```
disp_norm = (disp - min) / (max - min)   # 0~1, 1=가까움
depth_norm = 1.0 - disp_norm             # 0=near, 1=far
```

- `DEPTH_SCALE = 50.0` m: 근사 최대 가시거리 (절대 스케일 없는 단안 추정이므로 참고값)
- 절대 거리 변환: `depth_m ≈ depth_norm × DEPTH_SCALE` (근사)
- **주의**: 각 방향의 depth_norm은 이미지별로 독립적으로 min-max 정규화되므로, 4방향을 합쳐 하나의 이미지로 재추론하면 정규화 기준이 뒤섞여 결과가 왜곡된다. 그래서 깊이 추정 자체는 반드시 방향별로 독립 수행하고, 합치기는 시각화 jpg에만 적용한다.

#### 3. 처리 순서
1. 이미지를 PIL RGB로 변환 후 pipeline 추론
2. disparity를 depth_norm으로 변환 (뒤집기)
3. plasma colormap으로 시각화 이미지 저장
4. `.npz`로 압축 저장
5. **[웹 업로드용 합치기]** 01_segmentation과 동일한 방식으로 4방향 depth 시각화를 파노라마 단위로 합쳐 `02_depth_merged/{stem}.jpg`로 저장.

---

## Step 3: BEV 투영 및 음영 계측 (`03_bev_shadow.ipynb`)

### 목표
Step 0~2의 결과(크롭 이미지, 카메라 파라미터, 구조물/지면/차량 마스크, 깊이)를 통합하여 파노라마 1장당 360° Bird's Eye View 격자를 생성하고, 레이캐스팅으로 음영(blind zone)을 계측 및 시각화한다.

### 입력
- `output/00_front/{pano}_{dir}_cam.json` 및 `{pano}_{dir}.jpg`
- `output/01_seg/{pano}_{dir}_masks.npz`
- `output/02_depth/{pano}_{dir}_depth.npz`

### 출력
- `output/03_bev/{pano}_bev360.jpg` — 3×1 세로 시각화 패널 (occupancy / shadow-buildings / shadow-+side-vehicles)
- `output/03_bev/{pano}_dsi.json` — L_vis, A_shadow, DSI 등 계측값

### BEV 격자 파라미터
| 파라미터 | 값 |
|---|---|
| 해상도 (`GRID_RES`) | 0.5 m/px |
| 최대 가시거리 (`MAX_RANGE`) | 60.0 m |
| 캔버스 크기 | 240×240 px (카메라 중심 기준 반경 60m) |
| 카메라 높이 가정 (`CAM_HEIGHT`) | 2.5 m (스트리트뷰 리그) |
| 레이 수 (360°) | 720 |

### 방법

#### 1. IPM (Inverse Perspective Mapping) 기반 BEV 투영

단안 깊이를 광선거리로 직접 사용하면 수직 벽의 중간 높이 픽셀이 멀리 찍혀 가까운 벽이 BEV에 바깥·앞으로 퍼지는 문제가 발생한다. 이를 IPM으로 교체한다.

**기본 가정:** 평지(pitch ≈ 0), 카메라 높이 `CAM_HEIGHT` 고정

**지면 접점 역투영:**
- 각 열(column)에서 장애물의 최하단 픽셀 `(u, v_base)`를 찾는다.
- 이 픽셀이 지면에 닿는 거리를 역투영한다:
  - `Z = CAM_HEIGHT × fy / (v_base − cy)`
  - `X = (u − cx) / fx × Z`

**발자취 연속화:**
- 열별 Z 프로파일에 median 평활(window=5)을 적용해 노이즈 스파이크 제거
- 인접 열의 투영점을 |ΔZ| < 4.0m일 때 선분으로 연결 → 연속 벽은 메우고 실제 틈은 남김
- 3×3 dilate로 레이 누락 방지

#### 2. 깊이 보정 (Depth Calibration)

IPM의 폴백으로, 단안 깊이를 도로 평면 픽셀로 metric calibration한다.

**방식:** affine 정합 `1/Z = a × disp + b`
- 도로 픽셀(화면 하단 절반, 지평선 아래)만 사용 (IPM이 신뢰되는 영역)
- 최소제곱법으로 a, b 추정 후 결정계수(R²) 계산
- R² ≥ 0.5이면 보정 깊이 사용, 미달 시 IPM 폴백

#### 3. 차량 분류 처리

**전방/후방 (front/back):**
- Connected Components로 차량을 개체 단위로 분리
- 중앙 cone(±15°) 내 차량: 촬영 차량과 co-moving으로 판단 → occluder 제외, 시각화만
- 중앙 cone 외 측면 차량: occluder로 처리

**좌/우 (left/right):**
- 모든 차량을 occluder로 처리

**본네트 제외:** 하단 25% 영역은 촬영 차량 본네트로 판단하여 BEV 투영에서 제외 (`ground_mask`에 포함)

#### 4. 지면/도로 투영 (시각화 전용)

도로·보도 픽셀을 IPM으로 면 채우기 투영하여 BEV에 '차도 코리도'로 표시한다.
- 각 열의 도로 픽셀을 v 순서로 투영 후 연속 픽셀을 선분으로 연결
- v 간격이 `2 × subsample`을 초과하면 연결하지 않음 (실제 도로 끊김 보존)

#### 5. 4방향 360° 병합

각 방향(yaw_deg)별로 생성된 BEV 레이어를 카메라 중심 240×240 캔버스에 OR 병합한다.

**좌표 변환 (`xz_to_cr`):**
```
col = CENTER_col + (Z × sin(yaw) + X × cos(yaw)) / GRID_RES
row = CENTER_row + (−Z × cos(yaw) + X × sin(yaw)) / GRID_RES
```

**병합 레이어 (우선순위 순):**
1. 보도(sidewalk) — 황갈색
2. 차도(road) — 짙은 회색
3. 기타 non-blocker — 연두색
4. 구조물 occluder — 빨간색
5. co-moving 차량 — 옅은 파랑
6. 측면 차량 occluder — 주황색

#### 6. 360° 레이캐스팅 및 음영 계측

카메라 중심에서 0~360° 방향으로 720개의 레이를 발사하여 첫 occluder 이후 영역을 음영(blind zone)으로 표시한다.

**레이 보행 파라미터:**
- 보행 간격: `GRID_RES × 0.7 = 0.35 m`
- 최대 보행 횟수: `MAX_RANGE / step = 171회`

**계측 지표:**

| 지표 | 설명 |
|---|---|
| `L_vis` | 정면 ±10° 레이의 hit 거리 중앙값 (m) |
| `A_shadow` | 음영 셀 수 × GRID_RES² (m²) |
| `A_total` | 360° 원판 면적 = π × MAX_RANGE² ≈ 11,310 m² |
| `D_stopping` | 제동 거리 = v×1s + v²/(2×μ×g) (반응 1s + 제동, μ=0.7) |
| `DSI_static` | `(D_stopping / L_vis) × (1 + A_shadow/A_total) × (1 + V_heavy)` |

**DSI 등급:**
- Safe: DSI < 1.0
- Caution: 1.0 ≤ DSI < 1.8
- High-risk: DSI ≥ 1.8

두 가지 시나리오를 비교 계산:
1. **건물만** (구조물 occluder만 사용)
2. **건물 + 측면 차량** (구조물 + 측면 차량 occluder 포함)

#### 7. 시각화 (3×1 세로 패널)

웹에서 파노라마(가로로 긴 4방향 크롭을 세로로 나열)와 나란히 배치하기 쉽도록, BEV 결과도 세로로 긴 이미지 하나로 저장한다.

| 위치 | 내용 |
|---|---|
| Row 1 | 360° BEV occupancy 격자 |
| Row 2 | 360° Shadow (건물만) + 레이 화살표 + L_vis/A_shadow/DSI |
| Row 3 | 360° Shadow (+측면 차량) + 동일 지표 |

---

## 처리 결과 요약

| 단계 | 입력 | 출력 |
|---|---|---|
| Step 0 | 36,367장 파노라마 | 145,468장 크롭 (36,367 × 4방향) |
| Step 1 | 145,468장 크롭 | 145,468장 마스크(방향별) + 36,367장 합친 시각화(`01_seg_merged`) |
| Step 2 | 145,468장 크롭 | 145,468장 깊이맵(방향별) + 36,367장 합친 시각화(`02_depth_merged`) |
| Step 3 | 36,367개 파노라마 단위 | 36,367장 BEV(3×1 세로) + DSI JSON |

---

## 주요 설계 결정

1. **ADE20K Mask2Former 채택**: COCO에 없는 방음벽·옹벽·교각 등 도시 구조물을 위해 150클래스 ADE20K 모델 사용. SegFormer-b5 대비 mIoU +4~5 향상.

2. **단안 깊이 → IPM 교체**: 단안 깊이로 수직 벽 위치를 추정할 때 발생하는 '벽이 BEV에 바깥으로 퍼지는' 오류를 IPM(지면 접점 역투영)으로 해결. 깊이는 R² ≥ 0.5인 경우에만 보정 거리로 보조 활용.

3. **co-moving 차량 제외**: 전/후방 중앙 ±15° 차량은 촬영 차량과 동행하는 것으로 간주하여 음영 계측에서 제외. 측면 차량만 occluder로 처리.

4. **360° 병합**: 단일 정면뷰 대신 4방향을 카메라 중심 격자에 병합함으로써 후방·측방 시야 차단까지 종합 계측. DSI의 A_total도 이에 맞춰 원판 면적(π×60²)으로 변경.

5. **GPU 추론은 방향별 독립 유지, 시각화만 병합**: Google Drive 업로드 파일 개수를 줄이고 웹에서 파노라마와 정렬하기 쉽도록, Step 1/2의 세그멘테이션·시각화 jpg는 파노라마 단위로 4방향을 가로로 이어붙여 별도 저장한다(`01_seg_merged`, `02_depth_merged`). 단, 세그멘테이션 추론과 깊이 추정 자체는 반드시 방향별로 독립 수행한다 — 특히 깊이는 방향별 disparity가 독립적으로 min-max 정규화되므로, 4방향을 하나로 합쳐 재추론하면 정규화 기준이 뒤섞여 결과가 왜곡된다. `.npz`/`.json`(마스크, 깊이, 카메라 K)은 Step 3이 방향별로 그대로 사용하므로 병합하지 않고 유지한다.

6. **Step 3 시각화 3×1 세로 레이아웃**: 웹에서 파노라마(가로로 긴 4방향을 세로로 나열해 표시)와 BEV 결과(세로로 긴 이미지)를 나란히 배치하기 위해, 기존 2×4 패널(세그멘테이션 썸네일 + occupancy/shadow×2/hazard)에서 세그멘테이션 썸네일 행과 hazard 패널을 제거하고 occupancy·shadow(건물만)·shadow(+측면차량) 3개 패널만 세로로 쌓아 저장한다. Method A(Emergence/H_leak) 관련 계산·시각화 코드는 이 과정에서 전부 제거했다.
