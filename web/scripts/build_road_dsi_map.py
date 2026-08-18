"""Aggregate per-point DSI (web/public/data/dsi_map.json) up to per-road (edge_id).

A road (edge_id) in roads.geojson is built from multiple points (see
build_points_geojson.py), each with its own DSI value. This script joins
GIS/historical_panoids_filtered.csv (point_id/pano_id -> edge_id) with
dsi_map.json (point_id_pano_id -> dsi/grade) and aggregates to one summary
value per edge_id, so the road line can be colored by that value.

Aggregation: mean DSI over the edge's points that have a DSI record; grade is
re-derived from the mean using the same thresholds as compute_dsi_refined's
grade_of (Safe < 1.0 <= Caution < 1.8 <= High-risk), not majority-voted from
per-point grades, so it's consistent with the numeric value shown/used.

Writes web/public/data/road_dsi_map_<version>.json as
{ "<edge_id>": { "dsi": <float>, "grade": <str>, "n": <int> } }
where n = number of points with a DSI record that contributed to the mean.

Run once per 03 version (same label as build_dsi_map.py), e.g. 260818.
The map colors roads by re-deriving the grade from this mean against the
version's roadTerciles in app/versions.ts, so the grade written here is only
the legacy label kept for reference.

Usage:
  python build_road_dsi_map.py <version>
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = WEB_DIR.parent / "GIS" / "historical_panoids_filtered.csv"


def grade_of(dsi: float) -> str:
    return "Safe" if dsi < 1.0 else ("Caution" if dsi < 1.8 else "High-risk")


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python build_road_dsi_map.py <version>")
    version = sys.argv[1]
    DSI_MAP_PATH = WEB_DIR / "public" / "data" / f"dsi_map_{version}.json"
    OUT_PATH = WEB_DIR / "public" / "data" / f"road_dsi_map_{version}.json"

    dsi_map = json.loads(DSI_MAP_PATH.read_text(encoding="utf-8"))

    edge_dsis = defaultdict(list)
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            key = f"{row['point_id']}_{row['pano_id']}"
            rec = dsi_map.get(key)
            if rec is None:
                continue
            edge_dsis[row["edge_id"]].append(rec["dsi"])

    mapping = {}
    for edge_id, values in edge_dsis.items():
        mean_dsi = sum(values) / len(values)
        mapping[edge_id] = {"dsi": round(mean_dsi, 4), "grade": grade_of(mean_dsi), "n": len(values)}

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as out:
        json.dump(mapping, out, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {len(mapping)} road DSI records to {OUT_PATH}")


if __name__ == "__main__":
    main()
