# -*- coding: utf-8 -*-
"""귀무 결과의 해석에 필요한 진단: 검정력, 범위제한, 분모 잡음, 가중 재분석"""
import json, sys
import geopandas as gpd, numpy as np, pandas as pd
from scipy import stats
from pathlib import Path

# TAAS/analysis/ 아래로 옮겨졌다. 데이터는 저장소 루트 기준이고 산출물은 이 스크립트 옆에
# 두므로, 실행 위치와 무관하도록 둘 다 __file__ 에서 푼다.
HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
DATA = BASE / "data"

sys.stdout.reconfigure(encoding="utf-8")

df = pd.read_csv(DATA / "dsi_severity_areas.csv", encoding="utf-8-sig")
r = df[df.set == "risk"].dropna(subset=["dsi_mean"])
s = df[df.set == "spot"].dropna(subset=["dsi_mean"])

print("[A] 검정력 — 이 표본에서 유의하게 잡아낼 수 있는 최소 상관")
for n, lab in [(61, "위험지역"), (24, "다발지역")]:
    # Fisher z: 80% 검정력, 양측 0.05
    z = (1.959964 + 0.8416212) / np.sqrt(n - 3)
    rho = np.tanh(z)
    print(f"    {lab} n={n:3d} → |rho| >= {rho:.3f} 이어야 80% 검정력. 그 이하는 애초에 못 잡는다.")
print()

print("[B] 범위제한 — 위험지역 안의 DSI 는 도시 전체보다 좁은가")
pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["point_id", "geometry"]]
dsi = json.load(open(ROOT / "web/public/data/dsi_map_260820.json", encoding="utf-8"))
dmap = {int(k.split("_")[0]): v["dsi"] for k, v in dsi.items()}
pt["dsi"] = pt.point_id.map(dmap)
allp = pt.dsi.dropna()
print(f"    전체 지점 DSI      n={len(allp):,}  평균 {allp.mean():.3f}  SD {allp.std():.3f}"
      f"  범위 {allp.min():.2f}~{allp.max():.2f}")
print(f"    구역 평균 DSI      n={len(r)}  평균 {r.dsi_mean.mean():.3f}  SD {r.dsi_mean.std():.3f}"
      f"  범위 {r.dsi_mean.min():.2f}~{r.dsi_mean.max():.2f}")
print(f"    → 구역 평균의 SD 가 지점 SD 의 {r.dsi_mean.std()/allp.std()*100:.0f}%. "
      f"평균을 내면서 변동이 깎였고, 대상도 전부 도심권이다.")
print()

print("[C] 분모 잡음 — 사고건수가 적은 구역의 심각도 비율은 거의 난수")
for lo in [0, 10, 20]:
    sub = r[r.acc >= lo]
    if len(sub) < 8: continue
    rho = stats.spearmanr(sub.dsi_mean, sub.sev_ratio).statistic
    print(f"    사고 {lo:2d}건 이상만 (n={len(sub):2d})  rho = {rho:+.3f}"
          f"   심각도 SD {sub.sev_ratio.std():.3f}")
print()

print("[D] 사고건수로 가중한 상관 (비율의 신뢰도를 반영)")
def wpearson(x, y, w):
    mx, my = np.average(x, weights=w), np.average(y, weights=w)
    cov = np.average((x-mx)*(y-my), weights=w)
    return cov / np.sqrt(np.average((x-mx)**2, weights=w) * np.average((y-my)**2, weights=w))
for d, lab in [(r, "위험지역"), (s, "다발지역")]:
    print(f"    {lab}  가중 r = {wpearson(d.dsi_mean.values, d.sev_ratio.values, d.acc.values):+.3f}"
          f"   (비가중 r = {stats.pearsonr(d.dsi_mean, d.sev_ratio).statistic:+.3f})")
print()

print("[E] 다중비교 — 이번에 돌린 검정 수")
print("    데이터셋 2 x (순위상관 3 + 편상관 1 + Fisher 1) = 10회.")
print("    전부 귀무일 때도 p<0.05 가 한 번 나올 확률은 1-0.95^10 = 40%.")
