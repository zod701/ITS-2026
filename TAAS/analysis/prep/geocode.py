# -*- coding: utf-8 -*-
"""
교통량 계측지점(교차로) 지오코딩 — VWorld Geocoder 2.0

  GET https://api.vworld.kr/req/address
      service=address request=getcoord version=2.0 crs=epsg:4326
      type=PARCEL|ROAD  address=<주소>  key=<KEY>

시도 순서: 지번(PARCEL, 강원특별자치도) → 지번(강원도) → 도로명(ROAD)
  '강원도 → 강원특별자치도' 개편이 자료마다 반영 시점이 달라 둘 다 시도한다.

앞서 돌린 Nominatim 결과 중 정밀 판정분(traffic_signals/junction)을 대조군으로 두고
두 소스의 좌표 차이를 재서 신뢰도를 정량화한다.
"""
import glob
import math
import re
import sys
import time
from pathlib import Path

import pandas as pd
import requests

HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
DATA = BASE / "data"
sys.path.insert(0, str(HERE))
sys.stdout.reconfigure(encoding="utf-8")

URL = "https://api.vworld.kr/req/address"

# 원본 xlsx 주소 오류 보정 (cid -> 주소)
#   10 교동사거리: '홍제동 666-10' 이 선수촌삼거리(cid 236) 주소와 같아 두 지점이
#   동일 좌표로 지오코딩됐다. 실제는 강릉대로 x 임영로 사거리(교동 980-1).
ADDR_FIX = {"10": "교동 980-1"}


def load_key():
    for line in open(TAAS / ".env", encoding="utf-8"):
        if "VWORLD_API_KEY" in line:
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("VWORLD_API_KEY 없음")


def read_xlsx(path):
    """openpyxl 없이 xlsx 읽기 (zip + XML)."""
    import xml.etree.ElementTree as ET
    import zipfile
    NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for r in root.iter(f"{NS}row"):
        cells = {}
        for c in r.findall(f"{NS}c"):
            col = re.match(r"([A-Z]+)", c.get("r")).group(1)
            v = c.find(f"{NS}v")
            if c.get("t") == "s" and v is not None:
                cells[col] = shared[int(v.text)]
            else:
                cells[col] = v.text if v is not None else None
        rows.append(cells)
    cols = sorted({k for r in rows for k in r}, key=lambda s: (len(s), s))
    return [[r.get(c) for c in cols] for r in rows]


def geocode(addr, key, session):
    """(lon, lat, 사용한질의, 상태) 반환. 실패 시 좌표는 None."""
    attempts = [
        ("PARCEL", f"강원특별자치도 강릉시 {addr}"),
        ("PARCEL", f"강원도 강릉시 {addr}"),
        ("ROAD", f"강원특별자치도 강릉시 {addr}"),
    ]
    last = "NO_TRY"
    for typ, q in attempts:
        try:
            r = session.get(URL, params={
                "service": "address", "request": "getcoord", "version": "2.0",
                "crs": "epsg:4326", "address": q, "refine": "true", "simple": "false",
                "format": "json", "type": typ, "key": key}, timeout=20)
            j = r.json()
        except Exception as e:
            last = type(e).__name__
            time.sleep(0.5)
            continue
        finally:
            time.sleep(0.15)
        st = j.get("response", {}).get("status")
        last = st
        if st == "OK":
            p = j["response"]["result"]["point"]
            return float(p["x"]), float(p["y"]), f"{typ}", st
    return None, None, None, last


def main():
    key, session = load_key(), requests.Session()
    rows = read_xlsx(sorted(glob.glob(str(TAAS / "교통량/*.xlsx")))[-1])
    tv = pd.DataFrame(rows[1:], columns=["cid", "name", "addr"] +
                      [f"d{i}" for i in range(len(rows[0]) - 3)])
    tv["avg"] = pd.to_numeric(tv.iloc[:, 3:34].stack(), errors="coerce").groupby(level=0).mean()

    out = []
    for i, r in tv.iterrows():
        addr = ADDR_FIX.get(str(r.cid), r.addr)
        lon, lat, used, st = geocode(addr, key, session)
        out.append({"cid": r.cid, "name": r["name"], "addr": addr, "avg": r["avg"],
                    "lon": lon, "lat": lat, "vw_type": used, "vw_status": st})
        print(f"{i+1:3d}/{len(tv)} {str(r['name'])[:22]:<22} {st:<12} {used or '-'}", flush=True)

    df = pd.DataFrame(out)
    df.to_csv(DATA / "traffic_points_vworld.csv", index=False, encoding="utf-8-sig")
    print(f"\n좌표 획득 {df.lon.notna().sum()}/{len(df)}")
    print("상태 분포:", dict(df.vw_status.value_counts()))
    print(f"-> {DATA / 'traffic_points_vworld.csv'}")

    # Nominatim 정밀분과 교차검증
    nm = pd.read_csv(DATA / "traffic_points_geocoded.csv", encoding="utf-8-sig")
    nm = nm[nm.precise & nm.osm.isin(["highway/traffic_signals", "junction/yes"])]
    df["cid"] = df.cid.astype(str)
    nm = nm.assign(cid=nm.cid.astype(str))
    j = df.merge(nm[["cid", "lat", "lon", "osm"]], on="cid", suffixes=("_vw", "_nm"))
    j = j.dropna(subset=["lat_vw", "lat_nm"])
    if len(j):
        d = [math.hypot((a - b) * 111320 * math.cos(math.radians(c)), (c - e) * 110540)
             for a, b, c, e in zip(j.lon_vw, j.lon_nm, j.lat_vw, j.lat_nm)]
        j["gap_m"] = d
        print(f"\n[교차검증] Nominatim 정밀분과 겹치는 {len(j)}개의 좌표 차이")
        print(f"    중앙 {pd.Series(d).median():.0f}m / 최대 {max(d):.0f}m")
        for _, x in j.sort_values("gap_m", ascending=False).head(6).iterrows():
            print(f"    {x['name']:<20} {x.gap_m:7.0f} m   [{x.osm}]")


if __name__ == "__main__":
    main()
