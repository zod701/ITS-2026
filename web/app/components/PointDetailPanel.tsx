"use client";

import { useEffect, useState } from "react";
import type { SelectedPoint } from "../types";

interface Props {
  point: SelectedPoint;
  onClose: () => void;
}

export default function PointDetailPanel({ point, onClose }: Props) {
  const [imageMap, setImageMap] = useState<Record<string, string> | null>(null);
  const [segMap, setSegMap] = useState<Record<string, string> | null>(null);
  const [addressMap, setAddressMap] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    fetch("/data/image_map.json")
      .then((res) => res.json())
      .then(setImageMap)
      .catch(() => setImageMap({}));
  }, []);

  useEffect(() => {
    fetch("/data/seg_map.json")
      .then((res) => res.json())
      .then(setSegMap)
      .catch(() => setSegMap({}));
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
  const segFileId = segMap?.[key];
  const segImageUrl = segFileId
    ? `https://drive.google.com/thumbnail?id=${segFileId}&sz=w1600`
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
          <div className="pano-crop">
            <div className="pano-crop-inner">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={`지점 ${point.pointId} 스트리트뷰`}
                className="pano-crop-image"
              />
            </div>
          </div>
        )}
        {segImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={segImageUrl}
            alt={`지점 ${point.pointId} 세그멘테이션 결과`}
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
          height: min(640px, 80vh);
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
          flex-direction: column;
          align-items: stretch;
          gap: 16px;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
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
          width: 100%;
          height: auto;
          border-radius: 4px;
          object-fit: contain;
        }
        .pano-crop {
          /* 원본은 좌/정면/우/후/아래/위 6분할 가로 스트립. 오른쪽 2/6(아래/위)을
             화면에서만 잘라내 4/6(좌/정면/우/후)만 보여준다 (원본 파일은 그대로 둠).
             aspect-ratio 대신 padding-top 비율 트릭을 써서 flex 자식으로 있어도
             높이가 찌그러지지 않고 항상 너비의 1/4(4:1)로 고정되게 한다. */
          position: relative;
          width: 100%;
          padding-top: 25%; /* 4:1 비율 */
          overflow: hidden;
          border-radius: 4px;
          flex-shrink: 0;
        }
        .pano-crop-inner {
          position: absolute;
          inset: 0;
          overflow: hidden;
        }
        .pano-crop-image {
          display: block;
          position: absolute;
          left: 0;
          top: 0;
          width: 150%; /* 6/4 = 1.5배로 확대해 4칸 폭이 컨테이너 전체를 채우게 함 */
          height: 100%;
        }
      `}</style>
    </aside>
  );
}
