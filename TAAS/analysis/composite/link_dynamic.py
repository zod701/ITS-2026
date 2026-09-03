# -*- coding: utf-8 -*-
"""
링크 단위 동적 지수 — 단위보정 + IDW 보간 (PoC 근사)

    1단계  단위 보정   교차로 진입량 / 차수  → 링크 몫 근사
    2단계  공간 보간   IDW (k=5, p=1), 링크 중점 기준
    3단계  정규화      상하위 클리핑 후 min-max
    4단계  DSI 결합    DSI_dyn = β·V_norm + (1-β)·P_resid
                       DSI_t   = α·DSI_static + (1-α)·DSI_dyn
                       + data_source 신뢰도 플래그

**이것은 예측이 아니라 근사다.** D-15 는 여섯 번의 실패 끝에 교통량 공간 확장을 종료했고,
X-17 은 교통량이 공간적으로 매끄러운 장이 아니어서 IDW 계열이 원리상 작동하지 않음을 보였다.
그 결론은 유효하다. 이 스크립트는 정확도가 아니라 **결합 구조의 개념검증**을 위한 것이며,
산출물에 신뢰도 플래그를 달아 실측/보간/정적전용을 구분한다. 실측이 확충되면 해당 링크만
교체하면 되도록 설계했다.

P_resid 는 주정차 대리에서 통행량 성분을 뺀 잔차다 (D-13). 통행량 항이 같이 있으므로
원지표를 쓰면 겹치는 부분을 두 번 센다. 게다가 아래 가중치는 D-14 에서 **잔차화된 입력**으로
유도한 부분계수라, 원지표에 곱하면 전제가 깨진다. 잔차화된 입력과 부분가중치는 세트다.

가중치
    β = 0.398   동적 항 안에서 통행량 : 주정차.  **원시 사고지점 자료로 유도** (D-20 · X-25)
                포아송 계수 통행량 +0.929 / 초과차폐 +1.409 → 0.929/(0.929+1.409).
                절단 자료로 뽑았던 0.720 을 대체한다. 부트스트랩 95% CI [0.09, 0.61].
    α = 시나리오  정적 : 동적.  **자료로 유도하지 않는다** (D-21)
                같은 모형에서 DSI 계수가 음수(−0.959, CI 0 포함)로 나와 비율이 성립하지
                않는다. 중상 이상 사고는 간선 교차로에서 나고 DSI 는 그런 곳을 안전하게
                평가하기 때문이다(X-13). α 는 "자율주행의 구조적 시야 위험을 일반 교통
                노출 대비 얼마로 칠 것인가"라는 **설계 선택**이므로 구간으로 병기한다.
"""
import sys
from pathlib import Path

import geopandas as gpd
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

K, P = 5, 1.0            # IDW — 보정값 기준 LOO 최고 (X-23). k=3,p=2 는 R² 0.013
CLIP = (0.01, 0.99)      # 3단계 클리핑
BETA = 0.398                      # 원시 사고자료 재유도 (D-20)
ALPHAS = [0.20, 0.35, 0.50]       # 설계 시나리오 (D-21). 대표값은 가운데
ALPHA = ALPHAS[1]
SNAP_M = 60.0            # 계측점 → 노드 스냅 허용
DSI_BUF = 25.0           # 링크에 DSI 지점을 붙이는 반경
FAR_M = 1000.0           # 최근접 계측점이 이보다 멀면 '정적DSI만'


def ends(g):
    g = g.geoms[0] if g.geom_type.startswith("Multi") else g
    cs = list(g.coords)
    return cs[0], cs[-1]


# ---------- 도로망 + 노드 차수 ----------
ln = gpd.read_file(ROOT / "GIS/NODE_LINK_GANGNEUNG.gpkg", layer="moct_link_").to_crs(5179)
deg, pos = {}, {}
for _, r in ln.iterrows():
    a, b = ends(r.geometry)
    pos.setdefault(r.F_NODE, a); pos.setdefault(r.T_NODE, b)
    deg[r.F_NODE] = deg.get(r.F_NODE, 0) + 1
    deg[r.T_NODE] = deg.get(r.T_NODE, 0) + 1
nodes = list(pos)
NP = np.array([pos[n] for n in nodes])
print(f"표준노드링크 {len(ln):,} 링크 · {len(nodes):,} 노드")

