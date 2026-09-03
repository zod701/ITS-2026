import type { Grade } from "./components/MapLegend";

/** BEV 결과 이미지 안에서 패널 하나가 차지하는 사각형 (원본 픽셀 좌표) */
export interface BevCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 3패널 BEV 이미지의 형상. 렌더러를 바꾸면 배치가 바뀌므로 버전마다 들고 있다. */
export interface BevLayout {
  imageW: number;
  imageH: number;
  occupancy: BevCrop;
  shadow: BevCrop;
  shadowVeh: BevCrop;
}

export interface DsiVersion {
  id: string;
  label: string;
  /** 지점 단위 DSI 분포의 등급 경계 (패널 배지) */
  pointTerciles: [number, number];
  /** 도로(edge) 평균 DSI 분포의 등급 경계 (지도 선 색상) */
  roadTerciles: [number, number];
  /**
   * `clipped`(탐색 한계에 붙은 pose 축의 개수)의 분모.
   * 260819_2 부터 회전을 상수로 고정해 이동 2축만 세므로 2 다 (method.md D-21).
   * 그 전 판은 회전까지 탐색해 3축이었다.
   */
  poseAxes: 2 | 3;
  bevLayout: BevLayout;
  /**
   * BEV 이미지·지점 상세를 가져올 버전. 파이프라인 산출물은 그대로 두고 DSI 값만 다시
   * 만든 판(예: 동적 지수 결합)이 같은 이미지를 재사용하도록 한다. 없으면 자기 id 를 쓴다.
   */
  assetsFrom?: string;
  /**
   * α(정적:동적 비중)를 웹에서 조절할 수 있는 판인지. 자료에 `s`(정적)·`d`(동적) 성분이
   * 실려 있어야 하며, 브라우저가 `dsi = α·s + (1-α)·d` 를 다시 계산하고 등급 임계도
   * 그때 분포에서 다시 뽑는다 (TAAS/method.md D-21 · D-23).
   * α 는 사고 자료로 유도되지 않는 **설계 파라미터**라 사용자가 직접 움직여 볼 수 있게 둔다.
   */
  alphaAdjustable?: boolean;
  /** 조절 가능한 판의 초기 α. 없으면 0.35. */
  alphaDefault?: number;
}

// 세로 3단 (649x2187): 제목 3줄 아래로 패널이 위→아래.  패널 좌표는 실측값이다
// (흰 배경이 아닌 픽셀의 행/열 분포에서 경계를 찾았다).
const LAYOUT_VERTICAL_3: BevLayout = {
  imageW: 649,
  imageH: 2187,
  occupancy: { x: 0, y: 174, w: 649, h: 626 },
  shadow: { x: 0, y: 862, w: 649, h: 625 },
  shadowVeh: { x: 0, y: 1550, w: 649, h: 625 },
};

// 가로 3패널 (1748x727): 제목 3줄 아래로 패널이 좌→우. 세 패널 모두 528px 정사각형이고
// 여백 8px 을 더해 544px 로 잘라낸다.
const LAYOUT_HORIZONTAL_3: BevLayout = {
  imageW: 1748,
  imageH: 727,
  occupancy: { x: 3, y: 180, w: 544, h: 544 },
  shadow: { x: 603, y: 180, w: 544, h: 544 },
  shadowVeh: { x: 1202, y: 180, w: 544, h: 544 },
};

// 가로 3패널, 1728x727 (260819_3~). 패널이 508px 정사각형으로 조금 작아지고 제목이 한 줄
// 더 내려왔다(패널 상단 188 -> 208). 여백 8px 을 더해 524px 로 잘라낸다.
const LAYOUT_HORIZONTAL_3_1728: BevLayout = {
  imageW: 1728,
  imageH: 727,
  occupancy: { x: 3, y: 200, w: 524, h: 524 },
  shadow: { x: 603, y: 200, w: 524, h: 524 },
  shadowVeh: { x: 1202, y: 200, w: 524, h: 524 },
};

