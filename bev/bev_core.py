"""03 BEV 코어: 공동 metric 보정 -> 점군 -> 방사 프로파일 -> 도로 차폐율.

노트북에 인라인하지 않고 모듈로 둔 이유는, 이 수식들이 독립 스크립트로 검증됐고
검증 코드와 노트북이 같은 구현을 공유해야 어긋나지 않기 때문이다.
(같은 이유로 만든 선례: bev_render_worker.py, road_prep.py)

파이프라인
  01 마스크 + 02 disparity + GIS
    -> calibrate_panorama : 4면 affine(a_d,b_d) + 공유 지면평면 n 동시 적합
    -> face_points        : metric 3D 점군, 지면 위 높이
    -> radial_profile     : 720방향 r(theta) (극좌표 히스토그램 + 누적 투표)
    -> refine_pose        : road_mask BEV 를 실폭도로 폴리곤에 등록
    -> road_occlusion     : 도로를 따라 R 이내 구간 중 안 보이는 길이 비율
"""
import heapq
import json
import math
from pathlib import Path

import numpy as np

# ── 기하 (큐브맵 면) ────────────────────────────────────────────────
FX = FY = 128.0
CX = CY = 127.5          # 256px 면의 올바른 주점. 00 은 128.0 을 저장하므로 디스크 K 를 읽지 않는다
DIRS = {"left": -90.0, "front": 0.0, "right": 90.0, "back": 180.0}
ORDER = ["left", "front", "right", "back"]
SEAMS = [("left", "front"), ("front", "right"), ("right", "back"), ("back", "left")]

# ── 분석 파라미터 (전부 실측으로 정한 값) ──────────────────────────
R_MAX = 40.0             # D_stop(50km/h)=27.95m 커버, 양자화 상대오차 <=14%
H_BAND = (1.0, 3.0)      # 지면 위 시선 차단 대역. 하한 1.0m 미만이면 연석·잔디가 차단물로 잡힌다
R_MIN_EGO = {"left": 1.0, "front": 3.0, "right": 1.0, "back": 3.0}   # 면별 최소 거리 (m)
# 전역 3.0 이었다. 자차는 front/back 화면을 크게 차지하지만 left/right 에는 거의 없다
# (근접빈도 front/back 1% vs left/right 10%) -- 보닛·트렁크가 01 의 vehicle_mask 로 빠지기
# 때문이다. 그래서 이 필터가 좌우에서 지우던 것은 대부분 진짜 근접 벽이었다.
# 같은 edge 이웃과의 차폐율 spearman (740장):
#   전역3.0 0.591 | 전역2.0 0.586 | fb3.0/lr1.5 0.603 | fb3.0/lr1.0 0.598 | fb3.0/lr0.5 0.595
# 앞뒤를 3.0 으로 유지하는 것이 핵심이다 -- 전역 2.0 은 전방 차량까지 근접 차단물로 잡아
# '차량 뒤라 판정 제외'가 0.060 -> 0.153 으로 뛴다(fb3.0 계열은 0.060 유지).
# 남는 한계: 수직거리 1m 이내의 평행한 벽은 정면 방향이 여전히 지워진다
# -- 벽이 평행하면 정중앙이 가장 가까워 임계에 먼저 걸리기 때문이다. (X-20)
GRAD_REJECT_REL = 0.15   # 인접 픽셀 |dZ|/Z 상한. 상대 기준이라 disp 스케일이 바뀌어도 유효
N_BINS = 720             # 0.5도
RADIAL_CELL = 0.5        # m
MIN_VOTES = 3
BACKGROUND_CLASS_IDS = {16, 68}   # mountain, hill: 수 km 밖이라 40m 유령 벽이 된다

SEAM_W = 3.0             # 이음매 행 가중치. 과하면 적합에 쓴 이음매만 맞고 나머지가 나빠진다
SKY_Q = 0.2              # 이음매 열에서 제거할 하위 disparity 분위 (하늘)
SUB = 3                  # 지면 픽셀 서브샘플
TILT_PRIOR = 3e-3
TILT_MAX_DEG = 8.0       # 4.0 이었다. 수평 강제(n=(0,1,0))가 지면이 실제로 기운 곳에서
                         # 거리에 비례하는 높이 오차를 만들어(40m·4deg = 2.8m = 시선대역 폭 전체)
                         # 원거리 도로를 통째로 차단물로 만들었다. 같은 도로 이웃 대비 초과
                         # 차폐 +0.230 -> +0.080. 8deg 초과에서는 원 적합의 이음매 잔차가
                         # 오히려 나빠져(0.114 vs 0.086) 클램프가 제 역할을 한다. (계획서 D-12/X-08)
CAM_HEIGHT_DEFAULT = 2.5  # **전 파노라마 공통** (D-25). CSV 의 (camera_altitude-land_altitude)
                          # 는 고도 1m 반올림 탓에 2.0/3.0 으로 튀는 잡음이다 -> X-35

GROUND_PX_MIN = 300      # 한 면이 '지면을 봤다'고 인정하는 최소 픽셀 수
FACES_MIN_VALID = 2      # 이 미만이면 보정이 식별되지 않는다 -> 값을 내지 않는다 (D-14)
ROAD_UNKNOWN_MAX = 0.5   # 차량 뒤라 모르는 도로가 이 비율을 넘으면 판정하지 않는다 (D-15)
ON_ROAD_MAX = 5.0        # 카메라가 실폭도로 폴리곤에서 이만큼 넘게 벗어나면 판정하지 않는다
                         # (D-19 로 도입, D-24 로 2.0 -> 5.0).
                         # 옛 기준(탐색 한계에 붙은 pose 개수 >= 2, D-16)은 within-edge 판별력이
                         # 정확히 0 이었다: 이탈도 차 +0.005 +- 0.002 로 무작위 50% 대조군(-0.002)
                         # 과 구분되지 않는다. (X-25)
                         # 2.0 이 아니라 5.0 인 이유: 2~5m 띠의 초과 차폐는 +0.018 (t=3.1) 로
                         # 유의하지만 **부호가 양수** 다 -- 위험을 높게 말하는 쪽이라 게이트가 아니라
                         # 신뢰도로 다룰 문제다. 5m 부터는 근거리 포함률이 0.21 -> 0.01 로 무너져
                         # '무엇을 쟀는지 모르는' 상태가 되므로 방향과 무관하게 막는다. (X-30/D-24)

# ── 신뢰도 층 (D-24) ──────────────────────────────────────────────
# 하드 게이트를 통과했지만 **위험을 높게 말할 가능성**이 있는 장을 버리지 않고 등급으로 남긴다.
# 노선 최적화는 엣지 가중치를 쓰므로 판정 불가는 도로망에 구멍을 낸다 -- 17% 과대평가된 값이
# 값 없음보다 낫다(순위는 유효하고 편향이 안전 방향이다).
# 경계는 within-edge 초과 차폐로 정했다 (X-30): 0 +0.0202 / 1 +0.0049 / 2 -0.0061 로 단조.
CONF_OFF_LOW,  CONF_SEAM_LOW,  CONF_NEAR_LOW = 2.0, 0.30, 0.30
CONF_OFF_MID,  CONF_SEAM_MID = 0.0, 0.15

