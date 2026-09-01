# -*- coding: utf-8 -*-
"""
영향권 반경 — 방사 감쇠 프로파일로 정한다

composite/radius_sweep.py 의 신뢰도 기준은 반경을 고르지 못했다(30~300m 단조증가).
교차로간 SD 가 어느 반경에서도 0.09 로 평평했기 때문 — 300m 까지 가도
DSI 장의 공간구조가 안 씻긴다. '집계평균의 정밀도'는 반경이 클수록 좋아지므로
애초에 최댓값을 갖지 않는 양이었다.

대신 영향권의 원래 정의로 돌아간다: **교차로 근처에서 DSI 가 배경보다 높다면,
그 초과가 사라지는 거리가 영향권이다.**

  각 DSI 지점을 가장 가까운 교차로에만 배정(중복계산 없음) → 거리 구간별 평균 →
  배경(먼 거리 점근값) 대비 초과분의 감쇠 곡선.
"""
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
DATA = BASE / "data"
sys.stdout.reconfigure(encoding="utf-8")

BIN, MAXD = 25.0, 600.0
BOOT = 400
rng = np.random.default_rng(7)

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
dist, owner = cKDTree(IX).query(PX, k=1)      # 최근접 교차로에만 배정
DSI, VEH = pt.dsi_refined.to_numpy(), pt.veh_extra_occ.to_numpy()

edges = np.arange(0, MAXD + BIN, BIN)
b = np.digitize(dist, edges) - 1
bg = (dist >= 400) & (dist < 600)             # 배경 정의
base_d, base_v = DSI[bg].mean(), VEH[bg].mean()
print(f"DSI 지점 {len(pt):,} · 교차로 {len(ix)}개")
print(f"배경(400~600m, n={bg.sum():,}):  DSI {base_d:.4f}   차량차폐 {base_v:.4f}\n")

print(f"{'거리대':>11}{'n':>7}{'DSI':>8}{'초과':>8}{'95% CI':>18}{'차폐':>8}{'초과':>8}")
print("-" * 70)
rows = []
for k in range(len(edges) - 1):
    m = b == k
    if m.sum() < 30:
        continue
    d_, v_, o_ = DSI[m], VEH[m], owner[m]
    # 교차로 단위 군집 부트스트랩 (D-10 유사복제 대응)
    cl = np.unique(o_); reps = []
    for _ in range(BOOT):
        pick = rng.choice(cl, len(cl), replace=True)
        reps.append(np.concatenate([d_[o_ == c] for c in pick]).mean())
    lo, hi = np.percentile(reps, [2.5, 97.5])
    rows.append(dict(lo_m=edges[k], hi_m=edges[k + 1], n=m.sum(), dsi=d_.mean(),
                     exc=d_.mean() - base_d, ci_lo=lo - base_d, ci_hi=hi - base_d,
                     veh=v_.mean(), veh_exc=v_.mean() - base_v))
    sig = "*" if (lo - base_d) > 0 else " "
    print(f"{edges[k]:>5.0f}~{edges[k+1]:>4.0f}{m.sum():>7,}{d_.mean():>8.4f}"
          f"{d_.mean()-base_d:>+8.4f} [{lo-base_d:>+6.4f},{hi-base_d:>+6.4f}]{sig}"
          f"{v_.mean():>8.4f}{v_.mean()-base_v:>+8.4f}")

p = pd.DataFrame(rows)
# DSI 초과는 음수(교차로 근처가 배경보다 낮다)라 감쇠비율이 뜻이 없다.
# 경계는 CI 로 읽고, 감쇠 곡선은 단조 양수인 차량차폐에서 읽는다.
print(f"\n[DSI] 0~{BIN:.0f}m 초과 {p.exc.iloc[0]:+.4f}"
      f"  = 정적 DSI 1SD(0.208)의 {abs(p.exc.iloc[0])/0.208:.2f}배 (부호는 음)")
neg = p[p.ci_hi < 0]
if len(neg):
    print(f"  배경보다 낮은 것이 유의한 마지막 거리대: {neg.hi_m.iloc[-1]:.0f}m")
pos = p[p.ci_lo > 0]
if len(pos):
    print(f"  배경보다 높은 것이 유의한 구간: "
          f"{pos.lo_m.iloc[0]:.0f}~{pos.hi_m.iloc[-1]:.0f}m")

vpeak = p.veh_exc.iloc[0]
print(f"\n[차량차폐] 0~{BIN:.0f}m 초과 {vpeak:+.4f} (배경 {base_v:.4f} 대비 {vpeak/base_v:+.0%})")
for frac in [.5, .25, .1]:
    hit = p[p.veh_exc < vpeak * frac]
    if len(hit):
        print(f"  최대치의 {frac:.0%} 아래로: {hit.lo_m.iloc[0]:.0f}m")

p.to_csv(DATA / "radius_profile.csv", index=False, encoding="utf-8-sig")
print(f"-> {DATA / 'radius_profile.csv'}")
