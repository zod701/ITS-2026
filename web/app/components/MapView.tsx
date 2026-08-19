"use client";

import { useCallback, useEffect, useRef } from "react";
import L from "leaflet";
import type { PointFeature, SelectedPoint } from "../types";
import { gradeFromDsi, versionById } from "../versions";
import {
  BUS_ROUTE_COLORS,
  GRADE_COLORS,
  NO_DATA_COLOR,
  NO_DATA_KEY,
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

interface Props {
  onSelect: (point: SelectedPoint) => void;
  visibleGrades: Record<GradeFilterKey, boolean>;
  visibleRoutes: Record<BusRoute, boolean>;
  /** 도로 색상에 쓸 03 실행 버전 (versions.ts). 바뀌면 선 색을 다시 칠한다. */
  version: string;
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
const LIGHT_TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const DARK_TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
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
  version,
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
  // 도로(DSI)와 버스 노선은 각자 독립적인 fetch로 비동기 추가되므로, 어느 쪽이 먼저
  // 도착하느냐에 따라 SVG z-order(추가 순서)가 매번 달라질 수 있다. 버스 노선 레이어를
  // 항상 여기 저장해두고, 도로 레이어가 (나중에) 추가된 직후 다시 앞으로 가져와 항상
  // 버스 노선이 DSI 선 위에 보이도록 강제한다.
  const busRouteLayersRef = useRef<L.GeoJSON[]>([]);

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
        roadTercilesRef.current = versionById(version).roadTerciles;
        restyle();
      });

    return () => {
      cancelled = true;
    };
  }, [version, colorFor]);

  useEffect(() => {
    visibleGradesRef.current = visibleGrades;
    applyFilterRef.current();
  }, [visibleGrades]);

  useEffect(() => {
    visibleRoutesRef.current = visibleRoutes;
    applyRouteFilterRef.current();
  }, [visibleRoutes]);

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

    return () => {
      cancelled = true;
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      busRouteLayersRef.current = [];
    };
    // 이 effect 는 지도를 만들고 정리(map.remove())까지 하므로 반드시 마운트 1회만 돌아야
    // 한다 - 다시 돌면 지도가 통째로 재생성되어 보고 있던 위치·줌이 초기화된다. 색상 함수
    // 셋은 ref 만 읽어 항상 최신 버전을 보므로 의존성에 넣을 이유도 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}
