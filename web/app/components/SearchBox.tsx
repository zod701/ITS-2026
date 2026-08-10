"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointFeature, SelectedPoint } from "../types";

interface Props {
  points: PointFeature[] | null;
  onSelectPoint: (point: SelectedPoint) => void;
  onHighlight: (pointIds: string[]) => void;
  style?: React.CSSProperties;
}

interface Candidate {
  pointId: string;
  panoId: string;
  lat: number;
  lon: number;
  address: string;
}

const MAX_RESULTS = 30;

export default function SearchBox({ points, onSelectPoint, onHighlight, style }: Props) {
  const [query, setQuery] = useState("");
  const [addressMap, setAddressMap] = useState<Record<string, string> | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/data/address_map.json")
      .then((res) => res.json())
      .then(setAddressMap)
      .catch(() => setAddressMap({}));
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // point_id 또는 pano_id 정확 일치를 먼저 시도하고, 없으면 주소 부분 문자열로 후보를 찾는다.
  const { exactPoint, addressCandidates } = useMemo(() => {
    const q = query.trim();
    if (!q || !points || !addressMap) {
      return { exactPoint: null as PointFeature | null, addressCandidates: [] as Candidate[] };
    }

    const byId = points.find((p) => p.properties.point_id === q || p.properties.pano_id === q);
    if (byId) {
      return { exactPoint: byId, addressCandidates: [] as Candidate[] };
    }

    const results: Candidate[] = [];
    for (const p of points) {
      const address = addressMap[p.properties.pano_id];
      if (!address || !address.includes(q)) continue;
      const [lon, lat] = p.geometry.coordinates;
      results.push({ pointId: p.properties.point_id, panoId: p.properties.pano_id, lat, lon, address });
      if (results.length >= MAX_RESULTS) break;
    }
    return { exactPoint: null, addressCandidates: results };
  }, [query, points, addressMap]);

  // 하이라이트는 검색 결과창(open)이 아니라 검색어 자체에 따라 유지한다 —
  // 지도를 드래그해도 open은 바깥 클릭으로 닫히지만 하이라이트는 남아 있어야 한다.
  useEffect(() => {
    if (!query.trim()) {
      onHighlight([]);
      return;
    }
    onHighlight(addressCandidates.map((c) => c.pointId));
  }, [addressCandidates, query, onHighlight]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (exactPoint) {
      const [lon, lat] = exactPoint.geometry.coordinates;
      onSelectPoint({
        pointId: exactPoint.properties.point_id,
        panoId: exactPoint.properties.pano_id,
        lat,
        lon,
      });
      setOpen(false);
    }
  };

  const pickCandidate = (c: Candidate) => {
    onSelectPoint({ pointId: c.pointId, panoId: c.panoId, lat: c.lat, lon: c.lon });
    setOpen(false);
  };

  return (
    <div className="search-box" style={style} ref={rootRef}>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="지점 ID, Pano ID, 주소로 검색"
          aria-label="지점 검색"
        />
      </form>

      {open && query.trim() && (
        <div className="search-results">
          {exactPoint && (
            <button
              className="search-result-item"
              onClick={() => {
                const [lon, lat] = exactPoint.geometry.coordinates;
                pickCandidate({
                  pointId: exactPoint.properties.point_id,
                  panoId: exactPoint.properties.pano_id,
                  lat,
                  lon,
                  address: addressMap?.[exactPoint.properties.pano_id] ?? "",
                });
              }}
            >
              지점 #{exactPoint.properties.point_id} 로 이동
            </button>
          )}
          {!exactPoint && addressCandidates.length === 0 && (
            <div className="search-empty">일치하는 지점이 없습니다.</div>
          )}
          {!exactPoint &&
            addressCandidates.map((c) => (
              <button key={c.pointId} className="search-result-item" onClick={() => pickCandidate(c)}>
                <span className="search-result-id">#{c.pointId}</span>
                <span className="search-result-address">{c.address}</span>
              </button>
            ))}
        </div>
      )}

      <style jsx>{`
        .search-box {
          position: absolute;
          z-index: 1000;
          width: 280px;
        }
        input {
          width: 100%;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--border-color);
          background: var(--panel-bg);
          color: var(--foreground);
          font-size: 13px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        input:focus {
          outline: 2px solid var(--link-color);
          outline-offset: -1px;
        }
        .search-results {
          margin-top: 4px;
          max-height: 320px;
          overflow-y: auto;
          background: var(--panel-bg);
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        .search-empty {
          padding: 10px 12px;
          font-size: 13px;
          color: var(--text-muted);
        }
        .search-result-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
          width: 100%;
          text-align: left;
          padding: 8px 12px;
          border: none;
          border-bottom: 1px solid var(--border-color);
          background: none;
          color: var(--foreground);
          font-size: 13px;
          cursor: pointer;
        }
        .search-result-item:last-child {
          border-bottom: none;
        }
        .search-result-item:hover {
          background: var(--panel-meta-bg);
        }
        .search-result-id {
          font-weight: 600;
          font-size: 12px;
          color: var(--text-muted);
        }
        .search-result-address {
          word-break: break-all;
        }

        /* 모바일: 고정 280px 대신 화면 폭에 맞춘다. 위치(left/top)는 page.tsx의 인라인
           스타일이라 !important로만 덮어쓸 수 있다(데스크탑에는 적용되지 않음).
           우측은 테마 토글 FAB(right 24 + 48px) 자리를 비워 둔다. */
        @media (max-width: 768px) {
          .search-box {
            left: 8px !important;
            top: 8px !important;
            right: 80px;
            width: auto;
          }
          /* iOS Safari는 폰트가 16px 미만인 입력에 포커스하면 화면을 확대해버린다. */
          input {
            font-size: 16px;
          }
          .search-results {
            max-height: 50dvh;
          }
        }
      `}</style>
    </div>
  );
}
