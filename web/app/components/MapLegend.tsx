"use client";

import { useEffect, useRef, useState } from "react";
import { DSI_VERSIONS } from "../versions";

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

// 도로교통공단 TAAS 공개 CSV 의 사고 이력 오버레이. DSI 는 사고가 난 적 없는 구간도 사전
// 진단하는 지표라 이 둘은 정답지가 아니라 대조군이다.
export type AccidentLayer = "riskArea" | "hotspot";
export const ACCIDENT_LAYERS: AccidentLayer[] = ["riskArea", "hotspot"];

// DSI 등급(초록·노랑·빨강)과 버스 노선(보라·청록·파랑) 어디와도 겹치지 않는 색으로 골랐다.
// 두 오버레이는 색뿐 아니라 형태로도 갈린다 - 위험지역은 채운 면, 다발지역은 테두리 원.
export const ACCIDENT_COLORS: Record<AccidentLayer, string> = {
  riskArea: "#92400e",
  hotspot: "#a21caf",
};

const ACCIDENT_LABELS: Record<AccidentLayer, string> = {
  riskArea: "위험지역",
  hotspot: "다발지역",
};

// 두 자료의 제공 연도가 다르다 (위험지역 2017~, 다발지역 2018~). public/data 의
// accident_*.geojson 이 갱신되면 여기도 같이 늘려야 한다.
export const ACCIDENT_YEARS: Record<AccidentLayer, string[]> = {
  riskArea: ["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"],
  hotspot: ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"],
};

const ACCIDENT_TITLES: Record<AccidentLayer, string> = {
  riskArea:
    "링크기반 교통사고 위험지역 (2017~2025, 64건). 시 전역의 사고 밀집구역을 전수로 담는다.",
  hotspot:
    "지자체별 교통사고 다발지역 (2018~2025, 24건). 해마다 시군구별 상위 3곳만 추린다.",
};

interface BusRouteDsiRecord {
  dsi: number;
  n: number;
}

type BusRouteDsiMap = Partial<Record<BusRoute | "overall", BusRouteDsiRecord>>;

interface Props {
  visibleGrades: Record<GradeFilterKey, boolean>;
  onToggleGrade: (key: GradeFilterKey) => void;
  onSetAllGrades: (on: boolean) => void;
  visibleRoutes: Record<BusRoute, boolean>;
  onToggleRoute: (key: BusRoute) => void;
  visibleAccident: Record<AccidentLayer, boolean>;
  onToggleAccident: (key: AccidentLayer) => void;
  accidentYears: Record<AccidentLayer, Record<string, boolean>>;
  onToggleAccidentYear: (key: AccidentLayer, year: string) => void;
  onSetAllAccidentYears: (key: AccidentLayer, on: boolean) => void;
  version: string;
  onChangeVersion: (id: string) => void;
  style?: React.CSSProperties;
}