# ---------- 1단계: 단위 보정 ----------
tv = pd.read_csv(DATA / "traffic_aadt.csv", encoding="utf-8-sig")[["cid", "aadt"]]
geo = pd.read_csv(DATA / "traffic_points_vworld.csv", encoding="utf-8-sig").dropna(subset=["lon"])
geo["cid"] = geo.cid.astype(str); tv["cid"] = tv.cid.astype(str)
tp = geo.merge(tv, on="cid")
tpg = gpd.GeoDataFrame(tp, geometry=gpd.points_from_xy(tp.lon, tp.lat), crs=4326).to_crs(5179)
TP = np.array([[g.x, g.y] for g in tpg.geometry])
d_sn, i_sn = cKDTree(NP).query(TP)
tp["node"] = [nodes[i] for i in i_sn]
tp["snap_m"] = d_sn
tp["deg"] = [deg[nodes[i]] for i in i_sn]
tp.loc[tp.snap_m > SNAP_M, "deg"] = np.nan          # 스냅 실패분은 차수 미상
tp["deg"] = tp.deg.fillna(tp.deg.median())
tp["v_adj"] = tp.aadt / tp.deg                      # ★ 1단계
tp["x"], tp["y"] = TP[:, 0], TP[:, 1]
print(f"계측점 {len(tp)}개 · 스냅 성공 {(tp.snap_m <= SNAP_M).sum()}개 "
      f"(중앙 {tp.snap_m.median():.0f}m) · 차수 중앙 {tp.deg.median():.0f}")
print(f"  진입량 중앙 {tp.aadt.median():,.0f} → 링크 몫 중앙 {tp.v_adj.median():,.0f}")

# ---------- 2단계: IDW ----------
mid = ln.geometry.interpolate(0.5, normalized=True)
MID = np.array([[m.x, m.y] for m in mid])
tree = cKDTree(tp[["x", "y"]].to_numpy())
dist, idx = tree.query(MID, k=K)
w = 1.0 / np.maximum(dist, 1.0) ** P
ln["v_link"] = (w * tp.v_adj.to_numpy()[idx]).sum(1) / w.sum(1)      # ★ 2단계
ln["d_near"] = dist[:, 0]

# ---------- 3단계: 정규화 ----------
lo, hi = ln.v_link.quantile(CLIP)
v = ln.v_link.clip(lo, hi)
ln["v_norm"] = (v - v.min()) / (v.max() - v.min())                   # ★ 3단계
print(f"\n보간값 {ln.v_link.min():,.0f}~{ln.v_link.max():,.0f} "
      f"→ 클리핑 {lo:,.0f}~{hi:,.0f} → v_norm 0~1")

