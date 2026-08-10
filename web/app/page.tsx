"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import GithubMarkdownButton from "./components/GithubMarkdownButton";
import MapLegend, {
  BUS_ROUTES,
  GRADES,
  NO_DATA_KEY,
  type BusRoute,
  type GradeFilterKey,
} from "./components/MapLegend";
import PointDetailPanel from "./components/PointDetailPanel";
import ThemeToggle from "./components/ThemeToggle";
import type { SelectedPoint } from "./types";

const MapView = dynamic(() => import("./components/MapView"), { ssr: false });

const ALL_GRADE_KEYS: GradeFilterKey[] = [...GRADES, NO_DATA_KEY];

export default function Home() {
  const [selected, setSelected] = useState<SelectedPoint | null>(null);
  const [visibleGrades, setVisibleGrades] = useState<Record<GradeFilterKey, boolean>>(
    Object.fromEntries(ALL_GRADE_KEYS.map((k) => [k, true])) as Record<GradeFilterKey, boolean>
  );
  const [visibleRoutes, setVisibleRoutes] = useState<Record<BusRoute, boolean>>(
    Object.fromEntries(BUS_ROUTES.map((k) => [k, true])) as Record<BusRoute, boolean>
  );

  const toggleGrade = (key: GradeFilterKey) => {
    setVisibleGrades((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleRoute = (key: BusRoute) => {
    setVisibleRoutes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <main style={{ position: "relative", height: "100vh", width: "100vw" }}>
      <MapView onSelect={setSelected} visibleGrades={visibleGrades} visibleRoutes={visibleRoutes} />
      {selected && (
        <PointDetailPanel point={selected} onClose={() => setSelected(null)} />
      )}
      <MapLegend
        visibleGrades={visibleGrades}
        onToggleGrade={toggleGrade}
        visibleRoutes={visibleRoutes}
        onToggleRoute={toggleRoute}
        style={{ left: 60, right: 84, top: 12, justifyContent: "center" }}
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
      />
    </main>
  );
}