# ── pose 정합 탐색 ────────────────────────────────────────────────
# 창 크기의 근거 (X-24):
#   방위각 메타데이터(camera_angle[1])는 실측 정확도가 로버스트 sigma 0.43deg 다
#   (주행 방위각 대비, 직진 18,022쌍). 옛 창 +-24deg 는 그 56sigma 로 근거가 없었다.
#   |dyaw| 가 20~25deg 인 장의 메타 잔차도 0.5deg 라, 큰 회전은 전부 정합 인공물이다.
#   이동도 +-8m 는 <=20m 겹침에 과적합했다: 창을 +-3m 로 줄이면 적합에 쓴 근거리
#   포함률은 0.837 -> 0.819 로 나빠지지만 쓰지 않은 20~40m 는 0.585 -> 0.595 로 좋아진다.
YAW_OFFSET = -2.0        # 사진 도로면과 GIS 사이의 계통 회전 (X-24).
                         # 0.25deg 격자 실측 중앙 -2.00deg, 촬영 세션 간 산포 0.56deg 로 상수다.
                         # 네이버 궤적 <-> GIS 중심선은 +0.004deg 로 정렬돼 있으므로 데이터가
                         # 아니라 우리 재구성 쪽 오프셋이다. 원리가 다른 두 추정기(도로면 PCA
                         # -2.28deg, 방사 프로파일 -1.50deg)도 같은 값을 내 교차검증됐다 (X-26).
                         # 파노라마당 잡음은 sigma 4.08deg 로 메타 오차의 10배다.
# 회전은 **탐색하지 않는다** (D-21). 잔여 회전(GIS 도로 축 대비 사진 도로 중심선의 기울기)으로
# 재면 탐색이 오히려 나쁘다: 주행 방위각 기준 |잔여회전| 중앙 1.96deg -> 1.77deg, >2deg 49.3% ->
# 44.0% (Wilcoxon p=0.0014). 탐색이 -2 에 머문 장은 1.31deg 인데 +-2deg 벗어난 장은 2.6~2.8deg 로
# 대칭적으로 나빠진다 -- 겹침 최대화가 이동·형상 오차를 회전 자유도로 흡수하고 있었다.
# fit_far 손해 -0.0023 은 유의하지 않다(p=0.2). 부수 효과로 FFT 가 5회 -> 1회.
DYAW = np.array([YAW_OFFSET])                  # 상수. 메타데이터 방위각 + YAW_OFFSET
DXY = np.arange(-3.0, 3.1, 1.0)                 # -3 .. +3
PEN_YAW, PEN_XY = 0.03, 0.04      # 동점일 때 작은 보정을 고르는 약한 사전분포
                                  # (PEN_YAW 는 D-21 이후 항상 0 -- 회전 후보가 하나뿐)
# 페널티 척도는 창과 분리한다. 창으로 정규화하면 창을 줄일 때 도/미터당 페널티가 같이
# 세져(24->4 이면 36배) 창 변경의 순효과를 알 수 없다. 부록 A 의 PEN_XY 결함과 같은 결합이다.
PEN_YAW_REF, PEN_XY_REF = 24.0, 8.0
POSE_RES = 0.5
POSE_MARGIN = 16.0
EPSG = 5179

# ── 광선 테이블 (모듈 로드 시 1회) ─────────────────────────────────
_U, _V = np.meshgrid(np.arange(256, dtype=np.float64), np.arange(256, dtype=np.float64))
RAY = np.stack([(_U - CX) / FX, (_V - CY) / FY, np.ones_like(_U)], -1)   # (256,256,3)
RNORM = np.linalg.norm(RAY, axis=-1)


# ── 시각화 격자 (bev_render_worker 규약: 240x240, 3패널 세로) ──────
CANVAS = 240
GRID_RES = 2 * R_MAX / CANVAS          # 0.3333 m/px. 캔버스를 240 으로 유지해 figure 형상 불변
CENTER = (CANVAS // 2, CANVAS // 2)

_gr, _gc = np.mgrid[0:CANVAS, 0:CANVAS]
_mx = (_gc - CENTER[0]) * GRID_RES     # 셀 중심의 BEV 우측 성분(m)
_my = (CENTER[1] - _gr) * GRID_RES     # 전방 성분(m)
CELL_R = np.hypot(_mx, _my)
CELL_BIN = ((np.arctan2(_mx, _my) % (2 * np.pi)) / (2 * np.pi) * N_BINS).astype(np.int64) % N_BINS


def _yaw(deg):
    t = math.radians(deg); c, s = math.cos(t), math.sin(t)
    return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])


RYAW = {d: _yaw(y) for d, y in DIRS.items()}


# ── 입력 ───────────────────────────────────────────────────────────
def load_face(stem, dname, seg_dir, depth_dir):
    """한 면의 disparity + 마스크. disp_raw(신규)/depth_norm(구) 자동 인식."""
    dz = Path(depth_dir) / f"{stem}_{dname}_depth.npz"
    sz = Path(seg_dir) / f"{stem}_{dname}_masks.npz"
    mj = Path(seg_dir) / f"{stem}_{dname}_meta.json"
    if not (dz.exists() and sz.exists() and mj.exists()):
        return None
    with np.load(dz) as z:
        disp = (z["disp_raw"] if "disp_raw" in z.files else 1.0 - z["depth_norm"]).astype(np.float64)
    meta = json.load(open(mj, encoding="utf-8"))
    with np.load(sz) as s:
        masks = s["masks"]
        blocker = np.zeros((256, 256), bool)
        for i, det in enumerate(meta["detections"]):
            if det["class_id"] not in BACKGROUND_CLASS_IDS:
                blocker |= masks[i]
        get = lambda k: s[k] if k in s.files else np.zeros((256, 256), bool)
        road, side, veh = get("road_mask"), get("sidewalk_mask"), get("vehicle_mask")
    return {"disp": disp, "blocker": blocker, "vehicle": veh,
            "road": road, "sidewalk": side, "ground": road | side}


# ── 도로 등급 -> 제한속도 -> 정지거리 ──────────────────────────────
# 등급 판별: 도로명주소법 시행령 제6조가 폭·차로로 대로/로/길을 정의하고
#   (대로 40m 이상 또는 8차로 이상 / 로 12~40m 또는 2~8차로 / 길 그 외),
#   이 데이터의 ROA_CLS_SE 2/3/4 가 그 셋과 일치한다
#   (실측 폭 중앙 35m / 20m / 6m, 도로명 끝글자 대로 / 로 / 길).
# 제한속도: 안전속도 5030 (도로교통법 시행규칙, 2019-04-17 개정 / 2021-04-17 전국 시행).
#   도시부 주거·상업·공업지역 일반도로 50 이하, 주택가 이면도로 등 30 이하.
#   이면도로에 '설계속도' 기준이 없는 이유는 설계가 아니라 운영(제한속도)으로 규율되기 때문.
# 대로 60 은 간선도로 상향 지정에 기댄 값이다. 70 을 쓰면 D_stop=47m 로 R_MAX(40m)를 넘어
#   지시함수 판정이 불가능해지므로 계산 가능성도 선택에 영향을 줬다 -> 보고서에 명시할 것.
SPEED_BY_CLASS = {"2": 60.0, "3": 50.0, "4": 30.0}   # 대로 / 로 / 길
SPEED_DEFAULT = 50.0
VEH_BLOCK_MAX = 0.5      # 전방 콘의 이 비율 이상이 차량에 가리면 sight_flag 판정 불가(None)


def stopping_distance(speed_kmh, reaction_s=1.0, mu=0.7, g=9.8):
    """반응거리 + 제동거리(m). 30/50/60 km/h -> 13.4 / 27.9 / 36.9 m 로 모두 R_MAX 안에 든다.

    반응 1s 는 자율주행 기준이다. 도로설계기준의 정지시거(반응 2.5s, 50km/h 에서 55m)를
    쓰면 R_MAX 를 넘어 L_vis 가 상한에 검열된 구간과 겹쳐 지시함수가 무의미해진다.
    """
    v = speed_kmh / 3.6
    return v * reaction_s + v * v / (2 * mu * g)


