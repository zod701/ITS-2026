"use client";

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
  GRADE_COLORS,
  NO_DATA_COLOR,
  NO_DATA_KEY,
  type AccidentLayer,
  type BusRoute,
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
  onSelect: (point: SelectedPoint) => void;
  visibleGrades: Record<GradeFilterKey, boolean>;
  visibleRoutes: Record<BusRoute, boolean>;
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
  onSelect,
  visibleGrades,
  visibleRoutes,
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
  // 사고 이력 오버레이는 DSI 도로·버스 노선보다 위에 그린다 - 아래에 두면 촘촘한 도로선이
  // 면을 잘게 끊어 놔 어디까지가 한 구역인지 읽히지 않는다. 대신 면 안쪽은 globals.css 의
  // pointer-events:stroke 로 클릭을 통과시켜, 그 아래 도로의 패널 열기를 가리지 않는다.
  // 세 레이어(도로·버스노선·사고이력)가 각자 비동기로 도착하므로, 어느 것이 추가되든
  // 끝에 raiseAccidentRef 를 불러 순서를 다시 세운다.
  const accidentLayersRef = useRef<Partial<Record<AccidentLayer, L.GeoJSON>>>({});
  const raiseAccidentRef = useRef<() => void>(() => {});
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
        // 도로가 버스 노선보다 나중에 추가돼 위로 올라갈 수 있으니, 이미 그려진 버스
        // 노선이 있으면 다시 맨 앞으로 가져온다.
        busRouteLayersRef.current.forEach((layer) => layer.bringToFront());
        // 사고 이력은 그보다도 위.
        raiseAccidentRef.current();

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
        casingLayer.bringToFront();
        busRoutesLayer.bringToFront();
        raiseAccidentRef.current();

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
            // 폴리곤이 아니라 점이므로 pointToLayer 로 원을 직접 만든다. 두 겹의 크기는
            // 같게 두고 색과 진하기로만 구분한다 - 중상 196건도 사망 20건과 똑같이
            // 눈에 들어와야 분포를 읽을 수 있다.
            pointToLayer: (_feature, latlng) =>
              L.circleMarker(latlng, {
                radius: 6.5,
                color: "#ffffff",
                weight: 1.2,
                opacity: 0.9,
                fillColor: ACCIDENT_COLORS[key],
                fillOpacity: key === "fatal" ? 0.95 : 0.7,
              }),
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

        accidentLayersRef.current = { serious: makeLayer("serious"), fatal: makeLayer("fatal") };
        // 앞으로 올리는 순서가 곧 쌓임 순서다 - 나중에 부른 쪽이 더 위로 온다.
        // 결과: DSI 도로 → 버스 노선 → 중상 → 맨 위 사망.
        raiseAccidentRef.current = () => {
          accidentLayersRef.current.serious?.bringToFront();
          accidentLayersRef.current.fatal?.bringToFront();
        };
        raiseAccidentRef.current();

        applyAccidentFilterRef.current = () => {
          (Object.keys(accidentLayersRef.current) as AccidentLayer[]).forEach((key) => {
            const layerOn = visibleAccidentRef.current[key];
            const years = accidentYearsRef.current[key];
            accidentLayersRef.current[key]?.eachLayer((layer) => {
              const feature = (layer as L.Path & {
                feature: { properties: { year: string } };
              }).feature;
              const show = layerOn && years[feature.properties.year] !== false;
              const el = (layer as L.Path).getElement();
              if (el) (el as HTMLElement).style.display = show ? "" : "none";
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
      accidentLayersRef.current = {};
    };
    // 이 effect 는 지도를 만들고 정리(map.remove())까지 하므로 반드시 마운트 1회만 돌아야
    // 한다 - 다시 돌면 지도가 통째로 재생성되어 보고 있던 위치·줌이 초기화된다. 색상 함수
    // 셋은 ref 만 읽어 항상 최신 버전을 보므로 의존성에 넣을 이유도 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}
