"use client";

import { useEffect, useMemo, useState } from "react";
import type { SelectedPoint } from "../types";
import {
  combineAlpha,
  gradeFromDsi,
  gridTerciles,
  tercilesOf,
  versionById,
  type BevCrop,
  type BevLayout,
  type TercileGrid,
} from "../versions";

// build_point_detail.py 가 쓰는 축약 키. 실행마다 기록한 필드가 달라 전부 optional 이다.
interface PointDetail {
  ro?: number; rm?: number; rs?: number; ru?: number;          // 도로 차폐
  rma?: number; rda?: number;                                  // D-06 이후: 길이 대신 면적
  lv?: number; lf?: number; lb?: number; ds?: number;          // 가시거리 · 정지시거
  sl?: number; rc?: string; sf?: boolean | null;
  pf?: number; pfar?: number; pfwd?: number; pbwd?: number;    // 정합
  dyaw?: number; dx?: number; dy?: number; cl?: number;
  sm?: number; seam?: (number | null)[]; f3?: number;          // 보정
  // valid 와 그것을 이루는 게이트. 어느 게이트가 막았는지에 따라 그 줄을 빨갛게 칠한다.
  // 구성은 실행마다 다르다 — 260819 부터 pc 가 빠지고 om(+cof) 이 들어왔다.
  v?: boolean; cv?: boolean; rk?: boolean; pc?: boolean; om?: boolean; cof?: number;
  cf?: number;   // 신뢰도 0/1/2 — 판정 여부와 무관하다(D-24)
}

// 조각 번호 = point_id / 이 값 — build_point_detail.py 의 BUCKET_SIZE 와 같아야 한다.
const DETAIL_BUCKET_SIZE = 1000;

const SEAM_LABELS = ["좌|정", "정|우", "우|후", "후|좌"];

// 신뢰도(0/1/2)는 판정 여부와 무관하지만, 낮을수록 위험을 높게 말하는 경향이 있어(D-24)
// DSI 옆에 함께 둔다. 색은 지도 등급 팔레트를 그대로 쓴다.
const CONFIDENCE_COLORS = ["#ef4444", "#eab308", "var(--text-muted)"];

// 실패 방향이 한쪽(과대보고)이라 값을 버리지 않고 등급만 남긴다 — 읽는 사람이 그 방향을
// 알아야 해석이 되므로 툴팁으로 붙인다. 수치는 method.md D-24 의 실측(33,098장)이다.
const CONFIDENCE_TIPS = [
  "신뢰도 낮음 — 값은 쓰되 보수적으로 읽으세요.\n"
    + "카메라가 도로에서 2m 넘게 벗어났거나, 이음매가 0.30 이상 어긋났거나, 근거리 정합이 "
    + "0.30 미만인 경우입니다.\n"
    + "실측상 차폐를 평균 +0.020 과대평가합니다 (전체의 13%).",
  "신뢰도 보통 — 대체로 신뢰할 수 있습니다.\n"
    + "카메라가 도로 중심선에서 조금 벗어났거나 이음매 잔차가 0.15 이상입니다.\n"
    + "실측상 차폐를 평균 +0.005 과대평가합니다 (전체의 28%).",
  "신뢰도 높음 — 그대로 신뢰할 수 있습니다.\n"
    + "카메라가 도로 위에 있고 이음매·근거리 정합이 모두 양호합니다 (전체의 58%).",
];

