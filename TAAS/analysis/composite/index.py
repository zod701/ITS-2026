# -*- coding: utf-8 -*-
"""
교차로 결합 위험지수 (CDI) — 정적 DSI + 동적 지수

구조
  CDI = w_s·DSI + w_t·통행량 + w_v·초과차폐        (각 항은 백분위 순위 0~1 로 정규화)

  w_s : w_t : w_v = 1 : 2.47 : 0.40~0.96                        (D-14 · X-15)
      빈도모형(사고밀집 오즈 ~ DSI + 교통량 + 초과차폐 + 길이 + 폭, n=3,706)의 계수비다.
      **순위 척도에서 추정**하므로 SD 단위 환산이 필요 없다 — 지수가 순위로 결합하기
      때문이고, SD 로 환산하면 어느 단위(지점/엣지/교차로)의 SD 를 쓰느냐에 따라
      비율이 1.85~4.49 로 흔들린다 (D-07 의 1:1.95 가 그 문제를 안고 있었다).
  w_v = 0.40 ~ 0.96 구간
      독립적인 두 경로가 수렴하지 않았다. 빈도모형 0.96, 파이프라인 내부 탄력도 0.40.
      단일값을 못 주므로 구간으로 제시한다. 구간 안에서 순위상관 0.983 이상이라
      실질 영향은 작다. 불법주정차 실측이 확보되면 이 항만 교체하면 된다.

  초과차폐 = 차량차폐 - (통행량으로 예측된 차량차폐)          (D-13 · X-14)
      원지표를 그대로 쓰면 통행량을 두 번 센다. 차량차폐는 통행량과 rho +0.496
      (공유분산 24.6%) 이고 도로폭을 통제해도 +0.476 으로 거의 줄지 않는다.
      잔차만 남기면 통행량과의 상관이 +0.049 로 떨어진다. 의미도
      "이 통행량이면 예상되는 것보다 더 가려져 있다" 가 되어 주정차 대리에 가까워진다.
      버리는 성분은 1번 항이 이미 100% 담고 있으므로 정보 손실이 아니라 중복 제거다.

단위를 교차로로 두는 이유
  통행량 자료가 '교차로 진입량'이라 링크 속성이 아니다. 링크로 보간하려는 시도는
  네 가지 방식 모두 실패했다(최고 CV R² 0.24, 배수오차 1.35~1.44). 자료의 원래 단위를
  지키는 편이 정직하다.
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
RADIUS = 75.0           # 교차로 영향권 — D-12 (방사 감쇠 프로파일)
W_S, W_T = 1.0, 2.47    # 순위척도 계수비 (D-14)
W_V_RANGE = [0.0, 0.40, 0.70, 0.96]   # 0 = 시나리오 없음, 0.40~0.96 = 유도 구간

# ---------- 교차로(계측점) ----------
tv = pd.read_csv(DATA / "traffic_aadt.csv", encoding="utf-8-sig")[["cid", "aadt"]]
geo = pd.read_csv(DATA / "traffic_points_vworld.csv", encoding="utf-8-sig").dropna(subset=["lon"])
geo["cid"] = geo.cid.astype(str); tv["cid"] = tv.cid.astype(str)
ix = geo.merge(tv, on="cid")
ix = gpd.GeoDataFrame(ix, geometry=gpd.points_from_xy(ix.lon, ix.lat), crs=4326).to_crs(5179)

# ---------- 지점별 DSI + 차량차폐 ----------
pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["point_id", "geometry"]]
veh = pd.read_csv(DATA / "vehicle_occlusion_260820.csv", encoding="utf-8-sig")
veh = veh[veh.valid == True]
pt = pt.merge(veh[["point_id", "dsi_refined", "veh_extra_occ", "dsi_veh"]], on="point_id", how="inner")
print(f"DSI 지점 {len(pt):,} · 교차로 {len(ix)}개 · 영향권 {RADIUS:.0f}m")

PX = np.array([[g.x, g.y] for g in pt.geometry])
IX = np.array([[g.x, g.y] for g in ix.geometry])
near = cKDTree(PX).query_ball_point(IX, RADIUS)
rows = []
for k, idxs in enumerate(near):
    if len(idxs) < 5:
        continue
    s = pt.iloc[idxs]
    rows.append({
        "cid": ix.cid.iloc[k], "name": ix.name.iloc[k], "aadt": ix.aadt.iloc[k],
        "lon": ix.lon.iloc[k], "lat": ix.lat.iloc[k], "n_pt": len(idxs),
        "dsi": s.dsi_refined.mean(), "dsi_p90": s.dsi_refined.quantile(.9),
        "veh_occ": s.veh_extra_occ.mean(), "dsi_veh": s.dsi_veh.mean(),
    })
d = pd.DataFrame(rows)
print(f"영향권에 DSI 지점 5개 이상인 교차로 {len(d)}개\n")

pr = lambda s: stats.rankdata(s) / len(s)
d["r_dsi"] = pr(d.dsi)
d["r_aadt"] = pr(d.aadt)
d["r_veh"] = pr(d.veh_occ)

# ---------- 통행량 성분 제거 ----------
d["veh_pred"] = np.polyval(np.polyfit(d.r_aadt, d.r_veh, 1), d.r_aadt)
d["veh_resid"] = d.r_veh - d.veh_pred
d["r_resid"] = pr(d.veh_resid)
print("[중복 제거] 차량차폐에서 통행량으로 설명되는 몫을 뺀다")
for lab, col in [("차폐(원)", "r_veh"), ("통행량몫", "veh_pred"), ("초과차폐", "r_resid")]:
    print(f"    {lab:<8} ~ 통행량  rho {stats.spearmanr(d[col], d.r_aadt).statistic:+.3f}")
print(f"    분해 오차 {abs(d.veh_pred + d.veh_resid - d.r_veh).max():.1e}\n")


def cdi(w_v):
    w = np.array([W_S, W_T, w_v], float)
    w = w / w.sum()
    return w[0] * d.r_dsi + w[1] * d.r_aadt + w[2] * d.r_resid


for wv in W_V_RANGE:
    d[f"cdi_{wv}"] = cdi(wv)

# ---------- 무엇이 달라지는가 ----------
print("[정적 DSI 만으로 매긴 순위 vs 결합 지수 순위]")
base = d.r_dsi.rank(ascending=False)
for wv in [0.0, 0.96]:
    comb = d[f"cdi_{wv}"].rank(ascending=False)
    rho = stats.spearmanr(base, comb).statistic
    moved = (abs(base - comb) >= 10).sum()
    print(f"  w_v={wv}:  순위상관 {rho:+.3f}   10위 이상 이동한 교차로 {moved}/{len(d)}개")
print()

print("[결합 지수 상위 12 — w_v=0 (DSI+통행량만)]")
top = d.nlargest(12, "cdi_0.0")
print(f"{'교차로':<24}{'CDI':>6}{'DSI':>7}{'순위':>5}{'통행량':>9}{'순위':>5}{'차량차폐':>8}")
print("-" * 68)
for _, r in top.iterrows():
    print(f"{r['name'][:22]:<24}{r['cdi_0.0']:>6.3f}{r.dsi:>7.3f}{int(d.r_dsi.rank(ascending=False)[r.name]):>5}"
          f"{r.aadt:>9,.0f}{int(d.r_aadt.rank(ascending=False)[r.name]):>5}{r.veh_occ:>8.3f}")
print()

print("[초과차폐를 넣으면 가장 크게 오르는 교차로 — 시나리오 효과]")
d["jump"] = d["cdi_0.0"].rank(ascending=False) - d["cdi_0.96"].rank(ascending=False)
for _, r in d.nlargest(6, "jump").iterrows():
    print(f"    {r['name'][:22]:<24} {int(d['cdi_0.0'].rank(ascending=False)[r.name]):>3}위 → "
          f"{int(d['cdi_0.96'].rank(ascending=False)[r.name]):>3}위  "
          f"(초과차폐 상위 {(1-r.r_resid)*100:.0f}%, 통행량 상위 {(1-r.r_aadt)*100:.0f}%)")

d.to_csv(DATA / "composite_index_intersections.csv", index=False, encoding="utf-8-sig")
print(f"\n-> {DATA / 'composite_index_intersections.csv'}")
