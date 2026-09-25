"""Join the user BIS inventory, official coordinates and supplied smartcard counts.

Offline rebuild: python TAAS/analysis/prep/build_bus_stop_demand.py
Refresh the public BIS snapshot first: add --refresh-bis.
The historical VWorld GeoJSON is preserved before replacing the web data.
"""
import argparse
import csv
import hashlib
import json
import math
import re
import shutil
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / "demand"
OUT = BASE / "processed"
SMART = BASE / "smartcard data"
WEB = ROOT / "web/public/data/bus_stops.geojson"
URL = "https://bis.gn.go.kr/search/station"
BOUNDS = (128.8598787651, 37.7321168224, 128.9546660985, 37.811142202)


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(name, rows):
    with (OUT / name).open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def aggregate(rows):
    result = defaultdict(lambda: [0, 0, 0])
    for r in rows:
        v = result[r["sttn_id"]]
        v[0] += int(r["ride_nope"])
        v[1] += int(r["goff_nope"])
        v[2] += 1
    return dict(result)


def norm(name):
    return re.sub(r"[\s.,()\-]", "", name.replace("(버스정류장)", "")).casefold()


def distance(a, b):
    x, y, xx, yy = map(math.radians, (*a, *b))
    h = math.sin((yy-y)/2)**2 + math.cos(y)*math.cos(yy)*math.sin((xx-x)/2)**2
    return 12710000 * math.asin(min(1, math.sqrt(h)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh-bis", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    snapshot_path = OUT / "bis_station_snapshot.json"
    if args.refresh_bis:
        with urllib.request.urlopen(URL, timeout=30) as response:
            records = json.load(response)["list"]
        snapshot_path.write_text(json.dumps({"source_url": URL,
            "retrieved_at": datetime.now(timezone.utc).isoformat(), "list": records},
            ensure_ascii=False, indent=2), encoding="utf-8")
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    lines = [s.strip() for s in next(BASE.glob("*bis.txt")).read_text(encoding="utf-8-sig").splitlines() if s.strip()]
    assert len(lines) % 2 == 0
    pairs = list(zip(lines[::2], lines[1::2]))
    assert all(re.fullmatch(r"\d{7}", i) for n, i in pairs)
    inventory = {i: n for n, i in pairs}
    official = {str(r["stationId2"]): r for r in snapshot["list"]}
    assert len(inventory) == len(pairs) and len(official) == len(snapshot["list"])
    assert set(inventory) <= official.keys(), "BIS coordinates missing for inventory IDs"
    annual_raw = read_csv(SMART / "2025.csv")
    assert {r["opr_yr"] for r in annual_raw} == {"2025"}
    annual = aggregate(annual_raw)
    year_check = aggregate(read_csv(SMART / "station_year.csv"))
    assert {i: v[:2] for i, v in annual.items()} == {i: v[:2] for i, v in year_check.items()}
    daily = {}
    aliases = defaultdict(set)
    for p in sorted(SMART.glob("station*.csv")):
        rows = read_csv(p)
        for r in rows:
            if r["sttn_nm"].strip():
                aliases[r["sttn_id"]].add(norm(r["sttn_nm"]))
        match = re.fullmatch(r"station_(\d{2})(\d{2})", p.stem)
        if match:
            date = f"2025-{match[1]}-{match[2]}"
            datetime.strptime(date, "%Y-%m-%d")
            daily[date] = aggregate(rows)
    assert len(daily) == 8 and min(daily) == "2025-05-27" and max(daily) == "2025-06-03"
    festival = {}
    for values in daily.values():
        for i, v in values.items():
            total = festival.setdefault(i, [0, 0, 0])
            total[0] += v[0]
            total[1] += v[1]
            total[2] += 1
    master = []
    for i, name in inventory.items():
        r = official[i]
        lon, lat = float(r["coordnatesx"]), float(r["coordnatesy"])
        assert math.isfinite(lon) and math.isfinite(lat) and 124 < lon < 132 and 33 < lat < 39
        a, f = annual.get(i), festival.get(i)
        master.append({"sttn_id": i, "sttn_nm": name, "longitude": lon, "latitude": lat,
            "coordinate_source": URL, "coordinate_retrieved_at": snapshot["retrieved_at"],
            "bis_api_name": r["stationNm"],
            "in_analysis_bbox": BOUNDS[0] <= lon <= BOUNDS[2] and BOUNDS[1] <= lat <= BOUNDS[3],
            "annual_2025_ride_nope": a[0] if a else None,
            "annual_2025_goff_nope": a[1] if a else None,
            "annual_record_present": a is not None,
            "danoje_start": min(daily), "danoje_end": max(daily),
            "danoje_ride_nope": f[0] if f else None, "danoje_goff_nope": f[1] if f else None,
            "danoje_days_with_record": f[2] if f else 0, "danoje_days_supplied": len(daily)})
    write_csv("bus_stops_2025_annual_and_danoje.csv", master)
    daily_rows = []
    for date, values in daily.items():
        for r in master:
            v = values.get(r["sttn_id"])
            daily_rows.append({"date": date, "sttn_id": r["sttn_id"], "sttn_nm": r["sttn_nm"],
                "longitude": r["longitude"], "latitude": r["latitude"],
                "ride_nope": v[0] if v else None, "goff_nope": v[1] if v else None,
                "record_present": v is not None})
    write_csv("bus_stops_2025_danoje_daily.csv", daily_rows)
    unmatched = []
    totals = {}
    for period, values in [("2025", annual), ("danoje_total", festival), *daily.items()]:
        raw = [sum(v[j] for v in values.values()) for j in (0, 1)]
        joined = [sum(v[j] for i, v in values.items() if i in inventory) for j in (0, 1)]
        excluded = [sum(v[j] for i, v in values.items() if i not in inventory) for j in (0, 1)]
        assert raw == [joined[j] + excluded[j] for j in (0, 1)]
        totals[period] = {"source": raw, "joined_bis": joined, "unmatched": excluded,
                          "matched_ids": len(values.keys() & inventory.keys()),
                          "unmatched_ids": len(values.keys() - inventory.keys())}
        for i, v in values.items():
            if i not in inventory:
                unmatched.append({"period": period, "sttn_id": i, "ride_nope": v[0],
                    "goff_nope": v[1], "reason": "ID absent from supplied BIS inventory"})
    if unmatched:
        write_csv("smartcard_unmatched_bis.csv", unmatched)
    backup = OUT / "bus_stops_vworld_original.geojson"
    if not backup.exists():
        shutil.copy2(WEB, backup)
    old = json.loads(backup.read_text(encoding="utf-8"))["features"]
    comparison = []
    for idx, feature in enumerate(old):
        name, xy = feature["properties"]["name"], feature["geometry"]["coordinates"]
        candidates = [r for r in master if norm(name) == norm(r["sttn_nm"]) or norm(name) in aliases[r["sttn_id"]]]
        ranked = sorted((distance(xy, (r["longitude"], r["latitude"])), r["sttn_id"]) for r in candidates)
        nearest = min((distance(xy, (r["longitude"], r["latitude"])), r["sttn_id"]) for r in master)
        accepted = bool(ranked and ranked[0][0] <= 200 and (len(ranked) == 1 or ranked[1][0]-ranked[0][0] >= 5))
        comparison.append({"old_index": idx, "old_name": name, "old_longitude": xy[0], "old_latitude": xy[1],
            "candidate_id": ranked[0][1] if ranked else "", "candidate_distance_m": round(ranked[0][0], 3) if ranked else None,
            "name_candidate_count": len(ranked), "comparison_accepted": accepted,
            "nearest_any_id": nearest[1], "nearest_any_distance_m": round(nearest[0], 3)})
    # Remove ambiguous many-to-one correspondences from the displacement denominator.
    uses = Counter(r["candidate_id"] for r in comparison if r["comparison_accepted"])
    for r in comparison:
        if uses[r["candidate_id"]] > 1:
            r["comparison_accepted"] = False
    write_csv("web_stop_location_comparison.csv", comparison)
    accepted = [r for r in comparison if r["comparison_accepted"]]
    report = {"bis_inventory_count": len(master), "web_old_count": len(old),
        "web_new_count": sum(r["in_analysis_bbox"] for r in master),
        "coordinate_missing": 0, "api_name_mismatches": sum(r["sttn_nm"] != r["bis_api_name"] for r in master),
        "daily_year_assumption": "2025, from user-requested festival year; filenames contain MMDD only",
        "counts_order": ["ride_nope", "goff_nope"], "totals": totals,
        "location_comparison": {"method": "name/ID-backed smartcard alias + nearest <=200m, runner-up gap >=5m, unique target",
            "accepted_pairs": len(accepted), "unresolved_old_points": len(old)-len(accepted),
            "thresholds": {str(t): {"count": sum(r["candidate_distance_m"] > t for r in accepted),
                "percent_of_accepted": round(100*sum(r["candidate_distance_m"] > t for r in accepted)/len(accepted), 2) if accepted else None}
                for t in (10, 20, 50, 100)}},
        "source_sha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [next(BASE.glob("*bis.txt")), snapshot_path, SMART / "2025.csv", *sorted(SMART.glob("station*.csv")), backup]}}
    (OUT / "validation_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    features = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["longitude"], r["latitude"]]},
        "properties": {"name": r["sttn_nm"], "addr": "", **r}} for r in master if r["in_analysis_bbox"]]
    assert len({f["properties"]["sttn_id"] for f in features}) == len(features)
    WEB.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "source_sha256"}, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
