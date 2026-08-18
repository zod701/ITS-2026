"use client";

import { useEffect, useState } from "react";
import type { SelectedPoint } from "../types";
import { gradeFromDsi, versionById, type BevCrop, type BevLayout } from "../versions";

// build_point_detail.py 가 쓰는 축약 키. 실행마다 기록한 필드가 달라 전부 optional 이다.
interface PointDetail {
  ro?: number; rm?: number; rs?: number; ru?: number;          // 도로 차폐
  lv?: number; lf?: number; lb?: number; ds?: number;          // 가시거리 · 정지시거
  sl?: number; rc?: string; sf?: boolean | null;
  pf?: number; pfar?: number; pfwd?: number; pbwd?: number;    // 정합
  dyaw?: number; dx?: number; dy?: number; cl?: number;
  sm?: number; seam?: (number | null)[]; f3?: number;          // 보정
  v?: boolean;
}

// point_detail_<version>/<bucket>.json — build_point_detail.py 의 BUCKET_SIZE 와 같아야 한다.
const DETAIL_BUCKET_SIZE = 1000;

const SEAM_LABELS = ["좌|정", "정|우", "우|후", "후|좌"];

const fmt = (v: number | undefined, digits = 2, unit = "") =>
  v === undefined ? null : `${v.toFixed(digits)}${unit}`;

// BEV 결과 이미지 한 장에서 패널 하나만 잘라 보여준다. 컨테이너는 패널 비율로 두고, 이미지를
// 그 비율만큼 키워 원하는 패널이 창에 오도록 밀어 넣는다(배치가 버전마다 달라 CSS 에 고정하지
// 않고 좌표에서 계산한다).
function cropBoxStyle(crop: BevCrop): React.CSSProperties {
  return { aspectRatio: `${crop.w} / ${crop.h}` };
}

function cropImageStyle(crop: BevCrop, layout: BevLayout): React.CSSProperties {
  return {
    width: `${(layout.imageW / crop.w) * 100}%`,
    height: `${(layout.imageH / crop.h) * 100}%`,
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
  };
}

interface Props {
  point: SelectedPoint;
  /** 03 실행 버전 (versions.ts). 범례에서 고르며 BEV 이미지와 DSI 값이 함께 바뀐다. */
  version: string;
  onClose: () => void;
}