export default function MapLegend({
  visibleGrades,
  onToggleGrade,
  onSetAllGrades,
  visibleRoutes,
  onToggleRoute,
  visibleAccident,
  onToggleAccident,
  accidentYears,
  onToggleAccidentYear,
  onSetAllAccidentYears,
  version,
  onChangeVersion,
  style,
}: Props) {
  const gradeKeys: GradeFilterKey[] = [...GRADES, NO_DATA_KEY];
  const allGradesOn = gradeKeys.every((k) => visibleGrades[k]);
  const [routeDsi, setRouteDsi] = useState<BusRouteDsiMap>({});
  const [collapsed, setCollapsed] = useState(false);
  // 연도 패널은 해당 항목에 마우스를 올리면 열린다. 닫기는 살짝 늦춰야 버튼과 패널 사이를
  // 지나갈 때 깜빡이며 닫히지 않는다(둘 사이 여백은 패널의 padding-top 이 메운다).
  const [openYears, setOpenYears] = useState<AccidentLayer | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openYearPanel = (key: AccidentLayer) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenYears(key);
  };
  const closeYearPanel = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenYears(null), 160);
  };
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // 평균 DSI 도 버전마다 값이 다르므로 등급 색과 같은 버전을 따라간다.
  useEffect(() => {
    let cancelled = false;
    fetch(`/data/bus_route_dsi_${version}.json`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setRouteDsi(data);
      })
      .catch(() => {
        if (!cancelled) setRouteDsi({});
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

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
          <div className="legend-heading">파이프라인 버전</div>
          {/* 버전은 계속 쌓이므로 개수와 무관하게 폭이 일정한 셀렉트로 둔다.
              (알약 버튼을 나열하면 버전이 늘어날수록 범례가 가로로 밀린다.) */}
          <select
            className="version-select"
            value={version}
            onChange={(e) => onChangeVersion(e.target.value)}
            aria-label="파이프라인 버전"
            title="지도 색상·DSI 값·BEV 이미지가 함께 바뀝니다. 버전 간 DSI 값은 정의가 달라 직접 비교할 수 없습니다."
          >
            {DSI_VERSIONS.map((v, i) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {i === 0 ? " (최신)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="legend-divider" />

        <div className="legend-section">
          {/* 제목을 누르면 네 등급을 한 번에 껐다 켠다 - 하나만 보려면 전부 끄고 하나만
              켜는 게 빠른데, 항목을 하나씩 누르면 세 번을 눌러야 했다. */}
          <button
            className="legend-heading legend-heading-btn"
            onClick={() => onSetAllGrades(!allGradesOn)}
            aria-pressed={allGradesOn}
            title={allGradesOn ? "전체 해제" : "전체 선택"}
          >
            도로 위험도 (DSI)
          </button>
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
          <div className="legend-heading" title="도로교통공단 TAAS 공개 자료">
            사고 이력
          </div>
          <div className="legend-row">
            {ACCIDENT_LAYERS.map((key) => {
              const years = ACCIDENT_YEARS[key];
              return (
                <div
                  key={key}
                  className="year-host"
                  onMouseEnter={() => openYearPanel(key)}
                  onMouseLeave={closeYearPanel}
                  onFocus={() => openYearPanel(key)}
                  onBlur={closeYearPanel}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setOpenYears(null);
                  }}
                >
                  <button
                    className={`legend-item ${visibleAccident[key] ? "" : "legend-item-off"}`}
                    onClick={() => onToggleAccident(key)}
                    aria-pressed={visibleAccident[key]}
                    aria-expanded={openYears === key}
                    title={ACCIDENT_TITLES[key]}
                  >
                    <span
                      className={
                        key === "riskArea"
                          ? "legend-swatch legend-swatch-fill"
                          : "legend-swatch legend-swatch-ring"
                      }
                      style={
                        key === "riskArea"
                          ? {
                              background: `${ACCIDENT_COLORS[key]}59`,
                              borderColor: ACCIDENT_COLORS[key],
                            }
                          : { borderColor: ACCIDENT_COLORS[key] }
                      }
                    />
                    {ACCIDENT_LABELS[key]}
                    <span className="year-caret" aria-hidden="true">
                      ▾
                    </span>
                  </button>

                  {openYears === key && (
                    <div className="year-panel">
                      <div className="year-panel-card">
                        <div className="year-panel-head">
                          <span>연도</span>
                          <span className="year-panel-actions">
                            <button
                              className="year-action"
                              onClick={() => onSetAllAccidentYears(key, true)}
                            >
                              전체
                            </button>
                            <button
                              className="year-action"
                              onClick={() => onSetAllAccidentYears(key, false)}
                            >
                              해제
                            </button>
                          </span>
                        </div>
                        <div className="year-grid">
                          {years.map((y) => (
                            <button
                              key={y}
                              className={`year-chip ${accidentYears[key][y] ? "year-chip-on" : ""}`}
                              onClick={() => onToggleAccidentYear(key, y)}
                              aria-pressed={accidentYears[key][y]}
                              style={
                                accidentYears[key][y]
                                  ? {
                                      background: ACCIDENT_COLORS[key],
                                      borderColor: ACCIDENT_COLORS[key],
                                    }
                                  : undefined
                              }
                            >
                              {y.slice(2)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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
        /* 누를 수 있는 제목. 나머지 제목과 같은 크기·색으로 두되, 밑줄 힌트로 클릭 가능함을
           알린다(제목 크기가 바뀌면 옆 항목들이 밀려 버튼 위치가 흔들린다). */
        .legend-heading-btn {
          border: none;
          background: none;
          padding: 0;
          font-family: inherit;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: var(--text-muted);
          text-transform: uppercase;
          white-space: nowrap;
          cursor: pointer;
          text-decoration: underline dotted;
          text-underline-offset: 3px;
        }
        .legend-heading-btn:hover {
          color: var(--foreground);
        }
        .legend-heading-btn:focus-visible {
          outline: 2px solid var(--link-color);
          outline-offset: 2px;
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
        /* 버전은 여러 개 중 하나만 고르는 선택이라, 켜고 끄는 등급/노선 항목과 달리
           셀렉트로 둔다(체크박스처럼 보이면 여러 개를 켤 수 있어 보인다). */
        .version-select {
          border: 1px solid var(--border-color);
          background: var(--panel-bg);
          color: var(--foreground);
          font-size: 12px;
          font-family: inherit;
          padding: 3px 6px;
          border-radius: 6px;
          cursor: pointer;
          max-width: 150px;
        }
        .version-select:hover {
          border-color: var(--link-color);
        }
        .version-select:focus-visible {
          outline: 2px solid var(--link-color);
          outline-offset: 1px;
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
        /* 사고 이력 오버레이는 지도에서도 면 / 테두리 원으로 그려지므로 견본도 같은 형태로
           둔다 - 색만 다른 사각형 두 개면 어느 쪽이 어느 레이어인지 범례만 보고는 모른다. */
        .legend-swatch-fill {
          border: 1.5px solid;
        }
        .legend-swatch-ring {
          background: none;
          border: 2.5px solid;
          border-radius: 50%;
        }

        /* 연도 패널: 항목에 올리면 그 아래로 열린다. .year-panel 자체의 padding-top 이
           버튼과 카드 사이의 여백을 메워, 마우스가 그 틈을 지날 때 hover 가 끊기지 않는다. */
        .year-host {
          position: relative;
          display: flex;
          align-items: center;
        }
        .year-caret {
          font-size: 9px;
          color: var(--text-muted);
          margin-left: 1px;
        }
        .year-panel {
          position: absolute;
          top: 100%;
          left: 0;
          padding-top: 6px;
          z-index: 1100;
        }
        .year-panel-card {
          background: var(--panel-bg);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 8px 10px 9px;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .year-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .year-panel-actions {
          display: flex;
          gap: 6px;
        }
        .year-action {
          border: none;
          background: none;
          padding: 0;
          font: inherit;
          font-size: 10px;
          text-transform: none;
          letter-spacing: 0;
          color: var(--link-color);
          cursor: pointer;
        }
        .year-action:hover {
          text-decoration: underline;
        }
        .year-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 4px;
        }
        .year-chip {
          border: 1px solid var(--border-color);
          background: none;
          color: var(--foreground);
          font-family: inherit;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
          padding: 3px 0;
          min-width: 28px;
          border-radius: 5px;
          cursor: pointer;
        }
        .year-chip:hover {
          border-color: var(--link-color);
        }
        .year-chip-on {
          color: #fff;
        }
        .year-chip:focus-visible,
        .year-action:focus-visible {
          outline: 2px solid var(--link-color);
          outline-offset: 1px;
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
