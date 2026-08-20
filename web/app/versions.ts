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

export function gradeFromDsi(dsi: number, terciles: [number, number]): Grade {
  if (dsi < terciles[0]) return "Safe";
  if (dsi < terciles[1]) return "Caution";
  return "High-risk";
}
