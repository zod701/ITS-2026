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
  const [depthMap, setDepthMap] = useState<Record<string, string> | null>(null);
  const [bevMap, setBevMap] = useState<Record<string, string> | null>(null);
  const [addressMap, setAddressMap] = useState<Record<string, string> | null>(null);
  const [dsiMap, setDsiMap] = useState<Record<string, { dsi: number; grade: string }> | null>(
    null
  );
  const [linkCopied, setLinkCopied] = useState(false);
  const [panoIdCopied, setPanoIdCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
    fetch("/data/depth_map.json")
      .then((res) => res.json())
      .then(setDepthMap)
      .catch(() => setDepthMap({}));
  }, []);

  useEffect(() => {
    fetch("/data/bev_map.json")
      .then((res) => res.json())
      .then(setBevMap)
      .catch(() => setBevMap({}));
  }, []);

  useEffect(() => {
    fetch("/data/dsi_map.json")
      .then((res) => res.json())
      .then(setDsiMap)
      .catch(() => setDsiMap({}));
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
  const depthFileId = depthMap?.[key];
  const depthImageUrl = depthFileId
    ? `https://drive.google.com/thumbnail?id=${depthFileId}&sz=w1600`
    : null;
  const bevFileId = bevMap?.[key];
  const bevImageUrl = bevFileId
    ? `https://drive.google.com/thumbnail?id=${bevFileId}&sz=w1600`
    : null;
  const address = addressMap?.[point.panoId];
  const dsiRecord = dsiMap?.[key];

  const GRADE_COLORS: Record<string, string> = {
    Safe: "#22c55e",
    Caution: "#eab308",
    "High-risk": "#ef4444",
  };

  // dsi_map.json에 저장된 grade(구 임계값 Safe<1.0/Caution<1.8 기준)는 매칭 테이블
  // 원본 그대로 두고, 배지 표시에는 지점 단위 DSI 분포의 3등분(tercile) 경계값을 쓴다.
  // 지도 도로 색상(MapView.tsx)의 도로 단위 경계값(2.36/3.57)과는 분포가 달라 별도 값.
  const POINT_DSI_TERCILES: [number, number] = [1.92, 3.14];
  const gradeFromDsi = (dsi: number): string => {
    if (dsi < POINT_DSI_TERCILES[0]) return "Safe";
    if (dsi < POINT_DSI_TERCILES[1]) return "Caution";
    return "High-risk";
  };

  const handleCopyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("point", point.pointId);
    await navigator.clipboard.writeText(url.toString());
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  };

  const handleCopyPanoId = async () => {
    await navigator.clipboard.writeText(point.panoId);
    setPanoIdCopied(true);
    setTimeout(() => setPanoIdCopied(false), 1500);
  };

  return (
    <aside className="detail-panel">
      <button className="close-button" onClick={onClose} aria-label="닫기">
        ✕
      </button>
      <div className="detail-panel-body">
        <div className="detail-panel-meta-col">
          <div className="meta-title-row">
            <h2>지점 #{point.pointId}</h2>
            <button className="copy-link-button" onClick={handleCopyLink} title="이 지점 링크 복사">
              {linkCopied ? "복사됨 ✓" : "링크 복사"}
            </button>
          </div>
          <dl className="detail-panel-meta">
            <div className="meta-item">
              <dt>DSI</dt>
              <dd>
                {dsiRecord ? (
                  <>
                    {dsiRecord.dsi.toFixed(2)}{" "}
                    <span
                      className="dsi-grade-badge"
                      style={{ background: GRADE_COLORS[gradeFromDsi(dsiRecord.dsi)] }}
                    >
                      {gradeFromDsi(dsiRecord.dsi)}
                    </span>
                  </>
                ) : dsiMap === null ? (
                  "불러오는 중…"
                ) : (
                  "-"
                )}
              </dd>
            </div>
            <div className="meta-item">
              <dt>Pano ID</dt>
              <dd>
                {point.panoId}{" "}
                <button
                  className="copy-inline-button"
                  onClick={handleCopyPanoId}
                  title="Pano ID 복사"
                >
                  {panoIdCopied ? "복사됨 ✓" : "복사"}
                </button>{" "}
                <a
                  href={`https://map.naver.com/p?p=${point.panoId},0,0,80,Float`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="naver-map-link"
                >
                  네이버 지도에서 보기 ↗
                </a>
              </dd>
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
        </div>
        <div className="detail-panel-images-row">
          <div className="detail-panel-images-col">
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
            {depthImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={depthImageUrl}
                alt={`지점 ${point.pointId} 깊이 추정 결과`}
                className="detail-panel-image"
              />
            )}
          </div>
          {bevImageUrl && (
            <div className="bev-occupancy-crop">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bevImageUrl}
                alt={`지점 ${point.pointId} BEV 점유 격자`}
                className="bev-occupancy-crop-image"
              />
            </div>
          )}
          {bevImageUrl && (
            <div className="bev-shadow-col">
              <div className="bev-shadow-crop bev-shadow-crop-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bevImageUrl}
                  alt={`지점 ${point.pointId} BEV 음영(건물)`}
                  className="bev-shadow-crop-image bev-shadow-crop-image-1"
                />
              </div>
              <div className="bev-shadow-crop bev-shadow-crop-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bevImageUrl}
                  alt={`지점 ${point.pointId} BEV 음영(차량 포함)`}
                  className="bev-shadow-crop-image bev-shadow-crop-image-2"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .detail-panel {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: min(640px, 80vh);
          background: var(--panel-bg);
          color: var(--foreground);
          box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .close-button {
          position: absolute;
          top: 12px;
          right: 16px;
          border: none;
          background: none;
          color: var(--foreground);
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
          z-index: 1;
        }
        .detail-panel-meta-col {
          display: flex;
          flex-direction: column;
          gap: 12px;
          flex-shrink: 0;
          width: 330px;
          background: var(--panel-meta-bg);
          border-radius: 8px;
          padding: 16px;
        }
        .detail-panel-meta-col h2 {
          font-size: 18px;
        }
        .meta-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .copy-link-button {
          border: 1px solid var(--border-color);
          background: none;
          color: var(--text-muted);
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 999px;
          cursor: pointer;
          white-space: nowrap;
        }
        .copy-link-button:hover {
          color: var(--link-color);
          border-color: var(--link-color);
        }
        .copy-inline-button {
          display: inline-block;
          border: 1px solid var(--border-color);
          background: none;
          color: var(--text-muted);
          font-size: 11px;
          padding: 1px 7px;
          border-radius: 999px;
          cursor: pointer;
          white-space: nowrap;
        }
        .copy-inline-button:hover {
          color: var(--link-color);
          border-color: var(--link-color);
        }
        .detail-panel-meta {
          display: flex;
          flex-direction: column;
          gap: 12px;
          font-size: 14px;
        }
        .meta-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .dsi-grade-badge {
          display: inline-block;
          padding: 1px 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          color: #fff;
        }
        .naver-map-link {
          display: inline-block;
          color: var(--link-color);
          font-size: 12px;
          white-space: nowrap;
        }
        .naver-map-link:hover {
          text-decoration: underline;
        }
        .detail-panel-body {
          padding: 16px;
          display: flex;
          flex-direction: row;
          align-items: stretch;
          gap: 16px;
          flex: 1;
          min-height: 0;
          overflow: auto;
        }
        .detail-panel-images-row {
          display: flex;
          flex-direction: row;
          align-items: flex-start;
          align-self: flex-start;
          gap: 16px;
          flex: 1;
          min-width: 0;
        }
        .detail-panel-images-col {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 16px;
          flex: 1 1 0;
          min-width: 320px;
          max-width: 640px;
        }
        /* BEV 결과 이미지(649x2187)는 위에서부터 제목 텍스트 + 3개 정사각형에 가까운
           패널(occupancy / shadow-buildings / shadow+vehicles, 각 649x~625px)이 세로로
           이어져 있다. 패널별 위치를 실측(픽셀)해 세 조각으로 각각 크롭한다:
           occupancy는 크게(왼쪽 사진들과 나란히), 두 shadow 패널은 작게 그 옆에 세로로. */
        .bev-occupancy-crop {
          position: relative;
          width: 520px;
          aspect-ratio: 649 / 626;
          overflow: hidden;
          border-radius: 4px;
          flex-shrink: 0;
        }
        .bev-occupancy-crop-image {
          display: block;
          position: absolute;
          left: 0;
          top: -27.7955%;
          width: 100%;
          height: 349.361%;
        }
        .bev-shadow-col {
          display: flex;
          flex-direction: column;
          gap: 16px;
          width: 250px;
          flex-shrink: 0;
        }
        .bev-shadow-crop {
          position: relative;
          width: 250px;
          aspect-ratio: 649 / 625;
          overflow: hidden;
          border-radius: 4px;
          flex-shrink: 0;
        }
        .bev-shadow-crop-image {
          display: block;
          position: absolute;
          left: 0;
          width: 100%;
          height: 349.92%;
        }
        .bev-shadow-crop-image-1 {
          top: -137.92%;
        }
        .bev-shadow-crop-image-2 {
          top: -248%;
        }
        dt {
          color: var(--text-muted);
          margin: 0;
        }
        dd {
          margin: 0;
          word-break: break-all;
        }
        .status-text {
          color: var(--text-muted);
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
          padding-top: 25%; /* width(100%) 기준 4:1 비율 */
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

        /* 모바일: 데스크탑의 가로 배치(메타 | 사진들 | BEV)는 폭이 부족하므로 전부
           세로로 쌓고, 고정 px 폭(330/520/250)을 화면 폭 기준으로 바꾼다.
           데스크탑 규칙은 이 블록 밖에 그대로 두어 전혀 영향받지 않는다. */
        @media (max-width: 768px) {
          .detail-panel {
            height: 85dvh;
          }
          .detail-panel-body {
            flex-direction: column;
            padding: 12px;
            gap: 12px;
          }
          .detail-panel-meta-col {
            width: auto;
            padding: 12px;
          }
          .detail-panel-images-row {
            flex-direction: column;
            align-self: stretch;
            gap: 12px;
          }
          .detail-panel-images-col {
            min-width: 0;
            max-width: none;
            gap: 12px;
          }
          .bev-occupancy-crop {
            width: 100%;
          }
          /* 두 shadow 패널은 세로로 쌓으면 너무 길어지므로 가로로 반씩 나눈다. */
          .bev-shadow-col {
            flex-direction: row;
            width: 100%;
            gap: 12px;
          }
          .bev-shadow-crop {
            width: auto;
            flex: 1 1 0;
            min-width: 0;
          }
        }
      `}</style>
    </aside>
  );
}
