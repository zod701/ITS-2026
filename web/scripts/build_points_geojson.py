"""GIS/historical_panoids_filtered.csv -> web/public/data/{roads,points}.geojson

CSV lives outside web/; this script reads it once locally and writes the
lightweight output into web/public/data/, which is the only file the
frontend actually reads at runtime.

- roads.geojson: one LineString per edge_id, built by connecting points in
  point_id order (verified to track spatial order within an edge). Used to
  render the "streets with street-view coverage" as a line, Naver-map style.
- points.geojson: the original per-point features (point_id, pano_id, lat,
  lon), used to find the nearest point when a road line is clicked.
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = WEB_DIR.parent / "GIS" / "historical_panoids_filtered.csv"
ROADS_OUT_PATH = WEB_DIR / "public" / "data" / "roads.geojson"
POINTS_OUT_PATH = WEB_DIR / "public" / "data" / "points.geojson"


def main():
    rows = []
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    point_features = []
    edges = defaultdict(list)
    for row in rows:
        lat, lon = float(row["point_lat"]), float(row["point_lon"])
        point_features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"point_id": row["point_id"], "pano_id": row["pano_id"]},
        })
        edges[row["edge_id"]].append((int(row["point_id"]), lat, lon))

    road_features = []
    for edge_id, pts in edges.items():
        if len(pts) < 2:
            continue
        pts.sort(key=lambda p: p[0])
        coords = [[lon, lat] for _, lat, lon in pts]
        road_features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"edge_id": edge_id},
        })

    ROADS_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with open(POINTS_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {"type": "FeatureCollection", "features": point_features},
            f, ensure_ascii=False, separators=(",", ":"),
        )

    with open(ROADS_OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {"type": "FeatureCollection", "features": road_features},
            f, ensure_ascii=False, separators=(",", ":"),
        )

    print(f"Wrote {len(point_features)} points to {POINTS_OUT_PATH}")
    print(f"Wrote {len(road_features)} road segments to {ROADS_OUT_PATH}")


if __name__ == "__main__":
    main()
