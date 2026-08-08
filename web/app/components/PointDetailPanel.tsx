"use client";

import { useEffect, useState } from "react";
import type { SelectedPoint } from "../types";

interface Props {
  point: SelectedPoint;
  onClose: () => void;
}

export default function PointDetailPanel({ point, onClose }: Props) {
  const [imageMap, setImageMap] = useState<Record<string, string> | null>(null);
  const [addressMap, setAddressMap] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    fetch("/data/image_map.json")
      .then((res) => res.json())
      .then(setImageMap)
      .catch(() => setImageMap({}));
  }, []);

  useEffect(() => {
    fetch("/data/address_map.json")
      .then((res) => res.json())
      .then(setAddressMap)
      .catch(() => setAddressMap({}));
  }, []);

  const key = `${point.pointId}_${point.panoId}`;
  const fileId = imageMap?.[key];
  const imageUrl = fileId
    ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`
    : null;
  const address = addressMap?.[point.panoId];

  return (
    <aside className="detail-panel">
      <div className="detail-panel-header">
        <h2>지점 #{point.pointId}</h2>
        <dl className="detail-panel-meta">
          <div className="meta-item">
            <dt>Pano ID</dt>
            <dd>{point.panoId}</dd>
          </div>
          <div className="meta-item">
            <dt>위치</dt>
            <dd>
              {point.lat.toFixed(6)}, {point.lon.toFixed(6)}
            </dd>
          </div>
          <div className="meta-item">
            <dt>주소</dt>
            <dd>{address ?? "-"}</dd>
          </div>
        </dl>
        <button onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="detail-panel-body">
        {imageMap === null && <p className="status-text">이미지 정보를 불러오는 중…</p>}
        {imageMap !== null && !imageUrl && (
          <p className="status-text">이 지점의 이미지가 아직 등록되지 않았습니다.</p>
        )}
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={`지점 ${point.pointId} 스트리트뷰`}
            className="detail-panel-image"
          />
        )}
      </div>

      <style jsx>{`
        .detail-panel {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: min(320px, 45vh);
          background: white;
          box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .detail-panel-header {
          display: flex;
          align-items: center;
          gap: 24px;
          padding: 12px 16px;
          border-bottom: 1px solid #e5e5e5;
          flex-shrink: 0;
        }
        .detail-panel-header h2 {
          font-size: 18px;
          flex-shrink: 0;
        }
        .detail-panel-header button {
          border: none;
          background: none;
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
          margin-left: auto;
          flex-shrink: 0;
        }
        .detail-panel-meta {
          display: flex;
          flex-direction: row;
          gap: 24px;
          font-size: 14px;
          overflow-x: auto;
        }
        .meta-item {
          display: flex;
          flex-direction: row;
          gap: 6px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .detail-panel-body {
          padding: 16px;
          display: flex;
          flex-direction: row;
          align-items: flex-start;
          flex: 1;
          min-height: 0;
          overflow-x: auto;
        }
        dt {
          color: #666;
          margin: 0;
        }
        dd {
          margin: 0;
          word-break: break-all;
        }
        .status-text {
          color: #666;
          font-size: 14px;
        }
        .detail-panel-image {
          height: 100%;
          max-height: 100%;
          width: auto;
          max-width: 100%;
          border-radius: 4px;
          object-fit: contain;
        }
      `}</style>
    </aside>
  );
}