def load_road_class(csv_path="GIS/historical_panoids_filtered.csv",
                    gpkg_path="GIS/gangneung_point.gpkg"):
    """pano stem -> ROA_CLS_SE('2'/'3'/'4'). (edge_id, point_id) 로 조인 (실측 매칭률 100%)."""
    import sqlite3
    import pandas as pd

    with sqlite3.connect(gpkg_path) as con:
        gp = pd.read_sql("SELECT edge_id, point_id, ROA_CLS_SE FROM gangneung_point", con)
    df = pd.read_csv(csv_path, encoding="utf-8-sig")
    m = df.merge(gp, on=["edge_id", "point_id"], how="left")
    stems = "point_" + m.point_id.astype(str) + "_pano_" + m.pano_id.astype(str)
    return dict(zip(stems, m.ROA_CLS_SE.astype("string")))


def load_cam_heights(csv_path="GIS/historical_panoids_filtered.csv", raw=False):
    """pano_id -> 리그 높이(m). **모든 장에 상수 `CAM_HEIGHT_DEFAULT` 를 준다** (D-25).

    `(camera_altitude - land_altitude)/100` 은 측정값이 아니다 — 고도가 캠페인에 따라
    **1m 단위로 반올림**돼 있어 그 차이가 2.0 아니면 3.0 으로만 튄다. 같은 주행 2초 간격에
    `cam_alt` 는 같은데 `land_alt` 만 1m 달라지는 쌍이 실제로 있다. 고도가 정밀하게 기록된
    유일한 캠페인(2024-09, 27,650장)에서는 **전부 정확히 2.5m** 다.

    `Z ∝ h` 이므로 이 잡음이 후기 캠페인 8,605장(23.7%)에 ±20% 거리 오차를 주입했다.
    실측: 같은 도로에서 h=2.0/3.0 집단의 복원 도로 폭 비가 1.42 (옳으면 1.00, 참 높이가
    같으면 1.50), 상수로 바꾸면 0.95. (X-35 → D-25)

    `raw=True` 는 CSV 원본 값을 돌려준다 — **진단 전용**. 캠페인별 분석에 쓴다.
    """
    import pandas as pd
    df = pd.read_csv(csv_path, encoding="utf-8-sig")
    if not raw:
        return dict.fromkeys(df.pano_id, CAM_HEIGHT_DEFAULT)
    h = (pd.to_numeric(df.camera_altitude, errors="coerce")
         - pd.to_numeric(df.land_altitude, errors="coerce")) / 100.0
    h = h.where(h.between(1.5, 4.0))
    return dict(zip(df.pano_id, h.fillna(CAM_HEIGHT_DEFAULT)))


# ── 1. 공동 metric 보정 ────────────────────────────────────────────
def _solve(A, Y, w, tilt_prior, iters=3):
    """A x = Y n 을 |n|=1 제약 아래 푼다 (분리 최소제곱 + Huber IRLS).

    x 를 주변화하면 n 에 대한 2차형식만 남는다:
        Q = Y'W2Y - (Y'W2A)(A'W2A)^-1(A'W2Y)
    h 를 GIS 에서 고정해 계가 비동차가 되므로, a~0 인 쓰레기 해로 수렴하지 않는다.
    """
    for _ in range(iters):
        W2 = w ** 2
        AtW = A.T * W2
        AtA = AtW @ A + 1e-9 * np.eye(8)
        AtY = AtW @ Y
        Q = (Y.T * W2) @ Y - AtY.T @ np.linalg.solve(AtA, AtY) + tilt_prior * np.diag([1.0, 0.0, 1.0])
        n = np.linalg.eigh(Q)[1][:, 0]
        if n[1] < 0:
            n = -n
        x = np.linalg.solve(AtA, AtY @ n)
        r = A @ x - Y @ n
        s = 1.4826 * np.median(np.abs(r - np.median(r))) + 1e-12
        w = np.minimum(1.0, 1.345 * s / np.maximum(np.abs(r), 1e-12))
    return x, n


def calibrate_panorama(faces, cam_h):
    """4면 affine(a_d, b_d) + 공유 지면평면 n 을 동시 적합.

    모델   1/Z_d = a_d*disp_d + b_d              (Z = 면 좌표계 z-depth)
    평면   n.P = h, |n|=1, n_y>0 (y 하향)   =>   1/Z = (1/h) n^T (R_d r),  r=(x_n,y_n,1)

    지면행   a_d*disp_i + b_d = (1/h) n^T (R_d r_i)      (road|sidewalk, 지평선 아래)
    이음매행 a_p*disp_p(v,255) + b_p = a_q*disp_q(v,0) + b_q
             (cx=127.5 라 u=255 와 u=0 이 주점 대칭 -> range 변환 인자 |r| 이 정확히 상쇄)

    실측: held-out 이음매 잔차가 면별 독립 0.114 -> 0.060 (기울기 기여가 47%, 이음매는 10%).
    """
    A_rows, Y_rows, w_rows, n_ground = [], [], [], []
    for k, d in enumerate(ORDER):
        m = faces[d]["ground"].copy()
        m[: int(CY) + 3, :] = False
        idx = np.argwhere(m)[::SUB]
        n_ground.append(len(idx))
        if len(idx) == 0:
            continue
        vv, uu = idx[:, 0], idx[:, 1]
        A = np.zeros((len(idx), 8))
        A[:, 2 * k] = faces[d]["disp"][vv, uu]
        A[:, 2 * k + 1] = 1.0
        A_rows.append(A)
        Y_rows.append((RAY[vv, uu] @ RYAW[d].T) / cam_h)
        w_rows.append(np.ones(len(idx)))

    for p, q in SEAMS:
        dp, dq = faces[p]["disp"][:, 255], faces[q]["disp"][:, 0]
        keep = (dp > np.quantile(faces[p]["disp"], SKY_Q)) & (dq > np.quantile(faces[q]["disp"], SKY_Q))
        if keep.sum() < 10:
            continue
        kp, kq = ORDER.index(p), ORDER.index(q)
        A = np.zeros((int(keep.sum()), 8))
        A[:, 2 * kp] = dp[keep]; A[:, 2 * kp + 1] = 1.0
        A[:, 2 * kq] = -dq[keep]; A[:, 2 * kq + 1] = -1.0
        A_rows.append(A)
        Y_rows.append(np.zeros((int(keep.sum()), 3)))
        w_rows.append(np.full(int(keep.sum()), SEAM_W))

    if not A_rows:
        return None
    A, Y, w = np.vstack(A_rows), np.vstack(Y_rows), np.concatenate(w_rows)
    x, n = _solve(A, Y, w, TILT_PRIOR)
    pitch = math.degrees(math.atan2(-n[2], n[1]))
    roll = math.degrees(math.atan2(n[0], n[1]))

    status = "ok"
    if abs(pitch) > TILT_MAX_DEG or abs(roll) > TILT_MAX_DEG:
        n = np.array([0.0, 1.0, 0.0]); pitch = roll = 0.0
        W2 = w ** 2; AtW = A.T * W2
        x = np.linalg.solve(AtW @ A + 1e-9 * np.eye(8), AtW @ (Y @ n))
        status = "tilt_clamped"
    if not np.all(x[0::2] > 0):
        status = "bad_scale"
    if sum(g >= GROUND_PX_MIN for g in n_ground) < FACES_MIN_VALID:
        status = "few_ground"

    return {"a": x[0::2], "b": x[1::2], "n": n, "h": cam_h,
            "pitch_deg": pitch, "roll_deg": roll, "n_ground": n_ground, "status": status}