// 03 을 재실행할 때마다 BEV 이미지와 DSI 값이 한 벌로 갱신되므로, 그 한 벌을 버전으로 묶어
// 통째로 갈아끼운다 (이미지만 옛 버전인데 색은 새 버전인 상태를 만들지 않기 위해서다).
//
// DSI 는 버전 간 직접 비교할 수 없다 - 260811 은 D_stop/L_vis 를 곱한 옛 정의라 값이 최대
// 638 까지 벌어지고, 260818 은 도로 차폐율 기반이라 1.15~2.30 에 들어온다. 그래서 등급
// 경계도 각 버전의 분포에서 따로 뽑는다. 버전이 다르면 같은 색이라도 같은 위험도가 아니다.
//
// 새 버전을 추가할 때: build_image_map.py 로 bev_map_<id>.json,
// rebuild_dsi_data.py 로 dsi_map/road_dsi_map/bus_route_dsi_<id>.json 을 만들고,
// 두 임계값을 그 버전의 분포에서 다시 뽑고, 렌더 형상이 바뀌었으면 패널 좌표까지
// 실측해 여기 한 항목을 추가한다(첫 항목이 기본값).
export const DSI_VERSIONS: DsiVersion[] = [
  {
    // 프로젝트 목적을 **특수 이벤트 기간의 셔틀 노선 설계**로 한정하면서 만든 판이다.
    // 파이프라인(BEV·정적 DSI)은 260820 그대로이고, 동적 항의 통행량만 **강릉단오제 기간
    // 실측**으로 바꿨다. 배율은 연평균이 아니라 축제 창 앞뒤 28일과 비교해 계절 효과를
    // 통제했다 (TAAS/method.md D-24).
    //
    // 두 해를 나눠 둔 이유: 한 해만 보면 그해 특수 상황인지 알 수 없다. 두 판을 견주면
    // 배율 순위상관 rho +0.725 · 상위 10 중 7개 겹침으로 **축제 효과가 재현**된다.
    //
    // 정규화 기준점과 등급 임계를 **평시판(260820_2)과 공유**하므로 세 판을 직접 비교할 수
    // 있다. 판마다 따로 정규화하면 축제로 통행량이 올라가도 각자 0~1 로 다시 펴지며 상승분이
    // 상쇄된다 — 그 상태에서는 도로 순위상관이 0.9992 였다.
    id: "danoje_2026",
    label: "2026년 강릉단오제",
    // 아래 두 값은 격자(terciles_grid.json)를 못 받았을 때의 폴백이다. 실제 등급은
    // 기준판 격자에서 온다 — 그래서 이 판의 High-risk 도로는 3분의 1이 아니라 38.1% 다.
    pointTerciles: [0.3041, 0.4654],
    roadTerciles: [0.3812, 0.5156],
    poseAxes: 2,
    bevLayout: LAYOUT_HORIZONTAL_3_1728,
    assetsFrom: "260820",
    alphaAdjustable: true,
    alphaDefault: 0.35,
  },
  {
    // 프로젝트 목적을 **특수 이벤트 기간의 셔틀 노선 설계**로 한정하면서 만든 판이다.
    // 파이프라인(BEV·정적 DSI)은 260820 그대로이고, 동적 항의 통행량만 **강릉단오제 기간
    // 실측**으로 바꿨다. 배율은 연평균이 아니라 축제 창 앞뒤 28일과 비교해 계절 효과를
    // 통제했다 (TAAS/method.md D-24).
    //
    // 두 해를 나눠 둔 이유: 한 해만 보면 그해 특수 상황인지 알 수 없다. 두 판을 견주면
    // 배율 순위상관 rho +0.725 · 상위 10 중 7개 겹침으로 **축제 효과가 재현**된다.
    //
    // 정규화 기준점과 등급 임계를 **평시판(260820_2)과 공유**하므로 세 판을 직접 비교할 수
    // 있다. 판마다 따로 정규화하면 축제로 통행량이 올라가도 각자 0~1 로 다시 펴지며 상승분이
    // 상쇄된다 — 그 상태에서는 도로 순위상관이 0.9992 였다.
    id: "danoje_2025",
    label: "2025년 강릉단오제",
    // 아래 두 값은 격자(terciles_grid.json)를 못 받았을 때의 폴백이다. 실제 등급은
    // 기준판 격자에서 온다 — 그래서 이 판의 High-risk 도로는 3분의 1이 아니라 39.3% 다.
    pointTerciles: [0.3041, 0.4654],
    roadTerciles: [0.3812, 0.5156],
    poseAxes: 2,
    bevLayout: LAYOUT_HORIZONTAL_3_1728,
    assetsFrom: "260820",
    alphaAdjustable: true,
    alphaDefault: 0.35,
  },
  {
    // 파이프라인은 260820 그대로이고, 정적 DSI 에 **동적 지수를 결합**한 판이다
    // (TAAS/method.md D-17 · D-18). 지점마다
    //   DSI_t = α·DSI_static + (1-α)·(β·V_norm + (1-β)·P_resid)
    //
    // β = 0.398 은 **원시 사고지점 자료**(TAAS 2024~25 중상 이상 216건)로 유도했다
    // (D-20 · X-25). 포아송 계수 통행량 +0.929 / 초과차폐 +1.409 → 주정차 대리가 통행량보다
    // 크다. 절단 자료로 뽑았던 0.720 을 대체한다.
    //
    // α = 0.35 는 **자료로 유도한 값이 아니다** (D-21). 같은 모형에서 DSI 계수가 음수로
    // 나와 비율이 성립하지 않는다 — 중상 이상 사고는 간선 교차로에서 나고 DSI 는 그런 곳을
    // 안전하게 평가한다(X-13). α 는 설계 시나리오 0.20/0.35/0.50 의 대표값이며, 구간 끝단
    // 사이에서 상위 10% 의 절반가량이 교체된다.
    //
    // V_norm 은 계측 교차로 75개의 진입량을 차수로 나눠 IDW(k=5,p=1)로 보간한 **근사치**이고
    // (LOO R² 0.123), 예측이 아니라 결합 구조의 개념검증(PoC)이다. 계측점 1km 초과 지점
    // (1.5%)은 정적값만 쓴다.
    //
    // 척도가 다르다 — 0~1 정규화라 260820 의 1.15~1.89 와 직접 비교할 수 없다.
    // BEV 이미지·지점 상세는 파이프라인 산출물이라 260820 것을 그대로 쓴다(assetsFrom).
    id: "260820_2",
    label: "26.08.20 (2차)",
    pointTerciles: [0.3041, 0.4654],
    roadTerciles: [0.3811, 0.5155],
    poseAxes: 2,
    bevLayout: LAYOUT_HORIZONTAL_3_1728,
    assetsFrom: "260820",
    alphaAdjustable: true,
    alphaDefault: 0.35,
  },
  {
    // Drive 폴더명·로컬 산출물 모두 260820.
    // D-06 으로 차폐 도메인이 중심선 길이(m) -> 도로면 면적(m2) 으로 바뀌었다. 그 결과
    // 차폐 0 인 지점이 52% -> 6.7% 로 줄어, D-11 이 기계적 tercile 을 포기했던 이유
    // (quantile(1/3) 이 최소값과 같아짐)가 사라졌다. 이 버전부터는 tercile 을 그대로 쓴다.
    id: "260820",
    label: "26.08.20",
    pointTerciles: [1.1873, 1.392],
    roadTerciles: [1.3149, 1.5206],
    poseAxes: 2,
    bevLayout: LAYOUT_HORIZONTAL_3_1728,
  },
  {
    // Drive 폴더명·로컬 산출물 모두 260819_4 (260819_3 은 웹에 올리지 않았다).
    // D-24 반영: confidence 0/1/2 가 추가됐다 — 판정 여부와 무관하고, 낮을수록 위험을
    // 높게 말하는 경향이 있어 패널에서 DSI 옆에 함께 보여준다.
    // 렌더가 1728x727 고정으로 돌아왔다(폭 흔들림 해소).
    id: "260819_4",
    label: "26.08.19 (4차)",
    pointTerciles: [1.1501, 1.374],
    roadTerciles: [1.2434, 1.4091],
    poseAxes: 2,
    bevLayout: LAYOUT_HORIZONTAL_3_1728,
  },
  {
    // Drive 폴더명·로컬 산출물 모두 260819_2.
    // 회전 탐색을 없애고 계통 오차를 상수로 박은 실행이다 (bev_core.YAW_OFFSET = -2.0,
    // DYAW 후보가 하나뿐). 계측 도메인도 넓어져 차폐율이 260819 보다 올라갔다.
    id: "260819_2",
    label: "26.08.19 (2차)",
    pointTerciles: [1.1501, 1.3735],
    roadTerciles: [1.2438, 1.4099],
    poseAxes: 2,
    bevLayout: LAYOUT_HORIZONTAL_3,
  },
  {
    // Drive 폴더명은 latest_260819, 로컬 산출물은 output/260819.
    // 판정 게이트가 바뀌었다: pose_converged 가 빠지고 on_mapped_road(카메라가 GIS 도로망
    // 위에 있는가)가 들어왔다. 판정 불가 7.6% 중 대부분이 이 사유다.
    id: "260819",
    label: "26.08.19",
    // 최소값(= 차폐 0) 쏠림 52.0%. 기계적 tercile 은 이번에도 불가능하다.
    pointTerciles: [1.1501, 1.3711],
    roadTerciles: [1.243, 1.4066],
    poseAxes: 3,
    bevLayout: LAYOUT_HORIZONTAL_3,
  },
  {
    // Drive 폴더명은 260818_2(옛 이름 latest_260818_2), 로컬 산출물은 output/260818_2.
    // 03 재설계(도로 폴리곤 겹쳐 그리기·가로 3패널·판정 불가 표시)가 처음 반영된 실행이다.
    id: "260818_2",
    label: "26.08.18 (2차)",
    // 최소값 쏠림 49.6% (판정 불가 1,711지점이 빠져 260818 보다 조금 높다)
    pointTerciles: [1.1501, 1.382],
    roadTerciles: [1.2563, 1.4244],
    poseAxes: 3,
    bevLayout: LAYOUT_HORIZONTAL_3,
  },
  {
    id: "260818",
    label: "26.08.18",
    // 지점 분포는 47.8% 가 최소값(= 40m 안에 가려진 도로가 없음)에 묶여 있어 기계적
    // tercile 을 쓰면 quantile(1/3) 이 최소값과 같아져 Safe 가 0% 가 된다. 그래서
    // Safe 는 "차폐 0", 두 번째 경계는 나머지의 중앙값으로 둔다 (method.md D-11).
    pointTerciles: [1.1501, 1.4375],
    // 도로는 지점 평균이라 최소값 쏠림이 사라진다 -> tercile 을 그대로 쓴다.
    roadTerciles: [1.2735, 1.4754],
    poseAxes: 3,
    bevLayout: LAYOUT_VERTICAL_3,
  },
  {
    id: "260811",
    label: "26.08.11",
    pointTerciles: [1.92, 3.14],
    roadTerciles: [2.36, 3.57],
    poseAxes: 3,
    bevLayout: LAYOUT_VERTICAL_3,
  },
];

