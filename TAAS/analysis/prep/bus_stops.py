# -*- coding: utf-8 -*-
"""
버스정류장 위치 수집 — VWorld 지명검색(POI) 2.0

  GET https://api.vworld.kr/req/search
      service=search request=search version=2.0 crs=EPSG:4326
      type=place  query=정류장  bbox=<웹 지도 범위>  size=1000  key=<KEY>

geocode.py 처럼 주소를 좌표로 바꾸는 방식(request=getcoord)은 쓰지 않는다. 정류장은
지번이 아니라 지명이라 주소 질의로는 도로 위 승강장 자리가 아니라 인접 필지 중심이
잡힌다. POI 검색은 좌표를 직접 돌려주므로 중간 변환 오차가 없다.

  · query='정류장' 은 제목뿐 아니라 분류(category)에도 걸린다. '송정해변'처럼 이름에
    '정류장'이 없는 정류장도 분류로 잡히므로, 받은 뒤 category 로 거르면 된다.
  · bbox 를 4x4 로 쪼개 재조회해도 같은 600건이라 결과 절단(cap)은 없다.

**중복 등재**: 같은 승강장이 '동양석재' 와 '동양석재버스정류장' 두 레코드로 실려 있다.
이름에서 접미사를 떼고 15m 안에서 병합한다 (593 -> 361). 도로 양쪽의 상·하행 승강장은
서로 다른 자리이므로 병합하지 않는다.

범위는 웹 지도가 진단한 구간 그대로다 — roads.geojson 의 외곽이 곧 GANGNEUNG_BOUNDS 라
이 상자 밖 정류장은 DSI 가 매겨진 도로가 없다. 361 개소 중 332 개소가 DSI 엣지 50m 안에
있고, 나머지는 지수 산출 대상이 아닌 이면도로 정류장이다.

**한계**: VWorld POI 는 교통 원자료가 아니라 지명 DB 다. 정류장 ID·경유노선·상하행
정보가 없고 폐지된 정류장이 남아 있을 수 있다. 정식 출처는 국토교통부 '전국 버스정류장
위치정보 표준데이터'(data.go.kr, 인증키 필요)다.

사용:
  python bus_stops.py        -> web/public/data/bus_stops.geojson
"""
import json
import math
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
WEB = ROOT / "web" / "public" / "data"
sys.stdout.reconfigure(encoding="utf-8")

URL = "https://api.vworld.kr/req/search"

# web/app/components/MapView.tsx 의 GANGNEUNG_BOUNDS 와 같은 범위.
BBOX = "128.8598787651,37.7321168224,128.9546660985,37.811142202"
CATEGORY = "버스터미널/정류장"
MERGE_M = 15.0                              # 같은 승강장의 중복 등재로 볼 거리
SUFFIXES = ("버스정류장", "버스정류소", "정류장", "정류소")

LAT0 = 37.775                               # 강릉 도심 위도. 미터 환산 기준.
MX = 111320 * math.cos(math.radians(LAT0))
MY = 110540


def load_key():
    for line in open(TAAS / ".env", encoding="utf-8"):
        if "VWORLD_API_KEY" in line:
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("VWORLD_API_KEY 없음")


def fetch(key):
    r = requests.get(URL, params={
        "service": "search", "request": "search", "version": "2.0",
        "crs": "EPSG:4326", "query": "정류장", "type": "place",
        "format": "json", "size": 1000, "page": 1,
        "bbox": BBOX, "key": key}, timeout=30)
    j = r.json()["response"]
    if j["status"] != "OK":
        raise RuntimeError(f"VWorld status={j['status']}")
    items = j["result"]["items"]
    total = int(j["record"]["total"])
    if len(items) < total:
        raise RuntimeError(f"결과 절단: {len(items)}/{total} — size 를 늘려야 한다")
    return items


def strip_suffix(title):
    for s in SUFFIXES:
        if title.endswith(s):
            return title[: -len(s)].strip()
    return title.strip()


def merge(rows):
    """이름이 서로를 포함하고 MERGE_M 안이면 한 승강장으로 본다."""
    out, used = [], [False] * len(rows)
    for i, p in enumerate(rows):
        if used[i]:
            continue
        grp, used[i] = [p], True
        for j in range(i + 1, len(rows)):
            if used[j]:
                continue
            q = rows[j]
            d = math.hypot((p["lon"] - q["lon"]) * MX, (p["lat"] - q["lat"]) * MY)
            if d < MERGE_M and (p["name"] == q["name"]
                                or p["name"] in q["name"] or q["name"] in p["name"]):
                grp.append(q)
                used[j] = True
        out.append({"name": p["name"],
                    "addr": p["addr"],
                    "lon": sum(g["lon"] for g in grp) / len(grp),
                    "lat": sum(g["lat"] for g in grp) / len(grp)})
    return out


def main():
    t0 = time.time()
    items = fetch(load_key())
    stops = [it for it in items if CATEGORY in it["category"]]
    print(f"VWorld POI {len(items)}건 -> 정류장 분류 {len(stops)}건")

    rows = [{"name": strip_suffix(it["title"]),
             "addr": it["address"].get("parcel") or it["address"].get("road") or "",
             "lon": float(it["point"]["x"]),
             "lat": float(it["point"]["y"])} for it in stops]
    merged = merge(rows)
    print(f"중복 병합 -> {len(merged)}개소")

    fc = {"type": "FeatureCollection",
          "features": [{"type": "Feature",
                        "geometry": {"type": "Point",
                                     "coordinates": [round(m["lon"], 7), round(m["lat"], 7)]},
                        "properties": {"name": m["name"], "addr": m["addr"]}}
                       for m in sorted(merged, key=lambda m: m["name"])]}

    path = WEB / "bus_stops.geojson"
    path.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    print(f"-> {path}  ({path.stat().st_size / 1024:.0f} KB, {time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
