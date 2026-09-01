# -*- coding: utf-8 -*-
"""
교통량 보간 — 계측점이 없는 엣지의 교통량을 추정

접근
  1) roads.geojson(4,566 엣지)의 끝점을 스냅해 교차로 단위 그래프를 만든다.
     원본 road_graph.npz 는 5m 간격 98,486 노드라 매개중심성 계산이 무겁고,
     차수 2 노드가 대부분이라 축약해도 경로 구조는 보존된다.
  2) 엣지 매개중심성(길이 가중) = 통행이 몰리는 정도 → 교통량 대리
  3) 계측점 74~102개에서 log(교통량) ~ 중심성 + 도로폭 + 등급 + 접근성 회귀
  4) 군집 교차검증으로 성능을 재고, 그 성능이 곧 보간 통제의 한계다.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import networkx as nx
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
RNG = np.random.default_rng(20260831)

# ---------- 도로망 → 교차로 그래프 ----------
# roads.geojson 의 끝점은 서로 최대 25m 어긋나 있어(중앙 1.64m) 스냅으로는 위상이 안 산다.
# 위상이 명시된 road_graph.npz(5m 간격 98,486 노드)를 쓰고, 차수 2 사슬을 축약해
# 교차로 단위 그래프로 줄인 뒤 매개중심성을 낸다.
z = np.load(ROOT / "GIS/road_graph.npz", allow_pickle=True)
xy, li, lj, lw = z["xy"], z["li"], z["lj"], z["lw"]
G0 = nx.Graph()
G0.add_weighted_edges_from(zip(li.tolist(), lj.tolist(), lw.tolist()), weight="w")
comp = max(nx.connected_components(G0), key=len)
G0 = G0.subgraph(comp).copy()
print(f"원 그래프(최대성분): 노드 {G0.number_of_nodes():,} · 엣지 {G0.number_of_edges():,}")

junc = {n for n, d in G0.degree() if d != 2}
print(f"  교차로/말단 노드 {len(junc):,}개 — 이 사이의 사슬을 하나의 엣지로 축약")

H = nx.Graph()
chain_nodes = {}          # 축약 엣지 -> 원 노드 목록
seen = set()
for j in junc:
    for nb in G0.neighbors(j):
        if (j, nb) in seen:
            continue
        prev, cur = j, nb
        members, L = [j], G0[j][nb]["w"]
        while cur not in junc:
            members.append(cur)
            nxt = [x for x in G0.neighbors(cur) if x != prev]
            if not nxt:
                break
            L += G0[cur][nxt[0]]["w"]
            prev, cur = cur, nxt[0]
        members.append(cur)
        seen.add((j, nb)); seen.add((cur, prev))
        if j == cur:
            continue
        if H.has_edge(j, cur) and H[j][cur]["length"] <= L:
            continue
        H.add_edge(j, cur, length=max(float(L), 1e-6))
        chain_nodes[(j, cur)] = members
print(f"  축약 그래프: 노드 {H.number_of_nodes():,} · 엣지 {H.number_of_edges():,}")

print("  엣지 매개중심성 계산 중...", flush=True)
K = 800 if H.number_of_nodes() > 2000 else None
eb = nx.edge_betweenness_centrality(H, k=K, weight="length", normalized=True, seed=7)
print(f"  {'표본 ' + str(K) + '개 출발점 근사' if K else '전수 계산'} 완료")

# 축약 엣지의 중심성 -> 그 사슬에 속한 원 노드들에 부여
node_btw = np.zeros(len(xy))
for (a, b), v in eb.items():
    for n in chain_nodes.get((a, b), chain_nodes.get((b, a), [])):
        node_btw[n] = max(node_btw[n], v)

# 원 노드 -> gangneung_point 의 edge_id -> roads.geojson 엣지
gp = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["edge_id", "geometry"]]
gp["edge_id"] = gp.edge_id.astype(str)
gxy = np.array([[g.x, g.y] for g in gp.geometry])
_, nn = cKDTree(gxy).query(xy)
btw_by_edge = pd.DataFrame({"edge_id": gp.edge_id.values[nn], "btw": node_btw})     .groupby("edge_id")["btw"].mean()

rd = json.load(open(ROOT / "web/public/data/roads.geojson", encoding="utf-8"))
e = gpd.GeoDataFrame(
    [{"edge_id": f["properties"]["edge_id"], "geometry": shape(f["geometry"])} for f in rd["features"]],
    geometry="geometry", crs=4326).to_crs(5179)
e["length"] = e.geometry.length
e["btw"] = e.edge_id.map(btw_by_edge)
print(f"  중심성 부여 엣지 {e.btw.notna().sum():,}/{len(e):,}"
      f"  범위 {e.btw.min():.2e}~{e.btw.max():.2e}")

# ---------- 엣지 속성 ----------
dsi = json.load(open(ROOT / "web/public/data/road_dsi_map_260820.json", encoding="utf-8"))
e["dsi"] = e.edge_id.map({k: v["dsi"] for k, v in dsi.items()})
pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["edge_id", "ROAD_BT", "ROA_CLS_SE"]]
pt["edge_id"] = pt.edge_id.astype(str)
w = pt.groupby("edge_id").agg(
    width=("ROAD_BT", lambda s: pd.to_numeric(s, errors="coerce").mean()),
    rclass=("ROA_CLS_SE", lambda s: pd.to_numeric(s, errors="coerce").mean()))
e = e.merge(w, left_on="edge_id", right_index=True, how="left")

mid = e.geometry.interpolate(0.5, normalized=True)
mxy = np.array([[m.x, m.y] for m in mid])
ctr = mxy.mean(axis=0)
e["d_center"] = np.hypot(mxy[:, 0] - ctr[0], mxy[:, 1] - ctr[1])

# ---------- 계측점을 엣지에 붙이기 ----------
tv = pd.read_csv(DATA / "traffic_aadt.csv", encoding="utf-8-sig")[["cid", "aadt"]]
geo = pd.read_csv(DATA / "traffic_points_vworld.csv", encoding="utf-8-sig").dropna(subset=["lon"])
geo["cid"] = geo.cid.astype(str); tv["cid"] = tv.cid.astype(str)
tp = geo.merge(tv, on="cid")
tpg = gpd.GeoDataFrame(tp, geometry=gpd.points_from_xy(tp.lon, tp.lat), crs=4326).to_crs(5179)
txy = np.array([[g.x, g.y] for g in tpg.geometry])
d_e, i_e = cKDTree(mxy).query(txy)
tpg["edge_row"] = i_e
tpg["snap_dist"] = d_e
tr = tpg[tpg.snap_dist <= 150].copy()
print(f"\n계측점 {len(tpg)}개 중 엣지 150m 이내 스냅 {len(tr)}개")

feat = e.loc[tr.edge_row, ["btw", "width", "rclass", "d_center", "length"]].reset_index(drop=True)
feat["y"] = np.log(tr.aadt.values)
feat = feat.dropna()
print(f"  학습 표본 {len(feat)}개")

X_cols = ["l_btw", "width", "rclass", "l_dc"]
feat["l_btw"] = np.log(feat.btw.clip(lower=1e-6))
feat["l_dc"] = np.log(feat.d_center.clip(lower=1))

print("\n[단변량 상관 — log(교통량) 대상]")
for c in X_cols:
    r = stats.spearmanr(feat[c], feat.y)
    print(f"    {c:<8} rho {r.statistic:+.3f}  p={r.pvalue:.4f}")


def fit(Xtr, ytr):
    A = np.column_stack([np.ones(len(Xtr)), Xtr])
    return np.linalg.lstsq(A, ytr, rcond=None)[0]


def pred(b, X):
    return np.column_stack([np.ones(len(X)), X]) @ b


Xa = feat[X_cols].values
ya = feat.y.values
b_all = fit(Xa, ya)
r2_in = 1 - np.sum((ya - pred(b_all, Xa)) ** 2) / np.sum((ya - ya.mean()) ** 2)

# K-겹 교차검증
K, idx = 5, RNG.permutation(len(feat))
errs = []
for k in range(K):
    te = idx[k::K]; tr_i = np.setdiff1d(idx, te)
    b = fit(Xa[tr_i], ya[tr_i])
    errs.append(ya[te] - pred(b, Xa[te]))
res = np.concatenate(errs)
r2_cv = 1 - np.sum(res ** 2) / np.sum((ya - ya.mean()) ** 2)
print(f"\n[보간 모형 성능]  n={len(feat)}")
print(f"    적합 R² {r2_in:.3f}   5겹 교차검증 R² {r2_cv:.3f}")
print(f"    CV 잔차 RMSE {np.sqrt((res**2).mean()):.3f} (log 스케일)"
      f"  → 배수 오차 중앙 {np.exp(np.median(np.abs(res))):.2f}배")
print(f"    계수: " + ", ".join(f"{c} {v:+.3f}" for c, v in zip(["절편"] + X_cols, b_all)))

# ---------- 전체 엣지 예측 ----------
E = e.copy()
E["l_btw"] = np.log(E.btw.clip(lower=1e-6))
E["l_dc"] = np.log(E.d_center.clip(lower=1))
ok = E[X_cols].notna().all(axis=1)
E.loc[ok, "aadt_hat"] = np.exp(pred(b_all, E.loc[ok, X_cols].values))
print(f"\n전체 엣지 {len(E):,}개 중 보간 가능 {ok.sum():,}개")
print(f"    추정 교통량 {E.aadt_hat.min():,.0f} ~ {E.aadt_hat.max():,.0f} (실측 {tr.aadt.min():,.0f}~{tr.aadt.max():,.0f})")

E[["edge_id", "dsi", "width", "rclass", "btw", "d_center", "length", "aadt_hat"]].to_csv(
    DATA / "edges_with_interpolated_traffic.csv", index=False, encoding="utf-8-sig")
print(f"-> {DATA / 'edges_with_interpolated_traffic.csv'}")
