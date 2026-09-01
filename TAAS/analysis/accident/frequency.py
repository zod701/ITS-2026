# -*- coding: utf-8 -*-
"""
DSI vs 사고위험지역 여부 — 교통량 통제 빈도 분석 (계측점 500m 이내 제한)

설계
  단위   : 도로 엣지 (roads.geojson, 길이 중앙 55m)
  사례   : 링크기반 사고위험지역(2017~2025 합집합)과 교차하는 엣지
  대조   : 교차하지 않는 엣지
  제한   : 교통량 계측점 500m 이내 — 교통량을 보간 없이 실측으로 붙일 수 있는 범위
  통제   : log(교통량), log(엣지길이), 도로폭, 계측점까지 거리
           ★ 도로등급은 넣지 않는다. DSI 와 rho 0.633 이라 통제하면 관심 신호가 함께 사라진다.
  추정   : 로지스틱 회귀(IRLS) + 계측점 단위 군집 강건 표준오차
           인접 엣지는 조건을 공유하므로 독립으로 세면 표준오차가 과소평가된다.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy import stats
from scipy.spatial import cKDTree
from shapely.geometry import shape

HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
DATA = BASE / "data"
sys.stdout.reconfigure(encoding="utf-8")
RADIUS = 500.0


def logit_irls(X, y, max_iter=60, tol=1e-9):
    b = np.zeros(X.shape[1])
    for _ in range(max_iter):
        eta = np.clip(X @ b, -30, 30)
        p = 1 / (1 + np.exp(-eta))
        W = np.clip(p * (1 - p), 1e-9, None)
        z = eta + (y - p) / W
        XtW = X.T * W
        b_new = np.linalg.solve(XtW @ X, XtW @ z)
        if np.max(np.abs(b_new - b)) < tol:
            b = b_new
            break
        b = b_new
    eta = np.clip(X @ b, -30, 30)
    p = 1 / (1 + np.exp(-eta))
    return b, p


def cluster_se(X, y, p, b, groups):
    W = np.clip(p * (1 - p), 1e-9, None)
    bread = np.linalg.inv((X.T * W) @ X)
    u = y - p
    meat = np.zeros((X.shape[1], X.shape[1]))
    for g in np.unique(groups):
        m = groups == g
        s = X[m].T @ u[m]
        meat += np.outer(s, s)
    G = len(np.unique(groups))
    adj = G / max(G - 1, 1)
    V = bread @ meat @ bread * adj
    return np.sqrt(np.diag(V))


# ---------- 데이터 ----------
rd = json.load(open(ROOT / "web/public/data/roads.geojson", encoding="utf-8"))
e = gpd.GeoDataFrame(
    [{"edge_id": f["properties"]["edge_id"], "geometry": shape(f["geometry"])} for f in rd["features"]],
    geometry="geometry", crs=4326).to_crs(5179)
dsi = json.load(open(ROOT / "web/public/data/road_dsi_map_260820.json", encoding="utf-8"))
e["dsi"] = e.edge_id.map({k: v["dsi"] for k, v in dsi.items()})
e["npt"] = e.edge_id.map({k: v["n"] for k, v in dsi.items()})
e["length"] = e.geometry.length
e = e.dropna(subset=["dsi"]).copy()

# 엣지별 도로폭 — 지점 레이어에서 평균
pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["edge_id", "ROAD_BT", "ROA_CLS_SE", "geometry"]]
pt["edge_id"] = pt.edge_id.astype(str)
w = pt.groupby("edge_id").agg(width=("ROAD_BT", lambda s: pd.to_numeric(s, errors="coerce").mean()),
                              rclass=("ROA_CLS_SE", lambda s: pd.to_numeric(s, errors="coerce").mean()))
e = e.merge(w, left_on="edge_id", right_index=True, how="left")

# 교통량 (12개월 평균) + 최근접 계측점
tv = pd.read_csv(DATA / "traffic_aadt.csv", encoding="utf-8-sig")[["cid", "aadt"]]
geo = pd.read_csv(DATA / "traffic_points_vworld.csv", encoding="utf-8-sig").dropna(subset=["lon"])
geo["cid"] = geo.cid.astype(str)
tv["cid"] = tv.cid.astype(str)
tp = geo.merge(tv, on="cid", how="inner")
tpg = gpd.GeoDataFrame(tp, geometry=gpd.points_from_xy(tp.lon, tp.lat), crs=4326).to_crs(5179)
mid = e.geometry.interpolate(0.5, normalized=True)
tree = cKDTree(np.array([[g.x, g.y] for g in tpg.geometry]))
d, i = tree.query(np.array([[m.x, m.y] for m in mid]))
e["tp_dist"] = d
e["tp_idx"] = i
e["aadt"] = tpg.aadt.values[i]

# 사례 판정
gj = json.load(open(ROOT / "web/public/data/accident_risk_areas.geojson", encoding="utf-8"))
risk = gpd.GeoDataFrame([{**f["properties"], "geometry": shape(f["geometry"])} for f in gj["features"]],
                        geometry="geometry", crs=4326).to_crs(5179)
e["case"] = e.geometry.intersects(risk.union_all()).astype(int)

s = e[(e.tp_dist <= RADIUS)].dropna(subset=["width", "aadt"]).copy()
print(f"계측점 {RADIUS:.0f}m 이내 · 공변량 완비 엣지 {len(s):,}개")
print(f"  사례 {s.case.sum():,} ({s.case.mean()*100:.1f}%) / 대조 {(1-s.case).sum():,}")
print(f"  군집(최근접 계측점) {s.tp_idx.nunique()}개\n")

# ---------- 모형 ----------
s["z_dsi"] = (s.dsi - s.dsi.mean()) / s.dsi.std()
s["l_aadt"] = np.log(s.aadt)
s["l_len"] = np.log(s.length)
specs = [
    ("① DSI 단독", ["z_dsi"]),
    ("② + 길이", ["z_dsi", "l_len"]),
    ("③ + 길이·교통량", ["z_dsi", "l_len", "l_aadt"]),
    ("④ + 길이·교통량·폭·계측거리", ["z_dsi", "l_len", "l_aadt", "width", "tp_dist"]),
    ("⑤ ④ + 도로등급(참고: 과통제)", ["z_dsi", "l_len", "l_aadt", "width", "tp_dist", "rclass"]),
]
print("로지스틱 회귀 — 결과: 사고위험지역과 교차(1) 여부")
print("DSI 계수는 표준화 1SD 증가당 오즈비. 표준오차는 계측점 군집 강건.\n")
print(f"{'모형':<30}{'OR(DSI)':>9}{'95% CI':>18}{'p':>9}   {'OR(교통량,log)':>14}")
print("-" * 84)
y = s.case.values.astype(float)
g = s.tp_idx.values
for name, cols in specs:
    X = np.column_stack([np.ones(len(s))] + [s[c].values.astype(float) for c in cols])
    b, p = logit_irls(X, y)
    se = cluster_se(X, y, p, b, g)
    k = cols.index("z_dsi") + 1
    lo, hi = np.exp(b[k] - 1.96 * se[k]), np.exp(b[k] + 1.96 * se[k])
    pv = 2 * (1 - stats.norm.cdf(abs(b[k] / se[k])))
    at = f"{np.exp(b[cols.index('l_aadt')+1]):.3f}" if "l_aadt" in cols else "—"
    print(f"{name:<30}{np.exp(b[k]):>9.3f}{f'[{lo:.3f}, {hi:.3f}]':>18}{pv:>9.4f}   {at:>14}")

s[["edge_id", "case", "dsi", "aadt", "length", "width", "rclass", "tp_dist"]].to_csv(
    DATA / "freq_edges_500m.csv", index=False, encoding="utf-8-sig")
print(f"\n-> {DATA / 'freq_edges_500m.csv'}")