def fit_breakdown(mask, half, n, gx, gy, bearing, dyaw=0.0, dx=0.0, dy=0.0):
    """정합 포함률을 거리·방향으로 쪼갠 값. **기록 전용 - 판정에 쓰지 않는다.**

    현행 fit_score 는 <=20m 를 한 덩어리로 보고 한쪽 포함률만 재므로 둘을 놓친다.
      원거리 어긋남 -- 정합에 20m 이내만 쓰는데 점의 98% 가 거기 몰려 있다.
                     실측: fit_near > 0.97 인 파노라마의 34.5% 가 fit_far < 0.7 이다.
      회전 오차     -- 전방과 후방이 반대쪽으로 흔들리는데 합치면 상쇄된다. 탐색 한계
                     2개 이상 집단에서 fwd 0.890 / bwd 0.550 로 한쪽만 무너진다.
                     '둘 중 나쁜 쪽'은 정상 집단과 -0.446 차이로 현행(-0.251)의 1.8배다.

    양방향(역커버리지·IoU)은 채택하지 않았다 -- 정합이 정상이어도 GIS 도로의 60~70% 는
    가려지거나 시야 밖이라 0.3 대에 머물러 판별력이 없다(정상 0.34 vs 실패 0.31).

    폭 교란은 이 지표들도 그대로 안고 있다(등급 상관 -0.43~-0.45). 게이트로 쓰면 이면도로만
    잘려 나간다 -- X-05 에서 이미 겪은 실패다. (X-19)
    """
    out = {"fit_far": None, "fit_fwd": None, "fit_bwd": None}
    if mask is None or len(gx) == 0:
        return out
    b = math.radians(bearing + dyaw)
    fx, fy = math.sin(b), math.cos(b)
    rx, ry = math.cos(b), -math.sin(b)
    wx, wy = gx * rx + gy * fx + dx, gx * ry + gy * fy + dy
    cc = ((wx + half) / POSE_RES).astype(np.int64)
    rr = ((half - wy) / POSE_RES).astype(np.int64)
    ok = (cc >= 0) & (cc < n) & (rr >= 0) & (rr < n)
    inside = np.zeros(len(gx), bool)
    inside[ok] = mask[rr[ok], cc[ok]]

    rad = np.hypot(gx, gy)
    ang = np.degrees(np.arctan2(gx, gy))
    near = rad <= 20.0
    for key, m in (("fit_far", (rad > 20.0) & (rad <= R_MAX)),
                   ("fit_fwd", near & (np.abs(ang) <= 60)),
                   ("fit_bwd", near & (np.abs(np.abs(ang) - 180) <= 60))):
        if m.sum() >= 30:
            out[key] = round(float(inside[m].mean()), 4)
    return out


def pose_clipped(dyaw, dx, dy):
    """탐색 한계에 붙은 pose 파라미터 개수 (0~2). 회전은 탐색하지 않으므로 이동만 센다 (D-21).

    한계에 붙었다는 것은 최적점이 창 밖이거나 애초에 뚜렷한 최적점이 없다는 뜻이다
    (X-07: 창을 넓혀도 93%는 해가 안 움직이고 한계 사례는 오히려 악화가 더 잦았다).
    실측 within-edge 초과 차폐: 1개 +0.078 / 2개 +0.108 / 3개 +0.187. (D-16)
    """
    return int(abs(dx) >= DXY.max()) + int(abs(dy) >= DXY.max())


def faces_with_ground(cal):
    """지면이 GROUND_PX_MIN 이상 보인 면의 개수. 보정 식별성의 유일한 실측 지표다.

    실측(같은 edge 이웃 대비 초과 차폐): 0면 -0.320 / 1면 +0.292 / 2면 -0.052 / 3면 +0.021.
    0면은 이음매+prior 만으로 적합해 점이 거의 R_MAX 를 통과하지 못하고 모든 방향이 '트임'이
    된다(= 보정 실패를 '안전'으로 보고). 1면은 나머지 세 면이 이음매 연쇄로 결정돼 스케일
    오차가 누적된다. 2~3면은 멀쩡하다. (계획서 D-14/X-09)
    """
    return sum(g >= GROUND_PX_MIN for g in cal["n_ground"])


def calib_valid(cal):
    """보정이 식별 가능했는가. False 면 지표를 내지 않고 판정 불가로 둔다."""
    return faces_with_ground(cal) >= FACES_MIN_VALID


def confidence(cam_off_m, seam_max, fit_fwd, fit_bwd):
    """신뢰도 2(높음)/1(보통)/0(낮음). **판정 여부와 무관하다** -- 값은 항상 낸다 (D-24).

    세 축 모두 within-edge 초과 차폐가 **양수** 다. 즉 이 장들은 위험을 높게 말하지 낮게
    말하지 않는다. 그래서 버리지 않고 등급만 남긴다. 실측 (X-30, 하드 게이트 통과분 33,098장):

        신뢰도 0  11.3%   초과차폐 +0.0202   dL_vis -0.89m   경보 12.4%
        신뢰도 1  28.8%   초과차폐 +0.0049   dL_vis -0.29m   경보  9.0%
        신뢰도 2  60.0%   초과차폐 -0.0061   dL_vis +0.31m   경보  3.5%

    near 는 0.3~0.7 구간에서 초과 차폐가 0 이라(-0.003 / -0.001) 보통 조건에 넣지 않았다.
    0.3 미만에서만 +0.027 로 튄다.
    """
    vals = [v for v in (fit_fwd, fit_bwd) if v is not None]
    near_low = bool(vals) and (sum(vals) / len(vals)) < CONF_NEAR_LOW
    if cam_off_m > CONF_OFF_LOW or seam_max >= CONF_SEAM_LOW or near_low:
        return 0
    if cam_off_m > CONF_OFF_MID or seam_max >= CONF_SEAM_MID:
        return 1
    return 2


def seam_residuals(faces, cal):
    """이음매 4쌍 각각의 range 상대 불일치. 4면이 닫힌 고리라 이음매도 4개다.

    같은 지점을 두 면이 나눠 찍었으므로 경계 열의 거리는 같아야 한다. 적합에 직접 쓰이지
    않은 방향의 정보라 보정 품질의 out-of-sample 지표가 된다.

    중앙값 하나로 뭉개면 최악 이음매가 가려진다 -- 실측 최악/중앙 배수 p50 = 2.09 이고,
    '중앙 <= 0.055(G1 통과)인데 최악 > 0.10' 인 파노라마가 23.4% 다. 그래서 4개를 그대로
    돌려주고 요약은 호출자가 고른다. (X-18)

    측정 불가한 이음매는 None (JSON 의 null. NaN 은 유효한 JSON 이 아니다).
    """
    out = {}
    for p, q in SEAMS:
        kp, kq = ORDER.index(p), ORDER.index(q)
        izp = cal["a"][kp] * faces[p]["disp"][:, 255] + cal["b"][kp]
        izq = cal["a"][kq] * faces[q]["disp"][:, 0] + cal["b"][kq]
        with np.errstate(divide="ignore", invalid="ignore"):
            Rp, Rq = RNORM[:, 255] / izp, RNORM[:, 0] / izq
        ok = np.isfinite(Rp) & np.isfinite(Rq) & (Rp > 2) & (Rp < 80) & (Rq > 2) & (Rq < 80)
        out[f"{p}|{q}"] = (float(np.median(np.abs(Rp[ok] - Rq[ok]) / (0.5 * (Rp[ok] + Rq[ok]))))
                           if ok.sum() >= 20 else None)
    return out


def seam_residual(faces, cal):
    """이음매 잔차 중앙값 (기존 계약면 유지). 전부 측정 불가면 None."""
    v = [x for x in seam_residuals(faces, cal).values() if x is not None]
    return float(np.median(v)) if v else None


