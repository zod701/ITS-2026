"use client";

import { useEffect, useState } from "react";
import { LANDMARK_COLOR } from "./MapLegend";

// 강릉역·전수교육관 두 거점. 버스 노선·사고 이력과 같은 버튼+패널 방식으로 접어 둔다.
// 이름은 landmarks.geojson 에서 읽는다 - 여기 박아 두면 자료를 늘렸을 때 지도에는 뜨는데
// 목록에는 없는 상태가 된다.

interface LandmarkRecord {
  name: string;
  addr: string;
}

interface Props {
  /** 끈 거점만 담는다. 비어 있으면 전부 보임 - 이름을 미리 알 수 없어 이렇게 둔다. */
  hiddenLandmarks: Record<string, boolean>;
  onToggleLandmark: (name: string) => void;
  onSetAllLandmarks: (names: string[], on: boolean) => void;
}

export default function PoiButton({
  hiddenLandmarks,
  onToggleLandmark,
  onSetAllLandmarks,
}: Props) {
  const [open, setOpen] = useState(false);
  const [landmarks, setLandmarks] = useState<LandmarkRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/landmarks.geojson")
      .then((res) => res.json())
      .then((fc: { features: { properties: LandmarkRecord }[] }) => {
        if (!cancelled) setLandmarks(fc.features.map((f) => f.properties));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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

  const anyOn = landmarks.some((l) => !hiddenLandmarks[l.name]);
  const allOn = landmarks.length > 0 && landmarks.every((l) => !hiddenLandmarks[l.name]);

  return (
    <div className="poi-host">
      <button
        className={`poi-btn ${anyOn ? "poi-btn-on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="주요 지점"
        aria-expanded={open}
        title="수요 시나리오의 두 끝점 (강릉역·전수교육관)"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M8 1.5c-2.5 0-4.5 2-4.5 4.5 0 3.2 4 8 4.5 8.5.5-.5 4.5-5.3 4.5-8.5 0-2.5-2-4.5-4.5-4.5Zm0 6.3a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Z" />
        </svg>
        <span className="poi-btn-label">POI</span>
      </button>

      {open && (
        <div className="poi-panel" role="dialog" aria-label="주요 지점">
          <div className="poi-panel-head">
            <span>주요 지점</span>
            {/* 거점이 둘뿐이라 전체 토글이 크게 줄여 주진 않지만, 자료가 늘어도 한 번에
                껐다 켤 수 있게 다른 패널과 같은 자리에 둔다. */}
            <button
              className="poi-all"
              onClick={() => onSetAllLandmarks(landmarks.map((l) => l.name), !allOn)}
              aria-pressed={allOn}
              disabled={landmarks.length === 0}
            >
              {allOn ? "전체 해제" : "전체 선택"}
            </button>
          </div>
          <div className="poi-list">
            {landmarks.length === 0 && <div className="poi-empty">불러오는 중…</div>}
            {landmarks.map((l) => (
              <button
                key={l.name}
                className={`poi-item ${hiddenLandmarks[l.name] ? "poi-item-off" : ""}`}
                onClick={() => onToggleLandmark(l.name)}
                aria-pressed={!hiddenLandmarks[l.name]}
                title={l.addr}
              >
                {/* 지도의 거점 표식과 같은 네모. */}
                <span className="poi-mark" style={{ background: LANDMARK_COLOR }} />
                <span className="poi-label">{l.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <style jsx>{`
        /* 범례 안에 들어가는 컨트롤이라 버스 노선 버튼과 같은 높이·모양을 쓴다. */
        .poi-host {
          position: relative;
          display: flex;
          align-items: center;
        }
        .poi-btn {
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
        .poi-btn:hover {
          border-color: var(--link-color);
          color: var(--link-color);
        }
        .poi-btn:focus-visible {
          outline: 2px solid var(--link-color);
          outline-offset: 1px;
        }
        /* 지도에 거점이 하나라도 켜져 있으면 버튼만 보고도 알 수 있게 한다. */
        .poi-btn-on {
          border-color: var(--link-color);
          color: var(--link-color);
          font-weight: 600;
        }
        .poi-btn-label {
          line-height: 1;
        }
        .poi-panel {
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
        .poi-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        .poi-all {
          border: none;
          background: none;
          padding: 0;
          font: inherit;
          font-size: 10px;
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          color: var(--link-color);
          cursor: pointer;
        }
        .poi-all:hover {
          text-decoration: underline;
        }
        .poi-all:disabled {
          color: var(--text-muted);
          cursor: default;
          text-decoration: none;
        }
        .poi-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .poi-empty {
          font-size: 12px;
          color: var(--text-muted);
        }
        .poi-item {
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
        .poi-item-off {
          opacity: 0.4;
        }
        .poi-mark {
          width: 11px;
          height: 11px;
          border-radius: 2px;
          flex-shrink: 0;
          box-shadow: 0 0 0 1.5px #ffffff;
        }
        .poi-label {
          flex: 1;
        }

        /* 모바일: 범례가 세로로 쌓이면서 이 버튼이 왼쪽 끝에 서므로 패널도 왼쪽으로 편다. */
        @media (max-width: 768px) {
          .poi-panel {
            right: auto;
            left: 0;
          }
        }
      `}</style>
    </div>
  );
}
