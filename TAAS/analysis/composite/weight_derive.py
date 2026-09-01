# -*- coding: utf-8 -*-
"""
w_v 유도 — 두 개의 독립 경로

경로 ① 빈도모형 계수비 (D-07 을 그대로 확장)
    엣지 단위 로지스틱에 초과차폐를 넣고 1SD 계수를 읽는다. 모형에 log(교통량)이
    이미 들어 있으므로 차폐 계수는 **통행량을 통제한 부분효과**다 (D-13 이 요구하는 조건).
    FWL 정리에 따라 원지표를 넣든 잔차를 넣든 차폐 계수는 같다 — 아래에서 확인한다.
    달라지는 것은 1SD 환산에 쓰는 SD 뿐이고, 지수가 잔차를 쓰므로 잔차의 SD 를 쓴다.

경로 ② 파이프라인 내부 탄력도
    파이프라인은 이미 dsi_veh(차량 차폐를 포함한 DSI)를 계산한다. 즉 차폐를 구조적
    위험 대비 얼마로 치는지에 대한 내부 답을 갖고 있다. 그 비율을 읽는다.

D-07 규약: 계수는 엣지 모형에서, 1SD 는 **교차로 단위**에서 취한다. 지수가 교차로 단위이기
때문이다. (D-07 이 'log교통량 1SD(교차로, 0.4876)' 이라 적은 것과 같은 처리)
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


def logit_irls(X, y, max_iter=60, tol=1e-9):
    b = np.zeros(X.shape[1])
    for _ in range(max_iter):
        eta = np.clip(X @ b, -30, 30)
        p = 1 / (1 + np.exp(-eta))
        W = np.clip(p * (1 - p), 1e-9, None)
        XtW = X.T * W
        b_new = np.linalg.solve(XtW @ X, XtW @ (eta + (y - p) / W))
        if np.max(np.abs(b_new - b)) < tol:
            return b_new, 1 / (1 + np.exp(-np.clip(X @ b_new, -30, 30)))
        b = b_new
    return b, 1 / (1 + np.exp(-np.clip(X @ b, -30, 30)))


def cluster_se(X, y, p, groups):
    W = np.clip(p * (1 - p), 1e-9, None)
    bread = np.linalg.inv((X.T * W) @ X)
    u = y - p
    meat = np.zeros((X.shape[1], X.shape[1]))
    for g in np.unique(groups):
        m = groups == g
        s = X[m].T @ u[m]
        meat += np.outer(s, s)
    G = len(np.unique(groups))
    return np.sqrt(np.diag(bread @ meat @ bread * (G / max(G - 1, 1))))


def vif(X):
    out = []
    for j in range(1, X.shape[1]):
        o = [k for k in range(X.shape[1]) if k != j]
        b, *_ = np.linalg.lstsq(X[:, o], X[:, j], rcond=None)
        r = X[:, j] - X[:, o] @ b
        ss = ((X[:, j] - X[:, j].mean()) ** 2).sum()
        out.append(1 / max(1 - (1 - (r ** 2).sum() / ss), 1e-9))
    return out


# ---------- 엣지 자료 (accident/frequency.py 와 동일 절차) ----------
fe = pd.read_csv(DATA / "freq_edges_500m.csv", encoding="utf-8-sig")
pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["point_id", "edge_id"]]
veh = pd.read_csv(DATA / "vehicle_occlusion_260820.csv", encoding="utf-8-sig")
veh = veh[veh.valid == True]
ev = pt.merge(veh[["point_id", "veh_extra_occ"]], on="point_id").groupby("edge_id").agg(
    veh=("veh_extra_occ", "mean"), n_pt=("veh_extra_occ", "size"))
ev.index = ev.index.astype(str)
fe["edge_id"] = fe.edge_id.astype(str)
d = fe.merge(ev, left_on="edge_id", right_index=True, how="inner").dropna(
    subset=["dsi", "aadt", "length", "width", "veh"])
print(f"엣지 {len(d):,}개 (사례 {int(d.case.sum())}) · 차폐 결합 {len(d)/len(fe):.0%}")

z = lambda s: (s - s.mean()) / s.std(ddof=1)
rk = lambda s: stats.rankdata(s) / len(s)          # 백분위 순위 — 지수와 같은 척도
d["log_aadt"] = np.log(d.aadt)
d["log_len"] = np.log(d.length)

# 지수는 순위로 결합한다. 계수도 순위 척도에서 뽑아야 SD 단위 환산이 필요 없다.
d["R_dsi"], d["R_aadt"], d["R_veh"] = rk(d.dsi), rk(d.aadt), rk(d.veh)
d["R_res"] = rk(d.R_veh - np.polyval(np.polyfit(d.R_aadt, d.R_veh, 1), d.R_aadt))

y = d.case.to_numpy(float)
grp = pd.factorize(d.aadt)[0]        # 같은 aadt = 같은 최근접 계측점 (75개)
print(f"군집 {len(np.unique(grp))}개 (계측점)")


def run(cols, label):
    X = np.column_stack([np.ones(len(d))] + [d[c].to_numpy() for c in cols])
    b, p = logit_irls(X, y)
    se = cluster_se(X, y, p, grp)
    v = vif(X)
    print(f"\n[{label}]  n={len(d):,}  사례 {int(y.sum())}")
    print(f"{'항':<10}{'계수':>10}{'SE':>9}{'z':>7}{'VIF':>7}")
    for k, c in enumerate(cols, start=1):
        print(f"{c:<10}{b[k]:>+10.4f}{se[k]:>9.4f}{b[k]/se[k]:>7.2f}{v[k-1]:>7.2f}")
    return dict(zip(cols, b[1:]))


CTL = ["log_len", "width"]
mA = run(["R_dsi", "R_aadt"] + CTL, "모형 A — 차폐 없음 (D-07 재현, 순위척도)")
mB = run(["R_dsi", "R_aadt", "R_veh"] + CTL, "모형 B — 차폐 원지표")
mC = run(["R_dsi", "R_aadt", "R_res"] + CTL, "모형 C — 초과차폐(잔차)  ★ 채택")

print(f"\n[가중치 — 순위 척도 계수비, 환산 불필요]")
print(f"  차폐 없음   w_s : w_t         = 1 : {mA['R_aadt']/mA['R_dsi']:.2f}")
print(f"  원지표      w_s : w_t : w_v   = 1 : {mB['R_aadt']/mB['R_dsi']:.2f} : {mB['R_veh']/mB['R_dsi']:.2f}")
print(f"  초과차폐    w_s : w_t : w_v   = 1 : {mC['R_aadt']/mC['R_dsi']:.2f} : {mC['R_res']/mC['R_dsi']:.2f}")

# ---------- D-07 의 척도 의존성 ----------
ix = pd.read_csv(DATA / "composite_index_intersections.csv", encoding="utf-8-sig")
vv = veh
b_s, b_t = 0.2013 / 0.2078, 0.8065
print(f"\n[참고 — D-07 의 1:1.95 는 SD 를 어디서 취하느냐에 달려 있다]")
for lab, sd_s, sd_t in [("엣지 통일", d.dsi.std(ddof=1), d.log_aadt.std(ddof=1)),
                        ("교차로 통일", ix.dsi.std(ddof=1), np.log(ix.aadt).std(ddof=1)),
                        ("D-07 (혼합)", 0.2078, 0.4876)]:
    print(f"    {lab:<12} 1 : {(b_t*sd_t)/(b_s*sd_s):.2f}")
print("    DSI 는 영향권 평균을 내면 SD 가 0.208 -> 0.091 로 줄고 교통량은 안 줄어든다.")
print("    순위 척도에는 이 문제가 없다 — 어느 단위든 균등분포로 맞춰지기 때문이다.")

# ---------- 경로 ② 파이프라인 내부 탄력도 ----------
A = np.column_stack([np.ones(len(vv)), rk(vv.dsi_refined), rk(vv.veh_extra_occ)])
coef, *_ = np.linalg.lstsq(A, rk(vv.dsi_veh), rcond=None)
print(f"\n[경로 ② 파이프라인 내부 비중 — 순위 척도, n={len(vv):,}]")
print(f"  rank(dsi_veh) = {coef[0]:+.3f} + {coef[1]:.3f}·rank(DSI) + {coef[2]:.3f}·rank(차폐)")
print(f"  w_v / w_s = {coef[2]/coef[1]:.2f}")
