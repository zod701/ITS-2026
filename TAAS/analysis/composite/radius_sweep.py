# -*- coding: utf-8 -*-
"""
교차로 영향권 반경 선택 — 세 가지 기준을 같은 축에 놓고 본다

  ① 중첩      이웃 교차로와 영향권이 겹치기 시작하는 반경 (기하 상한)
  ② 신뢰도    집계평균의 신호 대 잡음. 반경이 작으면 표본이 적어 잡음, 크면
              진입로·다음 블록까지 평균해 교차로 간 분산이 무너진다. 유한한 r 에서 최대.
  ③ 안정성    인접 반경 간 순위상관. 순위가 더는 안 움직이는 고원.

신뢰도 정의 (ICC 계열)
  var_between = 교차로별 집계값의 분산
  var_noise   = 평균(교차로 내 분산 / n)          ... 집계평균의 표집분산
  reliability = (var_between - var_noise) / var_between

  D-10 의 유사복제(5m 간격) 때문에 n 을 그대로 쓰면 잡음이 과소평가된다.
  25m 격자 점유 칸 수를 유효 n 으로 둔 판을 함께 낸다 (보수적).
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

RADII = [30, 40, 50, 60, 75, 90, 100, 125, 150, 200, 250, 300]
MIN_PT = 5
CELL = 25.0     # 유효 n 산정용 격자

# 원본 xlsx 주소 오류 보정 — geocode_traffic.ADDR_FIX 와 같은 내용

tv = pd.read_csv(DATA / "traffic_aadt.csv", encoding="utf-8-sig")[["cid", "aadt"]]
geo = pd.read_csv(DATA / "traffic_points_vworld.csv", encoding="utf-8-sig").dropna(subset=["lon"])
geo["cid"] = geo.cid.astype(str); tv["cid"] = tv.cid.astype(str)
ix = geo.merge(tv, on="cid")
ix = gpd.GeoDataFrame(ix, geometry=gpd.points_from_xy(ix.lon, ix.lat), crs=4326).to_crs(5179)

pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["point_id", "geometry"]]
veh = pd.read_csv(DATA / "vehicle_occlusion_260820.csv", encoding="utf-8-sig")
veh = veh[veh.valid == True]
pt = pt.merge(veh[["point_id", "dsi_refined", "veh_extra_occ"]], on="point_id", how="inner")

PX = np.array([[g.x, g.y] for g in pt.geometry])
IX = np.array([[g.x, g.y] for g in ix.geometry])
DSI = pt.dsi_refined.to_numpy()
VEH = pt.veh_extra_occ.to_numpy()
tree = cKDTree(PX)

# ① 중첩 — 교차로 간 최근접이웃 거리
nn = cKDTree(IX).query(IX, k=2)[0][:, 1]
print(f"교차로 {len(ix)}개 · DSI 지점 {len(pt):,}개")
print(f"교차로 최근접이웃 거리  p05 {np.percentile(nn,5):.0f}m  p25 {np.percentile(nn,25):.0f}m  "
      f"중앙 {np.median(nn):.0f}m\n")


def agg(r):
    near = tree.query_ball_point(IX, r)
    keep, mean_, p90_, vehm, n_, neff_, wvar_ = [], [], [], [], [], [], []
    owner = {}
    for k, idx in enumerate(near):
        for i in idx:
            owner.setdefault(i, set()).add(k)
        if len(idx) < MIN_PT:
            continue
        v = DSI[idx]
        cells = {(int(x // CELL), int(y // CELL)) for x, y in PX[idx]}
        keep.append(k); n_.append(len(idx)); neff_.append(len(cells))
        mean_.append(v.mean()); p90_.append(np.quantile(v, .9))
        vehm.append(VEH[idx].mean()); wvar_.append(v.var(ddof=1) if len(v) > 1 else 0.0)
    shared = sum(1 for s in owner.values() if len(s) > 1)
    return (np.array(keep), np.array(mean_), np.array(p90_), np.array(vehm),
            np.array(n_), np.array(neff_), np.array(wvar_), len(owner), shared)


def reliability(vals, wvar, n):
    vb = vals.var(ddof=1)
    vn = np.mean(wvar / np.maximum(n, 1))
    return (vb - vn) / vb if vb > 0 else np.nan, vb, vn


rows, ranks = [], {}
for r in RADII:
    keep, mn, p90, vh, n, neff, wvar, cov_pt, shared = agg(r)
    rel_n, vb, vn = reliability(mn, wvar, n)
    rel_e, _, vne = reliability(mn, wvar, neff)
    rel90, _, _ = reliability(p90, wvar, n)
    ranks[r] = pd.Series(stats.rankdata(-mn), index=keep)
    rows.append(dict(r=r, n_ix=len(keep), n_pt_med=np.median(n),
                     overlap=(nn < 2 * r).mean(), shared_pt=shared / max(cov_pt, 1),
                     sd_between=np.sqrt(vb), rel_n=rel_n, rel_eff=rel_e, rel_p90=rel90,
                     veh_sd=vh.std(ddof=1)))
t = pd.DataFrame(rows)

# ③ 안정성 — 인접 반경 간 순위상관 (공통 교차로만)
t["rho_prev"] = np.nan
for i in range(1, len(RADII)):
    a, b = ranks[RADII[i - 1]], ranks[RADII[i]]
    c = a.index.intersection(b.index)
    t.loc[i, "rho_prev"] = stats.spearmanr(a[c], b[c]).statistic

print(f"{'반경':>5}{'교차로':>6}{'n_pt':>6}{'중첩':>7}{'공유점':>7}"
      f"{'SD간':>8}{'신뢰도':>8}{'유효n':>8}{'p90신뢰':>8}{'ρ(직전)':>9}")
print("-" * 74)
for _, x in t.iterrows():
    rp = f"{x.rho_prev:+.3f}" if pd.notna(x.rho_prev) else "    —"
    print(f"{x.r:>5.0f}{x.n_ix:>6.0f}{x.n_pt_med:>6.0f}{x.overlap:>6.0%}{x.shared_pt:>7.0%}"
          f"{x.sd_between:>8.3f}{x.rel_n:>8.3f}{x.rel_eff:>8.3f}{x.rel_p90:>8.3f}{rp:>9}")

best_n = t.loc[t.rel_n.idxmax()]; best_e = t.loc[t.rel_eff.idxmax()]
print(f"\n신뢰도 최대  원n {best_n.r:.0f}m ({best_n.rel_n:.3f})   "
      f"유효n {best_e.r:.0f}m ({best_e.rel_eff:.3f})")
t.to_csv(DATA / "radius_sweep.csv", index=False, encoding="utf-8-sig")
print(f"-> {DATA / 'radius_sweep.csv'}")
