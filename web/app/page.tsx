"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import GithubMarkdownButton from "./components/GithubMarkdownButton";
import MapLegend, {
  ACCIDENT_LAYERS,
  ACCIDENT_YEARS,
  BUS_ROUTES,
  ROUTE_CANDIDATES,
  GRADES,
  NO_DATA_KEY,
  type AccidentLayer,
  type BusRoute,
  type RouteCandidate,
  type GradeFilterKey,
} from "./components/MapLegend";
import AccidentButton from "./components/AccidentButton";
import PoiButton from "./components/PoiButton";
import BusRouteButton from "./components/BusRouteButton";
import type { BisRoute, DemandPeriod } from "./bisRoutes";
import PointDetailPanel from "./components/PointDetailPanel";
import SearchBox from "./components/SearchBox";
import ThemeToggle from "./components/ThemeToggle";
import type { PointFeature, SelectedPoint } from "./types";
import { DEFAULT_ALPHA, DEFAULT_DSI_VERSION, versionById } from "./versions";

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
  // 등급 셋은 기본 켜짐이지만 '데이터 없음'은 꺼 둔다 - 계측된 지점이 없어 색을 매길 수
  // 없는 구간이라, 켜 두면 등급이 매겨진 도로와 같은 굵기로 깔려 위험도 분포를 가린다.
  const [visibleGrades, setVisibleGrades] = useState<Record<GradeFilterKey, boolean>>(
    Object.fromEntries(
      ALL_GRADE_KEYS.map((k) => [k, k !== NO_DATA_KEY])
    ) as Record<GradeFilterKey, boolean>
  );
  const [visibleRoutes, setVisibleRoutes] = useState<Record<BusRoute, boolean>>(
    Object.fromEntries(BUS_ROUTES.map((k) => [k, false])) as Record<BusRoute, boolean>
  );
  // 정류장도 노선·사고와 같은 대조 자료라 기본 꺼짐 - 첫 화면은 DSI 지도 그대로 둔다.
  const [showStops, setShowStops] = useState(false);
  const [bisRoutes, setBisRoutes] = useState<BisRoute[]>([]);
  const [bisError, setBisError] = useState(false);
  const [selectedBisRouteId, setSelectedBisRouteId] = useState("");
  const [demandPeriod, setDemandPeriod] = useState<DemandPeriod>("annual");
  useEffect(() => {
    let cancelled = false;
    fetch("/data/bis_routes.json")
      .then((res) => {
        if (!res.ok) throw new Error("BIS routes unavailable");
        return res.json();
      })
      .then((routes: BisRoute[]) => {
        if (!cancelled) setBisRoutes(routes.sort((a, b) =>
          a.name.localeCompare(b.name, "ko", { numeric: true }) || a.company.localeCompare(b.company, "ko")
        ));
      })
      .catch(() => { if (!cancelled) setBisError(true); });
    return () => { cancelled = true; };
  }, []);
  // 제안 노선도 다른 오버레이와 마찬가지로 기본 꺼짐 - 첫 화면은 DSI 지도 그대로 둔다.
  const [visibleCandidates, setVisibleCandidates] = useState<Record<RouteCandidate, boolean>>(
    Object.fromEntries(ROUTE_CANDIDATES.map((r) => [r, false])) as Record<RouteCandidate, boolean>
  );
  // 거점(강릉역·전수교육관)은 기준점이라 기본 켜짐. 이름을 landmarks.geojson 에서 읽어
  // 오므로 초기값을 미리 알 수 없어, **끈 것만** 담고 빈 객체를 '전부 보임'으로 읽는다.
  const [hiddenLandmarks, setHiddenLandmarks] = useState<Record<string, boolean>>({});
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
  // α(정적:동적 비중)는 사고 자료로 유도되지 않는 설계 파라미터라(TAAS/method.md D-21)
  // 사용자가 직접 움직인다. 버전을 바꾸면 그 판의 기본값으로 되돌린다.
  const [alpha, setAlpha] = useState(
    versionById(DEFAULT_DSI_VERSION).alphaDefault ?? DEFAULT_ALPHA
  );
  const changeVersion = (v: string) => {
    setDsiVersion(v);
    setAlpha(versionById(v).alphaDefault ?? DEFAULT_ALPHA);
  };

  const toggleGrade = (key: GradeFilterKey) => {
    setVisibleGrades((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const setAllGrades = (on: boolean) => {
    setVisibleGrades(
      Object.fromEntries(ALL_GRADE_KEYS.map((k) => [k, on])) as Record<GradeFilterKey, boolean>
    );
  };
  const toggleRoute = (key: BusRoute) => {
    if (!visibleRoutes[key]) setAllGrades(false);
    setVisibleRoutes((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const selectBisRoute = (id: string) => {
    if (id && id !== selectedBisRouteId) setAllGrades(false);
    setSelectedBisRouteId(id);
  };
  const toggleStops = () => {
    setShowStops((prev) => !prev);
  };
  const toggleCandidate = (rank: RouteCandidate) => {
    if (!visibleCandidates[rank]) setAllGrades(false);
    setVisibleCandidates((prev) => ({ ...prev, [rank]: !prev[rank] }));
  };
  const toggleLandmark = (name: string) => {
    setHiddenLandmarks((prev) => ({ ...prev, [name]: !prev[name] }));
  };
  const setAllLandmarks = (names: string[], on: boolean) => {
    setHiddenLandmarks(Object.fromEntries(names.map((n) => [n, !on])));
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
        demandPeriod={demandPeriod}
        selectedBisRoute={bisRoutes.find((r) => r.id === selectedBisRouteId) ?? null}
        onSelect={selectPoint}
        visibleGrades={visibleGrades}
        visibleRoutes={visibleRoutes}
        showStops={showStops}
        visibleCandidates={visibleCandidates}
        hiddenLandmarks={hiddenLandmarks}
        visibleAccident={visibleAccident}
        accidentYears={accidentYears}
        version={dsiVersion}
        alpha={alpha}
        flyToTarget={flyToTarget}
        highlightPointIds={highlightPointIds}
      />
      {selected && (
        <PointDetailPanel
            point={selected}
            version={dsiVersion}
            alpha={alpha}
            onClose={closePanel}
          />
      )}
      <MapLegend
        visibleGrades={visibleGrades}
        onToggleGrade={toggleGrade}
        onSetAllGrades={setAllGrades}
        version={dsiVersion}
        alpha={alpha}
        onChangeVersion={changeVersion}
        onAlphaChange={setAlpha}
        style={{ left: 60, right: 84, top: 12, justifyContent: "center" }}
      >
        {/* 버스 노선·사고 이력은 버전과 무관한 고정 오버레이라 범례 항목으로 늘어놓지
            않고 버튼으로 접어 둔다. 범례가 버전마다 길어져 두 줄로 접히던 문제를 없앤다. */}
        <PoiButton
          hiddenLandmarks={hiddenLandmarks}
          onToggleLandmark={toggleLandmark}
          onSetAllLandmarks={setAllLandmarks}
        />
        <BusRouteButton
          demandPeriod={demandPeriod}
          onDemandPeriodChange={setDemandPeriod}
          bisRoutes={bisRoutes}
          bisError={bisError}
          selectedBisRouteId={selectedBisRouteId}
          onSelectBisRoute={selectBisRoute}
          visibleRoutes={visibleRoutes}
          onToggleRoute={toggleRoute}
          showStops={showStops}
          onToggleStops={toggleStops}
          visibleCandidates={visibleCandidates}
          onToggleCandidate={toggleCandidate}
          version={dsiVersion}
          alpha={alpha}
        />
        <AccidentButton
          visibleAccident={visibleAccident}
          onToggleAccident={toggleAccident}
          accidentYears={accidentYears}
          onToggleAccidentYear={toggleAccidentYear}
          onSetAllAccidentYears={setAllAccidentYears}
        />
      </MapLegend>
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
        driveDocs={[
          { id: "1XXhLcUI0WI3sdbK1w-CqfxTMpvYRtESt", label: "유스 펠로우쉽" },
          { id: "1TbMFgtUvTv1hUUzsIlG_hz54yq_lzTSx", label: "아이디어 공모전" },
        ]}
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
