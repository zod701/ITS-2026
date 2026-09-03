# -*- coding: utf-8 -*-
"""사고 하위유형별 DSI 계수 — 음수가 어디서 오는가 (X-26)

X-25 가 전체 사고 기준으로 DSI 계수를 음수로 냈다. 그것이 전체의 성질인지 특정 사고 유형의
성질인지를 가른다. 모형·엣지집합·통제변수는 X-25 와 동일하고 결과변수만 부분집합이다.

**탐색적이다.** 8개 부분집합을 돌리므로 다중비교가 걸린다(34%). 사전 지정 검정이 아니다.
"""
import json, sys
from pathlib import Path
import geopandas as gpd, numpy as np, pandas as pd
from scipy import stats
from scipy.spatial import cKDTree
from shapely.geometry import shape

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
DATA = BASE / "data"
SNAP = 25.0


def poisson(X, y, off, it=100, tol=1e-10):
    b = np.zeros(X.shape[1]); b[0] = np.log(max(y.mean(), 1e-6))
    for _ in range(it):
        eta = np.clip(X @ b + off, -30, 30); mu = np.exp(eta)
        W = np.maximum(mu, 1e-9)
        bn = np.linalg.solve((X.T * W) @ X, (X.T * W) @ ((eta - off) + (y - mu) / W))
        if np.max(np.abs(bn - b)) < tol:
            return bn, np.exp(np.clip(X @ bn + off, -30, 30))
        b = bn
    return b, np.exp(np.clip(X @ b + off, -30, 30))


def cse(X, y, mu, g):
    br = np.linalg.inv((X.T * mu) @ X); u = y - mu
    m = np.zeros((X.shape[1], X.shape[1]))
    for c in np.unique(g):
        k = g == c; sv = X[k].T @ u[k]; m += np.outer(sv, sv)
    G = len(np.unique(g))
    return np.sqrt(np.diag(br @ m @ br * (G / max(G - 1, 1))))


fe = pd.read_csv(DATA / "freq_edges_500m.csv", encoding="utf-8-sig")
fe["edge_id"] = fe.edge_id.astype(str)
rd = json.load(open(ROOT / "web/public/data/roads.geojson", encoding="utf-8"))
geom = {str(f["properties"]["edge_id"]): shape(f["geometry"]) for f in rd["features"]}
e = gpd.GeoDataFrame(fe.assign(geometry=fe.edge_id.map(geom)), geometry="geometry", crs=4326).to_crs(5179)
e = e[e.geometry.notna()].reset_index(drop=True)
pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["point_id", "edge_id"]]
veh = pd.read_csv(DATA / "vehicle_occlusion_260820.csv", encoding="utf-8-sig")
veh = veh[veh.valid == True]
ev = pt.merge(veh[["point_id", "veh_extra_occ"]], on="point_id").groupby("edge_id").veh_extra_occ.mean()
ev.index = ev.index.astype(str)
e["veh"] = e.edge_id.map(ev)
e = e.dropna(subset=["dsi", "aadt", "length", "width", "veh"]).reset_index(drop=True)

acc = gpd.read_file(TAAS / "사고정보/24_25/TAAS_교통사고지점및정보_2425.shp").to_crs(5179)
acc["대분류"] = acc.사고유형.str.split(" - ").str[0]
acc["도로대"] = acc.도로형태.str.split(" - ").str[0]
AP = np.array([[p.x, p.y] for p in acc.geometry])
S, owner = [], []
for i, g in enumerate(e.geometry):
    n = max(int(g.length // 10), 1)
    for k in range(n + 1):
        p = g.interpolate(k * g.length / n)
        S.append([p.x, p.y]); owner.append(i)
S = np.array(S); owner = np.array(owner)
dist, idx = cKDTree(S).query(AP)

rk = lambda s: stats.rankdata(s) / len(s)
e["R_dsi"], e["R_aadt"], e["R_veh"] = rk(e.dsi), rk(e.aadt), rk(e.veh)
e["R_res"] = rk(e.R_veh - np.polyval(np.polyfit(e.R_aadt, e.R_veh, 1), e.R_aadt))
off = np.log(e.length.to_numpy()); grp = pd.factorize(e.aadt)[0]
COLS = ["R_dsi", "R_aadt", "R_res", "width"]
X = np.column_stack([np.ones(len(e))] + [e[c].to_numpy() for c in COLS])

print("하위유형별 포아송 — R_dsi 계수 (엣지 n=3,706, 계측점 75군집 강건 SE)")
print(f"{'하위집합':<22}{'사고':>5}{'R_dsi':>9}{'SE':>7}{'z':>7}{'R_res':>9}{'z':>7}")
print("-" * 68)
subs = [("전체", np.ones(len(acc), bool)),
        ("차대사람", acc.대분류 == "차대사람"),
        ("차대차", acc.대분류 == "차대차"),
        ("단일로", acc.도로대 == "단일로"),
        ("교차로", acc.도로대 == "교차로"),
        ("차대사람 x 단일로", (acc.대분류 == "차대사람") & (acc.도로대 == "단일로")),
        ("차대사람 x 교차로", (acc.대분류 == "차대사람") & (acc.도로대 == "교차로")),
        ("차대차 x 교차로", (acc.대분류 == "차대차") & (acc.도로대 == "교차로"))]
rows = []
for lab, m in subs:
    sel = m.to_numpy() if hasattr(m, "to_numpy") else m
    hit = (dist < SNAP) & sel
    y = np.bincount(owner[idx[hit]], minlength=len(e)).astype(float)
    if y.sum() < 15:
        print(f"{lab:<22}{int(y.sum()):>5}   (n<15, 생략)")
        continue
    b, mu = poisson(X, y, off)
    se = cse(X, y, mu, grp)
    print(f"{lab:<22}{int(y.sum()):>5}{b[1]:>+9.3f}{se[1]:>7.3f}{b[1]/se[1]:>7.2f}"
          f"{b[3]:>+9.3f}{b[3]/se[3]:>7.2f}")
    rows.append((lab, int(y.sum()), b[1], se[1], b[3], se[3]))

print("\n※ 탐색적 분석이다. 8개 하위집합을 돌렸으므로 다중비교가 걸린다 —")
print("  전부 귀무여도 하나쯤 p<0.05 가 나올 확률이 34% 다. 확증이 아니라 방향 탐색으로만 읽을 것.")