# ── 2. metric 점군 ─────────────────────────────────────────────────
def face_points(face, dname, cal, mask):
    """mask 픽셀 -> (theta, rng, height). theta=0 이 front 면 축, height 는 적합 평면 위 높이."""
    k = ORDER.index(dname)
    inv_z = cal["a"][k] * face["disp"] + cal["b"][k]

    # flying pixel 제거: 깊이 불연속 경계에서 보간된 점이 허공에 뜬다
    bad = np.zeros_like(inv_z, bool)
    du = np.abs(np.diff(inv_z, axis=1)) / np.maximum(inv_z[:, :-1], 1e-9)
    dv = np.abs(np.diff(inv_z, axis=0)) / np.maximum(inv_z[:-1, :], 1e-9)
    bad[:, :-1] |= du > GRAD_REJECT_REL; bad[:, 1:] |= du > GRAD_REJECT_REL
    bad[:-1, :] |= dv > GRAD_REJECT_REL; bad[1:, :] |= dv > GRAD_REJECT_REL

    sel = mask & (inv_z > 1.0 / R_MAX) & ~bad
    if not sel.any():
        return np.empty(0), np.empty(0), np.empty(0)
    vv, uu = np.nonzero(sel)
    P = (RAY[vv, uu] / inv_z[vv, uu][:, None]) @ RYAW[dname].T
    return (np.arctan2(P[:, 0], P[:, 2]),
            np.hypot(P[:, 0], P[:, 2]),
            cal["h"] - P @ cal["n"])


def ground_bev(faces, cal, r_max=R_MAX, sub=2, key="road"):
    """도로면 픽셀을 적합 평면으로 BEV 투영 (깊이가 아니라 평면이 정확하다)."""
    xs, ys = [], []
    for d in ORDER:
        m = faces[d][key].copy(); m[: int(CY) + 3, :] = False
        idx = np.argwhere(m)[::sub]
        if len(idx) == 0:
            continue
        rw = RAY[idx[:, 0], idx[:, 1]] @ RYAW[d].T
        iz = (rw @ cal["n"]) / cal["h"]
        ok = iz > 1.0 / r_max
        if not ok.any():
            continue
        P = rw[ok] / iz[ok][:, None]
        keep = np.hypot(P[:, 0], P[:, 2]) <= r_max
        xs.append(P[keep, 0]); ys.append(P[keep, 2])
    return (np.concatenate(xs), np.concatenate(ys)) if xs else (np.empty(0), np.empty(0))


# ── 3. 방사 프로파일 ───────────────────────────────────────────────
def radial_profile(theta, rng):
    """r(theta): 각 방향에서 누적 투표가 MIN_VOTES 에 처음 도달하는 반경.

    래스터 레이캐스팅을 대체한다 -> 격자 이산화 오차도, 레이 누출 방지용 dilate 도 불필요.
    '고정 투표수'가 백분위수보다 옳다: 벽은 수천 점, 기둥은 여덟 점이라 백분위수는 스케일 의존적이다.
    """
    n_cell = int(np.ceil(R_MAX / RADIAL_CELL))
    r_theta = np.full(N_BINS, R_MAX)
    if len(theta) == 0:
        return r_theta, np.zeros(N_BINS, np.int64)
    bi = (np.floor((theta % (2 * np.pi)) / (2 * np.pi) * N_BINS).astype(np.int64)) % N_BINS
    ri = np.clip((rng / RADIAL_CELL).astype(np.int64), 0, n_cell - 1)
    H = np.bincount(bi * n_cell + ri, minlength=N_BINS * n_cell).reshape(N_BINS, n_cell)
    hit = np.cumsum(H, axis=1) >= MIN_VOTES
    has = hit.any(axis=1)
    r_theta[has] = (np.argmax(hit, axis=1)[has] + 0.5) * RADIAL_CELL
    return r_theta, H.sum(axis=1)


def shadow_area(r_theta):
    """A_shadow = sum (dtheta/2)(R^2 - r^2). 원점 기준 가시영역은 항상 star-shaped 라 정확하다."""
    return float(np.sum(0.5 * (2 * np.pi / N_BINS) * (R_MAX ** 2 - r_theta ** 2)))


def l_vis(r_theta, half_deg=10.0):
    """(전방, 후방, min). 정지시거는 두 방향 중 **나쁜 쪽**으로 판단한다.

    셔틀은 이 링크를 양방향 중 어느 쪽으로도 지날 수 있다. 한 방향이라도 D_stop 을 못 채우면
    그 주행 방향에서는 멈출 수 없으므로, 링크 단위 경보는 min 이어야 한다. 평균은 막힌 쪽을
    가린다 -- 실측상 뒤집히는 1,578장(4.34%)의 전/후방 차이가 중앙 23.0m 로, 평균 24.9m 가
    "안전"이라 말하던 것을 min 11.8m 가 잡는다 (D_stop 중앙 13.4m).

    옛 평균의 근거는 "촬영차가 어느 쪽을 보고 지나갔는지에 대표 위험도가 의존하면 안 된다"
    였는데, min 도 앞뒤 교환에 불변이므로 그 요구를 똑같이 만족한다. 평균을 지지하던 또
    하나의 근거(0/180 모호성)는 방위각 검증으로 소멸했다 -- 모호성 자체가 없다. (D-20/X-24)

    D-17 구간 판정의 전제는 보존된다: r_veh <= r_occ 가 방향별로 성립하므로 min 을 취해도
    L_vis_veh <= L_vis 다 (36,339장 전량에서 위반 0건).
    """
    ang = np.arange(N_BINS) * 360.0 / N_BINS
    f = float(np.median(r_theta[(ang <= half_deg) | (ang >= 360 - half_deg)]))
    b = float(np.median(r_theta[np.abs(ang - 180.0) <= half_deg]))
    return f, b, min(f, b)


def vehicle_blocked_frac(r_occ, r_veh, half_deg=10.0):
    """전방/후방 콘에서 '차량이 구조물보다 가까운' 방향의 비율. (전방, 후방) 반환.

    차량을 occupancy 에서 빼도 차량 뒤가 드러나지는 않는다 — 그 픽셀은 세그멘테이션이 car 로
    라벨한 자리라 뒤에 뭐가 있는지 데이터가 없다. 그런데 radial_profile 은 점이 부족한 방향을
    r=R_MAX 로 채우므로 '모른다'가 '트여 있다'로 보고된다(구조적 L_vis 의 낙관 편향).
    r_veh < r_occ 인 방향이 바로 그 경우다.

    L_vis 는 콘의 중앙값이므로 이 비율이 0.5 를 넘으면 중앙값 자체가 가려진 값들로 결정된다
    -> 그때는 sight_flag 를 False 가 아니라 판정 불가(None)로 두어야 한다.
    """
    ang = np.arange(N_BINS) * 360.0 / N_BINS
    fwd = (ang <= half_deg) | (ang >= 360 - half_deg)
    bwd = np.abs(ang - 180.0) <= half_deg
    hidden = r_veh < r_occ - 1e-9
    return float(hidden[fwd].mean()), float(hidden[bwd].mean())


