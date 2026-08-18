"""GIS/bus_lanes.gpkg + web/public/data/{points.geojson,dsi_map_<version>.json} ->
web/public/data/bus_route_dsi_<version>.json

For each bus route (A/B/C), buffers the hand-traced route line by BUFFER_M
meters and averages the DSI of all points (from dsi_map.json) that fall
within the buffer -- points are spaced ~5-15m apart along a road, so a 20m
buffer catches points on the traced road without pulling in adjacent streets.

Also writes an "overall" entry: the mean DSI across every point in
dsi_map.json (not just those near a bus route), for the map legend's
whole-study-area summary line.

Run once per 03 version (same label as build_dsi_map.py), e.g. 260818.

Usage:
  python build_bus_route_dsi.py <version>
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point

WEB_DIR = Path(__file__).resolve().parent.parent
GPKG_PATH = WEB_DIR.parent / "GIS" / "bus_lanes.gpkg"
POINTS_PATH = WEB_DIR / "public" / "data" / "points.geojson"

BUFFER_M = 20.0
METRIC_CRS = "EPSG:5179"  # Korea 2000 / Unified CS


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python build_bus_route_dsi.py <version>")
    version = sys.argv[1]
    DSI_MAP_PATH = WEB_DIR / "public" / "data" / f"dsi_map_{version}.json"
    OUT_PATH = WEB_DIR / "public" / "data" / f"bus_route_dsi_{version}.json"

    routes = gpd.read_file(GPKG_PATH).to_crs(METRIC_CRS)

    points = json.loads(POINTS_PATH.read_text(encoding="utf-8"))
    dsi_map = json.loads(DSI_MAP_PATH.read_text(encoding="utf-8"))

    keys, geoms, dsis = [], [], []
    for feat in points["features"]:
        point_id = feat["properties"]["point_id"]
        pano_id = feat["properties"]["pano_id"]
        key = f"{point_id}_{pano_id}"
        rec = dsi_map.get(key)
        if rec is None:
            continue
        lon, lat = feat["geometry"]["coordinates"]
        keys.append(key)
        geoms.append(Point(lon, lat))
        dsis.append(rec["dsi"])

    points_gdf = gpd.GeoDataFrame({"key": keys, "dsi": dsis}, geometry=geoms, crs="EPSG:4326").to_crs(METRIC_CRS)

    result = {}
    for _, route in routes.iterrows():
        buffer = route.geometry.buffer(BUFFER_M)
        near = points_gdf[points_gdf.geometry.within(buffer)]
        if len(near) == 0:
            continue
        result[route["lane"]] = {"dsi": round(float(near["dsi"].mean()), 4), "n": int(len(near))}
        print(f"route {route['lane']}: n={len(near)} mean_dsi={near['dsi'].mean():.4f}")

    result["overall"] = {"dsi": round(float(points_gdf["dsi"].mean()), 4), "n": int(len(points_gdf))}
    print(f"overall: n={len(points_gdf)} mean_dsi={points_gdf['dsi'].mean():.4f}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
