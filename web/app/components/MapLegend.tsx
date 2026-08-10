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
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/data/bus_route_dsi.json")
      .then((res) => res.json())
      .then(setRouteDsi)
      .catch(() => setRouteDsi({}));
  }, []);

  // 모바일에서는 범례가 지도를 크게 가리므로 기본 접힘. 서버 렌더와 동일한 펼침 상태로
  // 첫 렌더한 뒤 마운트 후에 접어서 하이드레이션 불일치를 피한다. (데스크탑은 항상 펼침이며
  // 접기 버튼 자체가 CSS로 숨겨져 있어 이 상태값의 영향을 받지 않는다.)
  useEffect(() => {
    if (window.matchMedia("(max-width: 768px)").matches) setCollapsed(true);
  }, []);

  return (
    <div className={`map-legend ${collapsed ? "map-legend-collapsed" : ""}`} style={style}>
      <button
        className="legend-toggle"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        범례 <span aria-hidden="true">{collapsed ? "▾" : "▴"}</span>
      </button>
      {/* display:contents(데스크탑)로 감싸 레이아웃에 영향을 주지 않으면서,
          모바일에서만 이 래퍼를 접기 대상으로 쓴다. */}
      <div className="legend-content">
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
        /* 데스크탑: 접기 버튼은 없고, 래퍼는 레이아웃에서 투명(display:contents)해서
           자식들이 그대로 .map-legend의 flex 아이템이 된다 -> 기존과 동일한 배치. */
        .legend-toggle {
          display: none;
        }
        .legend-content {
          display: contents;
        }

        /* 모바일: 가로 한 줄로는 폭이 부족하므로 세로로 쌓고, 기본 접힘 상태로 지도를
           가리지 않게 한다. 위치(left/right/top)는 page.tsx의 인라인 스타일로 지정돼
           있어 여기서 덮어쓰려면 !important가 필요하다(데스크탑에는 적용되지 않음). */
        @media (max-width: 768px) {
          .map-legend {
            left: 8px !important;
            right: 8px !important;
            top: 52px !important;
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
            padding: 8px 10px;
            font-size: 12px;
          }
          /* 접힌 상태에서는 작은 알약 모양으로 줄여 지도를 최대한 열어준다. */
          .map-legend-collapsed {
            right: auto !important;
          }
          .legend-toggle {
            display: flex;
            align-items: center;
            gap: 6px;
            border: none;
            background: none;
            color: var(--text-muted);
            font-size: 12px;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            padding: 0;
          }
          .legend-content {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .map-legend-collapsed .legend-content {
            display: none;
          }
          .legend-divider {
            width: auto;
            height: 1px;
          }
          .legend-section {
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
          }
          .legend-row {
            gap: 6px 14px;
          }
        }
      `}</style>
    </div>
  );
}
