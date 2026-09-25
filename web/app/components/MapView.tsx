"use client";
import { routeDemandColors } from "../routeDemand";
import type { BisRoute, StationTotals } from "../bisRoutes";

function stationTooltip(p: StationTotals, route?: BisRoute, stop?: BisRoute["stops"][number]): HTMLElement {
  const container = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = p.name;
  container.appendChild(title);
  const count = (value: number | null, days: number) =>
    value == null ? "기록 없음" : `${(value / days).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}명/일`;
  const lines = [
    `정류장 ID ${p.sttn_id}`,
    "",
    ...(route ? ["전체 노선 합계 · 일평균"] : []),
    `2025년 일평균 승차 ${count(p.annual_2025_ride_nope, 365)} · 하차 ${count(p.annual_2025_goff_nope, 365)}`,
    `단오제 일평균 승차 ${count(p.danoje_ride_nope, 8)} · 하차 ${count(p.danoje_goff_nope, 8)}`,
  ];
  if (route && stop) {
    const annual = stop.demand.annual;
    const danoje = stop.demand.danoje;
    lines.push(
      "",
      `${route.name}번 · 일평균`,
      `2025년 승차 ${count(annual?.[0] ?? null, 365)} · 하차 ${count(annual?.[1] ?? null, 365)}`,
      `단오제 승차 ${count(danoje?.[0] ?? null, 8)} · 하차 ${count(danoje?.[1] ?? null, 8)}`,
    );
  }
  for (const text of lines) {
    container.appendChild(document.createElement("br"));
    container.appendChild(document.createTextNode(text));
  }
  return container;
}

import { useCallback, useEffect, useRef } from "react";
import L from "leaflet";
import type { PointFeature, SelectedPoint } from "../types";
import {
  combineAlpha,
  gradeFromDsi,
  gridTerciles,
  tercilesOf,
  versionById,
  type TercileGrid,
} from "../versions";
import {
  ACCIDENT_COLORS,
  BUS_ROUTE_COLORS,
  BUS_STOP_COLOR,
  LANDMARK_COLOR,
  ROUTE_CANDIDATE_COLOR,
  ROUTE_CANDIDATE_DASH,
  GRADE_COLORS,
  NO_DATA_COLOR,
  NO_DATA_KEY,
  type AccidentLayer,
  type BusRoute,
  type RouteCandidate,
  type Grade,
  type GradeFilterKey,
} from "./MapLegend";

const GANGNEUNG_BOUNDS: [[number, number], [number, number]] = [
  [37.7321168224, 128.8598787651],
  [37.811142202, 128.9546660985],
];

interface RoadFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { edge_id: string };
}

interface RoadDsiRecord {
  dsi: number;
  grade: Grade;
  n: number;
  /** α 조절판에만 있는 정적·동적 성분. dsi 는 이 둘로 다시 계산된다 (versions.ts). */
  s?: number;
  d?: number;
}

type RoadDsiMap = Record<string, RoadDsiRecord>;

const GRADE_COLORS_HOVER: Record<Grade, string> = {
  Safe: "#16a34a",
  Caution: "#ca8a04",
  "High-risk": "#dc2626",
};
const NO_DATA_COLOR_HOVER = "#d1d5db";

interface RoadsGeoJson {
  type: "FeatureCollection";
  features: RoadFeature[];
}

interface PointsGeoJson {
  type: "FeatureCollection";
  features: PointFeature[];
}

interface BusRouteFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { route: BusRoute; distance_km: number };
}

interface BusRoutesGeoJson {
  type: "FeatureCollection";
  features: BusRouteFeature[];
}

// 강릉시 BIS ID·좌표와 스마트카드 승하차를 결합한 지도 범위 내 정류장.
// TAAS/analysis/prep/build_bus_stop_demand.py에서 생성한다.
interface BusStopFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    name: string;
    addr: string;
    sttn_id: string;
    annual_2025_ride_nope: number | null;
    annual_2025_goff_nope: number | null;
    danoje_ride_nope: number | null;
    danoje_goff_nope: number | null;
    danoje_days_with_record: number;
    danoje_days_supplied: number;
  };
}

// 단오제 판의 수요가 흐르는 두 끝점 — 강릉역(외부 유입)과 전수교육관(행사 거점).
// 노선 후보를 볼 때 위치의 기준이 되므로 이름표를 항상 띄운다
// (TAAS/analysis/prep/landmarks.py).
interface LandmarkFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { name: string; title: string; addr: string };
}

// 두 거점을 잇는 위험도 최소 경로 3 개. 노선 A/B/C 와 같은 케이싱+실선 구조를 쓰되 색은
// 하나로 두고 rank 별 파선 무늬로 가른다.
interface RouteCandidateFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { rank: RouteCandidate; length_km: number; mean_dsi: number };
}

// 켜진 후보가 지나는 정류장. 한 정류장이 여러 후보에 걸리므로(강릉역 등) 후보별로 점을
// 복제하지 않고 ranks 에 어느 후보가 지나는지를 적어 둔다.
interface CandidateStopFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { name: string; addr: string; ranks: RouteCandidate[] };
}

// TAAS 원시 사고지점 오버레이 (2024~25 중상 이상 216건). 좌표계는 WGS84.
// 종전의 위험지역/다발지역 폴리곤은 사고 4건·9건 이상만 수록된 **선정 구역**이라
// 절단 자료였다 (TAAS/method.md X-24). 원시 지점으로 대체했다.
interface AccidentPointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    sev: "fatal" | "serious";
    year: string;
    ym: string;
    dn: string;
    dth: number;
    se: number;
    sl: number;
    type: string;
    road: string;
    viol: string;
  };
}

