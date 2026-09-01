# -*- coding: utf-8 -*-
"""
교통량과 DSI 의 단순 관계

목적: 본 분석(교통량 통제 후 DSI 효과) 전에, 두 변수가 얼마나 얽혀 있는지 먼저 본다.
  강하게 음의 상관이면(큰 길일수록 시야가 트이고 교통량이 많다) 통제 후 남는 DSI 변동이
  적다는 뜻이고, 그만큼 검정력이 더 깎인다.

교통량: 12개월(2025-08~2026-07) 전체 일별값의 평균. 월별 결측은 그 지점 평균으로 무시.
DSI   : 계측점 반경 R 안에 있는 도로망 지점들의 DSI 집계.
"""
import glob
import math
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
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
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def read_xlsx(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    rows = []
    for r in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(f"{NS}row"):
        cells = {}
        for c in r.findall(f"{NS}c"):
            col = re.match(r"([A-Z]+)", c.get("r")).group(1)
            v = c.find(f"{NS}v")
            cells[col] = shared[int(v.text)] if c.get("t") == "s" and v is not None else (
                v.text if v is not None else None)
        rows.append(cells)
    cols = sorted({k for r in rows for k in r}, key=lambda s: (len(s), s))
    return [[r.get(c) for c in cols] for r in rows]


# ---------- 12개월 평균 교통량 ----------
vals = {}
for f in sorted(glob.glob(str(TAAS / "교통량/*.xlsx"))):
    rows = read_xlsx(f)
    for r in rows[1:]:
        cid = str(r[0])
        day = [pd.to_numeric(x, errors="coerce") for x in r[3:]]
        day = [d for d in day if pd.notna(d)]
        if day:
            vals.setdefault(cid, []).extend(day)
traffic = pd.DataFrame(
    [{"cid": k, "aadt": float(np.mean(v)), "n_day": len(v)} for k, v in vals.items()])
print(f"교통량 지점 {len(traffic)}개 · 지점당 관측일 중앙 {traffic.n_day.median():.0f}일")

geo = pd.read_csv(DATA / "traffic_points_vworld.csv", encoding="utf-8-sig").dropna(subset=["lon"])
geo["cid"] = geo.cid.astype(str)
tp = traffic.merge(geo[["cid", "name", "addr", "lon", "lat"]], on="cid")
tp = gpd.GeoDataFrame(tp, geometry=gpd.points_from_xy(tp.lon, tp.lat), crs=4326).to_crs(5179)
print(f"좌표까지 붙은 지점 {len(tp)}개 · 일평균 {tp.aadt.min():,.0f}~{tp.aadt.max():,.0f}대\n")

# ---------- 도로망 지점의 DSI ----------
import json
pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["point_id", "ROA_CLS_SE", "ROAD_BT", "geometry"]]
dmap = {int(k.split("_")[0]): v["dsi"]
        for k, v in json.load(open(ROOT / "web/public/data/dsi_map_260820.json", encoding="utf-8")).items()}
pt["dsi"] = pt.point_id.map(dmap)
pt = pt.dropna(subset=["dsi"])
pt["road_class"] = pd.to_numeric(pt.ROA_CLS_SE, errors="coerce")
pt["width"] = pd.to_numeric(pt.ROAD_BT, errors="coerce")
print(f"DSI 지점 {len(pt):,}개\n")

tree = cKDTree(np.array([[g.x, g.y] for g in pt.geometry]))
tx = np.array([[g.x, g.y] for g in tp.geometry])

print("=" * 74)
print("교통량(일평균) vs 반경 내 DSI")
print("=" * 74)
print(f"{'반경':>6}{'유효지점':>7}{'DSI지점중앙':>10}   {'Spearman':>10}{'p':>9}   "
      f"{'log교통량 r':>11}{'R^2':>7}")
print("-" * 74)
res = {}
for R in [100, 150, 200, 300]:
    idx = tree.query_ball_point(tx, R)
    rows = []
    for i, ii in enumerate(idx):
        if len(ii) < 5:
            continue
        sub = pt.iloc[ii]
        rows.append({"cid": tp.cid.iloc[i], "name": tp.name.iloc[i], "aadt": tp.aadt.iloc[i],
                     "n": len(ii), "dsi": sub.dsi.mean(), "dsi_p90": sub.dsi.quantile(.9),
                     "road_class": sub.road_class.mean(), "width": sub.width.mean()})
    d = pd.DataFrame(rows)
    rho, p = stats.spearmanr(d.aadt, d.dsi)
    lg = np.log(d.aadt)
    r_p = stats.pearsonr(lg, d.dsi).statistic
    print(f"{R:>5}m{len(d):>7}{d.n.median():>10.0f}   {rho:>+10.3f}{p:>9.4f}   "
          f"{r_p:>+11.3f}{r_p**2:>7.3f}")
    res[R] = d
print()

d = res[200]
print("[상세: 반경 200m]")
print(f"    교통량 사분위별 평균 DSI")
d["q"] = pd.qcut(d.aadt, 4, labels=["Q1(적음)", "Q2", "Q3", "Q4(많음)"])
for q, g in d.groupby("q", observed=True):
    print(f"      {q:<9} n={len(g):3d}  일평균 {g.aadt.mean():7,.0f}대  "
          f"DSI {g.dsi.mean():.3f}  도로폭 {g.width.mean():5.1f}m  등급 {g.road_class.mean():.2f}")
print()
print("[교란 확인] 교통량-도로폭-도로등급-DSI 상호 상관 (Spearman)")
cols = ["aadt", "width", "road_class", "dsi"]
lab = {"aadt": "교통량", "width": "도로폭", "road_class": "도로등급", "dsi": "DSI"}
m = d[cols].corr(method="spearman")
print("           " + "".join(f"{lab[c]:>10}" for c in cols))
for c in cols:
    print(f"    {lab[c]:>7}" + "".join(f"{m.loc[c,c2]:>+10.3f}" for c2 in cols))
print()
r1, p1 = stats.spearmanr(d.aadt, d.dsi)
def prank(x, y, covs):
    R_ = lambda a: stats.rankdata(a)
    C = np.column_stack([np.ones(len(x))] + [R_(c) for c in covs])
    rx = R_(x) - C @ np.linalg.lstsq(C, R_(x), rcond=None)[0]
    ry = R_(y) - C @ np.linalg.lstsq(C, R_(y), rcond=None)[0]
    return stats.pearsonr(rx, ry)
ok = d.dropna(subset=["width", "road_class"])
r2, p2 = prank(ok.aadt.values, ok.dsi.values, [ok.width.values, ok.road_class.values])
print(f"    교통량-DSI 단순      rho {r1:+.3f} (p={p1:.4f})")
print(f"    도로폭·등급 통제 후   rho {r2:+.3f} (p={p2:.4f})   n={len(ok)}")

d.to_csv(DATA / "traffic_aadt.csv", index=False, encoding="utf-8-sig")
print(f"\n-> {DATA / 'traffic_aadt.csv'}")
