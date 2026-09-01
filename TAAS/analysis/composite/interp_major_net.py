# -*- coding: utf-8 -*-
"""
보간 재시도 ⑤ — 표준노드링크 + 영역 제한 (X-07~09 의 후속)

가설(사용자 제안): X-08 은 roads.geojson 을 걸러 망이 끊어져 실패했다. 표준노드링크는
최대성분 99.9% 로 끊기지 않으니, 여기에 계측점 영역으로 범위를 좁히면 보간이 될 수 있다.

검정: 계측 교차로 AADT 의 LOO 교차검증. 이전 최고는 IDW LOO R² 0.244 (X-07).
  A 유클리드 IDW        (기준선)
  B 망거리 IDW          (표준노드링크 최단경로)
  C 망거리 IDW + 구조속성
"""
import sys
from pathlib import Path

import geopandas as gpd
import networkx as nx
import numpy as np
import pandas as pd
from scipy import stats
from scipy.spatial import cKDTree
from shapely.geometry import MultiPoint

HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
DATA = BASE / "data"
sys.stdout.reconfigure(encoding="utf-8")

ln = gpd.read_file(ROOT / "GIS/NODE_LINK_GANGNEUNG.gpkg", layer="moct_link_").to_crs(5179)
for c in ["LANES", "ROAD_RANK", "MAX_SPD"]:
    ln[c] = pd.to_numeric(ln[c], errors="coerce")
ix = pd.read_csv(DATA / "composite_index_intersections.csv", encoding="utf-8-sig")
ixg = gpd.GeoDataFrame(ix, geometry=gpd.points_from_xy(ix.lon, ix.lat), crs=4326).to_crs(5179)


def ends(g):
    g = g.geoms[0] if g.geom_type.startswith("Multi") else g
    cs = list(g.coords)
    return cs[0], cs[-1]


# ---------- 그래프 + 노드 좌표·구조속성 ----------
G = nx.Graph()
pos, attr = {}, {}
for _, r in ln.iterrows():
    a, b = ends(r.geometry)
    pos.setdefault(r.F_NODE, a); pos.setdefault(r.T_NODE, b)
    for n in (r.F_NODE, r.T_NODE):
        d = attr.setdefault(n, {"deg": 0, "lanes": [], "rank": [], "spd": []})
        d["deg"] += 1; d["lanes"].append(r.LANES); d["rank"].append(r.ROAD_RANK); d["spd"].append(r.MAX_SPD)
    w = r.geometry.length
    if G.has_edge(r.F_NODE, r.T_NODE):
        G[r.F_NODE][r.T_NODE]["weight"] = min(G[r.F_NODE][r.T_NODE]["weight"], w)
    else:
        G.add_edge(r.F_NODE, r.T_NODE, weight=w)
comp = max(nx.connected_components(G), key=len)
print(f"표준노드링크 그래프 노드 {G.number_of_nodes():,} · 간선 {G.number_of_edges():,} · "
      f"최대성분 {len(comp)/G.number_of_nodes():.1%}")

nodes = [n for n in G.nodes if n in pos]
NP = np.array([pos[n] for n in nodes])
IP = np.array([[g.x, g.y] for g in ixg.geometry])
dist, idx = cKDTree(NP).query(IP)
ok = dist < 60
snap = [nodes[i] for i in idx]
d = ix.copy()
d["node"] = snap; d["snap_d"] = dist
d = d[ok & pd.Series([n in comp for n in snap], index=d.index)].reset_index(drop=True)
# 같은 노드에 두 계측점이 붙으면 하나만
d = d.drop_duplicates("node").reset_index(drop=True)
print(f"최대성분 위 노드에 스냅된 계측점 {len(d)}개 (중앙 스냅거리 {d.snap_d.median():.0f}m)\n")

for k, v in attr.items():
    pass
d["deg"] = [attr[n]["deg"] for n in d.node]
d["lanes"] = [np.nanmax(attr[n]["lanes"]) for n in d.node]
d["rank"] = [np.nanmin(attr[n]["rank"]) for n in d.node]
d["spd"] = [np.nanmax(attr[n]["spd"]) for n in d.node]

# ---------- 망거리 행렬 ----------
NET = np.full((len(d), len(d)), np.inf)
for i, s in enumerate(d.node):
    sp = nx.single_source_dijkstra_path_length(G, s, weight="weight")
    for j, t in enumerate(d.node):
        if t in sp:
            NET[i, j] = sp[t]
EUC = np.linalg.norm(d[["lon", "lat"]].to_numpy()[:, None] - d[["lon", "lat"]].to_numpy(), axis=2)
EUC = np.array([[ixg.geometry.iloc[i].distance(ixg.geometry.iloc[j]) for j in range(len(ix))]
                for i in range(len(ix))])
sel = [ix.index[ix.cid == c][0] for c in d.cid]
EUC = EUC[np.ix_(sel, sel)]
y = np.log(d.aadt.to_numpy())
print(f"이웃 계측점까지 망거리 중앙 {np.median([np.sort(r)[1] for r in NET]):,.0f}m  "
      f"(유클리드 {np.median([np.sort(r)[1] for r in EUC]):,.0f}m)")


def loo_idw(Dm, power=2, k=None):
    pred = np.empty(len(d))
    for i in range(len(d)):
        m = np.ones(len(d), bool); m[i] = False
        dd = Dm[i][m]; yy = y[m]
        fin = np.isfinite(dd)
        dd, yy = dd[fin], yy[fin]
        if k:
            o = np.argsort(dd)[:k]; dd, yy = dd[o], yy[o]
        w = 1 / np.maximum(dd, 1.0) ** power
        pred[i] = (w * yy).sum() / w.sum()
    return pred


def report(pred, label):
    ss_res = ((y - pred) ** 2).sum(); ss_tot = ((y - y.mean()) ** 2).sum()
    r2 = 1 - ss_res / ss_tot
    fold = np.exp(np.abs(y - pred))
    print(f"  {label:<28} R² {r2:>+7.3f}   rho {stats.spearmanr(pred, y).statistic:>+.3f}"
          f"   배수오차 중앙 {np.median(fold):.2f}  p90 {np.percentile(fold, 90):.2f}")
    return r2


print("\n[LOO 교차검증 — log(AADT) 예측]")
best = {}
for p in [1, 2, 3]:
    for k in [None, 3, 5, 8]:
        best[("유클리드", p, k)] = report(loo_idw(EUC, p, k), f"A 유클리드 IDW p={p} k={k}")
print()
for p in [1, 2, 3]:
    for k in [None, 3, 5, 8]:
        best[("망거리", p, k)] = report(loo_idw(NET, p, k), f"B 망거리 IDW p={p} k={k}")

# C 구조속성 결합
bk = max(best, key=best.get)
Dm = EUC if bk[0] == "유클리드" else NET
base = loo_idw(Dm, bk[1], bk[2])
X = np.column_stack([np.ones(len(d)), base, d.deg, d.lanes.fillna(d.lanes.median()),
                     d["rank"].fillna(d["rank"].median()), d.spd.fillna(d.spd.median())])
pred = np.empty(len(d))
for i in range(len(d)):
    m = np.ones(len(d), bool); m[i] = False
    b, *_ = np.linalg.lstsq(X[m], y[m], rcond=None)
    pred[i] = X[i] @ b
print()
report(pred, "C 최적 IDW + 구조속성")
print(f"\n최고 성적: {bk} → R² {best[bk]:+.3f}   (이전 최고 X-07 의 IDW LOO R² 0.244)")