export default function PointDetailPanel({ point, version, onClose }: Props) {
  const [imageMap, setImageMap] = useState<Record<string, string> | null>(null);
  const [segMap, setSegMap] = useState<Record<string, string> | null>(null);
  const [depthMap, setDepthMap] = useState<Record<string, string> | null>(null);
  const [bevMaps, setBevMaps] = useState<Record<string, Record<string, string>>>({});
  const [addressMap, setAddressMap] = useState<Record<string, string> | null>(null);
  const [dsiMaps, setDsiMaps] = useState<Record<string, Record<string, { dsi: number }>>>({});
  // `<version>/<bucket>` -> 그 조각의 지점 상세. 조각 단위로만 받아 둔다.
  const [detailBuckets, setDetailBuckets] = useState<Record<string, Record<string, PointDetail>>>(
    {}
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

  // 버전별 맵은 장당 2MB대라 고른 버전만 받아 두고 재사용한다(받아둔 버전은 다시 받지 않음).
  useEffect(() => {
    if (bevMaps[version]) return;
    let cancelled = false;
    fetch(`/data/bev_map_${version}.json`)
      .then((res) => res.json())
      .then((map) => {
        if (!cancelled) setBevMaps((prev) => ({ ...prev, [version]: map }));
      })
      .catch(() => {
        if (!cancelled) setBevMaps((prev) => ({ ...prev, [version]: {} }));
      });
    return () => {
      cancelled = true;
    };
  }, [version, bevMaps]);

  useEffect(() => {
    if (dsiMaps[version]) return;
    let cancelled = false;
    fetch(`/data/dsi_map_${version}.json`)
      .then((res) => res.json())
      .then((map) => {
        if (!cancelled) setDsiMaps((prev) => ({ ...prev, [version]: map }));
      })
      .catch(() => {
        if (!cancelled) setDsiMaps((prev) => ({ ...prev, [version]: {} }));
      });
    return () => {
      cancelled = true;
    };
  }, [version, dsiMaps]);

  // 지점 상세는 전량이 10MB대라 point_id 구간 단위로 쪼개 필요한 조각만 받는다.
  // 상세를 만들지 않은 버전(260811)은 404 가 나므로 빈 객체로 두고 절 자체를 숨긴다.
  const detailBucket = `${version}/${Math.floor(Number(point.pointId) / DETAIL_BUCKET_SIZE)}`;
  useEffect(() => {
    if (detailBuckets[detailBucket]) return;
    let cancelled = false;
    fetch(`/data/point_detail_${detailBucket}.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((map) => {
        if (!cancelled) setDetailBuckets((prev) => ({ ...prev, [detailBucket]: map }));
      })
      .catch(() => {
        if (!cancelled) setDetailBuckets((prev) => ({ ...prev, [detailBucket]: {} }));
      });
    return () => {
      cancelled = true;
    };
  }, [detailBucket, detailBuckets]);

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
  const bevMap = bevMaps[version];
  const bevFileId = bevMap?.[key];
  const bevImageUrl = bevFileId
    ? `https://drive.google.com/thumbnail?id=${bevFileId}&sz=w1600`
    : null;
  const address = addressMap?.[point.panoId];
  const dsiMap = dsiMaps[version];
  const dsiRecord = dsiMap?.[key];

  const GRADE_COLORS: Record<string, string> = {
    Safe: "#22c55e",
    Caution: "#eab308",
    "High-risk": "#ef4444",
  };

  // dsi_map_*.json에 저장된 grade(구 임계값 Safe<1.0/Caution<1.8 기준)는 매칭 테이블
  // 원본 그대로 두고, 배지 표시에는 지점 단위 DSI 분포의 경계값을 쓴다. 지도 도로 색상
  // (MapView.tsx)의 도로 단위 경계값과는 분포가 달라 버전마다 값이 따로 있다(versions.ts).
  const { pointTerciles, bevLayout } = versionById(version);
  const detail = detailBuckets[detailBucket]?.[key];

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
                      style={{
                        background: GRADE_COLORS[gradeFromDsi(dsiRecord.dsi, pointTerciles)],
                      }}
                    >
                      {gradeFromDsi(dsiRecord.dsi, pointTerciles)}
                    </span>
                  </>
                ) : dsiMap === undefined ? (
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

          {/* BEV 이미지 제목에 찍히는 계측·품질 지표. 이미지에는 최악 이음매만 나오지만
              여기서는 네 이음매를 모두 보여준다. 상세를 만들지 않은 버전에서는 절을 숨긴다. */}
          {detail && (
            <dl className="detail-panel-metrics">
              <div className="metric-group">
                <div className="metric-heading">계측</div>
                <div className="metric-row">
                  <dt>도로 차폐</dt>
                  <dd>
                    {detail.ro === undefined ? "-" : `${(detail.ro * 100).toFixed(1)}%`}
                    {detail.rm !== undefined && detail.rs !== undefined && (
                      <span className="metric-sub">
                        {" "}
                        {detail.rs.toFixed(0)}m 중 {detail.rm.toFixed(0)}m
                      </span>
                    )}
                    {detail.ru !== undefined && (
                      <span className="metric-sub"> · 차량 뒤 제외 {(detail.ru * 100).toFixed(1)}%</span>
                    )}
                  </dd>
                </div>
                <div className="metric-row">
                  <dt>가시거리</dt>
                  <dd>
                    {fmt(detail.lv, 1, "m") ?? "-"}
                    <span className="metric-sub">
                      {" "}
                      vs 정지시거 {fmt(detail.ds, 1, "m") ?? "-"}
                      {detail.sl !== undefined && ` · ${detail.sl.toFixed(0)}km/h`}
                      {detail.rc !== undefined && ` · 등급 ${detail.rc}`}
                    </span>
                  </dd>
                </div>
                {(detail.lf !== undefined || detail.lb !== undefined) && (
                  <div className="metric-row">
                    <dt>전방 / 후방</dt>
                    <dd>
                      {fmt(detail.lf, 1, "m") ?? "-"} / {fmt(detail.lb, 1, "m") ?? "-"}
                      {detail.sf !== undefined && (
                        <span className="metric-sub">
                          {" "}
                          · 시야 {detail.sf === null ? "판정 불가" : detail.sf ? "미확보" : "확보"}
                        </span>
                      )}
                    </dd>
                  </div>
                )}
              </div>

              <div className="metric-group">
                <div className="metric-heading">도로망 정합</div>
                <div className="metric-row">
                  <dt>fit</dt>
                  <dd>
                    {fmt(detail.pf) ?? "-"}
                    {detail.pfar !== undefined && (
                      <span className="metric-sub">
                        {" "}
                        원거리 {fmt(detail.pfar)} · 전방 {fmt(detail.pfwd)} · 후방 {fmt(detail.pbwd)}
                      </span>
                    )}
                  </dd>
                </div>
                <div className="metric-row">
                  <dt>보정량</dt>
                  <dd>
                    {detail.dyaw === undefined ? "-" : `dyaw ${detail.dyaw > 0 ? "+" : ""}${detail.dyaw}°`}
                    {detail.dx !== undefined && detail.dy !== undefined && (
                      <span className="metric-sub">
                        {" "}
                        · dxy ({detail.dx > 0 ? "+" : ""}
                        {detail.dx}, {detail.dy > 0 ? "+" : ""}
                        {detail.dy})m
                      </span>
                    )}
                    {detail.cl !== undefined && (
                      <span className="metric-sub"> · 탐색 한계 {detail.cl}/3</span>
                    )}
                  </dd>
                </div>
              </div>

              <div className="metric-group">
                <div className="metric-heading">보정 품질</div>
                <div className="metric-row">
                  <dt>이음매</dt>
                  <dd>
                    {detail.seam ? (
                      <span className="seam-list">
                        {detail.seam.map((v, i) => (
                          <span key={SEAM_LABELS[i]} className="seam-item">
                            {SEAM_LABELS[i]} {v === null ? "-" : v.toFixed(3)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <>
                        {fmt(detail.sm, 3) ?? "-"}
                        <span className="metric-sub"> (중앙값만 기록된 실행)</span>
                      </>
                    )}
                  </dd>
                </div>
                <div className="metric-row">
                  <dt>지면 보이는 면</dt>
                  <dd>
                    {detail.f3 === undefined ? "-" : `${detail.f3} / 4`}
                    {detail.v !== undefined && (
                      <span className="metric-sub"> · {detail.v ? "판정 가능" : "판정 불가"}</span>
                    )}
                  </dd>
                </div>
              </div>
            </dl>
          )}
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
          <div className="bev-group">
            {bevMap === undefined && <p className="status-text">BEV 결과를 불러오는 중…</p>}
            {bevMap !== undefined && !bevImageUrl && (
              <p className="status-text">이 버전에는 해당 지점의 BEV 결과가 없습니다.</p>
            )}
            {bevImageUrl && (
              <div className="bev-crops-row">
                <div className="bev-occupancy-crop" style={cropBoxStyle(bevLayout.occupancy)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={bevImageUrl}
                    alt={`지점 ${point.pointId} BEV 점유 격자 (${version})`}
                    className="bev-crop-image"
                    style={cropImageStyle(bevLayout.occupancy, bevLayout)}
                  />
                </div>
                <div className="bev-shadow-col">
                  <div className="bev-shadow-crop" style={cropBoxStyle(bevLayout.shadow)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={bevImageUrl}
                      alt={`지점 ${point.pointId} BEV 음영(건물) (${version})`}
                      className="bev-crop-image"
                      style={cropImageStyle(bevLayout.shadow, bevLayout)}
                    />
                  </div>
                  <div className="bev-shadow-crop" style={cropBoxStyle(bevLayout.shadowVeh)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={bevImageUrl}
                      alt={`지점 ${point.pointId} BEV 음영(차량 포함) (${version})`}
                      className="bev-crop-image"
                      style={cropImageStyle(bevLayout.shadowVeh, bevLayout)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
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
          width: 360px;
          background: var(--panel-meta-bg);
          border-radius: 8px;
          padding: 16px;
          /* 지표가 늘어 패널 높이를 넘길 수 있다. 사진 쪽을 밀지 않고 이 칸만 스크롤한다. */
          overflow-y: auto;
        }
        /* 지표 표: 라벨을 왼쪽에 고정폭으로 두고 값이 오른쪽에서 접힌다. 라벨/값을 세로로
           쌓는 위쪽 meta-item 과 달리, 항목이 많아 한 줄에 붙여야 훑어보기 쉽다. */
        .detail-panel-metrics {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 0;
          padding-top: 12px;
          border-top: 1px solid var(--border-color);
          font-size: 12px;
        }
        .metric-group {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .metric-heading {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 2px;
        }
        .metric-row {
          display: flex;
          gap: 8px;
          align-items: baseline;
        }
        .metric-row dt {
          flex: 0 0 84px;
          color: var(--text-muted);
        }
        .metric-row dd {
          margin: 0;
          word-break: keep-all;
        }
        .metric-sub {
          color: var(--text-muted);
        }
        .seam-list {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 2px 8px;
        }
        .seam-item {
          white-space: nowrap;
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
        /* BEV 영역: 로딩/부재 안내 + 크롭 3개(가로 배치). 버전 선택은 범례(MapLegend)에
           있고, 이 래퍼는 그 상태 문구와 크롭들을 묶기만 한다 - 크롭 자체의 치수 규칙은
           래퍼가 생기기 전과 같다. */
        .bev-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-shrink: 0;
        }
        .bev-crops-row {
          display: flex;
          flex-direction: row;
          align-items: flex-start;
          gap: 16px;
        }
        /* BEV 결과 이미지는 제목 3줄 + 패널 3개(occupancy / shadow-buildings /
           shadow+vehicles)로 되어 있다. 세로 3단이던 배치가 가로 3패널로 바뀌었고 앞으로도
           바뀔 수 있으므로, 패널 위치·비율은 versions.ts 의 실측 좌표에서 계산해 인라인
           스타일로 넣는다. 여기 남는 것은 어느 배치에서도 같은 규칙(크기·잘라내기)뿐이다:
           occupancy 는 크게(왼쪽 사진들과 나란히), 두 shadow 는 작게 그 옆에 세로로. */
        .bev-occupancy-crop {
          position: relative;
          width: 520px;
          overflow: hidden;
          border-radius: 4px;
          flex-shrink: 0;
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
          overflow: hidden;
          border-radius: 4px;
          flex-shrink: 0;
        }
        .bev-crop-image {
          display: block;
          position: absolute;
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
            /* 모바일은 패널 전체가 세로 스크롤이라, 이 칸이 또 스크롤되면 손가락이 갇힌다. */
            overflow-y: visible;
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
          .bev-group {
            align-self: stretch;
          }
          .bev-crops-row {
            flex-direction: column;
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