interface Props {
  demandPeriod: import("../bisRoutes").DemandPeriod;
  selectedBisRoute: import("../bisRoutes").BisRoute | null;
  onSelect: (point: SelectedPoint) => void;
  visibleGrades: Record<GradeFilterKey, boolean>;
  visibleRoutes: Record<BusRoute, boolean>;
  /** 버스 정류장 오버레이 표시 여부. 노선과 독립적으로 켠다. */
  showStops: boolean;
  /** 위험도 최소 경로 후보(rank 1~3) 중 켜 둘 것. */
  visibleCandidates: Record<RouteCandidate, boolean>;
  /** 표시를 끈 거점 이름. 비어 있으면 전부 보임 (page.tsx). */
  hiddenLandmarks: Record<string, boolean>;
  visibleAccident: Record<AccidentLayer, boolean>;
  /** 레이어별로 켜 둔 연도. 레이어가 켜져 있어도 여기 없는 연도는 그리지 않는다. */
  accidentYears: Record<AccidentLayer, Record<string, boolean>>;
  /** 도로 색상에 쓸 03 실행 버전 (versions.ts). 바뀌면 선 색을 다시 칠한다. */
  version: string;
  /** 정적:동적 비중. 조절 가능한 판에서만 의미가 있고, 바뀌면 값과 임계를 다시 뽑는다. */
  alpha: number;
  /** 값이 바뀔 때마다 지도를 해당 지점으로 이동(flyTo)한다. */
  flyToTarget: SelectedPoint | null;
  /** 검색으로 찾은 후보 지점들을 지도 위에 강조 마커로 표시. */
  highlightPointIds: string[];
}

