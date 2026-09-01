# -*- coding: utf-8 -*-
"""
보간 교통량으로 도로망 전체 재분석 — 500m 제한 결과의 강건성 검증

보간은 IDW(최근접 3개, 1/d). LOO R² 0.244 로 잡음이 크다.
  → 통제변수의 측정오차는 잔여교란을 남긴다. 다만 교통량-DSI 상관이 rho 0.19 로 약해
    이 경로로 새는 편향은 크지 않을 것으로 예상되며, 그 예상을 실증으로 확인하는 것이 목적.
주 추정치는 어디까지나 실측 교통량을 쓴 500m 제한 결과다.
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


def logit(X, y, it=80):
    b = np.zeros(X.shape[1])
    for _ in range(it):
        eta = np.clip(X @ b, -30, 30); p = 1 / (1 + np.exp(-eta))
        W = np.clip(p * (1 - p), 1e-9, None)
        bn = np.linalg.solve((X.T * W) @ X, (X.T * W) @ (eta + (y - p) / W))
        if np.max(np.abs(bn - b)) < 1e-10:
            b = bn; break
        b = bn
    return b, 1 / (1 + np.exp(-np.clip(X @ b, -30, 30)))


def cse(X, y, p, g):
    W = np.clip(p * (1 - p), 1e-9, None)
    bread = np.linalg.inv((X.T * W) @ X); u = y - p
    meat = np.zeros((X.shape[1],) * 2)
    for k in np.unique(g):
        m = g == k; s = X[m].T @ u[m]; meat += np.outer(s, s)
    G = len(np.unique(g))
    return np.sqrt(np.diag(bread @ meat @ bread * (G / max(G - 1, 1))))


# ---------- 엣지 + 속성 ----------
rd = json.load(open(ROOT / "web/public/data/roads.geojson", encoding="utf-8"))
e = gpd.GeoDataFrame([{"edge_id": f["properties"]["edge_id"], "geometry": shape(f["geometry"])}
                      for f in rd["features"]], geometry="geometry", crs=4326).to_crs(5179)
e["length"] = e.geometry.length
dsi = json.load(open(ROOT / "web/public/data/road_dsi_map_260820.json", encoding="utf-8"))
e["dsi"] = e.edge_id.map({k: v["dsi"] for k, v in dsi.items()})
pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["edge_id", "ROAD_BT"]]
pt["edge_id"] = pt.edge_id.astype(str)
e = e.merge(pt.groupby("edge_id").ROAD_BT.apply(
    lambda s: pd.to_numeric(s, errors="coerce").mean()).rename("width"),
    left_on="edge_id", right_index=True, how="left")

# ---------- IDW 보간 ----------
tv = pd.read_csv(DATA / "traffic_aadt.csv", encoding="utf-8-sig")[["cid", "aadt"]]
geo = pd.read_csv(DATA / "traffic_points_vworld.csv", encoding="utf-8-sig").dropna(subset=["lon"])
geo["cid"] = geo.cid.astype(str); tv["cid"] = tv.cid.astype(str)
tp = geo.merge(tv, on="cid")
g = gpd.GeoDataFrame(tp, geometry=gpd.points_from_xy(tp.lon, tp.lat), crs=4326).to_crs(5179)
TX = np.array([[p.x, p.y] for p in g.geometry]); TY = np.log(g.aadt.values)
mid = e.geometry.interpolate(0.5, normalized=True)
MX = np.array([[m.x, m.y] for m in mid])
tree = cKDTree(TX)
d3, i3 = tree.query(MX, k=3)
w = 1 / np.clip(d3, 1, None)
e["l_aadt_idw"] = (TY[i3] * w).sum(1) / w.sum(1)
e["tp_dist"] = d3[:, 0]
e["l_aadt_near"] = TY[i3[:, 0]]

# ---------- 사례 ----------
gj = json.load(open(ROOT / "web/public/data/accident_risk_areas.geojson", encoding="utf-8"))
risk = gpd.GeoDataFrame([{**f["properties"], "geometry": shape(f["geometry"])}
                         for f in gj["features"]], geometry="geometry", crs=4326).to_crs(5179)
e["case"] = e.geometry.intersects(risk.union_all()).astype(int)

d = e.dropna(subset=["dsi", "width"]).copy()
d["z_dsi"] = (d.dsi - d.dsi.mean()) / d.dsi.std()
d["l_len"] = np.log(d.length)
d["grp"] = i3[d.index, 0]          # 최근접 계측점 = 군집

print(f"전체 엣지 {len(d):,} · 사례 {d.case.sum():,} ({d.case.mean()*100:.1f}%) · 군집 {d.grp.nunique()}")
print(f"보간 교통량 {np.exp(d.l_aadt_idw).min():,.0f}~{np.exp(d.l_aadt_idw).max():,.0f}"
      f" (실측 {g.aadt.min():,.0f}~{g.aadt.max():,.0f})\n")


def run(sub, aadt_col, tag):
    cols = ["z_dsi", "l_len", aadt_col, "width"]
    X = np.column_stack([np.ones(len(sub))] + [sub[c].values.astype(float) for c in cols])
    y = sub.case.values.astype(float)
    b, p = logit(X, y); se = cse(X, y, p, sub.grp.values)
    pv = 2 * (1 - stats.norm.cdf(abs(b[1] / se[1])))
    print(f"{tag:<40}{len(sub):>7,}{np.exp(b[1]):>9.3f}"
          f"{f'[{np.exp(b[1]-1.96*se[1]):.3f}, {np.exp(b[1]+1.96*se[1]):.3f}]':>18}{pv:>9.4f}")


print(f"{'표본 / 교통량 출처':<40}{'n':>7}{'OR(DSI)':>9}{'95% CI':>18}{'p':>9}")
print("-" * 84)
near = d[d.tp_dist <= 500]
run(near, "l_aadt_near", "500m 이내 · 실측(최근접)  ← 주 추정치")
run(near, "l_aadt_idw", "500m 이내 · IDW 보간")
run(d, "l_aadt_idw", "전체 도로망 · IDW 보간")
far = d[d.tp_dist > 500]
if len(far) > 100:
    run(far, "l_aadt_idw", "500m 밖만 · IDW 보간")
print()
print("[교통량 통제를 아예 뺐을 때 — 통제가 실제로 하는 일]")
for sub, tag in [(near, "500m 이내"), (d, "전체")]:
    cols = ["z_dsi", "l_len", "width"]
    X = np.column_stack([np.ones(len(sub))] + [sub[c].values.astype(float) for c in cols])
    y = sub.case.values.astype(float)
    b, p = logit(X, y); se = cse(X, y, p, sub.grp.values)
    pv = 2 * (1 - stats.norm.cdf(abs(b[1] / se[1])))
    print(f"    {tag:<12} 교통량 없이  OR {np.exp(b[1]):.3f}  p={pv:.4f}")
