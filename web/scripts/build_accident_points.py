"""TAAS 원시 사고지점 shp -> web/public/data/accident_points_2425.geojson

교체 대상이던 accident_risk_areas / accident_hotspots 는 **선정된 구역**(사고 4건 / 9건
이상만 수록)이라 절단 자료였다 (TAAS/method.md X-24). 이 스크립트는 그 자리를 원시 지점
자료로 바꾼다 — 2024~25년 강릉시 중상 이상 216건, 선정 임계 없이 전수다.

**남는 한계**: 중상 이상만이다. 경상·부상신고는 TAAS 가 좌표를 제공하지 않는다.

Usage:
  python build_accident_points.py
"""
import json
import sys
from pathlib import Path

import geopandas as gpd

WEB_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = WEB_DIR.parent
SRC = REPO_ROOT / "TAAS" / "사고정보" / "24_25" / "TAAS_교통사고지점및정보_2425.shp"
OUT = WEB_DIR / "public" / "data" / "accident_points_2425.geojson"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    g = gpd.read_file(SRC).to_crs(4326)

    feats = []
    for _, r in g.iterrows():
        # 사망자수가 0 이면 중상사고. TAAS 의 '사고내용' 을 그대로 쓰지 않고 인명피해로
        # 판정해, 라벨 표기가 바뀌어도 레이어 분류가 흔들리지 않게 한다.
        sev = "fatal" if int(r["사망자수"]) > 0 else "serious"
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point",
                         "coordinates": [round(r.geometry.x, 6), round(r.geometry.y, 6)]},
            "properties": {
                "sev": sev,
                "year": str(int(r["발생년도"])),
                "ym": r["발생년월"],
                "dn": r["주야"],
                "dth": int(r["사망자수"]),
                "se": int(r["중상자수"]),
                "sl": int(r["경상자수"]),
                "type": r["사고유형"],
                "road": r["도로형태"],
                "viol": r["법규위반"],
            },
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": feats},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    n_f = sum(1 for f in feats if f["properties"]["sev"] == "fatal")
    print(f"Wrote {len(feats)} accident points to {OUT}")
    print(f"  사망 {n_f} · 중상 {len(feats) - n_f}")
    for y in sorted({f["properties"]["year"] for f in feats}):
        print(f"  {y}년 {sum(1 for f in feats if f['properties']['year'] == y)}건")


if __name__ == "__main__":
    main()
