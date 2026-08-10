"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import type { PointFeature, SelectedPoint } from "../types";
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

const LIGHT_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const DARK_TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const LIGHT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const DARK_ATTRIBUTION =
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

function gradeKeyFor(roadDsi: RoadDsiMap, edgeId: string): GradeFilterKey {
  return roadDsi[edgeId]?.grade ?? NO_DATA_KEY;
}

export default function MapView({
  onSelect,
  visibleGrades,
  visibleRoutes,
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
  // 도로(DSI)와 버스 노선은 각자 독립적인 fetch로 비동기 추가되므로, 어느 쪽이 먼저
  // 도착하느냐에 따라 SVG z-order(추가 순서)가 매번 달라질 수 있다. 버스 노선 레이어를
  // 항상 여기 저장해두고, 도로 레이어가 (나중에) 추가된 직후 다시 앞으로 가져와 항상
  // 버스 노선이 DSI 선 위에 보이도록 강제한다.
  const busRouteLayersRef = useRef<L.GeoJSON[]>([]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

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
      attribution: currentDark ? DARK_ATTRIBUTION : LIGHT_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    const observer = new MutationObserver(() => {
      const dark = isDarkTheme();
      if (dark === currentDark) return;
      currentDark = dark;
      map.removeLayer(tileLayer);
      tileLayer = L.tileLayer(dark ? DARK_TILE_URL : LIGHT_TILE_URL, {
        attribution: dark ? DARK_ATTRIBUTION : LIGHT_ATTRIBUTION,
        maxZoom: 19,
      }).addTo(map);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let points: PointFeature[] = [];
    let roadDsi: RoadDsiMap = {};

    fetch("/data/points.geojson")
      .then((res) => res.json())
      .then((data: PointsGeoJson) => {
        if (cancelled) return;
        points = data.features;
        pointsRef.current = data.features;
      });

    const colorFor = (edgeId: string) => {
      const rec = roadDsi[edgeId];
      return rec ? GRADE_COLORS[rec.grade] : NO_DATA_COLOR;
    };
    const hoverColorFor = (edgeId: string) => {
      const rec = roadDsi[edgeId];
      return rec ? GRADE_COLORS_HOVER[rec.grade] : NO_DATA_COLOR_HOVER;
    };

    Promise.all([
      fetch("/data/roads.geojson").then((res) => res.json()),
      fetch("/data/road_dsi_map.json")
        .then((res) => res.json())
        .catch(() => ({})),
    ]).then(([data, dsiData]: [RoadsGeoJson, RoadDsiMap]) => {
      if (cancelled) return;
      roadDsi = dsiData;
      const roadsLayer = L.geoJSON(data as GeoJSON.GeoJsonObject, {
        style: (feature) => ({
          color: colorFor((feature as unknown as RoadFeature).properties.edge_id),
          weight: 4,
          opacity: 0.85,
        }),
        onEachFeature: (feature, layer) => {
          const edgeId = (feature as unknown as RoadFeature).properties.edge_id;
          layer.on("mouseover", () => {
            if (!visibleGradesRef.current[gradeKeyFor(roadDsi, edgeId)]) return;
            (layer as L.Path).setStyle({ color: hoverColorFor(edgeId), weight: 6 });
          });
          layer.on("mouseout", () => {
            if (!visibleGradesRef.current[gradeKeyFor(roadDsi, edgeId)]) return;
            (layer as L.Path).setStyle({ color: colorFor(edgeId), weight: 4 });
          });
          layer.on("click", (e: L.LeafletMouseEvent) => {
            if (!visibleGradesRef.current[gradeKeyFor(roadDsi, edgeId)]) return;
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
      // 도로가 버스 노선보다 나중에 추가돼 위로 올라갈 수 있으니, 이미 그려진 버스
      // 노선이 있으면 다시 맨 앞으로 가져온다.
      busRouteLayersRef.current.forEach((layer) => layer.bringToFront());

      // grade 체크박스(범례)로 토글될 때 해당 등급 도로만 지도에 남기고 나머지는 제거.
      applyFilterRef.current = () => {
        roadsLayer.eachLayer((layer) => {
          const feature = (layer as L.Path & { feature: RoadFeature }).feature;
          const edgeId = feature.properties.edge_id;
          const show = visibleGradesRef.current[gradeKeyFor(roadDsi, edgeId)];
          const el = (layer as L.Path).getElement();
          if (el) (el as HTMLElement).style.display = show ? "" : "none";
        });
      };
      applyFilterRef.current();
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
  }, []);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}
