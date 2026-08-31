"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import GithubMarkdownButton from "./components/GithubMarkdownButton";
import MapLegend, {
  ACCIDENT_LAYERS,
  ACCIDENT_YEARS,
  BUS_ROUTES,
  GRADES,
  NO_DATA_KEY,
  type AccidentLayer,
  type BusRoute,
  type GradeFilterKey,
} from "./components/MapLegend";
import PointDetailPanel from "./components/PointDetailPanel";
import SearchBox from "./components/SearchBox";
import ThemeToggle from "./components/ThemeToggle";
import type { PointFeature, SelectedPoint } from "./types";
import { DEFAULT_DSI_VERSION } from "./versions";

const MapView = dynamic(() => import("./components/MapView"), { ssr: false });

const ALL_GRADE_KEYS: GradeFilterKey[] = [...GRADES, NO_DATA_KEY];

function toSelectedPoint(feature: PointFeature): SelectedPoint {
  const [lon, lat] = feature.geometry.coordinates;
  return {
    pointId: feature.properties.point_id,
    panoId: feature.properties.pano_id,
    lat,
    lon,
  };
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<SelectedPoint | null>(null);
  const [points, setPoints] = useState<PointFeature[] | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<SelectedPoint | null>(null);
  const [highlightPointIds, setHighlightPointIds] = useState<string[]>([]);
  const appliedInitialPoint = useRef(false);
  const [visibleGrades, setVisibleGrades] = useState<Record<GradeFilterKey, boolean>>(
    Object.fromEntries(ALL_GRADE_KEYS.map((k) => [k, true])) as Record<GradeFilterKey, boolean>
  );
  const [visibleRoutes, setVisibleRoutes] = useState<Record<BusRoute, boolean>>(
    Object.fromEntries(BUS_ROUTES.map((k) => [k, false])) as Record<BusRoute, boolean>
  );
  // 사고 이력은 DSI 와 별개의 대조 자료이므로 버스 노선과 마찬가지로 기본 꺼짐 —
  // 처음 들어온 사람이 보는 것은 여전히 DSI 지도 그대로다.
  const [visibleAccident, setVisibleAccident] = useState<Record<AccidentLayer, boolean>>(
    Object.fromEntries(ACCIDENT_LAYERS.map((k) => [k, false])) as Record<AccidentLayer, boolean>
  );
  // 연도는 처음에 전부 켠다 - 여러 해가 겹쳐 진해지는 곳이 곧 반복 선정 지점이라,
  // 기본 화면에서 그게 먼저 보이는 편이 낫다.
  const [accidentYears, setAccidentYears] = useState<
    Record<AccidentLayer, Record<string, boolean>>
  >(
    Object.fromEntries(
      ACCIDENT_LAYERS.map((k) => [k, Object.fromEntries(ACCIDENT_YEARS[k].map((y) => [y, true]))])
    ) as Record<AccidentLayer, Record<string, boolean>>
  );
  // 03 실행 버전. 지도 색상·평균 DSI·패널의 DSI 값과 BEV 이미지가 모두 이 값을 따른다.
  const [dsiVersion, setDsiVersion] = useState<string>(DEFAULT_DSI_VERSION);

  const toggleGrade = (key: GradeFilterKey) => {
    setVisibleGrades((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const setAllGrades = (on: boolean) => {
    setVisibleGrades(
      Object.fromEntries(ALL_GRADE_KEYS.map((k) => [k, on])) as Record<GradeFilterKey, boolean>
    );
  };
  const toggleRoute = (key: BusRoute) => {
    setVisibleRoutes((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleAccident = (key: AccidentLayer) => {
    setVisibleAccident((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleAccidentYear = (key: AccidentLayer, year: string) => {
    setAccidentYears((prev) => ({
      ...prev,
      [key]: { ...prev[key], [year]: !prev[key][year] },
    }));
  };
  const setAllAccidentYears = (key: AccidentLayer, on: boolean) => {
    setAccidentYears((prev) => ({
      ...prev,
      [key]: Object.fromEntries(ACCIDENT_YEARS[key].map((y) => [y, on])),
    }));
  };

  useEffect(() => {
    fetch("/data/points.geojson")
      .then((res) => res.json())
      .then((data: { features: PointFeature[] }) => setPoints(data.features))
      .catch(() => setPoints([]));
  }, []);

  // ?point={pointId} 딥링크: 최초 로드 시 해당 지점을 자동 선택 + 지도 이동.
  useEffect(() => {
    if (!points || appliedInitialPoint.current) return;
    appliedInitialPoint.current = true;
    const pointId = searchParams.get("point");
    if (!pointId) return;
    const feature = points.find((p) => p.properties.point_id === pointId);
    if (!feature) return;
    const sp = toSelectedPoint(feature);
    setSelected(sp);
    setFlyToTarget(sp);
  }, [points, searchParams]);

  const selectPoint = useCallback(
    (point: SelectedPoint) => {
      setSelected(point);
      const params = new URLSearchParams(searchParams.toString());
      params.set("point", point.pointId);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const closePanel = useCallback(() => {
    setSelected(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("point");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }, [router, searchParams]);

  const goToPoint = useCallback(
    (point: SelectedPoint) => {
      selectPoint(point);
      setFlyToTarget(point);
    },
    [selectPoint]
  );

  return (
    <main className="app-main">
      <MapView
        onSelect={selectPoint}
        visibleGrades={visibleGrades}
        visibleRoutes={visibleRoutes}
        visibleAccident={visibleAccident}
        accidentYears={accidentYears}
        version={dsiVersion}
        flyToTarget={flyToTarget}
        highlightPointIds={highlightPointIds}
      />
      {selected && (
        <PointDetailPanel point={selected} version={dsiVersion} onClose={closePanel} />
      )}
      <MapLegend
        visibleGrades={visibleGrades}
        onToggleGrade={toggleGrade}
        onSetAllGrades={setAllGrades}
        visibleRoutes={visibleRoutes}
        onToggleRoute={toggleRoute}
        visibleAccident={visibleAccident}
        onToggleAccident={toggleAccident}
        accidentYears={accidentYears}
        onToggleAccidentYear={toggleAccidentYear}
        onSetAllAccidentYears={setAllAccidentYears}
        version={dsiVersion}
        onChangeVersion={setDsiVersion}
        style={{ left: 60, right: 84, top: 12, justifyContent: "center" }}
      />
      <SearchBox
        points={points}
        onSelectPoint={goToPoint}
        onHighlight={setHighlightPointIds}
        style={{ left: 60, top: 70 }}
      />
      <ThemeToggle style={{ right: 24, top: 24 }} />
      <GithubMarkdownButton
        filenames={["README.md", "readme.md"]}
        title="GitHub"
        icon="github"
        style={{ right: 88, bottom: 24 }}
      />
      <GithubMarkdownButton
        filenames={["method.md", "Method.md"]}
        title="Method"
        icon="doc"
        style={{ right: 24, bottom: 24 }}
        driveFileId="1XXhLcUI0WI3sdbK1w-CqfxTMpvYRtESt"
      />
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}