function isDarkTheme(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light") return false;
  if (attr === "dark") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * 점 표식의 속살·테두리 색. 밝은 배경에서는 짙은 속살이 점을 드러내고 흰 테두리가 도로선과
 * 떼어 놓는데, 어두운 배경에서는 그 짙은 속살이 배경에 묻혀 얇은 흰 테두리만 남는다.
 * 그래서 다크모드에서는 둘을 **맞바꾼다** — 흰 속살이 점을 드러내고, 고유색이 테두리로
 * 물러나 어느 층의 표식인지는 그대로 알려준다.
 */
function markerPaint(identity: string, dark: boolean) {
  return dark
    ? { fillColor: "#ffffff", color: identity }
    : { fillColor: identity, color: "#ffffff" };
}

/**
 * 경유 정류장만은 두 테마 모두 속살을 노선색으로 둔다. 이 점은 '켜 둔 후보가 지나는 자리'를
 * 가리키므로 노선 선과 같은 색으로 채워져야 어느 선의 정류장인지 읽힌다 - 흰 속살로 뒤집으면
 * 일반 정류장과 같은 배색이 되어 구분이 사라진다. 어두운 배경에서는 흰 테두리가
 * 점을 드러내는 몫을 맡는다.
 */
function candidateStopPaint() {
  return { fillColor: ROUTE_CANDIDATE_COLOR, color: "#ffffff" };
}

/** 두 사각형이 겹치는 넓이. 0 이면 안 겹친다. */
function overlapArea(a: DOMRect, b: DOMRect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 사고 표식. 나머지 점 표식(DSI 지점·정류장·거점)이 전부 원이라, 사고만 **형태**로 갈라
 * 두면 색이 비슷해 보이는 상황에서도 무엇인지 바로 읽힌다. 삼각형은 원으로 그릴 수 없어
 * SVG divIcon 을 쓴다 - 그래서 이 표식만 마커 계열이고 나머지는 SVG 패스다.
 * 두 겹의 크기는 같게 두고 색과 진하기로만 구분한다 - 중상 196건도 사망 20건과 똑같이
 * 눈에 들어와야 분포를 읽을 수 있다.
 */
function accidentIcon(key: AccidentLayer): L.DivIcon {
  return L.divIcon({
    className: "accident-marker",
    html:
      '<svg width="15" height="14" viewBox="0 0 15 14" aria-hidden="true">' +
      '<path d="M7.5 1 L14 12.6 L1 12.6 Z" ' +
      `fill="${ACCIDENT_COLORS[key]}" fill-opacity="${key === "fatal" ? 0.95 : 0.7}" ` +
      'stroke="#ffffff" stroke-width="1.2" stroke-opacity="0.9" stroke-linejoin="round"/>' +
      "</svg>",
    iconSize: [15, 14],
    // 삼각형 무게중심 (1+12.6+12.6)/3 = 8.7 을 사고 지점에 맞춘다. 외접 사각형 중심에
    // 맞추면 도형이 실제 자리보다 위로 떠 보인다.
    iconAnchor: [7.5, 8.7],
  });
}

/**
 * 거점(강릉역·전수교육관) 표식. 사고를 삼각형으로 가른 것과 같은 이유로 네모를 쓴다 -
 * 원(지점·정류장) · 삼각형(사고) · 네모(거점)로 층마다 형태가 달라, 색이 비슷해 보이는
 * 상황에서도 무엇인지 읽힌다. 속살·테두리 색은 markerPaint 를 따라 다크모드에서 뒤집힌다.
 */
function landmarkIcon(dark: boolean): L.DivIcon {
  const { fillColor, color } = markerPaint(LANDMARK_COLOR, dark);
  return L.divIcon({
    className: "landmark-marker",
    html:
      '<svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">' +
      `<rect x="1.5" y="1.5" width="12" height="12" rx="1.5" fill="${fillColor}" ` +
      `stroke="${color}" stroke-width="2"/></svg>`,
    iconSize: [15, 15],
    iconAnchor: [7.5, 7.5],
  });
}

// 배경지도는 두 테마 모두 CARTO 무채색 타일을 쓴다. 기본 OSM 타일은 산이 초록, 물이 파랑,
// 건물이 분홍이라 그 위에 얹는 DSI 등급색(초록·노랑·빨강)과 버스 노선색이 배경과 섞여 읽히지
// 않았다. 배경에서 색을 빼면 화면의 색은 전부 지표를 뜻하게 된다.
// CARTO 가 2026 년 들어 raster(PNG) 베이스맵에 API 키를 요구하기 시작했다. 키가 없으면
// 타일에 "API KEY REQUIRED" 워터마크가 찍힌다(무료 한도 월 500만 타일, 비상업 이용).
// 키는 carto.com/basemaps/apikey 에서 도메인을 적어 신청하면 바로 발급된다.
// 타일은 브라우저가 직접 받으므로 키가 클라이언트에 노출된다 — CARTO 도 그 전제로
// 도메인을 받아 제한하므로 NEXT_PUBLIC_ 로 둔다 (Drive 키처럼 감출 수 있는 종류가 아니다).
// 키가 없으면 지금처럼 워터마크가 있는 채로 계속 동작한다.
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY;
const cartoTiles = (style: string) =>
  `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png` +
  (CARTO_KEY ? `?key=${CARTO_KEY}` : "");

const LIGHT_TILE_URL = cartoTiles("light_all");
const DARK_TILE_URL = cartoTiles("dark_all");
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function nearestPoint(
  points: PointFeature[],
  lat: number,
  lon: number
): PointFeature | null {
  let best: PointFeature | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const [plon, plat] = p.geometry.coordinates;
    const d = (plat - lat) ** 2 + (plon - lon) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

// 도로(edge) 단위 평균 DSI 분포의 3등분(tercile) 경계값으로 등급을 재계산한다. 경계값은
// 버전마다 다르므로(versions.ts) 여기 고정하지 않고 선택된 버전의 값을 받아 쓴다.
// road_dsi_map_*.json에 저장된 grade 필드(구 임계값 Safe<1.0/Caution<1.8 기준)는
// 매칭 테이블 원본 그대로 두고, 지도 색상 표시에만 이 기준을 적용한다.

export default function MapView({
  demandPeriod,
  selectedBisRoute,
  onSelect,
  visibleGrades,
  visibleRoutes,
  showStops,
  visibleCandidates,
  hiddenLandmarks,
  visibleAccident,
  accidentYears,
  version,
  alpha,
  flyToTarget,
  highlightPointIds,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);
  const visibleGradesRef = useRef(visibleGrades);
  const applyFilterRef = useRef<() => void>(() => {});
  const visibleRoutesRef = useRef(visibleRoutes);
  const applyRouteFilterRef = useRef<() => void>(() => {});
  const mapRef = useRef<L.Map | null>(null);
  const fittedBisRouteRef = useRef<string | null>(null);
  const pointsRef = useRef<PointFeature[]>([]);
  const highlightLayerRef = useRef<L.LayerGroup | null>(null);
  // 버전이 바뀌면 지도를 다시 만들지 않고 선 색만 갈아입힌다(줌·이동 상태 유지).
  // 지도 생성 effect 는 []로 한 번만 도므로, 그 안의 콜백이 최신 값을 보도록 ref 로 둔다.
  const roadDsiRef = useRef<RoadDsiMap>({});
  const roadTercilesRef = useRef<[number, number]>(versionById(version).roadTerciles);
  const roadsLayerRef = useRef<L.GeoJSON | null>(null);
  const restyleRoadsRef = useRef<() => void>(() => {});
  // α 를 바꾸면 각 도로의 dsi 를 성분에서 다시 합성하고 임계도 그 분포에서 다시 뽑는다.
  // 성분(s·d)이 없는 옛 버전은 파일에 실린 dsi 와 versions.ts 의 임계를 그대로 쓴다.
  const alphaRef = useRef(alpha);
  const applyAlphaRef = useRef<() => void>(() => {});
  // 판 간 비교가 성립하도록 임계는 기준판 격자에서 가져온다 (D-24). 한 번만 받아 둔다.
  const tercileGridRef = useRef<TercileGrid | null>(null);
  // 도로(DSI)와 버스 노선은 각자 독립적인 fetch로 비동기 추가되므로, 어느 쪽이 먼저
  // 도착하느냐에 따라 SVG z-order(추가 순서)가 매번 달라질 수 있다. 버스 노선 레이어를
  // 항상 여기 저장해두고, 도로 레이어가 (나중에) 추가된 직후 다시 앞으로 가져와 항상
  // 버스 노선이 DSI 선 위에 보이도록 강제한다.
  const busRouteLayersRef = useRef<L.GeoJSON[]>([]);
  // 정류장은 노선과 같은 층위(노선 위, 사고 아래)에 둔다. 정류장 점이 한꺼번에 붙었다
  // 떨어지면 그때마다 SVG 를 다시 그리므로, 레이어는 한 번만 만들고 지도에서 넣고 뺀다.
  const busStopsLayerRef = useRef<L.GeoJSON | null>(null);
  const landmarksLayerRef = useRef<L.GeoJSON | null>(null);
  const showStopsRef = useRef(showStops);
  const applyStopsRef = useRef<() => void>(() => {});
  const candidateLayersRef = useRef<L.GeoJSON[]>([]);
  // 켜진 후보가 지나는 정류장. 전체 정류장 레이어와 별개로, 후보 토글을 따라 켜진다.
  const candidateStopsLayerRef = useRef<L.GeoJSON | null>(null);
  // 경유 정류장 이름표를 마우스가 떠난 뒤에도 남겨 둘지. 정류장을 클릭할 때마다 뒤집힌다.
  const stopLabelsPinnedRef = useRef(false);
  const layoutStopLabelsRef = useRef<() => void>(() => {});
  const visibleCandidatesRef = useRef(visibleCandidates);
  const applyCandidateFilterRef = useRef<() => void>(() => {});
  const applyCandidateStopFilterRef = useRef<() => void>(() => {});
  const hiddenLandmarksRef = useRef(hiddenLandmarks);
  const applyLandmarkFilterRef = useRef<() => void>(() => {});
  // 레이어가 다섯 갈래로 각자 비동기 도착하므로, 어느 것이 늦게 붙든 순서를 여기서 한 번에
  // 다시 세운다. 아래에서 위로: 도로 → 노선 A/B/C → 후보 노선 → 정류장 → 경유 정류장 →
  // 랜드마크 → 사고. 정류장을 노선보다 위에 두어 노선 선이 정류장 점을 덮지 않게 한다.
  // 테마가 바뀌면 배경 타일과 함께 점 표식도 다시 칠한다 (markerPaint).
  const repaintMarkersRef = useRef<() => void>(() => {});
  repaintMarkersRef.current = () => {
    const dark = isDarkTheme();
    busStopsLayerRef.current?.setStyle(markerPaint(BUS_STOP_COLOR, dark));
    candidateStopsLayerRef.current?.setStyle(candidateStopPaint());
    // 거점은 divIcon 이라 setStyle 이 먹지 않는다. 아이콘을 새로 만들어 갈아 끼우고,
    // 그 과정에서 지워지는 display:none 을 필터로 다시 입힌다.
    landmarksLayerRef.current?.eachLayer((m) =>
      (m as L.Marker).setIcon(landmarkIcon(dark))
    );
    applyLandmarkFilterRef.current();
  };
  const restackRef = useRef<() => void>(() => {});
  restackRef.current = () => {
    busRouteLayersRef.current.forEach((layer) => layer.bringToFront());
    candidateLayersRef.current.forEach((layer) => layer.bringToFront());
    busStopsLayerRef.current?.bringToFront();
    candidateStopsLayerRef.current?.bringToFront();
    // 거점(markerPane 600)과 사고(전용 pane 610·620)는 SVG 패스가 아니라 마커라
    // bringToFront 가 먹지 않는다. 그 둘의 순서는 pane 의 z-index 가 정한다.
  };
  // 사고 이력 오버레이는 DSI 도로·버스 노선보다 위에 그린다 - 아래에 두면 촘촘한 도로선이
  // 면을 잘게 끊어 놔 어디까지가 한 구역인지 읽히지 않는다. 전용 pane 을 쓰므로 도착
  // 순서와 무관하게 늘 그 자리다.
  const accidentLayersRef = useRef<Partial<Record<AccidentLayer, L.GeoJSON>>>({});
  const visibleAccidentRef = useRef(visibleAccident);
  const accidentYearsRef = useRef(accidentYears);
  const applyAccidentFilterRef = useRef<() => void>(() => {});

  // ref 만 읽으므로 신원이 고정돼도 항상 현재 버전의 데이터를 본다.
  const gradeKeyFor = useCallback((edgeId: string): GradeFilterKey => {
    const rec = roadDsiRef.current[edgeId];
    return rec ? gradeFromDsi(rec.dsi, roadTercilesRef.current) : NO_DATA_KEY;
  }, []);
  const colorFor = useCallback((edgeId: string): string => {
    const rec = roadDsiRef.current[edgeId];
    return rec ? GRADE_COLORS[gradeFromDsi(rec.dsi, roadTercilesRef.current)] : NO_DATA_COLOR;
  }, []);
  const hoverColorFor = useCallback((edgeId: string): string => {
    const rec = roadDsiRef.current[edgeId];
    return rec
      ? GRADE_COLORS_HOVER[gradeFromDsi(rec.dsi, roadTercilesRef.current)]
      : NO_DATA_COLOR_HOVER;
  }, []);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // 버전이 바뀌면 해당 버전의 도로 DSI 를 받아 선 색만 다시 칠한다. 지도 인스턴스는 그대로
  // 두므로 보고 있던 위치·줌이 유지된다. 도로 레이어가 아직 없으면(첫 로드) 레이어가
  // 만들어진 뒤 restyleRoadsRef 로 한 번 더 호출된다.
  useEffect(() => {
    let cancelled = false;
    const restyle = () => {
      const layer = roadsLayerRef.current;
      if (!layer) return;
      layer.setStyle((feature) => ({
        color: colorFor((feature as unknown as RoadFeature).properties.edge_id),
        weight: 4,
        opacity: 0.85,
      }));
      applyFilterRef.current();
    };
    restyleRoadsRef.current = restyle;

    fetch(`/data/road_dsi_map_${version}.json`)
      .then((res) => res.json())
      .catch(() => ({}))
      .then((data: RoadDsiMap) => {
        if (cancelled) return;
        roadDsiRef.current = data;
        applyAlphaRef.current();
      });

    return () => {
      cancelled = true;
    };
  }, [version, colorFor]);

  // 성분에서 dsi 를 다시 합성하고 임계를 다시 뽑은 뒤 선 색을 갈아입힌다.
  applyAlphaRef.current = () => {
    const recs = Object.values(roadDsiRef.current);
    const hasParts = recs.length > 0 && recs[0].s !== undefined;
    if (hasParts) {
      recs.forEach((r) => {
        r.dsi = combineAlpha(r.s as number, r.d as number, alphaRef.current);
      });
      roadTercilesRef.current =
        gridTerciles(tercileGridRef.current, "road", alphaRef.current) ??
        tercilesOf(recs.map((r) => r.dsi));
    } else {
      roadTercilesRef.current = versionById(version).roadTerciles;
    }
    restyleRoadsRef.current();
    applyFilterRef.current();
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/data/terciles_grid.json")
      .then((res) => res.json())
      .then((g: TercileGrid) => {
        if (cancelled) return;
        tercileGridRef.current = g;
        applyAlphaRef.current();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    alphaRef.current = alpha;
    applyAlphaRef.current();
  }, [alpha, version]);

  useEffect(() => {
    visibleGradesRef.current = visibleGrades;
    applyFilterRef.current();
  }, [visibleGrades]);

  useEffect(() => {
    visibleRoutesRef.current = visibleRoutes;
    applyRouteFilterRef.current();
  }, [visibleRoutes]);

  useEffect(() => {
    showStopsRef.current = showStops;
    applyStopsRef.current();
  }, [showStops]);

  useEffect(() => {
    visibleCandidatesRef.current = visibleCandidates;
    applyCandidateFilterRef.current();
    applyCandidateStopFilterRef.current();
  }, [visibleCandidates]);

  useEffect(() => {
    hiddenLandmarksRef.current = hiddenLandmarks;
    applyLandmarkFilterRef.current();
  }, [hiddenLandmarks]);

  useEffect(() => {
    visibleAccidentRef.current = visibleAccident;
    applyAccidentFilterRef.current();
  }, [visibleAccident]);

  useEffect(() => {
    accidentYearsRef.current = accidentYears;
    applyAccidentFilterRef.current();
  }, [accidentYears]);

  // 검색 결과 지점으로 지도 이동 + 마커 임시 강조.
  useEffect(() => {
    if (!flyToTarget || !mapRef.current) return;
    mapRef.current.flyTo([flyToTarget.lat, flyToTarget.lon], 18, { duration: 0.8 });
    const marker = L.circleMarker([flyToTarget.lat, flyToTarget.lon], {
      radius: 14,
      color: "#facc15",
      weight: 3,
      fillOpacity: 0,
    }).addTo(mapRef.current);
    const timer = setTimeout(() => marker.remove(), 2000);
    return () => {
      clearTimeout(timer);
      marker.remove();
    };
  }, [flyToTarget]);

  // 주소 검색 후보지 하이라이트 마커.
  useEffect(() => {
    if (!mapRef.current) return;
    highlightLayerRef.current?.clearLayers();
    if (highlightPointIds.length === 0) return;
    const layer = highlightLayerRef.current ?? L.layerGroup().addTo(mapRef.current);
    highlightLayerRef.current = layer;
    const idSet = new Set(highlightPointIds);
    for (const p of pointsRef.current) {
      if (!idSet.has(p.properties.point_id)) continue;
      const [lon, lat] = p.geometry.coordinates;
      L.circleMarker([lat, lon], {
        radius: 8,
        color: "#facc15",
        weight: 2,
        fillColor: "#fde047",
        fillOpacity: 0.9,
      })
        .bindTooltip(`지점 #${p.properties.point_id}`)
        .on("click", () => {
          onSelectRef.current({
            pointId: p.properties.point_id,
            panoId: p.properties.pano_id,
            lat,
            lon,
          });
        })
        .addTo(layer);
    }
  }, [highlightPointIds]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current).fitBounds(GANGNEUNG_BOUNDS);
    mapRef.current = map;
    // 언마운트(map.remove()) 이후 늦게 도착하는 fetch 콜백이 이미 제거된 지도에
    // 레이어를 추가하려다 던지는 크래시(Renderer.onAdd -> getPane() undefined)를 막는다.
    // React StrictMode의 mount->unmount->mount 이중 실행이나 Fast Refresh로 재현된다.
    let cancelled = false;

    // 다크모드일 때는 CARTO Dark Matter 타일(무료, OSM 데이터 기반)로 전환 —
    // 기본 OSM 타일은 항상 밝은 배경이라 다크모드에서도 그대로면 눈부심.
    // data-theme(토글 수동 선택)을 시스템 설정보다 우선하고, 토글이 바뀌면
    // MutationObserver로 감지해 타일 레이어를 즉시 교체한다.
    // 사고 표식은 divIcon 마커라 bringToFront 로 순서를 세울 수 없다. 전용 pane 을 만들어
    // z-index 로 못 박는다 - markerPane(600) 위, tooltipPane(650) 아래.
    map.createPane("accident-serious").style.zIndex = "610";
    map.createPane("accident-fatal").style.zIndex = "620";

    let currentDark = isDarkTheme();
    let tileLayer = L.tileLayer(currentDark ? DARK_TILE_URL : LIGHT_TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    const observer = new MutationObserver(() => {
      const dark = isDarkTheme();
      if (dark === currentDark) return;
      currentDark = dark;
      map.removeLayer(tileLayer);
      tileLayer = L.tileLayer(dark ? DARK_TILE_URL : LIGHT_TILE_URL, {
        attribution: TILE_ATTRIBUTION,
        maxZoom: 19,
      }).addTo(map);
      repaintMarkersRef.current();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let points: PointFeature[] = [];

    fetch("/data/points.geojson")
      .then((res) => res.json())
      .then((data: PointsGeoJson) => {
        if (cancelled) return;
        points = data.features;
        pointsRef.current = data.features;
      });

    fetch("/data/roads.geojson")
      .then((res) => res.json())
      .then((data: RoadsGeoJson) => {
        if (cancelled) return;
        const roadsLayer = L.geoJSON(data as GeoJSON.GeoJsonObject, {
          style: (feature) => ({
            color: colorFor((feature as unknown as RoadFeature).properties.edge_id),
            weight: 4,
            opacity: 0.85,
          }),
          onEachFeature: (feature, layer) => {
            const edgeId = (feature as unknown as RoadFeature).properties.edge_id;
            layer.on("mouseover", () => {
              if (!visibleGradesRef.current[gradeKeyFor(edgeId)]) return;
              (layer as L.Path).setStyle({ color: hoverColorFor(edgeId), weight: 6 });
            });
            layer.on("mouseout", () => {
              if (!visibleGradesRef.current[gradeKeyFor(edgeId)]) return;
              (layer as L.Path).setStyle({ color: colorFor(edgeId), weight: 4 });
            });
            layer.on("click", (e: L.LeafletMouseEvent) => {
              if (!visibleGradesRef.current[gradeKeyFor(edgeId)]) return;
              if (points.length === 0) return;
              const nearest = nearestPoint(points, e.latlng.lat, e.latlng.lng);
              if (!nearest) return;
              const [lon, lat] = nearest.geometry.coordinates;
              onSelectRef.current({
                pointId: nearest.properties.point_id,
                panoId: nearest.properties.pano_id,
                lat,
                lon,
              });
            });
          },
        });
        roadsLayer.addTo(map);
        roadsLayerRef.current = roadsLayer;
        // 도로가 다른 레이어보다 나중에 추가돼 위로 올라갈 수 있으니 순서를 다시 세운다.
        restackRef.current();

        // grade 체크박스(범례)로 토글될 때 해당 등급 도로만 지도에 남기고 나머지는 제거.
        applyFilterRef.current = () => {
          roadsLayer.eachLayer((layer) => {
            const feature = (layer as L.Path & { feature: RoadFeature }).feature;
            const edgeId = feature.properties.edge_id;
            const show = visibleGradesRef.current[gradeKeyFor(edgeId)];
            const el = (layer as L.Path).getElement();
            if (el) (el as HTMLElement).style.display = show ? "" : "none";
          });
        };
        applyFilterRef.current();
        // 도로 데이터가 DSI 맵보다 늦게 도착했을 수도 있으니 여기서도 한 번 칠한다.
        restyleRoadsRef.current();
      });

    fetch("/data/bus_routes.geojson")
      .then((res) => res.json())
      .then((busRoutes: BusRoutesGeoJson) => {
        if (cancelled) return;
        // 도로 위험도(DSI) 선과 헷갈리지 않도록, 버스 노선은 어두운 케이싱(테두리)을 먼저
        // 깔고 그 위에 컬러 실선을 겹쳐 그린다 — 굵은 테두리가 있는 실선이라 얇은 DSI 라인과
        // 형태 자체가 달라 구분된다. interactive: false로 클릭/hover를 무시시켜, 버스 노선이
        // DSI 도로 위에 겹쳐 그려져도 그 아래 도로의 클릭 이벤트(패널 열기)를 가리지 않게 한다.
        const casingLayer = L.geoJSON(busRoutes as GeoJSON.GeoJsonObject, {
          style: () => ({
            color: "#111827",
            weight: 9,
            opacity: 0.55,
          }),
          interactive: false,
        }).addTo(map);
        const busRoutesLayer = L.geoJSON(busRoutes as GeoJSON.GeoJsonObject, {
          style: (feature) => ({
            color: BUS_ROUTE_COLORS[(feature as unknown as BusRouteFeature).properties.route],
            weight: 5,
            opacity: 1,
          }),
          interactive: false,
        }).addTo(map);
        busRouteLayersRef.current = [casingLayer, busRoutesLayer];
        restackRef.current();

        // 노선 체크박스(범례)로 토글될 때 해당 노선(케이싱+컬러 라인 둘 다)만 지도에 남기고 나머지는 제거.
        applyRouteFilterRef.current = () => {
          [casingLayer, busRoutesLayer].forEach((layerGroup) => {
            layerGroup.eachLayer((layer) => {
              const feature = (layer as L.Path & { feature: BusRouteFeature }).feature;
              const show = visibleRoutesRef.current[feature.properties.route];
              const el = (layer as L.Path).getElement();
              if (el) (el as HTMLElement).style.display = show ? "" : "none";
            });
          });
        };
        applyRouteFilterRef.current();
      });

    // 위험도 최소 경로 후보. 노선 A/B/C 와 같은 케이싱+실선 2 겹 구조를 쓴다 -
    // interactive: false 로 아래 도로의 클릭(패널 열기)을 가리지 않는다. 후보별 수치는
    // 툴팁 대신 「버스 노선」 패널에 적는다 - A/B/C 의 평균 DSI 와 같은 자리라야 견준다.
    fetch("/data/route_candidates.geojson")
      .then((res) => res.json())
      .catch(() => null)
      .then((loaded) => {
        if (cancelled || !loaded) return;
        const casing = L.geoJSON(loaded as GeoJSON.GeoJsonObject, {
          style: () => ({ color: "#111827", weight: 9, opacity: 0.55 }),
          interactive: false,
        }).addTo(map);
        const core = L.geoJSON(loaded as GeoJSON.GeoJsonObject, {
          style: (feature) => ({
            color: ROUTE_CANDIDATE_COLOR,
            weight: 5,
            opacity: 1,
            dashArray:
              ROUTE_CANDIDATE_DASH[
                (feature as unknown as RouteCandidateFeature).properties.rank
              ],
          }),
          interactive: false,
        }).addTo(map);
        candidateLayersRef.current = [casing, core];

        applyCandidateFilterRef.current = () => {
          [casing, core].forEach((group) => {
            group.eachLayer((layer) => {
              const feature = (layer as L.Path & { feature: RouteCandidateFeature }).feature;
              const show = visibleCandidatesRef.current[feature.properties.rank];
              const el = (layer as L.Path).getElement();
              if (el) (el as HTMLElement).style.display = show ? "" : "none";
            });
          });
        };
        applyCandidateFilterRef.current();
        restackRef.current();
      });

    // 켜진 후보가 지나는 정류장. 후보 선과 같은 색으로 칠해 어느 선의 정류장인지 바로
    // 읽히게 한다. 이름표는 **기본으로 감추고**, 이 중 아무 점에나 마우스를 올리면 그때
    // 켜져 있는 경유 정류장 이름이 한꺼번에 뜬다 - 노선이 어디를 훑는지는 이름 하나가
    // 아니라 이름의 배열로 읽히므로, 하나만 띄우면 오히려 쓸모가 없다. 상시로 띄우면
    // 25개가 서로 겹쳐 아무것도 못 읽는다.
    fetch("/data/route_candidate_stops.geojson")
      .then((res) => res.json())
      .catch(() => null)
      .then((loaded) => {
        if (cancelled || !loaded) return;
        const layer = L.geoJSON(loaded as GeoJSON.GeoJsonObject, {
          pointToLayer: (_feature, latlng) =>
            L.circleMarker(latlng, {
              radius: 6,
              weight: 1.8,
              opacity: 1,
              fillOpacity: 1,
              ...candidateStopPaint(),
            }),
          onEachFeature: (feature, marker) => {
            const p = (feature as unknown as CandidateStopFeature).properties;
            // permanent 로 붙여 두고 보이고 감추는 일은 CSS 에 맡긴다 - 마우스가 옮겨다닐
            // 때마다 25개를 열고 닫으면 이름표가 깜빡인다.
            marker.bindTooltip(p.name, {
              permanent: true,
              direction: "right",
              offset: [8, 0],
              className: "candidate-stop-label",
            });
            const showLabels = (on: boolean) => {
              map.getContainer().classList.toggle("show-stop-labels", on);
              if (on) layoutStopLabelsRef.current();
            };
            marker.on("mouseover", () => showLabels(true));
            // 고정해 둔 동안에는 마우스가 떠나도 이름을 남긴다 - 경유지를 적어 두거나
            // 다른 후보와 견주려면 마우스를 치운 뒤에도 보여야 한다.
            marker.on("mouseout", () => {
              if (!stopLabelsPinnedRef.current) showLabels(false);
            });
            // 한 번 누르면 고정, 다시 누르면 풀린다. 푸는 순간에도 마우스는 아직 점 위에
            // 있으므로 이름은 켠 채로 두고, 실제로 벗어날 때 위 mouseout 이 지운다.
            marker.on("click", () => {
              stopLabelsPinnedRef.current = !stopLabelsPinnedRef.current;
              showLabels(true);
            });
          },
        }).addTo(map);
        candidateStopsLayerRef.current = layer;

        applyCandidateStopFilterRef.current = () => {
          let anyVisible = false;
          layer.eachLayer((marker) => {
            const feature = (marker as L.Path & { feature: CandidateStopFeature }).feature;
            const show = feature.properties.ranks.some(
              (r) => visibleCandidatesRef.current[r]
            );
            anyVisible = anyVisible || show;
            const el = (marker as L.Path).getElement();
            if (el) (el as HTMLElement).style.display = show ? "" : "none";
            // 점을 숨겨도 Leaflet 툴팁은 따로 떠 있으므로 같이 여닫는다.
            if (show) marker.openTooltip();
            else marker.closeTooltip();
          });
          // 보일 정류장이 하나도 없으면 고정을 풀어 둔다 - 그대로 두면 후보를 다시 켰을 때
          // 만지지도 않은 이름표가 떠 있다.
          if (!anyVisible) {
            stopLabelsPinnedRef.current = false;
            map.getContainer().classList.remove("show-stop-labels");
          }
          layoutStopLabelsRef.current();
        };
        // 이름표가 서로 겹치지 않도록 점의 **좌·우** 중 빈 쪽에 붙인다. 기본은 오른쪽이고,
        // 그 자리가 이미 찬 이름표와 겹치면 왼쪽으로 넘긴다. 양쪽 다 겹치면 덜 겹치는 쪽에
        // 둔다 - 정류장이 한 축으로 촘촘히 늘어선 구간은 좌우만으로 다 풀리지 않는다.
        // 움직이지 않는 랜드마크 이름표는 미리 자리를 차지한 것으로 놓고 시작한다.
        layoutStopLabelsRef.current = () => {
          if (!map.getContainer().classList.contains("show-stop-labels")) return;
          const taken: DOMRect[] = [];
          landmarksLayerRef.current?.eachLayer((m) => {
            const el = m.getTooltip()?.getElement();
            if (el?.isConnected && el.offsetWidth) taken.push(el.getBoundingClientRect());
          });

          const markers: L.CircleMarker[] = [];
          layer.eachLayer((m) => markers.push(m as L.CircleMarker));
          // 화면 위에서 아래 순으로 배치해야 결과가 매번 같다.
          markers.sort(
            (a, b) =>
              map.latLngToContainerPoint(a.getLatLng()).y -
              map.latLngToContainerPoint(b.getLatLng()).y
          );

          for (const m of markers) {
            const dot = m.getElement() as HTMLElement | null;
            const el = m.getTooltip()?.getElement();
            if (!el?.isConnected || dot?.style.display === "none") continue;
            // 자리를 예측하지 않고 **실제로 옮겨 보고 잰다**. Leaflet 이 방향 클래스마다
            // margin-left 를 따로 걸어 두므로(오른쪽 6px), 인라인으로 덮으면 예측식이
            // 그만큼 어긋난다.
            el.style.marginLeft = "";
            const right = el.getBoundingClientRect();
            el.style.marginLeft = `${-(right.width + 16)}px`;
            const left = el.getBoundingClientRect();

            const cost = (r: DOMRect) =>
              taken.reduce((sum, t) => sum + overlapArea(r, t), 0);
            const useLeft = cost(left) < cost(right);
            if (!useLeft) el.style.marginLeft = "";
            taken.push(useLeft ? left : right);
          }
        };

        applyCandidateStopFilterRef.current();
        layoutStopLabelsRef.current();
        // 줌·이동으로 점 사이 화면 거리가 바뀌면 좌우 배치도 다시 잡아야 한다.
        map.on("zoomend moveend", () => layoutStopLabelsRef.current());
        restackRef.current();
      });

    // 두 점뿐이고 DSI 색과 겹치지 않는 무채색 표식이라 상시 표시한다 - 첫 화면에서
    // 지도가 어디를 보고 있는지 알려주는 기준점 역할이지 대조 자료가 아니다.
    fetch("/data/landmarks.geojson")
      .then((res) => res.json())
      .catch(() => null)
      .then((loaded) => {
        if (cancelled || !loaded) return;
        const layer = L.geoJSON(loaded as GeoJSON.GeoJsonObject, {
          pointToLayer: (_feature, latlng) =>
            L.marker(latlng, { icon: landmarkIcon(isDarkTheme()) }),
          onEachFeature: (feature, layer) => {
            const p = (feature as unknown as LandmarkFeature).properties;
            layer.bindTooltip(p.name, {
              permanent: true,
              direction: "top",
              offset: [0, -8],
              className: "landmark-label",
            });
          },
        }).addTo(map);
        landmarksLayerRef.current = layer;

        applyLandmarkFilterRef.current = () => {
          layer.eachLayer((layer_) => {
            const marker = layer_ as L.Marker & { feature: LandmarkFeature };
            const show = !hiddenLandmarksRef.current[marker.feature.properties.name];
            const el = marker.getElement();
            if (el) el.style.display = show ? "" : "none";
            // 점을 숨겨도 Leaflet 툴팁은 따로 떠 있으므로 이름표도 같이 여닫는다.
            if (show) marker.openTooltip();
            else marker.closeTooltip();
          });
        };
        applyLandmarkFilterRef.current();
        restackRef.current();
      });

    fetch("/data/bus_stops.geojson")
      .then((res) => res.json())
      .catch(() => null)
      .then((loaded) => {
        if (cancelled || !loaded) return;
        // 반지름 4px. 정류장이 도심에 몰려 있어 이보다 크면 서로 붙어 도로를 덮는다.
        // 사고지점(색 속살 + 흰 테두리)과 안팎이 뒤집힌 배색이라 겹쳐 봐도 갈린다.
        const stopsLayer = L.geoJSON(loaded as GeoJSON.GeoJsonObject, {
          pointToLayer: (_feature, latlng) =>
            L.circleMarker(latlng, {
              radius: 4,
              weight: 1.2,
              opacity: 0.9,
              fillOpacity: 0.95,
              ...markerPaint(BUS_STOP_COLOR, isDarkTheme()),
            }),
          onEachFeature: (feature, layer) => {
            const p = (feature as unknown as BusStopFeature).properties;
            layer.bindTooltip(
              stationTooltip(p),
              { sticky: true }
            );
          },
        });
        busStopsLayerRef.current = stopsLayer;

        applyStopsRef.current = () => {
          const layer = busStopsLayerRef.current;
          if (!layer) return;
          if (showStopsRef.current) {
            layer.addTo(map);
            restackRef.current();
          } else {
            layer.remove();
          }
        };
        applyStopsRef.current();
      });

    // TAAS 원시 사고지점. 사망/중상 두 겹으로 나눠 얹는다 - 216건뿐이라 개별 점으로
    // 그려도 지도가 뭉개지지 않고, 종전 선정구역과 달리 사고가 실제로 난 자리를 가리킨다.
    fetch("/data/accident_points_2425.geojson")
      .then((res) => res.json())
      .catch(() => null)
      .then((loaded) => {
        if (cancelled || !loaded) return;
        const fc = loaded as { features: AccidentPointFeature[] };

        const makeLayer = (key: AccidentLayer) =>
          L.geoJSON(fc as unknown as GeoJSON.GeoJsonObject, {
            filter: (feature) =>
              (feature as unknown as AccidentPointFeature).properties.sev === key,
            // 폴리곤이 아니라 점이므로 pointToLayer 로 표식을 직접 만든다 (accidentIcon).
            pointToLayer: (_feature, latlng) =>
              L.marker(latlng, { icon: accidentIcon(key), pane: `accident-${key}` }),
            onEachFeature: (feature, layer) => {
              const p = (feature as unknown as AccidentPointFeature).properties;
              const hurt = [
                p.dth ? `사망 ${p.dth}` : "",
                p.se ? `중상 ${p.se}` : "",
                p.sl ? `경상 ${p.sl}` : "",
              ]
                .filter(Boolean)
                .join(" · ");
              layer.bindTooltip(
                `<b>${p.ym} ${p.dn}</b><br/>${hurt}<br/>${p.type}<br/>` +
                  `<span style="opacity:.7">${p.road} · ${p.viol}</span>`,
                { sticky: true }
              );
            },
          }).addTo(map);

        // 쌓임 순서는 전용 pane 이 정한다 - 중상(610) 위에 사망(620).
        accidentLayersRef.current = { serious: makeLayer("serious"), fatal: makeLayer("fatal") };
        restackRef.current();

        applyAccidentFilterRef.current = () => {
          (Object.keys(accidentLayersRef.current) as AccidentLayer[]).forEach((key) => {
            const layerOn = visibleAccidentRef.current[key];
            const years = accidentYearsRef.current[key];
            accidentLayersRef.current[key]?.eachLayer((layer) => {
              const marker = layer as L.Marker & {
                feature: { properties: { year: string } };
              };
              const show = layerOn && years[marker.feature.properties.year] !== false;
              const el = marker.getElement();
              if (el) el.style.display = show ? "" : "none";
            });
          });
        };
        applyAccidentFilterRef.current();
      });

    return () => {
      cancelled = true;
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      busRouteLayersRef.current = [];
      busStopsLayerRef.current = null;
      candidateLayersRef.current = [];
      candidateStopsLayerRef.current = null;
      landmarksLayerRef.current = null;
      accidentLayersRef.current = {};
    };
    // 이 effect 는 지도를 만들고 정리(map.remove())까지 하므로 반드시 마운트 1회만 돌아야
    // 한다 - 다시 돌면 지도가 통째로 재생성되어 보고 있던 위치·줌이 초기화된다. 색상 함수
    // 셋은 ref 만 읽어 항상 최신 버전을 보므로 의존성에 넣을 이유도 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedBisRoute) {
      fittedBisRouteRef.current = null;
      return;
    }
    const route = selectedBisRoute;
    if (!map.getPane("bis-route-lines")) map.createPane("bis-route-lines").style.zIndex = "450";
    if (!map.getPane("bis-route-stops")) map.createPane("bis-route-stops").style.zIndex = "460";
    const group = L.featureGroup().addTo(map);
    const lines = route.segments.map((segment) => segment.map(([lon, lat]) => L.latLng(lat, lon)));
    L.polyline(lines, { pane: "bis-route-lines", color: "#111827", weight: 8, opacity: .7, interactive: false }).addTo(group);
    const colors = routeDemandColors(route, demandPeriod);
    const gradients: { node: SVGLinearGradientElement; a: L.LatLng; b: L.LatLng }[] = [];
    const svgNs = "http://www.w3.org/2000/svg";
    lines.forEach((segment, segmentIndex) => {
      for (let i = 1; i < segment.length; i++) {
        if (segment[i-1].equals(segment[i])) continue;
        const edge = L.polyline([segment[i-1], segment[i]], {
          pane: "bis-route-lines", color: colors[segmentIndex][i-1], weight: 5,
          opacity: 1, interactive: false,
        }).addTo(group);
        const path = edge.getElement() as SVGPathElement | undefined;
        const svg = path?.ownerSVGElement;
        if (!path || !svg) continue;
        const gradient = document.createElementNS(svgNs, "linearGradient");
        gradient.id = `bis-demand-${route.id}-${segmentIndex}-${i}`;
        gradient.setAttribute("gradientUnits", "userSpaceOnUse");
        [colors[segmentIndex][i-1], colors[segmentIndex][i]].forEach((color, n) => {
          const stop = document.createElementNS(svgNs, "stop");
          stop.setAttribute("offset", String(n));
          stop.setAttribute("stop-color", color);
          gradient.appendChild(stop);
        });
        svg.appendChild(gradient);
        path.setAttribute("stroke", `url(#${gradient.id})`);
        gradients.push({ node: gradient, a: segment[i-1], b: segment[i] });
      }
    });
    const updateGradients = () => gradients.forEach(({ node, a, b }) => {
      const start = map.latLngToLayerPoint(a), end = map.latLngToLayerPoint(b);
      node.setAttribute("x1", String(start.x)); node.setAttribute("y1", String(start.y));
      node.setAttribute("x2", String(end.x)); node.setAttribute("y2", String(end.y));
    });
    map.on("zoomend viewreset moveend", updateGradients);
    updateGradients();
    const tooltips: L.Tooltip[] = [];
    let pinnedTooltip: L.Tooltip | null = null;
    // 반복 경유는 같은 정류장 표식을 중복 생성하지 않고 순번을 함께 표시한다.
    const stops = new Map<string, { stop: typeof route.stops[number]; orders: string[] }>();
    route.stops.forEach((stop) => {
      const existing = stops.get(stop.id);
      if (existing) existing.orders.push(stop.order);
      else stops.set(stop.id, { stop, orders: [stop.order] });
    });
    stops.forEach(({ stop }) => {
      const marker = L.circleMarker([stop.coordinates[1], stop.coordinates[0]], {
        pane: "bis-route-stops", radius: 6, weight: 1.8, opacity: 1, fillOpacity: 1,
        color: "#ffffff", fillColor: "#475569",
      }).addTo(group);
      const label = stationTooltip(stop.stationTotals, route, stop);
      const tooltip = L.tooltip({ direction: "right", offset: [8, 0] })
        .setLatLng(marker.getLatLng()).setContent(label);
      tooltips.push(tooltip);
      marker.on("mouseover", () => tooltip.addTo(map));
      marker.on("mouseout", () => {
        if (pinnedTooltip !== tooltip) tooltip.remove();
      });
      marker.on("click", () => {
        if (pinnedTooltip === tooltip) {
          pinnedTooltip = null;
        } else {
          pinnedTooltip?.remove();
          pinnedTooltip = tooltip;
        }
        tooltip.addTo(map);
      });
    });
    const bounds = L.latLngBounds(lines.flat());
    if (fittedBisRouteRef.current !== route.id && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [35, 35], maxZoom: 15 });
      fittedBisRouteRef.current = route.id;
    }
    return () => {
      tooltips.forEach((tooltip) => tooltip.remove());
      map.off("zoomend viewreset moveend", updateGradients);
      gradients.forEach(({ node }) => node.remove());
      group.remove();
    };
  }, [selectedBisRoute, demandPeriod]);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}
