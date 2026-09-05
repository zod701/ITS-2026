"use client";

import { useEffect, useRef, useState } from "react";
import { combineAlpha } from "../versions";
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

// route_candidates.geojson 의 properties. 지도에는 선만 그리고 수치는 여기 적는다.
interface CandidateRecord {
  rank: RouteCandidate;
  length_km: number;
  mean_dsi: number;
  n_stops: number;
  share_highrisk: number;
}

interface BusRouteDsiRecord {
  dsi: number;
  n: number;
  /** 정적·동적 성분. 실린 판에서는 α 로 다시 합성한다. */
  s?: number;
  d?: number;
}

type BusRouteDsiMap = Partial<Record<BusRoute | "overall", BusRouteDsiRecord>>;

interface Props {
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
  const [routeDsi, setRouteDsi] = useState<BusRouteDsiMap>({});
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const hostRef = useRef<HTMLDivElement | null>(null);

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

  // 지도를 보려고 누른 것이므로 바깥을 클릭하거나 Esc 를 누르면 닫는다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!hostRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const routeValue = (r: BusRouteDsiRecord) =>
    r.s !== undefined && r.d !== undefined ? combineAlpha(r.s, r.d, alpha) : r.dsi;
  const anyOn =
    BUS_ROUTES.some((r) => visibleRoutes[r]) ||
    showStops ||
    ROUTE_CANDIDATES.some((r) => visibleCandidates[r]);

  return (
    <div className="bus-host" ref={hostRef}>
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
                    {rec ? `평균 DSI ${routeValue(rec).toFixed(2)}` : "—"}
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
              title="VWorld 지명검색으로 모은 지도 범위 안의 버스정류장. 경유노선·상하행 정보는 없다."
            >
              <span className="bus-dot" style={{ background: BUS_STOP_COLOR }} />
              <span className="bus-label">버스 정류장</span>
              <span className="bus-dsi">361개소</span>
            </button>
          </div>

          {/* 전수교육관↔강릉역 위험도 최소 경로. A/B/C 와 달리 이 저장소가 계산해 낸
              결과물이라 따로 묶고, 어떤 판·α 로 뽑았는지 부제로 밝힌다. */}
          {candidates.length > 0 && (
            <>
              <div className="bus-sep" />
              <div className="bus-panel-head">
                제안 노선 <span className="bus-sub">전수교육관 ↔ 강릉역 · 2026 단오제 · α 0.35</span>
              </div>
              <div className="bus-list">
                {candidates.map((c) => (
                  <button
                    key={c.rank}
                    className={`bus-item ${visibleCandidates[c.rank] ? "" : "bus-item-off"}`}
                    onClick={() => onToggleCandidate(c.rank)}
                    aria-pressed={visibleCandidates[c.rank]}
                    title={
                      `${c.length_km}km · 평균 DSI ${c.mean_dsi.toFixed(3)} · ` +
                      `High-risk 구간 ${Math.round(c.share_highrisk * 100)}% · ` +
                      `정류장 ${c.n_stops}개소`
                    }
                  >
                    <span
                      className="bus-swatch bus-swatch-dash"
                      style={{
                        backgroundImage: ROUTE_CANDIDATE_DASH[c.rank]
                          ? `repeating-linear-gradient(90deg, ${ROUTE_CANDIDATE_COLOR} 0 ${
                              c.rank === 2 ? "6px" : "2px"
                            }, transparent ${c.rank === 2 ? "6px" : "2px"} ${
                              c.rank === 2 ? "10px" : "5px"
                            })`
                          : undefined,
                        background: ROUTE_CANDIDATE_DASH[c.rank]
                          ? undefined
                          : ROUTE_CANDIDATE_COLOR,
                      }}
                    />
                    <span className="bus-label">
                      {c.rank}순위 <span className="bus-sub">{c.length_km}km</span>
                    </span>
                    <span className="bus-dsi">평균 DSI {c.mean_dsi.toFixed(2)}</span>
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
