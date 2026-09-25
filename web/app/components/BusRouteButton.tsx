"use client";

import { useEffect, useState } from "react";
import { combineAlpha } from "../versions";
import type { BisRoute, DemandPeriod } from "../bisRoutes";
import { routeNetDemandMaximum } from "../routeDemand";
import {
  BUS_ROUTES,
  BUS_ROUTE_COLORS,
  BUS_STOP_COLOR,
  ROUTE_CANDIDATES,
  ROUTE_CANDIDATE_COLOR,
  ROUTE_CANDIDATE_DASH,
  type BusRoute,
  type RouteCandidate,
} from "./MapLegend";

// 버스 노선은 파이프라인 버전과 무관한 고정 오버레이라, 버전마다 늘었다 줄었다 하는 범례와
// 함께 두면 상단 패널이 두 줄로 접힌다. 별도 버튼으로 빼서 필요할 때만 펼친다.

const BUS_ROUTE_LABELS: Record<BusRoute, string> = {
  A: "A 노선",
  B: "B 노선",
  C: "C 노선",
};

/** 정적·동적 성분이 실린 판에서는 α 로 다시 합성한다. 없으면 파일의 dsi 를 그대로 쓴다. */
interface DsiParts {
  dsi: number;
  s?: number;
  d?: number;
}

/** route_candidate_dsi_<판>.json — 키는 순위 문자열("1"·"2"·"3"). */
type CandidateDsiMap = Record<string, DsiParts & { coverage: number }>;

// route_candidates.geojson 의 properties. 판·α 와 무관한 값(길이·정류장 수)만 여기서 읽고,
// 위험도는 판별 파일에서 따로 받는다 - 노선은 한 판에서 뽑았지만 어느 판으로도 다시 잴 수
// 있어야 한다. mean_dsi 는 그 판별 파일이 없을 때의 대비책이다.
interface CandidateRecord {
  rank: RouteCandidate;
  length_km: number;
  mean_dsi: number;
  n_stops: number;
  share_highrisk: number;
}

/**
 * 후보 스와치 배경. 지도의 파선 무늬(SVG dashArray)를 그대로 받아 CSS 반복 그라디언트로
 * 옮기므로, 무늬를 바꿔도 범례와 지도가 어긋나지 않는다. 스와치 폭이 22px 뿐이라 지도의
 * 절반 간격으로 줄여야 파선이 두 마디 이상 보인다.
 *
 * background(단축) 하나만 쓴다 — backgroundImage 와 background 를 같은 style 객체에 함께
 * 두면, React 가 undefined 인 쪽을 빈 문자열로 되돌리면서 단축 속성이 앞서 세운 이미지를
 * 지워 파선이 통째로 사라진다.
 */
function swatchBackground(rank: RouteCandidate): string {
  const dash = ROUTE_CANDIDATE_DASH[rank];
  if (!dash) return ROUTE_CANDIDATE_COLOR;
  const [on, off] = dash.split(" ").map((v) => Number(v) / 2);
  return (
    `repeating-linear-gradient(90deg, ${ROUTE_CANDIDATE_COLOR} 0 ${on}px, ` +
    `transparent ${on}px ${on + off}px)`
  );
}

type BusRouteDsiMap = Partial<Record<BusRoute | "overall", DsiParts & { n: number }>>;

interface Props {
  demandPeriod: DemandPeriod;
  onDemandPeriodChange: (period: DemandPeriod) => void;
  bisRoutes: BisRoute[];
  bisError: boolean;
  selectedBisRouteId: string;
  onSelectBisRoute: (id: string) => void;
  visibleRoutes: Record<BusRoute, boolean>;
  onToggleRoute: (key: BusRoute) => void;
  /** 정류장 오버레이. 특정 노선에 속하지 않으므로 노선 목록과 나눠 둔다. */
  showStops: boolean;
  onToggleStops: () => void;
  /** 위험도 최소 경로 후보 3 개. */
  visibleCandidates: Record<RouteCandidate, boolean>;
  onToggleCandidate: (rank: RouteCandidate) => void;
  /** 노선 평균 DSI 를 읽어올 03 실행 버전. */
  version: string;
  /** 정적:동적 비중. 성분이 실린 판에서는 이 값으로 평균을 다시 합성한다. */
  alpha: number;
}