def occupancy(faces, cal, include_vehicles=True):
    """4면 blocker(+vehicle) -> 대역 통과 점군 -> r(theta)."""
    keys = ("blocker", "vehicle") if include_vehicles else ("blocker",)
    th, rg, ht, mn = [], [], [], []
    n_mask = 0
    for d in ORDER:
        for key in keys:
            # 영상 공간 개수. n_raw 는 face_points 안에서 이미 inv_z > 1/R_MAX 와 flying pixel
            # 을 거른 뒤라 보정 품질에 의존한다 -- '원래 볼 게 없었다'와 '투영이 밀어냈다'를
            # 가르려면 보정과 무관한 이 값이 필요하다. (X-30 의 미해결 항목)
            n_mask += int(faces[d][key].sum())
            t, r, h = face_points(faces[d], d, cal, faces[d][key])
            th.append(t); rg.append(r); ht.append(h)
            mn.append(np.full(len(r), R_MIN_EGO[d]))
    th, rg, ht, mn = map(np.concatenate, (th, rg, ht, mn))
    inr = (rg > mn) & (rg <= R_MAX)
    band = inr & (ht > H_BAND[0]) & (ht < H_BAND[1])
    r_theta, votes = radial_profile(th[band], rg[band])
    # 빈 bin 중 '대역 기아'(어떤 높이에는 점이 있었다)만 품질 문제다. 나머지는 진짜 트인 방향.
    any_bin = np.bincount((np.floor((th[inr] % (2 * np.pi)) / (2 * np.pi) * N_BINS)).astype(np.int64) % N_BINS,
                          minlength=N_BINS) if inr.any() else np.zeros(N_BINS, np.int64)
    starved = int(((votes == 0) & (any_bin > 0)).sum())
    return r_theta, {"n_points": int(band.sum()), "n_raw": int(len(th)),
                     "n_mask": n_mask,
                     "starved_bins": starved, "empty_bins": int((votes == 0).sum())}


# ── 4. 도로망 + pose 정합 + 도로 차폐율 ────────────────────────────
class RoadNet:
    """road_prep.py 가 만든 도로 그래프 + 실폭도로 폴리곤."""

    def __init__(self, graph_npz="GIS/road_graph.npz", surface_gpkg="GIS/gangneung_roadsurface.gpkg"):
        from scipy.spatial import cKDTree
        import geopandas as gpd
        from shapely.strtree import STRtree

        g = np.load(graph_npz)
        self.xy = g["xy"]
        self.adj = [[] for _ in range(len(self.xy))]
        for a, b, w in zip(g["li"], g["lj"], g["lw"]):
            self.adj[a].append((b, float(w))); self.adj[b].append((a, float(w)))
        self.tree = cKDTree(self.xy)
        self.surf = gpd.read_file(surface_gpkg)
        self.stree = STRtree(self.surf.geometry.values)

    def surface_mask(self, cam):
        """카메라 주변 실폭도로를 격자로 래스터화 (pose 탐색용)."""
        import geopandas as gpd
        from shapely import contains_xy
        from shapely.geometry import Point

        half = R_MAX + POSE_MARGIN
        idx = self.stree.query(Point(cam).buffer(half + 5))
        if len(idx) == 0:
            return None, half, 0
        polys = self.surf.geometry.values[idx]
        poly = polys[0] if len(polys) == 1 else gpd.GeoSeries(polys).union_all()
        n = int(2 * half / POSE_RES)
        gx = cam[0] - half + (np.arange(n) + 0.5) * POSE_RES
        gy = cam[1] + half - (np.arange(n) + 0.5) * POSE_RES
        XX, YY = np.meshgrid(gx, gy)
        return contains_xy(poly, XX.ravel(), YY.ravel()).reshape(n, n), half, n

    def dist_to_surface(self, cam, cap=20.0):
        """카메라에서 가장 가까운 실폭도로 폴리곤까지 거리 (안이면 0, cap 에서 절단).

        '이 지점이 우리가 가진 도로 지도 위에 있는가'를 이미지 없이 답한다.
        실측: 정상군은 91.4% 가 폴리곤 안이고, 정합 전 겹침이 0.1 미만인 집단은 9.5% 뿐이다.
        좁은 골목은 폴리곤이 가늘어도 카메라가 그 안에 있으므로 도로 폭과 혼동되지 않는다.
        """
        from shapely.geometry import Point

        p = Point(cam)
        idx = self.stree.query(p.buffer(cap))
        if len(idx) == 0:
            return cap
        return float(min(self.surf.geometry.values[j].distance(p) for j in idx))

    def reachable(self, cam, cap=R_MAX):
        """카메라 최근접 정점에서 도로를 따라 cap 이내인 링크 [(midx, midy, len)]."""
        src = int(self.tree.query(cam)[1])
        dist = {src: 0.0}
        pq = [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, math.inf):
                continue
            for v, w in self.adj[u]:
                nd = d + w
                if nd <= cap and nd < dist.get(v, math.inf):
                    dist[v] = nd
                    heapq.heappush(pq, (nd, v))
        out, seen = [], set()
        for u in dist:
            for v, w in self.adj[u]:
                if v in dist and (min(u, v), max(u, v)) not in seen:
                    seen.add((min(u, v), max(u, v)))
                    out.append((0.5 * (self.xy[u, 0] + self.xy[v, 0]),
                                0.5 * (self.xy[u, 1] + self.xy[v, 1]), w))
        return np.array(out) if out else np.empty((0, 3))


def _world_to_bev(px, py, cam, bearing_deg, dx=0.0, dy=0.0):
    """세계좌표(EPSG:5179) -> BEV (우측+, 전방+). bearing 은 front 면의 진북 방위각."""
    b = math.radians(bearing_deg)
    fx, fy = math.sin(b), math.cos(b)          # BEV 전방의 세계 방향
    rx, ry = math.cos(b), -math.sin(b)         # BEV 우측의 세계 방향
    ex, ey = px - cam[0] - dx, py - cam[1] - dy
    return ex * rx + ey * ry, ex * fx + ey * fy


def refine_pose(mask, half, n, x, y, bearing):
    """도로면 BEV 를 폴리곤 래스터에 등록. (score, dyaw, dx, dy) 반환.

    점수는 '투영된 도로 셀 중 폴리곤 안에 드는 비율'이라 창을 넓히면 옆 도로로
    미끄러질 수 있다 -> 이동/회전에 약한 2차 페널티를 걸어 동점 시 작은 보정을 고른다.
    실측: 겹침 0.689 -> 0.882, 이동 median 3.1m, |dyaw| median 4.0도.

    이동(dx,dy) 탐색은 상호상관이라 회전마다 FFT 한 번으로 전부 얻는다
    (완전탐색은 25x17x17=7225회로 파노라마당 1.1초가 걸려 전체의 89%를 먹었다).
    """
    from scipy.signal import fftconvolve

    if mask is None or len(x) == 0:
        return 0.0, 0.0, 0.0, 0.0
    M = mask.astype(np.float32)
    best = (-9.0, 0.0, 0.0, 0.0)
    for dyaw in DYAW:
        b = math.radians(bearing + dyaw)
        fx, fy = math.sin(b), math.cos(b); rx, ry = math.cos(b), -math.sin(b)
        wx, wy = x * rx + y * fx, x * ry + y * fy
        cc = ((wx + half) / POSE_RES).astype(np.int64)
        rr = ((half - wy) / POSE_RES).astype(np.int64)
        ok = (cc >= 0) & (cc < n) & (rr >= 0) & (rr < n)
        if not ok.any():
            continue
        # 점 개수가 아니라 **셀 점유(0/1)** 로 센다. 원근 때문에 도로면 점은 0~10m 에
        # 23,299 / 10~20m 에 1,692 로 14:1 이라, 개수로 세면 회전이 근거리에 압도당한다
        # -- 가까운 도로면은 조금 돌려도 폴리곤 안에 그대로 있어 점수가 안 변하고, 정작
        # 회전을 결정하는(지렛대가 긴) 먼 점들이 묻힌다. 셀 점유로 바꾸면 단위 면적당
        # 동일 가중이 되어 원거리가 살아난다. 실측 fit_far 0.519 -> 0.551,
        # 짝지어 개선 43.5% / 악화 14.7%, 탐색 한계 도달 2.4% -> 1.4%. (X-21)
        A = (np.bincount(rr[ok] * n + cc[ok], minlength=n * n).reshape(n, n) > 0).astype(np.float32)
        # corr[n-1+sr, n-1+sc] = sum_rc A[r,c] * M[r+sr, c+sc]
        corr = fftconvolve(M, A[::-1, ::-1], mode="full")
        denom = float(A.sum())
        pen_yaw = PEN_YAW * ((dyaw - YAW_OFFSET) / PEN_YAW_REF) ** 2
        for dx in DXY:
            sc = int(round(dx / POSE_RES))
            for dy in DXY:
                sr = int(round(-dy / POSE_RES))
                s = (corr[n - 1 + sr, n - 1 + sc] / denom - pen_yaw
                     # dx^2+dy^2 의 최대는 모서리에서 2*DXY.max()^2 다. DXY.max()^2 로
                     # 나누면 모서리 페널티가 PEN_XY 의 2배가 되어 대각 보정만 부당하게
                     # 불리해진다(등방이어야 한다). 정규화를 최대값으로 맞춘다.
                     - PEN_XY * ((dx ** 2 + dy ** 2) / (2 * PEN_XY_REF ** 2)))
                if s > best[0]:
                    best = (float(s), float(dyaw), float(dx), float(dy))
    return best


