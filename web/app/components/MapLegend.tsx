"use client";

import { useEffect, useState } from "react";
import { DSI_VERSIONS, combineAlpha, versionById } from "../versions";

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

// 정류장은 재는 값이 없는 참조 자료라 색을 주지 않는다 - 이 지도에서 색은 전부 지표를
// 뜻하므로(배경지도를 무채색으로 깐 이유와 같다), 정류장에 유채색을 주면 등급처럼 읽힌다.
// 밝은 배경에서는 짙은 속살이, 어두운 배경에서는 흰 테두리가 각각 점을 드러낸다.
export const BUS_STOP_COLOR = "#475569";

// 강릉역·전수교육관 표식. 정류장과 같은 이유로 무채색이되, 그보다 짙게 두어 정류장 점
// 사이에서도 기준점으로 먼저 읽히게 한다. 버스 노선 케이싱과 같은 값이다.
export const LANDMARK_COLOR = "#111827";

// 위험도 최소 경로로 뽑은 셔틀 노선 후보 3 개
// (TAAS/analysis/composite/route_candidates.py).
export type RouteCandidate = 1 | 2 | 3;
export const ROUTE_CANDIDATES: RouteCandidate[] = [1, 2, 3];

// 세 후보는 같은 방법으로 뽑은 한 묶음이라 색을 나누지 않고 **선 모양**으로만 가른다 —
// 색을 셋으로 쪼개면 노선 A/B/C 와 등급색까지 여섯 갈래가 되어 지도가 읽히지 않는다.
// 등급색(초록·노랑·빨강)과는 색상환에서 멀어 겹치지 않는다. 다만 기존 노선 C(#2563eb)와
// 같은 파랑 계열이라, 둘을 함께 켜면 케이싱 굵기와 파선 무늬로만 갈린다 — C 보다 한 단계
// 짙은 값을 써서 나란히 놓였을 때의 구분을 조금이라도 벌려 둔다.
export const ROUTE_CANDIDATE_COLOR = "#1d4ed8";
export const ROUTE_CANDIDATE_DASH: Record<RouteCandidate, string | undefined> = {
  1: undefined,
  2: "13 8",
  3: "2 7",
};

// 도로교통공단 TAAS 공개 CSV 의 사고 이력 오버레이. DSI 는 사고가 난 적 없는 구간도 사전
// 진단하는 지표라 이 둘은 정답지가 아니라 대조군이다.
export type AccidentLayer = "fatal" | "serious";
export const ACCIDENT_LAYERS: AccidentLayer[] = ["fatal", "serious"];

// DSI 등급(초록·노랑·빨강)과 버스 노선(보라·청록·파랑) 어디와도 겹치지 않는 색으로 골랐다.
// 두 겹은 크기가 같고 색으로만 갈린다 - 중상 196건도 사망 20건과 같은 비중으로 보여야
// 분포가 읽힌다.
export const ACCIDENT_COLORS: Record<AccidentLayer, string> = {
  fatal: "#a21caf",
  serious: "#92400e",
};

export const ACCIDENT_LABELS: Record<AccidentLayer, string> = {
  fatal: "사망사고",
  serious: "중상사고",
};

// 원시 지점 자료는 2024~25 두 해뿐이다. accident_points_2425.geojson 이 갱신되면
// 여기도 같이 늘려야 한다.
export const ACCIDENT_YEARS: Record<AccidentLayer, string[]> = {
  fatal: ["2024", "2025"],
  serious: ["2024", "2025"],
};

export const ACCIDENT_TITLES: Record<AccidentLayer, string> = {
  fatal:
    "TAAS 원시 사고지점 — 사망사고 (2024~25, 20건). 선정 임계 없는 전수 자료.",
  serious:
    "TAAS 원시 사고지점 — 중상사고 (2024~25, 196건). 경상은 좌표 미제공이라 빠져 있다.",
};

interface BusRouteDsiRecord {
  dsi: number;
  n: number;
  /** α 조절판에만 있는 정적·동적 성분 (versions.ts). */
  s?: number;
  d?: number;
}

type BusRouteDsiMap = Partial<Record<BusRoute | "overall", BusRouteDsiRecord>>;

interface Props {
  visibleGrades: Record<GradeFilterKey, boolean>;
  onToggleGrade: (key: GradeFilterKey) => void;
  onSetAllGrades: (on: boolean) => void;
  version: string;
  /** 정적:동적 비중. 조절 가능한 판에서만 슬라이더가 나온다. */
  alpha: number;
  onAlphaChange: (a: number) => void;
  onChangeVersion: (id: string) => void;
  style?: React.CSSProperties;
  /** 패널 오른쪽 끝에 붙일 컨트롤 (버스 노선 버튼). 범례 항목과 같은 줄·같은 높이로 선다. */
  children?: React.ReactNode;
}