// 지표 설명. 값이 무엇을 재는지와 어느 쪽이 좋은지를 적는다 — 숫자만 보고는 방향
// (클수록 나쁨/좋음)을 알 수 없어서다.
const METRIC_TIPS = {
  occluded:
    "40m 이내 도달 가능한 도로 중 시야가 닿지 않는 길이의 비율입니다.\n"
    + "'차량 뒤 제외'는 차량을 장애물로 인식하지 않았을 때의 차폐율입니다.",
  lvis:
    "가시거리로 정면·후면으로 시선이 처음 막히는 거리(둘의 최솟값)입니다. 40m의 계측 상한값을 가집니다.\n"
    + "정지시거는 도로 유형에 따른 제한속도에서 계산된 반응 1초 + 제동으로 필요한 거리입니다.\n"
    + "가시거리 < 정지시거 이면 즉시 대응이 불가능한 구간으로 판단합니다.",
  lvisDir:
    "전방·후방 각각의 가시거리입니다. 한쪽만 짧으면 교차로·굽은 길처럼 한 방향만 막힌 경우입니다.\n"
    + "'시야'는 두 값과 정지시거를 비교한 판정이며, 차량 뒤가 불확실하면 '판정 불가'가 됩니다.",
  fit:
    "파노라마 사진만으로 복원한 도로면이 GIS 실폭도로와 얼마나 겹치는지를 나타낸 정합 정확도입니다. (0~1, 클수록 좋음)\n",
  pose:
    "정합을 맞추려고 카메라 위치·방위를 얼마나 움직였는지를 나타냅니다.\n"
    + "dyaw 는 회전각(도)으로 -2 상수 고정, dxy 는 평행이동(m)한 거리입니다.\n"
    + "'탐색 한계'는 보정값이 탐색 범위(-3m ~ +3m) 끝에 붙은 개수로, 많으면 정합이 수렴하지 못함을 나타냅니다.",
  onRoad:
    "카메라가 GIS 도로망 위에 있는가를 의미합니다. 5m 넘게 벗어나면 무엇을 쟀는지 알 수 없어 판정하지 않습니다.\n"
    + "사유지·주차장처럼 도로망에 없는 길에서 찍힌 파노라마가 여기서 제외되기 쉽습니다.",
  seam:
    "Depth map의 네 방향 사진이 맞닿는 이음매에서 깊이가 어긋난 정도를 의미합니다. (작을수록 좋음)\n"
    + "하나라도 크면 그 방향의 거리 환산을 믿기 어렵다고 판단합니다. 0.30 이상이면 신뢰도가 낮음으로 내려갑니다.",
  faces:
    "네 방향 중 지면이 충분히(300px 이상) 보인 면의 수를 의미합니다.\n"
    + "거리 환산은 바닥을 기준으로 풀기 때문에, 2면 미만이면 환산이 성립하지 않아 판정 불가가 됩니다.",
};

// 정적·동적 성분은 각각 0~1 로 정규화된 값이고, 화면의 DSI 는 α 로 섞은 결과다.
// 정적 신뢰도(confidence)와 성격이 다르다 — 저쪽은 BEV 계측 품질이고 이쪽은 **보간 근거의
// 질**이다. 통행량은 계측 교차로 75개소에서만 관측되고 나머지는 IDW 근사이므로,
// 근거가 얼마나 가까운지(d_near)와 참조한 계측값들이 서로 얼마나 어긋나는지(disp)를 본다.
const DYN_CONFIDENCE_TIPS = [
  "동적 항 미적용 — 가장 가까운 계측 교차로가 1km 넘게 떨어져 있어 통행량을 추정하지 않았습니다. 이 지점의 값은 정적 항 그대로입니다.",
  "보간 근거 보통 — 계측 교차로가 멀거나, 참조한 계측값들이 서로 크게 어긋납니다. 대부분의 지점이 여기 해당합니다.",
  "보간 근거 양호 — 계측 교차로가 300m 이내이고, 참조한 계측값들이 2.5배 이내로 모여 있습니다. 전체의 약 18%입니다.",
];

const DSI_PARTS_TIP =
  "위의 도로 위험도를 이루는 두 성분입니다. 각각 0~1 로 정규화돼 있습니다.\n"
  + "정적 = 시야 차폐로 계산한 값, 동적 = 통행량·주정차 대리로 계산한 값입니다.\n"
  + "도로 위험도 = 정적 × α + 동적 × (1−α) 이며, α 는 상단 패널의 슬라이더로 조절합니다.";

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
  /** 정적:동적 비중. 성분이 실린 판에서는 이 값으로 DSI 를 다시 합성한다. */
  alpha: number;
  onClose: () => void;
}

