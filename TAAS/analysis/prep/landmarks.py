# -*- coding: utf-8 -*-
"""
주요 지점(랜드마크) 좌표 — VWorld 지명검색(POI) 2.0

단오제 판(dsi_map_danoje_*)의 수요 시나리오가 놓이는 두 끝점을 지도에 표시하기 위한
자료다. 셔틀 수요는 **강릉역(외부 유입)에서 단오장(행사장)으로** 흐르므로, 노선 후보를
볼 때 이 두 점이 어디 있는지가 같이 보여야 한다.

bus_stops.py 와 같은 API·같은 bbox 를 쓰되 대상만 다르다. 질의 결과가 여러 건이라
**분류(category)로 고른다** — 이름만으로 고르면 같은 이름의 정류장·진출입시설이 섞인다.

  강릉역   '철도시설 > ... > 고속철도역'      교동 95-10   (역사 본체.
           같은 이름의 '버스터미널/정류장' POI 는 역 앞 정류장이라 다른 자리다)
  전수교육관 '... > 무형문화재전수시설'         노암동 722-2 (단오제 상설 거점.
           같은 이름으로 근린공원·공연시설운영업·문예회관 POI 가 더 있으나 15m 안이고,
           건물의 본래 분류인 무형문화재전수시설을 쓴다. '전수교육관입구'는 진출입시설
           이라 분류로 걸러진다)

행사 자체는 남대천 둔치 일대에 걸친 **면**이지만, 여기서는 노선 끝점의 위치를 가리키는
용도이므로 상설 건물인 전수교육관을 대표점으로 둔다.

사용:
  python landmarks.py        -> web/public/data/landmarks.geojson
"""
import json
import sys

import requests

from bus_stops import BBOX, URL, WEB, load_key

sys.stdout.reconfigure(encoding="utf-8")

# (표시이름, 질의어, 분류에 반드시 들어갈 문자열)
TARGETS = [
    ("강릉역", "강릉역", "고속철도역"),
    ("강릉단오제전수교육관", "강릉단오제전수교육관", "무형문화재전수시설"),
]


def find(session, key, query, category):
    r = session.get(URL, params={
        "service": "search", "request": "search", "version": "2.0",
        "crs": "EPSG:4326", "query": query, "type": "place",
        "format": "json", "size": 100, "page": 1,
        "bbox": BBOX, "key": key}, timeout=30)
    j = r.json()["response"]
    if j["status"] != "OK":
        raise RuntimeError(f"'{query}' VWorld status={j['status']}")
    hits = [it for it in j["result"]["items"] if category in it["category"]]
    if not hits:
        raise RuntimeError(f"'{query}' 에서 분류 '{category}' 결과 없음")
    if len(hits) > 1:
        print(f"  [주의] '{query}' 분류 '{category}' {len(hits)}건 — 첫 건 사용")
    return hits[0]


def main():
    key, session = load_key(), requests.Session()
    features = []
    for name, query, category in TARGETS:
        it = find(session, key, query, category)
        addr = it["address"].get("parcel") or it["address"].get("road") or ""
        lon, lat = float(it["point"]["x"]), float(it["point"]["y"])
        print(f"{name:<6} {lon:.7f} {lat:.7f}  {it['title']}  | {addr}")
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
            "properties": {"name": name, "title": it["title"], "addr": addr},
        })

    path = WEB / "landmarks.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                               ensure_ascii=False), encoding="utf-8")
    print(f"-> {path}")


if __name__ == "__main__":
    main()
