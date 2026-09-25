"""Publish cached BIS route CSVs as browser map data."""
import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "demand/processed/routes"


def read(name):
    with (SOURCE / name).open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main():
    with (ROOT / "demand/processed/bus_stops_2025_annual_and_danoje.csv").open(encoding="utf-8-sig", newline="") as f:
        station_totals = {r["sttn_id"]: r for r in csv.DictReader(f)}
    demand = {}
    totals = {}
    for period, filename in [("annual", "route_stop_demand_2025.csv"), ("danoje", "route_stop_demand_2025_danoje.csv")]:
        records = read(filename)
        demand[period] = {(r["route_id"], r["sttn_id"]): [int(r["ride_nope"]), int(r["goff_nope"])] for r in records}
        totals[period] = defaultdict(int)
        for r in records:
            totals[period][r["route_id"]] += int(r["ride_nope"]) + int(r["goff_nope"])
    geometry, stops = defaultdict(list), defaultdict(list)
    for r in read("route_geometry.csv"):
        geometry[r["route_id"]].append(r)
    for r in read("route_stops.csv"):
        stops[r["route_id"]].append(r)
    result = []
    for r in read("routes.csv"):
        rid = r["route_id"]
        segments, segment, previous = [], [], None
        for p in sorted(geometry[rid], key=lambda p: int(p["response_order"])):
            direction = p["up_down"]
            if previous is not None and direction != previous:
                if len(segment) >= 2:
                    segments.append(segment)
                segment = []
            segment.append([float(p["longitude"]), float(p["latitude"])])
            previous = direction
        if len(segment) >= 2:
            segments.append(segment)
        assert segments, rid
        result.append({"id": rid, "name": r["route_name"], "company": r["company_name"],
            "start": r["start_stop_name"], "end": r["end_stop_name"], "segments": segments,
            "stops": [{"id": p["sttn_id"], "name": p["sttn_nm"], "order": p["station_order"],
                "coordinates": [float(p["longitude"]), float(p["latitude"])]}
                for p in sorted(stops[rid], key=lambda p: int(p["response_order"]))]})
    assert len(result) == len({r["id"] for r in result}) == 132
    for route in result:
        # Each route has its own range for each period and boarding/alighting metric.
        ranges = {p: [0, 0] for p in demand}
        for stop in route["stops"]:
            total = station_totals.get(stop["id"], {})
            stop["stationTotals"] = {
                "name": total.get("sttn_nm", stop["name"]), "sttn_id": stop["id"],
                **{field: int(total[field]) if total.get(field) else None for field in (
                    "annual_2025_ride_nope", "annual_2025_goff_nope", "danoje_ride_nope", "danoje_goff_nope")},
                "danoje_days_with_record": int(total.get("danoje_days_with_record", 0)),
                "danoje_days_supplied": 8,
            }
            stop["demand"] = {p: demand[p].get((route["id"], stop["id"])) for p in demand}
            for p, values in stop["demand"].items():
                if values is not None:
                    ranges[p] = [max(ranges[p][i], values[i]) for i in (0, 1)]
        route["demandRanges"] = ranges
        route["demandTotals"] = {p: totals[p].get(route["id"]) for p in totals}
    (ROOT / "web/public/data/bis_routes.json").write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Published {len(result)} routes")


if __name__ == "__main__":
    main()
