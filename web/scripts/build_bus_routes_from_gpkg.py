"""GIS/bus_lanes.gpkg -> web/public/data/bus_routes.geojson

bus_lanes.gpkg holds the bus routes (A/B/C) hand-traced directly onto the
official route map, one LineString per route in the "lane" column. This
replaces the earlier OSRM-based stop-to-stop routing approach -- OSRM's
road routing diverged significantly from the actual routes (e.g. route C
came out 22.44km via OSRM vs 9.52km hand-traced), so the hand-traced lines
are the source of truth for route geometry now.

distance_km is computed by projecting to EPSG:5179 (Korea 2000 / Unified CS,
metric) and measuring line length.

Usage:
  python build_bus_routes_from_gpkg.py
"""
import json
from pathlib import Path

import geopandas as gpd

WEB_DIR = Path(__file__).resolve().parent.parent
GPKG_PATH = WEB_DIR.parent / "GIS" / "bus_lanes.gpkg"
OUT_PATH = WEB_DIR / "public" / "data" / "bus_routes.geojson"


def main():
    gdf = gpd.read_file(GPKG_PATH)
    gdf_m = gdf.to_crs(epsg=5179)

    features = []
    for i, row in gdf.iterrows():
        distance_km = gdf_m.geometry.iloc[i].length / 1000
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": list(row.geometry.coords)},
            "properties": {"route": row["lane"], "distance_km": round(distance_km, 2)},
        })
        print(f"route {row['lane']}: {len(row.geometry.coords)} points, {distance_km:.2f} km")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {len(features)} routes to {OUT_PATH}")


if __name__ == "__main__":
    main()
