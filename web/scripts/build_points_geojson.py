"""GIS -> web/public/data/{roads,points}.geojson

Source files live outside web/; this script reads them once locally and writes
the lightweight output into web/public/data/, which is the only thing the
frontend reads at runtime.

- points.geojson: one Point per panorama (point_id, pano_id) from
  historical_panoids_filtered.csv. Used to find the nearest point when a road
  line is clicked.
- roads.geojson: one LineString per edge_id, built from *every* 5m point of
  that edge in GIS/노드링크/gangneung_point.shp — which is the government
  도로구간 link layer sampled at 5m, so the points sit exactly on the official
  line (measured: median and p95 offset 0.000 m). Only edges that appear in the
  panorama CSV are written, so the map still shows "streets with street-view
  coverage" — but now along the road's real shape.

  Earlier this file was built by connecting the *panorama* points instead.
  Those exist only where street view happens to cover the road, so stretches
  without coverage were skipped and the line cut across corners.

  The official link layer (강릉시내.shp) cannot be used directly per edge:
  one link (RDS_MAN_NO) is split into up to 90 edges and the point file's
  `distance` field restarts at 0 for each edge, so there is no way to cut the
  link geometry at edge boundaries. The 5m points are the finest official
  geometry available at edge granularity; between two of them the polyline
  deviates from the true curve by at most ~5²/(8R) (≈0.2 m at R=15 m).
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString

WEB_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = WEB_DIR.parent / "GIS" / "historical_panoids_filtered.csv"
LINK_POINTS_PATH = WEB_DIR.parent / "GIS" / "노드링크" / "gangneung_point.shp"
ROADS_OUT_PATH = WEB_DIR / "public" / "data" / "roads.geojson"
POINTS_OUT_PATH = WEB_DIR / "public" / "data" / "points.geojson"

COORD_DECIMALS = 6      # 위경도 6자리 = 약 0.11 m. 그 이하는 화면에서 의미가 없다.
# 직선 구간에서는 5m 포인트 대부분이 일직선 위에 있어 그리기에 불필요하다. 0.2m 허용오차로
# 정점이 89k -> 26k 로 줄어 파일이 2.5MB -> 0.8MB 가 되고, 선은 최대 0.2m 만 움직인다
# (차선 폭의 1/15 수준이라 어느 배율에서도 보이지 않는다).
SIMPLIFY_M = 0.2
METRIC_CRS = 5179       # 포인트 원본 CRS. 허용오차를 미터로 주려면 여기서 단순화해야 한다.


def main():
    rows = []
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    point_features = []
    covered_edges = set()
    for row in rows:
        lat, lon = float(row["point_lat"]), float(row["point_lon"])
        point_features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"point_id": row["point_id"], "pano_id": row["pano_id"]},
        })
        covered_edges.add(int(row["edge_id"]))

    link_pts = gpd.read_file(LINK_POINTS_PATH, columns=["edge_id", "point_id"]).to_crs(METRIC_CRS)
    link_pts = link_pts[link_pts.edge_id.astype(int).isin(covered_edges)]

    edges = defaultdict(list)
    for edge_id, point_id, geom in zip(link_pts.edge_id, link_pts.point_id, link_pts.geometry):
        edges[str(int(edge_id))].append((int(point_id), geom.x, geom.y))

    edge_ids, lines = [], []
    for edge_id, pts in edges.items():
        if len(pts) < 2:
            continue
        # point_id 는 링크를 따라 5m 간격으로 매겨져 있어 그대로 진행 방향 순서가 된다.
        pts.sort(key=lambda p: p[0])
        edge_ids.append(edge_id)
        lines.append(LineString([(x, y) for _, x, y in pts]))

    simplified = gpd.GeoSeries(lines, crs=METRIC_CRS).simplify(SIMPLIFY_M).to_crs(4326)

    road_features = [
        {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [round(x, COORD_DECIMALS), round(y, COORD_DECIMALS)] for x, y in line.coords
                ],
            },
            "properties": {"edge_id": edge_id},
        }
        for edge_id, line in zip(edge_ids, simplified)
    ]

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
