# -*- coding: utf-8 -*-
"""
가중치 재유도 — 원시 사고지점 자료 (§5.5 절차)

D-14 는 "엣지가 사고위험지역과 겹치는가"(0/1)를 결과로 삼았는데, 그 자료는 **사고 4건 이상만
수록된 선정 결과**라 셋이 걸렸다 (X-24).
  1) 통제군 오염 — 사고 1~3건 도로가 0건과 함께 비사례로 들어감
  2) 노출도 내재 — 사고건수 = 통행량 x 위험도 이므로 임계 통과 자체가 통행량 편
  3) 행정 쿼터 (다발지역)

원시 지점 자료(TAAS 2024~25, 중상 이상 216건)로 결과변수를 **엣지별 사고건수**로 바꾼다.
포아송 + log(길이) offset + 계측점 군집 강건 SE. 1)과 2)가 함께 풀린다.

**남는 선택 편의**: 이 자료는 중상 이상만이다. 경상 사고는 여전히 안 보인다. 다만 이것은
'심각도 절단'이라 '건수 절단'과 성격이 다르고, 자율주행 셔틀 안전 관점에서는 중상 이상이
오히려 관심 대상에 가깝다.

**비교의 한계**: 옛 결과변수(2017~25, 전 심각도, 4건 임계)와 새 결과변수(2024~25, 중상 이상,
전수)는 기간·심각도·절단이 모두 다르다. 그래도 "임계를 없애면 통행량 가중치가 내려가는가"
라는 X-24 의 핵심 질문에는 답할 수 있다.
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

SNAP_M = 25.0        # 사고지점 -> 엣지 스냅 허용 (95% 가 15m 이내)


def poisson_irls(X, y, offset, max_iter=100, tol=1e-10):
    b = np.zeros(X.shape[1])
    b[0] = np.log(max(y.mean(), 1e-6))
    for _ in range(max_iter):
        eta = np.clip(X @ b + offset, -30, 30)
        mu = np.exp(eta)
        W = np.maximum(mu, 1e-9)
        z = (eta - offset) + (y - mu) / W
        b_new = np.linalg.solve((X.T * W) @ X, (X.T * W) @ z)
        if np.max(np.abs(b_new - b)) < tol:
            b = b_new
            break
        b = b_new
    mu = np.exp(np.clip(X @ b + offset, -30, 30))
    return b, mu


def cluster_se(X, y, mu, groups):
    bread = np.linalg.inv((X.T * mu) @ X)
    u = y - mu
    meat = np.zeros((X.shape[1], X.shape[1]))
    for g in np.unique(groups):
        m = groups == g
        s = X[m].T @ u[m]
        meat += np.outer(s, s)
    G = len(np.unique(groups))
    return np.sqrt(np.diag(bread @ meat @ bread * (G / max(G - 1, 1))))


# ---------- 엣지 (D-14 와 같은 집합) ----------
fe = pd.read_csv(DATA / "freq_edges_500m.csv", encoding="utf-8-sig")
fe["edge_id"] = fe.edge_id.astype(str)
rd = json.load(open(ROOT / "web/public/data/roads.geojson", encoding="utf-8"))
geom = {str(f["properties"]["edge_id"]): shape(f["geometry"]) for f in rd["features"]}
e = gpd.GeoDataFrame(fe.assign(geometry=fe.edge_id.map(geom)), geometry="geometry", crs=4326).to_crs(5179)
e = e[e.geometry.notna()].reset_index(drop=True)

# ---------- 차폐 (엣지 평균) ----------
pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["point_id", "edge_id"]]
veh = pd.read_csv(DATA / "vehicle_occlusion_260820.csv", encoding="utf-8-sig")
veh = veh[veh.valid == True]
ev = pt.merge(veh[["point_id", "veh_extra_occ"]], on="point_id").groupby("edge_id").veh_extra_occ.mean()
ev.index = ev.index.astype(str)
e["veh"] = e.edge_id.map(ev)
e = e.dropna(subset=["dsi", "aadt", "length", "width", "veh"]).reset_index(drop=True)

# ---------- 결과변수: 엣지별 사고건수 ----------
acc = gpd.read_file(ROOT / "TAAS/사고정보/24_25/TAAS_교통사고지점및정보_2425.shp").to_crs(5179)
AP = np.array([[p.x, p.y] for p in acc.geometry])
# 엣지를 10m 간격으로 샘플링해 최근접 엣지를 찾는다 (선-점 거리)
samples, owner = [], []
for i, g in enumerate(e.geometry):
    n = max(int(g.length // 10), 1)
    for k in range(n + 1):
        p = g.interpolate(k * g.length / n)
        samples.append([p.x, p.y]); owner.append(i)
S = np.array(samples); owner = np.array(owner)
dist, idx = cKDTree(S).query(AP)
hit = dist < SNAP_M
cnt = np.bincount(owner[idx[hit]], minlength=len(e))
e["acc_n"] = cnt
print(f"엣지 {len(e):,}개 · 사고 {int(hit.sum())}/{len(acc)} 건 배정 ({hit.mean():.0%}, {SNAP_M:.0f}m 이내)")
print(f"  사고 있는 엣지 {int((e.acc_n > 0).sum()):,}개  분포 {dict(pd.Series(e.acc_n).value_counts().sort_index().head(6))}")

# ---------- 예측변수: 순위 척도 (D-14 와 동일) ----------
rk = lambda s: stats.rankdata(s) / len(s)
e["R_dsi"], e["R_aadt"], e["R_veh"] = rk(e.dsi), rk(e.aadt), rk(e.veh)
e["R_res"] = rk(e.R_veh - np.polyval(np.polyfit(e.R_aadt, e.R_veh, 1), e.R_aadt))
e["log_len"] = np.log(e.length)
y = e.acc_n.to_numpy(float)
off = e.log_len.to_numpy()                      # 길이 offset (기하적 노출)
grp = pd.factorize(e.aadt)[0]                   # 같은 aadt = 같은 최근접 계측점
print(f"  군집 {len(np.unique(grp))}개 · 총 사고 {int(y.sum())} · 평균 {y.mean():.4f}건/엣지\n")


def run(cols, label):
    X = np.column_stack([np.ones(len(e))] + [e[c].to_numpy() for c in cols])
    b, mu = poisson_irls(X, y, off)
    se = cluster_se(X, y, mu, grp)
    disp = ((y - mu) ** 2 / np.maximum(mu, 1e-9)).sum() / (len(y) - X.shape[1])
    print(f"[{label}]  n={len(e):,}  사고 {int(y.sum())}  과산포 {disp:.2f}")
    print(f"{'항':<10}{'계수':>10}{'SE':>9}{'z':>7}{'IRR':>8}")
    for k, c in enumerate(cols, start=1):
        print(f"{c:<10}{b[k]:>+10.4f}{se[k]:>9.4f}{b[k]/se[k]:>7.2f}{np.exp(b[k]):>8.3f}")
    return dict(zip(cols, b[1:])), dict(zip(cols, se))


CTL = ["width"]
mA, sA = run(["R_dsi", "R_aadt"] + CTL, "모형 A — 차폐 없음")
print()
mC, sC = run(["R_dsi", "R_aadt", "R_res"] + CTL, "모형 C — 초과차폐 포함  ★ 채택")

ws, wt, wv = 1.0, mC["R_aadt"] / mC["R_dsi"], mC["R_res"] / mC["R_dsi"]
beta = wt / (wt + wv)
alpha = ws / (ws + wt + wv)
print(f"\n{'='*62}")
print(f"[재유도 결과]  w_s : w_t : w_v = 1 : {wt:.2f} : {wv:.2f}")
print(f"               β = {beta:.3f}   α = {alpha:.3f}")
print(f"[D-14 (절단자료)]  1 : 2.47 : 0.96   β = 0.720   α = 0.226")
print(f"\n통행량 가중치 {wt/2.47:+.0%} 변화  ->  X-24 가 예측한 방향(과대추정)이 맞았는가?")

out = pd.DataFrame({
    "항": ["R_dsi", "R_aadt", "R_res"],
    "재유도(원시)": [mC["R_dsi"], mC["R_aadt"], mC["R_res"]],
    "SE": [sC["R_dsi"], sC["R_aadt"], sC["R_res"]],
    "D-14(절단)": [0.9583, 2.3654, 0.9209],
})
out["비율_재유도"] = out["재유도(원시)"] / mC["R_dsi"]
out["비율_D14"] = out["D-14(절단)"] / 0.9583
print()
print(out.round(4).to_string(index=False))
out.to_csv(DATA / "weight_rederive_raw.csv", index=False, encoding="utf-8-sig")
print(f"\n-> {DATA / 'weight_rederive_raw.csv'}")