def shadow_grid(r_theta):
    """r(theta) -> 240x240 음영 마스크. 셀 반경이 그 방향 가시거리보다 멀면 음영이다.
    (레이를 걸어가며 칠하던 방식이 사라져 이산화 누출도, dilate 도 없다.)"""
    return (CELL_R > r_theta[CELL_BIN]) & (CELL_R <= R_MAX)


def scatter_grid(theta, rng):
    """점군 -> 240x240 bool 격자 (occupancy 표시용)."""
    g = np.zeros((CANVAS, CANVAS), bool)
    if len(theta) == 0:
        return g
    c = np.clip((CENTER[0] + rng * np.sin(theta) / GRID_RES).astype(np.int64), 0, CANVAS - 1)
    r = np.clip((CENTER[1] - rng * np.cos(theta) / GRID_RES).astype(np.int64), 0, CANVAS - 1)
    g[r, c] = True
    return g


def road_grid(links, cam, bearing, dx=0.0, dy=0.0, width=6.0):
    """도달 가능한 도로 링크 -> 240x240 bool.

    실제 도로 모양이 아니라 '무엇을 쟀는지'(중심선)를 표시하는 선이다. 도로면 자체는
    surface_grid 가 실폭도로 폴리곤으로 그린다 -- 고정폭 리본을 도로라고 그리면
    폭 35m 대로도 회전교차로도 6m 띠가 되어 사진과 맞을 수가 없었다.
    """
    g = np.zeros((CANVAS, CANVAS), bool)
    if len(links) == 0:
        return g
    bx, by = _world_to_bev(links[:, 0], links[:, 1], cam, bearing, dx, dy)
    keep = np.hypot(bx, by) <= R_MAX
    if not keep.any():
        return g
    k = max(1, int(round(width / GRID_RES / 2)))
    c = ((CENTER[0] + bx[keep] / GRID_RES)).astype(np.int64)
    r = ((CENTER[1] - by[keep] / GRID_RES)).astype(np.int64)
    for dr in range(-k, k + 1):
        for dc in range(-k, k + 1):
            rr, cc = np.clip(r + dr, 0, CANVAS - 1), np.clip(c + dc, 0, CANVAS - 1)
            g[rr, cc] = True
    return g


def surface_grid(mask, half, cam, bearing, dx=0.0, dy=0.0):
    """실폭도로 폴리곤 래스터 -> 240x240 bool (BEV 카메라 좌표계).

    refine_pose 가 쓰려고 이미 만든 mask(세계축 정렬, POSE_RES m/px)를 최근접 재표본만
    한다. 폴리곤을 다시 점-in-폴리곤 판정하면 파노라마당 57,600 회가 더 드는데 그 정보는
    mask 안에 이미 있다. mask 창이 R_MAX + POSE_MARGIN 이라 BEV 창(R_MAX)을 항상 덮는다.
    """
    g = np.zeros((CANVAS, CANVAS), bool)
    if mask is None:
        return g
    b = math.radians(bearing)
    fx, fy = math.sin(b), math.cos(b)
    rx, ry = math.cos(b), -math.sin(b)
    BX, BY = np.meshgrid((np.arange(CANVAS) - CENTER[0]) * GRID_RES,
                         (CENTER[1] - np.arange(CANVAS)) * GRID_RES)
    # _world_to_bev 의 역변환 (회전행렬이라 전치가 역행렬)
    px = cam[0] + dx + BX * rx + BY * fx
    py = cam[1] + dy + BX * ry + BY * fy
    j = np.rint((px - (cam[0] - half)) / POSE_RES - 0.5).astype(np.int64)
    i = np.rint(((cam[1] + half) - py) / POSE_RES - 0.5).astype(np.int64)
    ok = (i >= 0) & (i < mask.shape[0]) & (j >= 0) & (j < mask.shape[1])
    g[ok] = mask[i[ok], j[ok]]
    return g


# 시각화 색 규약. 두 도로 출처(GIS/사진)를 함께 그려 불일치가 그림에서 바로 보이게 한다.
C_NODATA = (200, 200, 200)
C_SURFACE = (150, 152, 158)      # GIS 실폭도로 (실제 폭과 모양)
C_IMGROAD = (62, 128, 196)       # 파노라마가 실제로 본 도로면
C_AXIS = (34, 34, 40)            # 측정 대상 = 도로 중심선
C_OUTBAND = (100, 200, 100)
C_BLOCKER = (220, 80, 80)
C_SHADOW = (255, 190, 0)         # 도로 위 사각지대 = 지표에 들어가는 것
C_SHADOW_OFF = (255, 238, 180)   # 도로 밖 사각지대 = 맥락 (bev_render_worker 가 칠한다)

BEV_LEGEND = [(tuple(v / 255 for v in c), lab) for c, lab in [
    (C_SURFACE, "GIS road surface"),
    (C_IMGROAD, "Road seen in panorama"),
    (C_AXIS, "Measured domain (centerline)"),
    (C_BLOCKER, "Occluder (in sight band)"),
    (C_OUTBAND, "Out of sight band"),
    (C_SHADOW, "Blind zone on road (counted)"),
    (C_SHADOW_OFF, "Blind zone off road"),
    (C_NODATA, "No data"),
]]


def bev_canvas(faces, cal, mask, half, links, gxy, cam, bearing, dx=0.0, dy=0.0):
    """240x240x3 시각화 캔버스.

    아래에서 위로: 자료없음 -> GIS 도로면 -> 사진이 본 도로면 -> 측정 대상(중심선)
    -> 시선대역 밖 점 -> 차단물.

    두 도로 출처를 겹쳐 그리는 이유: 지표는 GIS 도로 위치에 의존하는데, 그 배치가 이
    파노라마에서 맞았는지를 예전 그림으로는 판정할 수 없었다. 겹쳐 그리면
      회색만 있고 파랑 없음 -> 가려서 못 본 도로 (측정하려는 것)
      파랑이 회색 밖으로 나감 -> 정합 오차 (믿으면 안 되는 것)
    이 눈으로 구분된다.
    """
    bev = np.full((CANVAS, CANVAS, 3), C_NODATA, np.uint8)
    bev[surface_grid(mask, half, cam, bearing, dx, dy)] = C_SURFACE

    gx, gy = gxy
    if len(gx):
        bev[scatter_grid(np.arctan2(gx, gy), np.hypot(gx, gy))] = C_IMGROAD

    bev[road_grid(links, cam, bearing, dx, dy, width=1.5)] = C_AXIS

    th, rg, ht, mn = [], [], [], []
    for d in ORDER:
        for key in ("blocker", "vehicle"):
            t, r, hh = face_points(faces[d], d, cal, faces[d][key])
            th.append(t); rg.append(r); ht.append(hh)
            mn.append(np.full(len(r), R_MIN_EGO[d]))
    th, rg, ht, mn = map(np.concatenate, (th, rg, ht, mn))
    band = (rg > mn) & (rg <= R_MAX) & (ht > H_BAND[0]) & (ht < H_BAND[1])
    bev[scatter_grid(th[~band], rg[~band])] = C_OUTBAND
    bev[scatter_grid(th[band], rg[band])] = C_BLOCKER
    return bev


