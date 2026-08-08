"use client";

import { useEffect, useState } from "react";
import type { SelectedPoint } from "../types";

interface Props {
  point: SelectedPoint;
  onClose: () => void;
}

export default function PointDetailPanel({ point, onClose }: Props) {
  const [imageMap, setImageMap] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    fetch("/data/image_map.json")
      .then((res) => res.json())
      .then(setImageMap)
      .catch(() => setImageMap({}));
  }, []);

  const key = `${point.pointId}_${point.panoId}`;
  const fileId = imageMap?.[key];
  const imageUrl = fileId
    ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`
    : null;

  return (
    <aside className="detail-panel">
      <div className="detail-panel-header">
        <h2>지점 #{point.pointId}</h2>
        <button onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="detail-panel-body">
        <dl>
          <dt>Pano ID</dt>
          <dd>{point.panoId}</dd>
          <dt>위치</dt>
          <dd>
            {point.lat.toFixed(6)}, {point.lon.toFixed(6)}
          </dd>
        </dl>

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
          top: 0;
          right: 0;
          height: 100%;
          width: min(420px, 100%);
          background: white;
          box-shadow: -2px 0 12px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }
        .detail-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid #e5e5e5;
        }
        .detail-panel-header h2 {
          font-size: 18px;
        }
        .detail-panel-header button {
          border: none;
          background: none;
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
        }
        .detail-panel-body {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        dl {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 4px 12px;
          font-size: 14px;
        }
        dt {
          color: #666;
        }
        dd {
          word-break: break-all;
        }
        .status-text {
          color: #666;
          font-size: 14px;
        }
        .detail-panel-image {
          width: 100%;
          border-radius: 4px;
        }
      `}</style>
    </aside>
  );
}