export default function PointDetailPanel({ point, version, alpha, onClose }: Props) {
  // BEV 이미지·지점 상세는 파이프라인 산출물이라, DSI 값만 다시 만든 버전은 원판 것을
  // 그대로 쓴다 (versions.ts 의 assetsFrom). DSI 맵은 버전 자기 것을 쓴다.
  const assetVersion = versionById(version).assetsFrom ?? version;
  const [imageMap, setImageMap] = useState<Record<string, string> | null>(null);
  const [segMap, setSegMap] = useState<Record<string, string> | null>(null);
  const [depthMap, setDepthMap] = useState<Record<string, string> | null>(null);
  const [bevMaps, setBevMaps] = useState<Record<string, Record<string, string>>>({});
  const [addressMap, setAddressMap] = useState<Record<string, string> | null>(null);
  // 지도 도로 색과 같은 잣대를 쓰도록 기준판 임계 격자를 받아 둔다 (D-24).
  const [tercileGrid, setTercileGrid] = useState<TercileGrid | null>(null);
  const [dsiMaps, setDsiMaps] = useState<
    Record<string, Record<string, { dsi: number; s?: number; d?: number; dc?: number }>>
  >({});
  // `<version>/<bucket>` -> 그 조각의 지점 상세. 조각 단위로만 받아 둔다.
  const [detailBuckets, setDetailBuckets] = useState<Record<string, Record<string, PointDetail>>>(
    {}
  );
  // 브라우저 기본 툴팁 대신 직접 그린다. 패널과 메타 칸이 모두 overflow:auto 라 absolute 로
  // 띄우면 잘리므로, 화면 좌표에 fixed 로 띄우고 위치는 트리거의 사각형에서 계산한다.
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(
    null
  );
  const showTip = (e: React.MouseEvent | React.FocusEvent, text: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // 아래 공간이 모자라면 위로 띄운다.
    const above = window.innerHeight - r.bottom < 160;
    setTip({ text, x: Math.min(r.left, window.innerWidth - 336), y: above ? r.top : r.bottom, above });
  };
  const tipProps = (text: string) => ({
    className: "has-tip",
    tabIndex: 0,
    onMouseEnter: (e: React.MouseEvent) => showTip(e, text),
    onFocus: (e: React.FocusEvent) => showTip(e, text),
    onMouseLeave: () => setTip(null),
    onBlur: () => setTip(null),
  });

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
    if (bevMaps[assetVersion]) return;
    let cancelled = false;
    fetch(`/data/bev_map_${assetVersion}.json`)
      .then((res) => res.json())
      .then((map) => {
        if (!cancelled) setBevMaps((prev) => ({ ...prev, [assetVersion]: map }));
      })
      .catch(() => {
        if (!cancelled) setBevMaps((prev) => ({ ...prev, [assetVersion]: {} }));
      });
    return () => {
      cancelled = true;
    };
  }, [assetVersion, bevMaps]);

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

  // 지점 상세는 전량이 버전당 12MB라 저장소에 두지 않고 BEV 이미지와 같은 Drive 폴더에
  // 둔다. /api/point-detail 이 조각 하나만 서버에서 받아 CDN 캐시로 넘겨준다.
  // 상세를 올리지 않은 버전(260811 등)은 404 가 나므로 빈 객체로 두고 절 자체를 숨긴다.
  const detailBucket = `${assetVersion}/${Math.floor(Number(point.pointId) / DETAIL_BUCKET_SIZE)}`;
  useEffect(() => {
    if (detailBuckets[detailBucket]) return;
    let cancelled = false;
    fetch(`/api/point-detail/${detailBucket}`)
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
    fetch("/data/terciles_grid.json")
      .then((res) => res.json())
      .then(setTercileGrid)
      .catch(() => setTercileGrid(null));
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
  const bevMap = bevMaps[assetVersion];
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
  const { pointTerciles, bevLayout, poseAxes } = versionById(version);
  // α 조절판은 성분(s·d)에서 DSI 를 다시 합성한다. 임계도 그 α 의 분포에서 다시 뽑아야
  // 지도 도로 색과 배지가 어긋나지 않는다. 성분이 없는 판은 파일 값과 고정 임계를 쓴다.
  const dsiValue =
    dsiRecord === undefined
      ? undefined
      : dsiRecord.s !== undefined && dsiRecord.d !== undefined
        ? combineAlpha(dsiRecord.s, dsiRecord.d, alpha)
        : dsiRecord.dsi;
  const effTerciles = useMemo(() => {
    const fromGrid = gridTerciles(tercileGrid, "point", alpha);
    if (fromGrid) return fromGrid;
    const recs = dsiMap ? Object.values(dsiMap) : [];
    if (recs.length === 0 || recs[0].s === undefined) return pointTerciles;
    return tercilesOf(recs.map((r) => combineAlpha(r.s as number, r.d as number, alpha)));
  }, [tercileGrid, dsiMap, alpha, pointTerciles]);
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
              <dt>도로 위험도</dt>
              <dd>
                {/* 판정 불가면 dsi_map 에 값이 아예 없다. 빈칸 대신 여기서 알리고,
                    원인이 된 지표 줄은 아래에서 빨갛게 표시된다. */}
                {detail?.v === false ? (
                  <span className="dsi-grade-badge invalid-badge">판정 불가</span>
                ) : dsiValue !== undefined ? (
                  <>
                    {dsiValue.toFixed(2)}{" "}
                    <span
                      className="dsi-grade-badge"
                      style={{
                        background: GRADE_COLORS[gradeFromDsi(dsiValue, effTerciles)],
                      }}
                    >
                      {gradeFromDsi(dsiValue, effTerciles)}
                    </span>
                  </>
                ) : dsiMap === undefined ? (
                  "불러오는 중…"
                ) : (
                  "-"
                )}
{/* 성분이 실린 판에서는 신뢰도를 각 성분 옆으로 내린다 — 결합값 옆에 두면
                    정적 계측 품질이 결합 지수 전체의 신뢰도처럼 읽힌다. */}
                {detail?.cf !== undefined && dsiRecord?.s === undefined && (
                  <span
                    {...tipProps(CONFIDENCE_TIPS[detail.cf])}
                    className="confidence-note has-tip"
                    style={{ color: CONFIDENCE_COLORS[detail.cf] }}
                  >
                    {" "}
                    신뢰도 {detail.cf}/2
                  </span>
                )}
                {/* 동적 지수를 결합한 판(260820_2~)은 성분이 실려 있다. 합성값만 보면
                    슬라이더를 움직였을 때 무엇이 움직였는지 알 수 없어 둘을 함께 적는다. */}
                {dsiRecord?.s !== undefined && dsiRecord.d !== undefined && (
                  <div {...tipProps(DSI_PARTS_TIP)} className="dsi-parts has-tip">
                    {/* 신뢰도는 각 성분 **아래**로 내린다 — 식 중간에 끼면 곱셈 항처럼
                        읽혀 수식이 안 읽힌다. 두 축은 재는 것이 다르다: 계측은 BEV
                        측정 품질, 보간은 통행량 근거의 질이다. */}
                    <span className="dsi-part">
                      <span className="dsi-part-val">
                        정적 {dsiRecord.s.toFixed(3)}
                        <span className="dsi-parts-op"> × {alpha.toFixed(2)}</span>
                      </span>
                      {detail?.cf !== undefined && (
                        <span
                          {...tipProps(CONFIDENCE_TIPS[detail.cf])}
                          className="part-conf has-tip"
                          style={{ color: CONFIDENCE_COLORS[detail.cf] }}
                        >
                          계측 신뢰도 {detail.cf}/2
                        </span>
                      )}
                    </span>
                    <span className="dsi-parts-plus">+</span>
                    <span className="dsi-part">
                      <span className="dsi-part-val">
                        동적 {dsiRecord.d.toFixed(3)}
                        <span className="dsi-parts-op"> × {(1 - alpha).toFixed(2)}</span>
                      </span>
                      {dsiRecord.dc !== undefined && (
                        <span
                          {...tipProps(DYN_CONFIDENCE_TIPS[dsiRecord.dc])}
                          className="part-conf has-tip"
                          style={{ color: CONFIDENCE_COLORS[dsiRecord.dc] }}
                        >
                          보간 신뢰도 {dsiRecord.dc}/2
                        </span>
                      )}
                    </span>
                  </div>
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
                  <dt {...tipProps(METRIC_TIPS.occluded)}>도로 차폐</dt>
                  <dd className={detail.rk === false ? "metric-cause" : undefined}>
                    {detail.ro === undefined ? "-" : `${(detail.ro * 100).toFixed(1)}%`}
                    {/* D-06 으로 도메인이 중심선 길이(rs/rm) -> 도로면 면적(rda/rma)
                        으로 바뀌었다. 옛 판도 계속 서빙하므로 있는 쪽을 쓴다. */}
                    {detail.rda !== undefined && detail.rma !== undefined ? (
                      <span className="metric-sub">
                        {" "}
                        {detail.rda.toFixed(0)}m² 중 {detail.rma.toFixed(0)}m²
                      </span>
                    ) : detail.rm !== undefined && detail.rs !== undefined ? (
                      <span className="metric-sub">
                        {" "}
                        {detail.rs.toFixed(0)}m 중 {detail.rm.toFixed(0)}m
                      </span>
                    ) : null}
                    {detail.ru !== undefined && (
                      <span className="metric-sub">
                        {" "}
                        · 차량 뒤 제외 {(detail.ru * 100).toFixed(1)}%
                        {detail.rk === false && " (절반 초과)"}
                      </span>
                    )}
                  </dd>
                </div>
                <div className="metric-row">
                  <dt {...tipProps(METRIC_TIPS.lvis)}>가시거리</dt>
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
                    <dt {...tipProps(METRIC_TIPS.lvisDir)}>전방 / 후방</dt>
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
                  <dt {...tipProps(METRIC_TIPS.fit)}>fit</dt>
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
                  <dt {...tipProps(METRIC_TIPS.pose)}>보정량</dt>
                  <dd className={detail.pc === false ? "metric-cause" : undefined}>
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
                      <span className="metric-sub">
                        {" "}
                        · 탐색 한계 {detail.cl}/{poseAxes}
                        {detail.pc === false && " (정합 미수렴)"}
                      </span>
                    )}
                  </dd>
                </div>
                {/* 260819 부터의 게이트: 카메라가 GIS 도로망 위에 있는가. 이 실행에서 판정
                    불가의 대부분이 여기서 걸린다(도로망에 없는 길에서 찍힌 파노라마). */}
                {detail.om !== undefined && (
                  <div className="metric-row">
                    <dt {...tipProps(METRIC_TIPS.onRoad)}>도로망 위</dt>
                    <dd className={detail.om === false ? "metric-cause" : undefined}>
                      {detail.om ? "예" : "아니오"}
                      {detail.cof !== undefined && (
                        <span className="metric-sub"> · 도로에서 {detail.cof.toFixed(1)}m</span>
                      )}
                    </dd>
                  </div>
                )}
              </div>

              <div className="metric-group">
                <div className="metric-heading">보정 품질</div>
                <div className="metric-row">
                  <dt {...tipProps(METRIC_TIPS.seam)}>이음매</dt>
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
                  <dt {...tipProps(METRIC_TIPS.faces)}>지면 보이는 면</dt>
                  <dd className={detail.cv === false ? "metric-cause" : undefined}>
                    {detail.f3 === undefined ? "-" : `${detail.f3} / 4`}
                    {detail.cv === false && (
                      <span className="metric-sub"> · 2면 미만이라 보정 불성립</span>
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

      {tip && (
        <div
          className={`tooltip ${tip.above ? "tooltip-above" : ""}`}
          style={{ left: tip.x, top: tip.y }}
          role="tooltip"
        >
          {tip.text}
        </div>
      )}

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
        .part-conf {
          font-size: 10px;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .confidence-note {
          font-size: 12px;
          white-space: nowrap;
        }
        .dsi-parts {
          margin-top: 4px;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 12px;
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
          width: fit-content;
        }
        .dsi-part {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .dsi-part-val {
          white-space: nowrap;
        }
        .dsi-parts-plus {
          color: var(--text-muted);
          line-height: 1.35;
        }
        .dsi-parts-op {
          color: var(--text-muted);
        }
        /* 설명이 붙어 있다는 신호. 점선 밑줄은 툴팁의 관습적 표시다. */
        .has-tip {
          text-decoration: underline dotted;
          text-underline-offset: 3px;
          text-decoration-thickness: 1px;
          cursor: help;
        }
        .has-tip:focus-visible {
          outline: 2px solid var(--link-color);
          outline-offset: 2px;
        }
        .tooltip {
          position: fixed;
          z-index: 1100;
          max-width: 320px;
          padding: 8px 10px;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          background: var(--panel-bg);
          color: var(--foreground);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
          font-size: 12px;
          line-height: 1.6;
          /* 툴팁 문구의 줄바꿈(
)을 그대로 살린다. */
          white-space: pre-line;
          word-break: keep-all;
          /* 커서가 툴팁에 얹혀 깜빡이지 않게 한다. */
          pointer-events: none;
          transform: translateY(8px);
        }
        .tooltip-above {
          transform: translateY(calc(-100% - 8px));
        }
        /* 판정 불가를 만든 지표. 상위 dd 에 걸어 그 줄의 보조 문구까지 함께 빨개진다. */
        .metric-cause,
        .metric-cause .metric-sub {
          color: #ef4444;
        }
        .invalid-badge {
          background: #ef4444;
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