def _n2(v):
    return "n/a" if v is None else f"{v:.2f}"


MAX_TITLE_COLS = 170     # 이 길이를 넘으면 bbox_inches="tight" 가 제목을 따라가 파일이
                         # 넓어진다 (자당 +10px). 실제 렌더 워커로 실측한 값이다.


def suptitle_for(rec, pano, tag=""):
    """3패널 그림의 제목 (4행).

    호출부에서 직접 조립하면 '검증한 문자열'과 '실제 문자열'이 어긋난다 -- 실제로 한 번
    어긋나 저장 폭이 벌어졌다. 여기 한 곳에서만 만든다.

    1행 파노라마 ID / 2행 결론(등급 근거) / 3~4행 그 결론을 믿어도 되는지(품질).

    품질을 두 행으로 나눈 이유는 **폭이 곧 파일 폭**이기 때문이다 -- `bbox_inches="tight"` 라
    제목이 패널 폭을 넘으면 그만큼 그림이 넓어지고, `seam_worst` 이름 길이에 따라 장마다
    폭이 달라진다. 세로는 `tight_layout(rect=..0.88)` 이 0.79in 를 잡아두는데 3행은
    0.55in 만 써서 남았다. 4행이 0.73in 로 그 안에 들어간다.

    **임계는 실측 170자다** (실제 렌더 워커로 재확인): 144~170자는 전부 1728x727 이고
    171자부터 1732, 이후 자당 +10px 로 제목을 따라간다. 36,339장 실측 최장은 2행 165자였다.
    그런데 조각이 동시에 최대인 **조합 최악은 168자**로 여유가 2자뿐이었다 -- 우연히 남은
    여유이지 보장이 아니다. 두 가지로 구조화했다.
      1. 판정 불가면 `tag` 를 버린다. `DSI n/a` 인 줄에 '플래그도 n/a' 는 중복이고, 가장 긴
         조합(head 47자 + tag 22자)이 정확히 그 경우였다. 조합 최악 168 -> 146자.
      2. 그 위에 `MAX_TITLE_COLS` 하드 클램프. 오늘 분포에서는 발동하지 않지만 상한을
         **구조적으로** 보장한다. 발동하면 설계가 바뀌었다는 신호다.
    """
    c, p = rec["calib"], rec["pose"]
    if not rec["valid"]:
        tag = ""          # 'DSI n/a' 인 줄에 sight_flag 태그는 중복이다 (docstring 1.)
    if rec["valid"]:
        head = f"DSI {rec['dsi_raw']:.3f}"
    elif not rec["calib_valid"]:
        head = f"DSI n/a - calibration failed (ground faces {c['faces300']}/4)"
    elif not rec["on_mapped_road"]:
        head = f"DSI n/a - camera {rec['cam_off_road_m']:.1f}m off mapped road"
    else:
        head = f"DSI n/a - {rec['road_unknown_frac']:.0%} of road behind vehicles"

    sm, worst = c["seam_max"], c.get("seam_worst")
    seam_txt = "n/a" if sm is None else f"{sm:.3f}" + (f" @{worst}" if worst else "")
    lines = [
        pano,
        f"{head}   |   road occluded {rec['road_occluded_frac']:.1%}"
        f" of {rec['road_span_m']:.0f}m (excluded {rec['road_unknown_frac']:.0%})"
        f"   |   L_vis {rec['l_vis_m']:.1f}m vs D_stop {rec['d_stopping_m']:.1f}m"
        f" [{rec['speed_limit_kmh']:.0f}km/h cls{rec['road_class']}]{tag}",
        f"pose:     fit {p['fit_score']:.2f}"
        f" (far {_n2(p.get('fit_far'))} fwd {_n2(p.get('fit_fwd'))} bwd {_n2(p.get('fit_bwd'))})"
        f"   dyaw {p['dyaw_deg']:+.0f}deg   dxy ({p['dx_m']:+.0f},{p['dy_m']:+.0f})m"
        f"   at-limit {p['clipped']}/2   off road {rec['cam_off_road_m']:.1f}m",
        f"calib:    worst seam {seam_txt}   |   ground faces {c['faces300']}/4"
        f"   |   CONFIDENCE {rec['confidence']}/2",
    ]
    return "\n".join(x if len(x) <= MAX_TITLE_COLS
                     else x[:MAX_TITLE_COLS - 1] + "~" for x in lines)


def ray_hits(r_theta):
    """bev_render_worker 가 기대하는 [(각도deg, 거리m)] 형태."""
    return list(zip((np.arange(N_BINS) * 360.0 / N_BINS).tolist(), r_theta.tolist()))


def road_occlusion(links, r_theta, cam, bearing, dx=0.0, dy=0.0, r_veh=None):
    """도로를 따라 R 이내인 구간 중 r(theta) 로 '안 보이는' 길이의 비율.

    폭을 쓰지 않으므로 GIS 좌표 오차(카메라~노드 중앙 2.5m)에 견고하다.

    r_veh 를 주면 '차량 뒤라 알 수 없는' 구간을 **분모에서 뺀다**. 구조물만으로 재면 차량이
    가린 방향에서는 그 뒤의 구조물이 애초에 보이지 않아 r_theta 가 커지고, 결과적으로 그
    도로가 '보인다'고 계수된다 -- 실측상 도로 길이의 평균 6.6%p(지표값의 48%)를 낙관적으로
    세고 있었다. L_vis 의 sight_flag=None 과 같은 처리다: 모르면 판정하지 않는다. (D-15/X-17)

    반환의 road_occluded_frac 은 '아는 도로 중 안 보이는 비율'이고, 얼마나 몰랐는지는
    road_unknown_frac(전체 대비)으로 따로 남긴다. 판정 가능 여부는 호출자가 정한다.
    """
    if len(links) == 0:
        return None
    bx, by = _world_to_bev(links[:, 0], links[:, 1], cam, bearing, dx, dy)
    rr = np.hypot(bx, by)
    keep = rr <= R_MAX
    if keep.sum() == 0:
        return None
    rr, w = rr[keep], links[keep, 2]
    th = np.arctan2(bx[keep], by[keep]) % (2 * np.pi)
    k = (th / (2 * np.pi) * N_BINS).astype(np.int64) % N_BINS
    tot = float(w.sum())
    if tot <= 5.0:
        return None

    hidden = r_theta[k] < rr
    occ = float(w[hidden].sum())
    if r_veh is None:                       # 차량 포함 기준: 모르는 구간이 없다
        return {"road_occluded_frac": occ / tot, "road_span_m": tot,
                "road_occluded_m": occ, "road_known_m": tot, "road_unknown_frac": 0.0}

    # 구조물에 이미 가려진 구간은 차량과 무관하게 '안 보임'이다. 나머지 중 차량이 먼저
    # 막는 방향만 '모름'으로 뺀다.
    unknown = (~hidden) & (r_veh[k] < np.minimum(r_theta[k], rr))
    unk = float(w[unknown].sum())
    known = tot - unk
    den = known if known > 5.0 else tot     # 아는 구간이 거의 없으면 옛 정의로 퇴화(호출자가 기각)
    return {"road_occluded_frac": occ / den, "road_span_m": tot,
            "road_occluded_m": occ, "road_known_m": known, "road_unknown_frac": unk / tot}
