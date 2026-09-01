# -*- coding: utf-8 -*-
"""
DSI vs 교통사고 심각도 상관분석

결과변수: 심각도 = (사망 + 중상) / 사고건수
  사고가 났다는 조건 하의 비율이라 교통량(노출도)이 상당 부분 약분된다.
  시야 차폐는 발견을 늦춰 충돌속도를 올리므로, 이론적으로도 빈도보다 심각도에 먼저 나타난다.

설명변수: 구역 내 지점들의 DSI 집계 (dsi_map_*.json, 구조물만 반영한 dsi_refined)

단위: 사고위험지역 폴리곤 1개 = 관측 1개
  지점(5m 간격)을 관측으로 쓰면 이웃끼리 사실상 같은 관측이라 p값이 무의미해진다.
  구역 단위로 묶으면 n 은 줄지만 유사독립이 확보된다.
"""
import json
import sys

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy import stats
from shapely.geometry import shape

from pathlib import Path

# TAAS/analysis/ 아래로 옮겨졌다. 데이터는 저장소 루트 기준이고 산출물은 이 스크립트 옆에
# 두므로, 실행 위치와 무관하도록 둘 다 __file__ 에서 푼다.
HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
DATA = BASE / "data"

sys.stdout.reconfigure(encoding="utf-8")
RNG = np.random.default_rng(20260831)
VERSION = "260820"


def load_areas(path, kind):
    gj = json.load(open(path, encoding="utf-8"))
    rows = []
    for f in gj["features"]:
        p = f["properties"]
        rows.append({**p, "kind": kind, "geometry": shape(f["geometry"])})
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=4326).to_crs(5179)


def load_points():
    pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[
        ["point_id", "edge_id", "ROA_CLS_SE", "ROAD_BT", "geometry"]
    ]
    dsi = json.load(open(ROOT / f"web/public/data/dsi_map_{VERSION}.json", encoding="utf-8"))
    dmap = {int(k.split("_")[0]): v["dsi"] for k, v in dsi.items()}
    pt["dsi"] = pt.point_id.map(dmap)
    pt["road_class"] = pd.to_numeric(pt.ROA_CLS_SE, errors="coerce")
    pt["width"] = pd.to_numeric(pt.ROAD_BT, errors="coerce")
    return pt.dropna(subset=["dsi"])


def aggregate(areas, pts, sev_cols):
    """구역별로 내부 지점의 DSI 를 집계하고 심각도를 붙인다."""
    j = gpd.sjoin(pts, areas[["geometry"]], how="inner", predicate="within")
    g = j.groupby("index_right")
    agg = g.agg(
        n_pt=("dsi", "size"),
        dsi_mean=("dsi", "mean"),
        dsi_med=("dsi", "median"),
        dsi_p90=("dsi", lambda s: s.quantile(0.90)),
        road_class=("road_class", "mean"),
        width=("width", "mean"),
        n_edge=("edge_id", "nunique"),
    )
    out = areas.join(agg, how="left")
    out["sev_n"] = out[sev_cols].sum(axis=1)
    out["sev_ratio"] = out.sev_n / out.acc
    return out


def spearman_perm(x, y, n=20000):
    """순열검정으로 p 를 낸다 - n 이 작아 점근 근사를 믿기 어렵다."""
    r = stats.spearmanr(x, y).statistic
    null = np.empty(n)
    yv = np.asarray(y)
    for i in range(n):
        null[i] = stats.spearmanr(x, RNG.permutation(yv)).statistic
    p = (np.sum(np.abs(null) >= abs(r)) + 1) / (n + 1)
    return r, p


def partial_spearman_perm(x, y, covs, n=20000):
    """공변량을 순위회귀로 제거한 뒤의 편상관. 순열은 잔차에 대해 수행."""
    def rank(a):
        return stats.rankdata(a)

    C = np.column_stack([np.ones(len(x))] + [rank(c) for c in covs])
    rx = rank(x) - C @ np.linalg.lstsq(C, rank(x), rcond=None)[0]
    ry = rank(y) - C @ np.linalg.lstsq(C, rank(y), rcond=None)[0]
    r = stats.pearsonr(rx, ry).statistic
    null = np.empty(n)
    for i in range(n):
        null[i] = stats.pearsonr(rx, RNG.permutation(ry)).statistic
    p = (np.sum(np.abs(null) >= abs(r)) + 1) / (n + 1)
    return r, p