export default function BusRouteButton({
  demandPeriod,
  onDemandPeriodChange,
  bisRoutes,
  bisError,
  selectedBisRouteId,
  onSelectBisRoute,
  visibleRoutes,
  onToggleRoute,
  showStops,
  onToggleStops,
  visibleCandidates,
  onToggleCandidate,
  version,
  alpha,
}: Props) {
  const [open, setOpen] = useState(false);
  const selectedBisRoute = bisRoutes.find((route) => route.id === selectedBisRouteId);
  const [routeSort, setRouteSort] = useState<"number" | "annual" | "danoje" | "difference">("annual");
  const sortValue = (route: BisRoute): number | null => {
    const annual = route.demandTotals.annual;
    const danoje = route.demandTotals.danoje;
    if (routeSort === "annual") return annual == null ? null : annual / 365;
    if (routeSort === "danoje") return danoje == null ? null : danoje / 8;
    if (routeSort === "difference") return annual == null || danoje == null ? null : danoje / 8 - annual / 365;
    return null;
  };
  const sortedBisRoutes = [...bisRoutes].sort((a, b) => {
    if (routeSort !== "number") {
      const av = sortValue(a), bv = sortValue(b);
      if (av == null && bv != null) return 1;
      if (av != null && bv == null) return -1;
      if (av != null && bv != null && av !== bv) return bv - av;
    }
    return a.name.localeCompare(b.name, "ko", { numeric: true }) ||
      a.company.localeCompare(b.company, "ko") || a.id.localeCompare(b.id);
  });
  const [routeDsi, setRouteDsi] = useState<BusRouteDsiMap>({});
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [candidateDsi, setCandidateDsi] = useState<CandidateDsiMap>({});

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

  useEffect(() => {
    let cancelled = false;
    fetch("/data/route_candidates.geojson")
      .then((res) => res.json())
      .then((fc: { features: { properties: CandidateRecord }[] }) => {
        if (!cancelled) setCandidates(fc.features.map((f) => f.properties));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // 후보 위험도도 판마다 다르므로 노선 A/B/C 와 같은 방식으로 판을 따라간다.
  useEffect(() => {
    let cancelled = false;
    fetch(`/data/route_candidate_dsi_${version}.json`)
      .then((res) => res.json())
      .then((data: CandidateDsiMap) => {
        if (!cancelled) setCandidateDsi(data);
      })
      .catch(() => {
        if (!cancelled) setCandidateDsi({});
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // 바깥을 클릭해도 닫지 않는다 - 패널을 켜 둔 채로 지도를 눌러 지점을 살피거나 다른
  // 패널과 견주는 쓰임이라, 지도를 한 번 누를 때마다 닫히면 매번 다시 열어야 한다.
  // 닫는 길은 같은 버튼을 다시 누르는 것(과 Esc)뿐이다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const dsiValue = (r: DsiParts) =>
    r.s !== undefined && r.d !== undefined ? combineAlpha(r.s, r.d, alpha) : r.dsi;
  /** 선택된 판·α 로 다시 잰 후보 위험도. 그 판의 파일이 없으면 뽑을 때의 값으로 물러난다. */
  const candidateValue = (c: CandidateRecord) => {
    const rec = candidateDsi[String(c.rank)];
    return rec ? dsiValue(rec) : c.mean_dsi;
  };
  const anyOn =
    Boolean(selectedBisRouteId) ||
    BUS_ROUTES.some((r) => visibleRoutes[r]) ||
    showStops ||
    ROUTE_CANDIDATES.some((r) => visibleCandidates[r]);

  return (
    <div className="bus-host">
      <button
        className={`bus-btn ${anyOn ? "bus-btn-on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="버스 노선"
        aria-expanded={open}
        title="버스 노선"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M3.5 1h9A1.5 1.5 0 0 1 14 2.5v8a1.5 1.5 0 0 1-1 1.415V13a1 1 0 0 1-1 1h-.5a1 1 0 0 1-1-1v-.5h-5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-1.085A1.5 1.5 0 0 1 2 10.5v-8A1.5 1.5 0 0 1 3.5 1Zm0 1.5v3h9v-3h-9Zm0 4.5v3.5h9V7h-9Zm1 1a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm7 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
        </svg>
        <span className="bus-btn-label">버스 노선</span>
      </button>

      {open && (
        <div className="bus-panel" role="dialog" aria-label="버스 노선">
          <div className="bus-panel-head">강릉시 BIS 노선 · {bisRoutes.length}개</div>
          <select className="bis-select" aria-label="노선 정렬" value={routeSort}
            onChange={(e) => setRouteSort(e.target.value as typeof routeSort)}>
            <option value="number">노선번호 순</option>
            <option value="annual">2025 승하차량 순 ↓</option>
            <option value="danoje">2025 단오제 승하차량 순 ↓</option>
            <option value="difference">단오제 일평균 − 연간 일평균 순 ↓</option>
          </select>
          {routeSort !== "number" && <div className="bus-sub">
            일평균 승차+하차 · 내림차순 · 기록 없음은 마지막
            {routeSort === "difference" && <><br />단오제 합계 ÷ 8 − 연간 합계 ÷ 365 (승하차 건/일)</>}
          </div>}
          <select
            className="bis-select"
            aria-label="BIS 노선 선택"
            value={selectedBisRouteId}
            onChange={(e) => onSelectBisRoute(e.target.value)}
            disabled={!bisRoutes.length}
          >
            <option value="">{bisError ? "노선을 불러오지 못했습니다" : bisRoutes.length ? "노선 선택 (표시 해제)" : "노선 불러오는 중…"}</option>
            {sortedBisRoutes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.name} · {route.company} · {route.start} → {route.end} [{route.id}]
                {routeSort !== "number" && ` · ${sortValue(route) == null ? "기록 없음" : `${sortValue(route)!.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}건/일`}`}
              </option>
            ))}
          </select>
          <select className="bis-select" aria-label="승하차 수요 기간" value={demandPeriod}
            onChange={(e) => onDemandPeriodChange(e.target.value as DemandPeriod)}>
            <option value="annual">2025 전체</option>
            <option value="danoje">강릉단오제 · 2025.5.27~6.3</option>
          </select>
          <div className="demand-legend">
            <div>순승차(승차−하차): 양수 빨강 · 음수 파랑 · 0 중립색</div>
            <div className="demand-ramp" />
            <div>연함 → 차이 작음 · 진함 → 차이 큼</div>
            {selectedBisRoute && <div>
              순승차 일평균 색상 범위: ±{(routeNetDemandMaximum(selectedBisRoute, demandPeriod) / (demandPeriod === "annual" ? 365 : 8)).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}명/일
            </div>}
          </div>
          <div className="bus-sep" />
          <div className="bus-panel-head">기존 자율주행 버스 노선</div>
          <div className="bus-list">
            {BUS_ROUTES.map((route) => {
              const rec = routeDsi[route];
              return (
                <button
                  key={route}
                  className={`bus-item ${visibleRoutes[route] ? "" : "bus-item-off"}`}
                  onClick={() => onToggleRoute(route)}
                  aria-pressed={visibleRoutes[route]}
                >
                  <span
                    className="bus-swatch"
                    style={{ background: BUS_ROUTE_COLORS[route] }}
                  />
                  <span className="bus-label">{BUS_ROUTE_LABELS[route]}</span>
                  <span className="bus-dsi">
                    {rec ? `평균 위험도 ${dsiValue(rec).toFixed(2)}` : "—"}
                  </span>
                </button>
              );
            })}
          </div>
          {/* 정류장은 A/B/C 어디에도 속하지 않는 별도 자료라 선을 그어 나눈다. */}
          <div className="bus-sep" />
          <div className="bus-list">
            <button
              className={`bus-item ${showStops ? "" : "bus-item-off"}`}
              onClick={onToggleStops}
              aria-pressed={showStops}
              title="강릉시 BIS의 정류장 ID·좌표에 2025년 연간 및 단오제 기간 승하차를 결합한 지도 범위 내 정류장."
            >
              <span className="bus-dot" style={{ background: BUS_STOP_COLOR }} />
              <span className="bus-label">버스 정류장</span>
              <span className="bus-dsi">431개소</span>
            </button>
          </div>

          {/* 전수교육관↔강릉역 위험도 최소 경로. A/B/C 와 달리 이 저장소가 계산해 낸
              결과물이라 따로 묶고, 어떤 판·α 로 뽑았는지 부제로 밝힌다. */}
          {candidates.length > 0 && (
            <>
              <div className="bus-sep" />
              <div className="bus-panel-head">
                제안 노선{" "}
                <span className="bus-sub">
                  전수교육관 ↔ 강릉역 · 2026 단오제판 α 0.35 로 선정
                </span>
              </div>
              <div className="bus-list">
                {candidates.map((c) => (
                  <button
                    key={c.rank}
                    className={`bus-item ${visibleCandidates[c.rank] ? "" : "bus-item-off"}`}
                    onClick={() => onToggleCandidate(c.rank)}
                    aria-pressed={visibleCandidates[c.rank]}
                    title={
                      `${c.length_km}km · 평균 위험도 ${candidateValue(c).toFixed(3)} · ` +
                      `High-risk 구간 ${Math.round(c.share_highrisk * 100)}% · ` +
                      `정류장 ${c.n_stops}개소`
                    }
                  >
                    <span
                      className="bus-swatch bus-swatch-dash"
                      style={{ background: swatchBackground(c.rank) }}
                    />
                    <span className="bus-label">
                      {c.rank}순위 <span className="bus-sub">{c.length_km}km</span>
                    </span>
                    <span className="bus-dsi">평균 위험도 {candidateValue(c).toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <style jsx>{`
        /* 범례 안에 들어가는 컨트롤이라 버전 셀렉트와 같은 높이·모양을 쓴다. */
        .bus-host {
          position: relative;
          display: flex;
          align-items: center;
        }
        .bus-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          border: 1px solid var(--border-color);
          background: none;
          color: var(--foreground);
          font-size: 12px;
          font-family: inherit;
          padding: 3px 10px;
          border-radius: 6px;
          cursor: pointer;
          white-space: nowrap;
        }
        .bus-btn:hover {
          border-color: var(--link-color);
          color: var(--link-color);
        }
        .bus-btn:focus-visible {
          outline: 2px solid var(--link-color);
          outline-offset: 1px;
        }
        /* 지도에 노선이 하나라도 켜져 있으면 버튼만 보고도 알 수 있게 한다. */
        .bus-btn-on {
          border-color: var(--link-color);
          color: var(--link-color);
          font-weight: 600;
        }
        .bus-btn-label {
          line-height: 1;
        }
        .bus-panel {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 1;
          min-width: 210px;
          width: min(390px, calc(100vw - 80px));
          max-height: 75vh;
          overflow-y: auto;
          background: var(--panel-bg);
          color: var(--foreground);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 10px 12px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        }
        .bus-panel-head {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        .bis-select {
          width: 100%;
          padding: 7px;
          margin-bottom: 8px;
          background: var(--panel-bg);
          color: var(--foreground);
          border: 1px solid var(--border-color);
          border-radius: 4px;
          font: inherit;
          font-size: 12px;
        }
        .demand-legend { font-size: 11px; line-height: 1.6; margin-bottom: 8px; color: var(--text-muted); }
        .demand-ramp { height: 6px; margin: 4px 0; background: linear-gradient(90deg, #ef3340, #e5e7eb, #2563eb); border-radius: 3px; }
        .bus-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .bus-item {
          display: flex;
          align-items: center;
          gap: 8px;
          border: none;
          background: none;
          color: inherit;
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
          padding: 4px 2px;
          text-align: left;
          white-space: nowrap;
        }
        .bus-item-off {
          opacity: 0.4;
        }
        .bus-swatch {
          width: 22px;
          height: 5px;
          border-radius: 2px;
          flex-shrink: 0;
          box-shadow: 0 0 0 1.5px #111827;
        }
        /* 지도의 정류장 표식과 같은 모양 - 선(노선)과 점(정류장)을 범례에서도 구분한다. */
        .bus-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          flex-shrink: 0;
          margin: 0 6.5px;
          box-shadow: 0 0 0 1.2px #ffffff;
        }
        /* 파선 스와치는 배경이 그림이라 노선색 그림자를 두르지 않는다. */
        .bus-swatch-dash {
          box-shadow: none;
          height: 4px;
        }
        .bus-sub {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          color: var(--text-muted);
          font-size: 10px;
        }
        .bus-sep {
          height: 1px;
          background: var(--border-color);
          margin: 8px 0 6px;
        }
        .bus-label {
          flex: 1;
        }
        .bus-dsi {
          font-size: 11px;
          color: var(--text-muted);
        }

        /* 모바일: 범례가 세로로 쌓이면서 이 버튼이 왼쪽 끝에 서므로 패널도 왼쪽으로 편다. */
        @media (max-width: 768px) {
          .bus-panel {
            right: auto;
            left: 0;
          }
        }
      `}</style>
    </div>
  );
}