export default function MapLegend({
  visibleGrades,
  onToggleGrade,
  onSetAllGrades,
  version,
  alpha,
  onAlphaChange,
  onChangeVersion,
  style,
  children,
}: Props) {
  const gradeKeys: GradeFilterKey[] = [...GRADES, NO_DATA_KEY];
  const allGradesOn = gradeKeys.every((k) => visibleGrades[k]);
  const [routeDsi, setRouteDsi] = useState<BusRouteDsiMap>({});
  const [collapsed, setCollapsed] = useState(false);
  // 노선 평균도 α 로 다시 합성한다. 성분이 없는 옛 버전은 파일 값을 그대로 쓴다.
  const routeValue = (r: BusRouteDsiRecord) =>
    r.s !== undefined && r.d !== undefined ? combineAlpha(r.s, r.d, alpha) : r.dsi;
  const { alphaAdjustable } = versionById(version);

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
            title="지도 색상·도로 위험도 값·BEV 이미지가 함께 바뀝니다. 버전 간 도로 위험도 값은 정의가 달라 직접 비교할 수 없습니다."
          >
            {DSI_VERSIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <div className="legend-divider" />

        {alphaAdjustable && (
          <div className="legend-section">
            {/* α 는 사고 자료로 유도되지 않는 설계 파라미터라(method.md D-21) 값을 하나로
                박지 않고 직접 움직여 보게 둔다. 바꾸면 도로 색과 등급 임계가 함께 다시
                계산된다 - 임계는 그 α 의 분포에서 다시 뽑으므로 항상 3등분이 유지된다. */}
            <div className="legend-heading">
              정적 비중 α = {alpha.toFixed(2)}
              <span className="alpha-hint">
                {" "}
                정적 {Math.round(alpha * 100)}% · 동적 {Math.round((1 - alpha) * 100)}%
              </span>
            </div>
            <input
              className="alpha-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={alpha}
              onChange={(e) => onAlphaChange(Number(e.target.value))}
              aria-label="정적 비중 알파"
              title="도로 음영 지수(정적)와 동적 지수(통행량·주정차)의 비중. 사고 자료로 정해지지 않는 설계값이다."
            />
          </div>
        )}

        <div className="legend-section">
          {/* 제목을 누르면 네 등급을 한 번에 껐다 켠다 - 하나만 보려면 전부 끄고 하나만
              켜는 게 빠른데, 항목을 하나씩 누르면 세 번을 눌러야 했다. */}
          <button
            className="legend-heading legend-heading-btn"
            onClick={() => onSetAllGrades(!allGradesOn)}
            aria-pressed={allGradesOn}
            title={allGradesOn ? "전체 해제" : "전체 선택"}
          >
            도로 위험도
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
                  className={
                    "legend-swatch" +
                    (key === NO_DATA_KEY ? " legend-swatch-outline" : "")
                  }
                  style={{ background: key === NO_DATA_KEY ? NO_DATA_COLOR : GRADE_COLORS[key] }}
                />
                {GRADE_LABELS[key]}
              </button>
            ))}
          </div>
        </div>


        <div className="legend-divider" />

        <div className="legend-section">
          <div className="legend-summary">
            도로 위험도 평균{" "}
            {routeDsi.overall ? routeValue(routeDsi.overall).toFixed(2) : "불러오는 중…"}
          </div>
        </div>

        {children && (
          <>
            <div className="legend-divider" />
            <div className="legend-section">{children}</div>
          </>
        )}
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
        .alpha-hint {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          opacity: 0.65;
        }
        .alpha-slider {
          width: 100%;
          margin: 6px 0 2px;
          accent-color: var(--text-muted);
          cursor: pointer;
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
        /* '데이터 없음'은 지도에서 흰 선이라 견본도 흰색인데, 밝은 테마에서는 패널 배경도
           흰색이라 그대로 두면 견본이 보이지 않는다. 테두리를 둘러 흰 면임을 드러낸다.
           등급색 견본은 배경과 충분히 갈리므로 테두리를 두르지 않는다. */
        .legend-swatch-outline {
          box-shadow: inset 0 0 0 1px var(--text-muted);
        }
        .legend-swatch-line {
          width: 22px;
          height: 5px;
          border-radius: 2px;
          box-shadow: 0 0 0 1.5px #111827;
        }
        .legend-swatch-ring {
          background: none;
          border: 2.5px solid;
          border-radius: 50%;
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