export const DEFAULT_DSI_VERSION = DSI_VERSIONS[0].id;

export function versionById(id: string): DsiVersion {
  return DSI_VERSIONS.find((v) => v.id === id) ?? DSI_VERSIONS[0];
}

export const DEFAULT_ALPHA = 0.35;

/** 성분에서 합성한 결합 지수. 정적전용 지점은 s === d 라 α 와 무관하게 같은 값이 나온다. */
export function combineAlpha(s: number, d: number, alpha: number): number {
  return alpha * s + (1 - alpha) * d;
}

/**
 * 판 간 비교용 공통 임계 격자 (`terciles_grid.json`).
 * α 별로 임계를 두되 **항상 기준판(평시) 분포에서 뽑은 값**이라, 같은 α 에서는 모든 판이
 * 같은 잣대를 쓴다. 그래야 "축제판이 평시판보다 High-risk 가 많다" 같은 서술이 성립한다.
 * 판마다 자기 분포에서 뽑으면 어느 판이든 항상 3등분이 되어 비교가 불가능하다 (D-24).
 */
export interface TercileGrid {
  road: Record<string, [number, number]>;
  point: Record<string, [number, number]>;
}

export function gridTerciles(
  grid: TercileGrid | null,
  kind: "road" | "point",
  alpha: number
): [number, number] | null {
  if (!grid) return null;
  const key = (Math.round(alpha / 0.05) * 0.05).toFixed(2);
  return grid[kind]?.[key] ?? null;
}

/** 격자가 없는 옛 판을 위한 폴백. 자기 분포에서 3분위를 뽑는다. */
export function tercilesOf(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  return [at(1 / 3), at(2 / 3)];
}

export function gradeFromDsi(dsi: number, terciles: [number, number]): Grade {
  if (dsi < terciles[0]) return "Safe";
  if (dsi < terciles[1]) return "Caution";
  return "High-risk";
}