# ---------- 링크에 정적 DSI · 주정차 대리 붙이기 ----------
pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["point_id", "geometry"]].to_crs(5179)
veh = pd.read_csv(DATA / "vehicle_occlusion_260820.csv", encoding="utf-8-sig")
veh = veh[veh.valid == True]
pt = pt.merge(veh[["point_id", "dsi_refined", "veh_extra_occ"]], on="point_id")
PX = np.array([[g.x, g.y] for g in pt.geometry])
ptree = cKDTree(PX)
DSI, VEH = pt.dsi_refined.to_numpy(), pt.veh_extra_occ.to_numpy()
ds, vs, npt = [], [], []
for g in ln.geometry:
    n = max(int(g.length // 10), 1)
    S = np.array([[p.x, p.y] for p in (g.interpolate(i * g.length / n) for i in range(n + 1))])
    hit = {j for lst in ptree.query_ball_point(S, DSI_BUF) for j in lst}
    npt.append(len(hit))
    ds.append(DSI[list(hit)].mean() if hit else np.nan)
    vs.append(VEH[list(hit)].mean() if hit else np.nan)
ln["n_dsi_pt"], ln["dsi_static"], ln["p_dummy_raw"] = npt, ds, vs
cov = ln.dsi_static.notna().mean()
print(f"DSI 결합: {ln.dsi_static.notna().sum():,}/{len(ln):,} 링크 ({cov:.1%}) · "
      f"링크당 지점 중앙 {np.median([x for x in npt if x]):.0f}")

# 주정차 대리도 같은 방식으로 0~1 정규화
pv = ln.p_dummy_raw
plo, phi = pv.quantile(CLIP)
ln["p_dummy"] = ((pv.clip(plo, phi) - pv.clip(plo, phi).min())
                 / (pv.clip(plo, phi).max() - pv.clip(plo, phi).min()))

# 정적 DSI 도 0~1 로 (결합식이 같은 척도를 요구)
dv = ln.dsi_static
dlo, dhi = dv.quantile(CLIP)
ln["dsi_static_n"] = ((dv.clip(dlo, dhi) - dv.clip(dlo, dhi).min())
                      / (dv.clip(dlo, dhi).max() - dv.clip(dlo, dhi).min()))

# 통행량 성분 제거 — D-13. 통행량 항이 옆에 있으므로 잔차화가 필요하다.
pr = lambda a: stats.rankdata(a) / len(a)
ok = ln.p_dummy.notna()
rv, rp = pr(ln.loc[ok, "v_norm"]), pr(ln.loc[ok, "p_dummy"])
ln.loc[ok, "p_resid"] = pr(rp - np.polyval(np.polyfit(rv, rp, 1), rv))
print(f"주정차대리 ~ 보간통행량  원지표 rho {stats.spearmanr(ln.p_dummy[ok], ln.v_norm[ok]).statistic:+.3f}"
      f"  ->  잔차 rho {stats.spearmanr(ln.p_resid[ok], ln.v_norm[ok]).statistic:+.3f}")

# ---------- 4단계: 결합 + 신뢰도 플래그 ----------
ln["dsi_dynamic"] = BETA * ln.v_norm + (1 - BETA) * ln.p_resid
for a in ALPHAS:
    ln[f"dsi_t_a{int(a*100):03d}"] = a * ln.dsi_static_n + (1 - a) * ln.dsi_dynamic
ln["dsi_t"] = ln[f"dsi_t_a{int(ALPHA*100):03d}"]        # 대표값

measured_nodes = set(tp.loc[tp.snap_m <= SNAP_M, "node"])
src = []
for _, r in ln.iterrows():
    if pd.isna(r.dsi_static):
        src.append("정적DSI없음")
    elif r.F_NODE in measured_nodes or r.T_NODE in measured_nodes:
        src.append("실측")
    elif r.d_near > FAR_M:
        src.append("정적DSI만")
    else:
        src.append("보간")
ln["data_source"] = src
# '정적DSI만' 과 'DSI없음' 은 동적 항을 신뢰하지 않는다
only_static = ln.data_source.isin(["정적DSI만", "정적DSI없음"])
for a in ALPHAS:
    ln.loc[only_static, f"dsi_t_a{int(a*100):03d}"] = ln.dsi_static_n
ln.loc[only_static, "dsi_t"] = ln.dsi_static_n

print("\n[신뢰도 플래그]")
for k, g in ln.groupby("data_source"):
    print(f"  {k:<10} 링크 {len(g):>5,} ({len(g)/len(ln):>5.1%})  "
          f"연장 {g.geometry.length.sum()/1000:>6,.1f}km  최근접계측 중앙 {g.d_near.median():>6,.0f}m")

out = ln[["LINK_ID", "F_NODE", "T_NODE", "ROAD_NAME", "LANES", "ROAD_RANK",
          "n_dsi_pt", "dsi_static", "dsi_static_n", "v_link", "v_norm",
          "p_dummy_raw", "p_dummy", "p_resid", "dsi_dynamic",
          *[f"dsi_t_a{int(a*100):03d}" for a in ALPHAS], "dsi_t",
          "d_near", "data_source"]].copy()
out["length_m"] = ln.geometry.length.values
out.to_csv(DATA / "link_dynamic_index.csv", index=False, encoding="utf-8-sig")
ln.to_file(DATA / "link_dynamic_index.gpkg", layer="link_dsi_t", driver="GPKG")
print(f"\n-> {DATA / 'link_dynamic_index.csv'}")
print(f"-> {DATA / 'link_dynamic_index.gpkg'} (layer: link_dsi_t)")

# ---------- 검증: 이 파이프라인의 실제 LOO 성능 ----------
print("\n[LOO 교차검증 — 1단계 보정값을 대상으로, 이 파이프라인 그대로]")
XY = tp[["x", "y"]].to_numpy()
y = np.log(tp.v_adj.to_numpy())


def loo(k, p):
    pred = np.empty(len(tp))
    for i in range(len(tp)):
        m = np.ones(len(tp), bool); m[i] = False
        dd = np.linalg.norm(XY[m] - XY[i], axis=1)
        o = np.argsort(dd)[:k]
        ww = 1.0 / np.maximum(dd[o], 1.0) ** p
        pred[i] = (ww * y[m][o]).sum() / ww.sum()
    r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    fold = np.exp(np.abs(y - pred))
    return r2, stats.spearmanr(pred, y).statistic, np.median(fold), np.percentile(fold, 90)


for k, p in [(K, P), (3, 2), (3, 1), (5, 2), (8, 2)]:
    r2, rho, md, p90 = loo(k, p)
    tag = "  ← 채택" if (k, p) == (K, P) else ""
    print(f"  k={k} p={p}   R² {r2:>+7.3f}   rho {rho:>+.3f}   배수오차 중앙 {md:.2f} p90 {p90:.2f}{tag}")

r2v = loo(K, P)[0]
print(f"\n※ 문서화용 실제 수치: IDW(k={K}, p={int(P)}) LOO R² = {r2v:+.3f}")
print("   (보정 전 교차로 AADT 기준 X-07 의 0.244 와는 다른 대상·다른 설정이다)")
