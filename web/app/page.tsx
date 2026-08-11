"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import GithubMarkdownButton from "./components/GithubMarkdownButton";
import MapLegend, {
  BUS_ROUTES,
  GRADES,
  NO_DATA_KEY,
  type BusRoute,
  type GradeFilterKey,
} from "./components/MapLegend";
import PointDetailPanel from "./components/PointDetailPanel";
import SearchBox from "./components/SearchBox";
import ThemeToggle from "./components/ThemeToggle";
import type { PointFeature, SelectedPoint } from "./types";

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

  const toggleGrade = (key: GradeFilterKey) => {
    setVisibleGrades((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleRoute = (key: BusRoute) => {
    setVisibleRoutes((prev) => ({ ...prev, [key]: !prev[key] }));
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
        flyToTarget={flyToTarget}
        highlightPointIds={highlightPointIds}
      />
      {selected && <PointDetailPanel point={selected} onClose={closePanel} />}
      <MapLegend
        visibleGrades={visibleGrades}
        onToggleGrade={toggleGrade}
        visibleRoutes={visibleRoutes}
        onToggleRoute={toggleRoute}
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
