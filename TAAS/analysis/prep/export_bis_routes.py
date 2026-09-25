"""Export current public Gangneung BIS routes; cache original responses."""
import csv
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "demand/processed/routes"
BASE = "https://bis.gn.go.kr"


def fetch(path):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(BASE + path, timeout=30) as response:
                return json.load(response)
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def write(name, rows, fields):
    with (OUT / name).open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cache = OUT / "raw"
    cache.mkdir(exist_ok=True)
    listing = cache / "routes.json"
    if not listing.exists():
        listing.write_text(json.dumps({"retrieved_at": datetime.now(timezone.utc).isoformat(),
            "data": fetch("/search/route")}, ensure_ascii=False), encoding="utf-8")
    snapshot = json.loads(listing.read_text(encoding="utf-8"))
    routes = snapshot["data"]["list"]
    assert len(routes) == len({r["routeId"] for r in routes})
    basic, stops, vertices, schedules, times = [], [], [], [], []
    for index, route in enumerate(routes):
        rid = str(route["routeId"])
        path = cache / f"{rid}.json"
        if not path.exists():
            data = fetch(f"/search/route/map?routeId={rid}")
            path.write_text(json.dumps({"retrieved_at": datetime.now(timezone.utc).isoformat(),
                "data": data}, ensure_ascii=False), encoding="utf-8")
            time.sleep(.1)
        saved = json.loads(path.read_text(encoding="utf-8"))
        data = saved["data"]
        common = {"route_id": rid, "route_name": route["routeNm"],
                  "company_name": route["companyNm"]}
        basic.append({**common, "start_stop_name": route["stStaNm"],
            "end_stop_name": route["edStaNm"], "stop_visits": len(data["list"]),
            "geometry_points": len(data["draw"]), "retrieved_at": saved["retrieved_at"],
            "source_url": BASE + f"/search/route/map?routeId={rid}"})
        for n, r in enumerate(data["list"], 1):
            stops.append({**common, "response_order": n, "station_order": r.get("stationOrder"),
                "sttn_id": r.get("stationId2"), "sttn_nm": r.get("stationNm"),
                "longitude": r.get("vertexX"), "latitude": r.get("vertexY"),
                "turn_seq": r.get("turnSeq"), "up_down": r.get("upDown"),
                "first_time": r.get("firstTime"), "last_time": r.get("lastTime")})
            for t in r.get("routeTime") or []:
                times.append({**common, "response_order": n, "sttn_id": r.get("stationId2"),
                    "direction": t.get("direction"), "avg_time_raw": t.get("avgTime"),
                    "min_time_raw": t.get("minTime"), "max_time_raw": t.get("maxTime")})
        for n, r in enumerate(data["draw"], 1):
            vertices.append({**common, "response_order": n, "sequence": r.get("sequence"),
                "up_down": r.get("upDown"), "up_down_seq": r.get("upDownSeq"),
                "type_raw": r.get("type"), "turn_seq": r.get("turnSeq"),
                "longitude": r.get("vertexX"), "latitude": r.get("vertexY")})
        for r in data.get("routeSchedule") or []:
            schedules.append({**common, "company_id": r.get("companyId"),
                "start_stop_name": r.get("stStaNm"), "end_stop_name": r.get("edStaNm"),
                "first_time": r.get("firstTime"), "last_time": r.get("lastTime"),
                "total_run_raw": r.get("totalRun")})
        if (index + 1) % 10 == 0:
            print(f"Fetched {index+1}/{len(routes)}", flush=True)
    for name, rows in [("routes.csv", basic), ("route_stops.csv", stops),
                       ("route_geometry.csv", vertices), ("route_schedules.csv", schedules),
                       ("route_stop_times.csv", times)]:
        assert rows, name
        write(name, rows, list(rows[0]))
    assert len(stops) == sum(r["stop_visits"] for r in basic)
    assert len(vertices) == sum(r["geometry_points"] for r in basic)
    report = {"route_count": len(basic), "stop_visits": len(stops), "geometry_points": len(vertices),
        "schedule_rows": len(schedules), "stop_time_rows": len(times),
        "empty_stop_routes": [r["route_id"] for r in basic if not r["stop_visits"]],
        "empty_geometry_routes": [r["route_id"] for r in basic if not r["geometry_points"]],
        "source": BASE + "/search/route", "listing_retrieved_at": snapshot["retrieved_at"]}
    (OUT / "validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
