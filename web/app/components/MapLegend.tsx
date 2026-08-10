"use client";

import { useEffect, useState } from "react";

export type Grade = "Safe" | "Caution" | "High-risk";
export const GRADES: Grade[] = ["Safe", "Caution", "High-risk"];
export const NO_DATA_KEY = "no-data";
export type GradeFilterKey = Grade | typeof NO_DATA_KEY;

export const GRADE_COLORS: Record<Grade, string> = {
  Safe: "#22c55e",
  Caution: "#eab308",
  "High-risk": "#ef4444",
};
export const NO_DATA_COLOR = "#ffffff";

const GRADE_LABELS: Record<GradeFilterKey, string> = {
  Safe: "Safe",
  Caution: "Caution",
  "High-risk": "High-risk",
  [NO_DATA_KEY]: "데이터 없음",
};

export type BusRoute = "A" | "B" | "C";
export const BUS_ROUTES: BusRoute[] = ["A", "B", "C"];
export const BUS_ROUTE_COLORS: Record<BusRoute, string> = {
  A: "#8b5cf6",
  B: "#06b6d4",
  C: "#2563eb",
};

const BUS_ROUTE_LABELS: Record<BusRoute, string> = {
  A: "A 노선",
  B: "B 노선",
  C: "C 노선",
};

interface BusRouteDsiRecord {
  dsi: number;
  n: number;
}

type BusRouteDsiMap = Partial<Record<BusRoute | "overall", BusRouteDsiRecord>>;

interface Props {
  visibleGrades: Record<GradeFilterKey, boolean>;
  onToggleGrade: (key: GradeFilterKey) => void;
  visibleRoutes: Record<BusRoute, boolean>;
  onToggleRoute: (key: BusRoute) => void;
  style?: React.CSSProperties;
}

export default function MapLegend({
  visibleGrades,
  onToggleGrade,
  visibleRoutes,
  onToggleRoute,
  style,
}: Props) {
  const gradeKeys: GradeFilterKey[] = [...GRADES, NO_DATA_KEY];
  const [routeDsi, setRouteDsi] = useState<BusRouteDsiMap>({});

  useEffect(() => {
    fetch("/data/bus_route_dsi.json")
      .then((res) => res.json())
      .then(setRouteDsi)
      .catch(() => setRouteDsi({}));
  }, []);

  return (
    <div className="map-legend" style={style}>
      <div className="legend-section">
        <div className="legend-heading">도로 위험도 (DSI)</div>
        <div className="legend-row">
          {gradeKeys.map((key) => (
            <button
              key={key}
              className={`legend-item ${visibleGrades[key] ? "" : "legend-item-off"}`}
              onClick={() => onToggleGrade(key)}
              aria-pressed={visibleGrades[key]}
            >
              <span
                className="legend-swatch"
                style={{ background: key === NO_DATA_KEY ? NO_DATA_COLOR : GRADE_COLORS[key] }}
              />
              {GRADE_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="legend-divider" />

      <div className="legend-section">
        <div className="legend-heading">버스 노선</div>
        <div className="legend-row">
          {BUS_ROUTES.map((route) => (
            <button
              key={route}
              className={`legend-item ${visibleRoutes[route] ? "" : "legend-item-off"}`}
              onClick={() => onToggleRoute(route)}
              aria-pressed={visibleRoutes[route]}
            >
              <span
                className="legend-swatch legend-swatch-line"
                style={{ background: BUS_ROUTE_COLORS[route] }}
              />
              {BUS_ROUTE_LABELS[route]}
              {routeDsi[route] && (
                <span className="legend-dsi">평균 DSI {routeDsi[route]!.dsi.toFixed(2)}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="legend-divider" />

      <div className="legend-section">
        <div className="legend-summary">
          전체 포인트 평균 DSI{" "}
          {routeDsi.overall ? routeDsi.overall.dsi.toFixed(2) : "불러오는 중…"}
        </div>
      </div>

      <style jsx>{`
        .map-legend {
          position: absolute;
          z-index: 1000;
          background: var(--panel-bg);
          color: var(--foreground);
          border-radius: 8px;
          padding: 10px 16px;
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 16px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          font-size: 13px;
          flex-wrap: wrap;
        }
        .legend-section {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 10px;
        }
        .legend-heading {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: var(--text-muted);
          text-transform: uppercase;
          white-space: nowrap;
        }
        .legend-divider {
          width: 1px;
          align-self: stretch;
          background: var(--border-color);
        }
        .legend-row {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
          border: none;
          background: none;
          color: inherit;
          font-size: inherit;
          font-family: inherit;
          cursor: pointer;
          padding: 2px 0;
          white-space: nowrap;
          opacity: 1;
        }
        .legend-item-off {
          opacity: 0.4;
        }
        .legend-dsi {
          padding-left: 4px;
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .legend-summary {
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .legend-swatch {
          width: 14px;
          height: 14px;
          border-radius: 3px;
          flex-shrink: 0;
        }
        .legend-swatch-line {
          width: 22px;
          height: 5px;
          border-radius: 2px;
          box-shadow: 0 0 0 1.5px #111827;
        }
      `}</style>
    </div>
  );
}
