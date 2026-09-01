# -*- coding: utf-8 -*-
"""
강릉 셔틀 후보노선 A/B/C (web/public/data/bus_routes.geojson) 에 대해
KoROAD 세부링크 도로위험지수(차종=버스 02) 를 수집하고,
파이프라인 DSI(dsi_map_*.json / bus_route_dsi_*.json) 와 비교 가능한 형태로 저장.
"""
import sys, json, time, math
from collections import Counter
sys.path.insert(0, "TAAS")
from koroad_client import Client, VHCTY, QuotaError
sys.stdout.reconfigure(encoding="utf-8")

ROUTES = "web/public/data/bus_routes.geojson"
SPACING_M = 50.0          # 세부링크 단위(일반도로 100m/교차로 30m) 대비 적당한 샘플 간격
VHCTY_CD = "02"

def hav(a, b):
    (lo1, la1), (lo2, la2) = a, b
    R = 6371000.0
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = p2 - p1, math.radians(lo2 - lo1)
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))

def resample(coords, spacing):
    """누적거리 기준 spacing 간격으로 정점 추출 (원본 정점 스냅)"""
    out, acc = [coords[0]], 0.0
    for i in range(1, len(coords)):
        acc += hav(coords[i-1], coords[i])
        if acc >= spacing:
            out.append(coords[i]); acc = 0.0
    if out[-1] != coords[-1]:
        out.append(coords[-1])
    return out

gj = json.load(open(ROUTES, encoding="utf-8"))
cli = Client(sleep=0.05, budget=1500)
pipe = json.load(open("web/public/data/bus_route_dsi_260820.json", encoding="utf-8"))

print(f"{ROUTES} / 차종 {VHCTY_CD}={VHCTY[VHCTY_CD]} / 샘플 {SPACING_M:.0f}m\n")
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
for f in gj["features"]:
    rt = f["properties"]["route"]
    raw = [tuple(c) for c in f["geometry"]["coordinates"]]
    pts = resample(raw, SPACING_M)
    print(f"[노선 {rt}] {f['properties']['distance_km']}km, 원본 {len(raw)}pt -> 샘플 {len(pts)}pt "
          f"({len(pts)-1} 세그먼트)", flush=True)
    try:
        segs = cli.query_parallel(pts, VHCTY_CD, workers=4)
    except QuotaError as e:
        print(f"           [중단] {e}", flush=True)
        print("           수집분만 저장하고 종료합니다.", flush=True)
        break
    ok = [s for s in segs if s["value"] is not None]
    vals = sorted(s["value"] for s in ok)
    grds = dict(sorted(Counter(s["grade"] for s in ok).items()))
    if vals:
        mean = sum(vals)/len(vals)
        print(f"           수신 {len(ok)}/{len(segs)} ({len(ok)/len(segs)*100:.0f}%)  "
              f"지수 min={vals[0]:.2f} med={vals[len(vals)//2]:.2f} mean={mean:.2f} max={vals[-1]:.2f}")
        print(f"           위험등급 분포 {grds}   |  파이프라인 DSI={pipe.get(rt,{}).get('dsi')}")
    else:
        print("           전부 결측")
    res[rt] = {"vhctyCd": VHCTY_CD, "spacing_m": SPACING_M,
               "n_seg": len(segs), "n_ok": len(ok), "segments": segs}
    print(flush=True)

save(res, "TAAS/bus_routes_dgdgr.json")
print(f"API 호출 {cli.calls}회  resultCode 분포 {cli.codes}  / {time.time()-t0:.0f}s")
