# -*- coding: utf-8 -*-
"""강릉시 주요 시내 도로 x 차종=버스(02) 도로위험지수 수집 테스트"""
import sys, json, time
from collections import Counter
import geopandas as gpd
from shapely.ops import linemerge, substring
from shapely.geometry import LineString, MultiLineString
sys.path.insert(0, "TAAS")
from koroad_client import Client, VHCTY, QuotaError
sys.stdout.reconfigure(encoding="utf-8")

SHP, SPACING, MAXLEN = "GIS/노드링크/강릉시내.shp", 50.0, 2000.0
TARGETS = ["강릉대로", "경강로", "강변로", "창해로", "성덕로", "임영로", "난설헌로", "경포로"]

g = gpd.read_file(SHP, encoding="cp949")
cli = Client(sleep=0.05, budget=1500)
print(f"{SHP}  crs={g.crs}  rows={len(g)}")
print(f"차종 02={VHCTY['02']} / {SPACING:.0f}m 간격 / 도로별 최대 {MAXLEN:.0f}m\n")
print(f"{'도로명':<10}{'조회m':>7}{'세그':>5}{'수신':>5}{'결측':>5}   {'min':>6}{'med':>7}{'mean':>7}{'max':>8}   등급분포")
print("-" * 96)

def save(res, path):
    """빈/부분 결과가 기존 수집분을 덮어쓰지 않게 한다."""
    import os, json as _j
    if not res:
        print(f"[저장 안 함] 수집 결과가 없어 {path} 를 건드리지 않았습니다."); return
    if os.path.exists(path):
        try:
            prev = _j.load(open(path, encoding="utf-8"))
        except Exception:
            prev = {}
        if len(prev) > len(res):
            path = path.replace(".json", "_partial.json")
            print(f"[분리 저장] 기존 파일이 더 완전하므로 {path} 로 저장합니다.")
    _j.dump(res, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"-> {path}")

res, t0 = {}, time.time()
for rn in TARGETS:
    sub = g[g["RN"] == rn]
    if sub.empty:
        print(f"{rn:<10} 도로구간 없음"); continue
    m = linemerge(MultiLineString(list(sub.geometry)))
    line = sorted(list(m.geoms) if isinstance(m, MultiLineString) else [m], key=lambda p: -p.length)[0]
    L = min(line.length, MAXLEN)
    seg = substring(line, 0, L)
    n = max(1, int(round(L / SPACING)))
    pts = [seg.interpolate(i / n, normalized=True) for i in range(n + 1)]
    coords = list(gpd.GeoSeries([LineString(pts)], crs=g.crs).to_crs(4326).iloc[0].coords)

    try:
        segs = cli.query_parallel(coords, "02", workers=4)
    except QuotaError as e:
        print(f"{rn:<10} [중단] {e}"); break
    ok = [s for s in segs if s["value"] is not None]
    vals = sorted(s["value"] for s in segs if s["value"] is not None)
    grds = dict(sorted(Counter(s["grade"] for s in ok).items()))
    if vals:
        print(f"{rn:<10}{L:>7.0f}{len(segs):>5}{len(ok):>5}{len(segs)-len(ok):>5}   "
              f"{vals[0]:>6.2f}{vals[len(vals)//2]:>7.2f}{sum(vals)/len(vals):>7.2f}{vals[-1]:>8.2f}   {grds}")
    else:
        print(f"{rn:<10}{L:>7.0f}{len(segs):>5}{0:>5}{len(segs):>5}   (전부 결측)")
    res[rn] = {"len_m": L, "spacing": SPACING, "vhctyCd": "02", "segments": segs}

save(res, "TAAS/gangneung_bus_dgdgr.json")
tot = sum(len(v["segments"]) for v in res.values())
gotn = sum(1 for v in res.values() for s in v["segments"] if s["value"] is not None)
print("-" * 96)
print(f"세그먼트 {gotn}/{max(1,tot)} 수신 / API 호출 {cli.calls}회  resultCode {cli.codes} / {time.time()-t0:.0f}s")
