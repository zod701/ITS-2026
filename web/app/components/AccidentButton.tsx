"use client";

import { useEffect, useState } from "react";
import {
  ACCIDENT_COLORS,
  ACCIDENT_LABELS,
  ACCIDENT_LAYERS,
  ACCIDENT_TITLES,
  ACCIDENT_YEARS,
  type AccidentLayer,
} from "./MapLegend";

// 사고 이력은 버스 노선과 마찬가지로 파이프라인 버전과 무관한 고정 오버레이라, 버전마다
// 늘었다 줄었다 하는 범례에 펼쳐 두면 상단 패널이 가로로 밀린다. 버튼 하나로 접어 둔다.
// 종전에는 범례 안에 두 항목을 늘어놓고 연도를 hover 로 여는 하위 패널에 숨겨 뒀는데,
// 패널 안으로 들어온 지금은 연도가 두 개뿐이라 그냥 항목 아래 펼쳐 둔다.

interface Props {
  visibleAccident: Record<AccidentLayer, boolean>;
  onToggleAccident: (key: AccidentLayer) => void;
  /** 레이어별로 켜 둔 연도. 레이어가 켜져 있어도 여기 없는 연도는 그리지 않는다. */
  accidentYears: Record<AccidentLayer, Record<string, boolean>>;
  onToggleAccidentYear: (key: AccidentLayer, year: string) => void;
  onSetAllAccidentYears: (key: AccidentLayer, on: boolean) => void;
}

export default function AccidentButton({
  visibleAccident,
  onToggleAccident,
  accidentYears,
  onToggleAccidentYear,
  onSetAllAccidentYears,
}: Props) {
  const [open, setOpen] = useState(false);

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

  const anyOn = ACCIDENT_LAYERS.some((k) => visibleAccident[k]);

  return (
    <div className="acc-host">
      <button
        className={`acc-btn ${anyOn ? "acc-btn-on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="사고 이력"
        aria-expanded={open}
        title="도로교통공단 TAAS 원시 사고지점 (2024~25)"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M8 1.5a.9.9 0 0 1 .78.45l6 10.4A.9.9 0 0 1 14 13.7H2a.9.9 0 0 1-.78-1.35l6-10.4A.9.9 0 0 1 8 1.5Zm0 2.7-4.7 8.15h9.4L8 4.2Zm-.75 2.55h1.5v3.2h-1.5v-3.2Zm0 4h1.5v1.4h-1.5v-1.4Z" />
        </svg>
        <span className="acc-btn-label">사고 이력</span>
      </button>

      {open && (
        <div className="acc-panel" role="dialog" aria-label="사고 이력">
          <div className="acc-panel-head">
            사고 이력 <span className="acc-sub">도로교통공단 TAAS · 2024~25</span>
          </div>
          <div className="acc-list">
            {ACCIDENT_LAYERS.map((key) => (
              <div key={key} className="acc-group">
                <button
                  className={`acc-item ${visibleAccident[key] ? "" : "acc-item-off"}`}
                  onClick={() => onToggleAccident(key)}
                  aria-pressed={visibleAccident[key]}
                  title={ACCIDENT_TITLES[key]}
                >
                  {/* 지도와 같은 형태(삼각형)·같은 크기로 두고 색으로만 구분한다. */}
                  <svg className="acc-mark" viewBox="0 0 15 14" aria-hidden="true">
                    <path
                      d="M7.5 1 L14 12.6 L1 12.6 Z"
                      fill={ACCIDENT_COLORS[key]}
                      fillOpacity={key === "fatal" ? 0.95 : 0.7}
                    />
                  </svg>
                  <span className="acc-label">{ACCIDENT_LABELS[key]}</span>
                </button>
                <div className="acc-years">
                  {ACCIDENT_YEARS[key].map((y) => (
                    <button
                      key={y}
                      className={`acc-chip ${accidentYears[key][y] ? "acc-chip-on" : ""}`}
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
                      {y}
                    </button>
                  ))}
                  <span className="acc-year-actions">
                    <button
                      className="acc-year-action"
                      onClick={() => onSetAllAccidentYears(key, true)}
                    >
                      전체
                    </button>
                    <button
                      className="acc-year-action"
                      onClick={() => onSetAllAccidentYears(key, false)}
                    >
                      해제
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style jsx>{`
        /* 범례 안에 들어가는 컨트롤이라 버스 노선 버튼과 같은 높이·모양을 쓴다. */
        .acc-host {
          position: relative;
          display: flex;
          align-items: center;
        }
        .acc-btn {
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
        .acc-btn:hover {
          border-color: var(--link-color);
          color: var(--link-color);
        }
        .acc-btn:focus-visible {
          outline: 2px solid var(--link-color);
          outline-offset: 1px;
        }
        /* 지도에 사고 이력이 하나라도 켜져 있으면 버튼만 보고도 알 수 있게 한다. */
        .acc-btn-on {
          border-color: var(--link-color);
          color: var(--link-color);
          font-weight: 600;
        }
        .acc-btn-label {
          line-height: 1;
        }
        .acc-panel {
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
        .acc-panel-head {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        .acc-sub {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          font-size: 10px;
        }
        .acc-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .acc-item {
          display: flex;
          align-items: center;
          gap: 8px;
          border: none;
          background: none;
          color: inherit;
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
          padding: 2px;
          text-align: left;
          white-space: nowrap;
        }
        .acc-item-off {
          opacity: 0.4;
        }
        .acc-mark {
          width: 13px;
          height: 12px;
          flex-shrink: 0;
        }
        .acc-label {
          flex: 1;
        }
        /* 연도는 항목에 딸린 것이라 점 지름만큼 들여 쓴다. */
        .acc-years {
          display: flex;
          align-items: center;
          gap: 4px;
          padding-left: 23px;
        }
        .acc-chip {
          border: 1px solid var(--border-color);
          background: none;
          color: var(--text-muted);
          font-size: 11px;
          font-family: inherit;
          line-height: 1;
          padding: 3px 6px;
          border-radius: 4px;
          cursor: pointer;
        }
        .acc-chip-on {
          color: #ffffff;
        }
        .acc-year-actions {
          display: flex;
          gap: 6px;
          margin-left: auto;
        }
        .acc-year-action {
          border: none;
          background: none;
          color: var(--text-muted);
          font-size: 10px;
          font-family: inherit;
          padding: 0;
          cursor: pointer;
        }
        .acc-year-action:hover {
          color: var(--link-color);
        }

        /* 모바일: 범례가 세로로 쌓이면서 이 버튼이 왼쪽 끝에 서므로 패널도 왼쪽으로 편다. */
        @media (max-width: 768px) {
          .acc-panel {
            right: auto;
            left: 0;
          }
        }
      `}</style>
    </div>
  );
}
