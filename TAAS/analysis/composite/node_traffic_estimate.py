# -*- coding: utf-8 -*-
"""
모든 교차로의 교통량 추정 — 링크 보간을 포기하고 노드에만 한정한다

왜 이 문제가 더 잘 정의되는가
  계측값은 교차로 단위 양이다. 노드에서 노드로 옮기면 D-06 의 단위 불일치가 없다.
  커버리지도 실질 교차로 1,923개 전부로 늘어난다 (현재 68개 = 3.5%).

핵심 예측변수 — 매개중심성
  X-08 은 roads.geojson 끝점 스냅 실패로 최대성분이 9노드였다 (A-05). 표준노드링크는
  최대성분 99.9% 라 이번에는 계산이 성립한다. 매개중심성은 '이 노드를 지나는 최단경로
  수'이므로 균일 수요를 가정한 간이 통행배정이다. 교통량의 이론적으로 올바른 예측변수다.

검정: 계측 68개 노드에 대한 LOO. 이전 최고는 링크 보간 R² 0.244.
"""
import sys
from pathlib import Path

import geopandas as gpd
import networkx as nx
import numpy as np
import pandas as pd
from scipy import stats
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
DATA = BASE / "data"
sys.stdout.reconfigure(encoding="utf-8")

ln = gpd.read_file(ROOT / "GIS/NODE_LINK_GANGNEUNG.gpkg", layer="moct_link_").to_crs(5179)
for c in ["LANES", "ROAD_RANK", "MAX_SPD"]:
    ln[c] = pd.to_numeric(ln[c], errors="coerce")


def ends(g):
    g = g.geoms[0] if g.geom_type.startswith("Multi") else g
    cs = list(g.coords)
    return cs[0], cs[-1]


G_len, G_tt = nx.Graph(), nx.Graph()
pos, attr = {}, {}
for _, r in ln.iterrows():
    a, b = ends(r.geometry)
    pos.setdefault(r.F_NODE, a); pos.setdefault(r.T_NODE, b)
    for n in (r.F_NODE, r.T_NODE):
        d = attr.setdefault(n, {"deg": 0, "lanes": [], "rank": [], "spd": []})
        d["deg"] += 1; d["lanes"].append(r.LANES); d["rank"].append(r.ROAD_RANK); d["spd"].append(r.MAX_SPD)
    L = max(r.geometry.length, 1.0)
    spd = r.MAX_SPD if np.isfinite(r.MAX_SPD) and r.MAX_SPD > 0 else 30.0
    for Gg, w in ((G_len, L), (G_tt, L / spd)):
        if Gg.has_edge(r.F_NODE, r.T_NODE):
            Gg[r.F_NODE][r.T_NODE]["w"] = min(Gg[r.F_NODE][r.T_NODE]["w"], w)
        else:
            Gg.add_edge(r.F_NODE, r.T_NODE, w=w)
comp = max(nx.connected_components(G_len), key=len)
print(f"그래프 노드 {G_len.number_of_nodes():,} · 간선 {G_len.number_of_edges():,} · 최대성분 {len(comp)/G_len.number_of_nodes():.1%}")

print("매개중심성 계산 중 (길이·시간 두 판)...", flush=True)
bc_len = nx.betweenness_centrality(G_len.subgraph(comp), weight="w", normalized=True)
bc_tt = nx.betweenness_centrality(G_tt.subgraph(comp), weight="w", normalized=True)

nd = pd.DataFrame([{"node": n, "deg": attr[n]["deg"],
                    "lanes_sum": np.nansum(attr[n]["lanes"]), "lanes_max": np.nanmax(attr[n]["lanes"]),
                    "rank_min": np.nanmin(attr[n]["rank"]), "spd_max": np.nanmax(attr[n]["spd"]),
                    "bc_len": bc_len.get(n, np.nan), "bc_tt": bc_tt.get(n, np.nan),
                    "x": pos[n][0], "y": pos[n][1]} for n in comp])
nd = nd.dropna(subset=["bc_len"])
print(f"중심성 산출 노드 {len(nd):,}개  (0 이 아닌 노드 {int((nd.bc_len > 0).sum()):,}개)")

ix = pd.read_csv(DATA / "composite_index_intersections.csv", encoding="utf-8-sig")
ixg = gpd.GeoDataFrame(ix, geometry=gpd.points_from_xy(ix.lon, ix.lat), crs=4326).to_crs(5179)
IP = np.array([[g.x, g.y] for g in ixg.geometry])
dist, idx = cKDTree(nd[["x", "y"]].to_numpy()).query(IP)
ok = dist < 60
d = pd.concat([ix[ok].reset_index(drop=True),
               nd.iloc[idx[ok]].reset_index(drop=True)], axis=1).drop_duplicates("node")
y = np.log(d.aadt.to_numpy())
print(f"계측점 {len(d)}개가 노드에 매칭 (중앙 스냅 {np.median(dist[ok]):.0f}m)\n")

print("[단변량] 각 예측변수 ~ log(AADT)")
FE = ["bc_len", "bc_tt", "deg", "lanes_sum", "lanes_max", "rank_min", "spd_max"]
for c in FE:
    r = stats.spearmanr(d[c], y, nan_policy="omit")
    print(f"  {c:<10} rho {r.statistic:>+.3f}  p {r.pvalue:.4f}")

# 공간 IDW 항 (LOO 안에서 계산)
P = d[["x", "y"]].to_numpy()
DM = np.linalg.norm(P[:, None] - P, axis=2)


def loo(cols, use_idw):
    pred = np.empty(len(d))
    for i in range(len(d)):
        m = np.ones(len(d), bool); m[i] = False
        Xc = [np.ones(m.sum())] + [stats.rankdata(d[c][m]) for c in cols]
        xi = [1.0] + [stats.percentileofscore(d[c][m], d[c].iloc[i]) / 100 * m.sum() for c in cols]
        if use_idw:
            w = 1 / np.maximum(DM[i][m], 1.0) ** 1
            idw_i = (w * y[m]).sum() / w.sum()
            sub = []
            for j in np.where(m)[0]:
                mm = m.copy(); mm[j] = False
                wj = 1 / np.maximum(DM[j][mm], 1.0) ** 1
                sub.append((wj * y[mm]).sum() / wj.sum())
            Xc.append(np.array(sub)); xi.append(idw_i)
        X = np.column_stack(Xc)
        b, *_ = np.linalg.lstsq(X, y[m], rcond=None)
        pred[i] = np.array(xi) @ b
    return pred


def rep(pred, lab):
    r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    fold = np.exp(np.abs(y - pred))
    print(f"  {lab:<34} R² {r2:>+7.3f}  rho {stats.spearmanr(pred, y).statistic:>+.3f}"
          f"  배수오차 중앙 {np.median(fold):.2f}  p90 {np.percentile(fold, 90):.2f}")
    return r2


print("\n[LOO 교차검증]")
rep(loo(["bc_len"], False), "중심성(길이) 단독")
rep(loo(["bc_tt"], False), "중심성(시간) 단독")
rep(loo(["deg", "lanes_sum", "rank_min", "spd_max"], False), "구조속성만")
rep(loo(["bc_tt", "deg", "lanes_sum", "rank_min", "spd_max"], False), "중심성 + 구조속성")
rep(loo([], True), "공간 IDW 단독")
best = rep(loo(["bc_tt", "deg", "lanes_sum", "rank_min", "spd_max"], True), "중심성 + 구조 + 공간 IDW")
print(f"\n  참고: 링크 보간 최고 성적 R² 0.244 (X-07)")