def pooled_split(df, col="dsi_mean"):
    """DSI 중앙값 기준 상·하위 절반의 사고를 모아 2x2 로 비교.
    구역별 비율의 잡음을 피하려고 사고 건수 자체를 합쳐서 본다."""
    med = df[col].median()
    hi, lo = df[df[col] > med], df[df[col] <= med]
    tbl = np.array(
        [
            [hi.sev_n.sum(), hi.acc.sum() - hi.sev_n.sum()],
            [lo.sev_n.sum(), lo.acc.sum() - lo.sev_n.sum()],
        ]
    )
    odds, p = stats.fisher_exact(tbl)
    return tbl, odds, p, med


def report(name, df, sev_label):
    print("=" * 78)
    print(f"{name} — 심각도 = {sev_label}")
    print("=" * 78)
    tot = len(df)
    df = df[df.n_pt.notna() & (df.acc > 0)].copy()
    print(f"구역 {tot}개 중 내부에 DSI 지점이 있는 곳 {len(df)}개")
    print(f"  구역당 지점 수  min {df.n_pt.min():.0f} / 중앙 {df.n_pt.median():.0f} / max {df.n_pt.max():.0f}")
    print(f"  사고건수        합 {df.acc.sum():.0f} / 구역당 중앙 {df.acc.median():.0f}")
    print(f"  사망+중상       합 {df.sev_n.sum():.0f}")
    print(f"  심각도          평균 {df.sev_ratio.mean():.3f} / 중앙 {df.sev_ratio.median():.3f}"
          f" / 범위 {df.sev_ratio.min():.3f}~{df.sev_ratio.max():.3f}")
    print(f"  DSI(구역평균)   중앙 {df.dsi_mean.median():.3f}"
          f" / 범위 {df.dsi_mean.min():.3f}~{df.dsi_mean.max():.3f}")
    print()

    print("[1] 순위상관 (Spearman, 순열검정 20,000회)")
    for col, lab in [("dsi_mean", "구역 평균 DSI"), ("dsi_med", "구역 중앙 DSI"),
                     ("dsi_p90", "구역 상위10% DSI")]:
        r, p = spearman_perm(df[col].values, df.sev_ratio.values)
        print(f"    {lab:16s} rho = {r:+.3f}   p = {p:.4f}")
    print()

    print("[2] 도로등급·폭 통제 후 편상관")
    ok = df.dropna(subset=["road_class", "width"])
    r, p = partial_spearman_perm(
        ok.dsi_mean.values, ok.sev_ratio.values, [ok.road_class.values, ok.width.values]
    )
    print(f"    평균 DSI | 등급,폭   rho = {r:+.3f}   p = {p:.4f}   (n={len(ok)})")
    print()

    print("[3] DSI 상·하위 절반의 사고를 합쳐 비교 (Fisher exact)")
    tbl, odds, p, med = pooled_split(df)
    print(f"    분할 기준 평균 DSI = {med:.3f}")
    print(f"    DSI 높은 절반: 사망+중상 {tbl[0,0]:4d} / 그 외 {tbl[0,1]:4d}"
          f"  → 심각도 {tbl[0,0]/(tbl[0,0]+tbl[0,1]):.3f}")
    print(f"    DSI 낮은 절반: 사망+중상 {tbl[1,0]:4d} / 그 외 {tbl[1,1]:4d}"
          f"  → 심각도 {tbl[1,0]/(tbl[1,0]+tbl[1,1]):.3f}")
    print(f"    오즈비 {odds:.3f}   p = {p:.4f}")
    print()
    return df


pts = load_points()
print(f"DSI 부여 지점 {len(pts):,}개 (버전 {VERSION})\n")

risk = load_areas(ROOT / "web/public/data/accident_risk_areas.geojson", "risk")
risk = aggregate(risk, pts, ["dth", "se"])
r_df = report("링크기반 교통사고 위험지역", risk, "(사망+중상)/사고건수")

spot = load_areas(ROOT / "web/public/data/accident_hotspots.geojson", "spot")
spot = aggregate(spot, pts, ["dth", "se"])
s_df = report("지자체별 교통사고 다발지역", spot, "(사망+중상)/사고건수")

pd.concat([
    r_df.assign(set="risk"), s_df.assign(set="spot")
]).drop(columns="geometry").to_csv(DATA / "dsi_severity_areas.csv", index=False, encoding="utf-8-sig")
print(f"구역별 집계 -> {DATA / 'dsi_severity_areas.csv'}")
