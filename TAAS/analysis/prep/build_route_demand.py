"""Aggregate 2025 boarding/alighting by route and stop without multiplying visits."""
import csv
import argparse
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / "demand"
OUT = BASE / "processed/routes"


def read(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write(name, rows):
    with (OUT / name).open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--danoje", action="store_true", help="Use dated 2025 festival raw files")
    args = parser.parse_args()
    suffix = "2025_danoje" if args.danoje else "2025"
    daily_validation = []
    period = {}
    if args.danoje:
        raw = []
        files = sorted((BASE / "smartcard data/단오제 raw").glob("*.csv"))
        assert {p.stem for p in files} == {"0527", "0528", "0529", "0530", "0531", "0601", "0602", "0603"}
        for p in files:
            rows = read(p)
            assert {r["opr_ymd"] for r in rows} == {"2025" + p.stem}
            def station_totals(records):
                result = defaultdict(lambda: [0, 0])
                for record in records:
                    result[record["sttn_id"]][0] += int(record["ride_nope"])
                    result[record["sttn_id"]][1] += int(record["goff_nope"])
                return dict(result)
            actual = station_totals(rows)
            prior = station_totals(read(BASE / f"smartcard data/station_{p.stem}.csv"))
            mismatches = sum(actual.get(i) != prior.get(i) for i in actual.keys() | prior.keys())
            daily_validation.append({"date": "2025" + p.stem, "raw_rows": len(rows),
                "ride_nope": sum(int(r["ride_nope"]) for r in rows),
                "goff_nope": sum(int(r["goff_nope"]) for r in rows),
                "prior_station_csv_mismatched_ids": mismatches})
            raw.extend(rows)
        period = {"period_start": "2025-05-27", "period_end": "2025-06-03", "days_supplied": 8}
    else:
        raw = read(BASE / "smartcard data/2025.csv")
        assert {r["opr_yr"] for r in raw} == {"2025"}
    routes = {r["route_id"]: r for r in read(OUT / "routes.csv")}
    stops = {r["sttn_id"]: r for r in read(BASE / "processed/bus_stops_2025_annual_and_danoje.csv")}
    visits = defaultdict(list)
    for r in read(OUT / "route_stops.csv"):
        visits[r["route_id"], r["sttn_id"]].append(r)
    old_names = defaultdict(set)
    for p in sorted((BASE / "smartcard data").glob("station*.csv")):
        for r in read(p):
            if r["sttn_nm"].strip():
                old_names[r["sttn_id"]].add(r["sttn_nm"])
    counts = defaultdict(lambda: [0, 0])
    sequences = defaultdict(set)
    for r in raw:
        key = r["rte_id"], r["sttn_id"]
        counts[key][0] += int(r["ride_nope"])
        counts[key][1] += int(r["goff_nope"])
        sequences[key].add(r["sttn_seq"])
    groups = defaultdict(list)
    for (rid, sid), (ride, goff) in sorted(counts.items()):
        route = routes.get(rid, {})
        stop = stops.get(sid, {})
        current = visits.get((rid, sid), [])
        name = stop.get("sttn_nm") or (current[0]["sttn_nm"] if current else "") or " | ".join(sorted(old_names[sid]))
        groups[rid].append({"year": 2025, "route_id": rid,
            "route_name_current": route.get("route_name", ""), "company_name_current": route.get("company_name", ""),
            "route_in_current_bis": bool(route), "sttn_id": sid, "sttn_nm": name,
            "name_source": "BIS inventory" if stop else "BIS route" if current else "smartcard station files" if name else "unavailable",
            "stop_in_current_bis_inventory": bool(stop), "stop_on_current_route": bool(current),
            "current_station_orders": " | ".join(r["station_order"] for r in current),
            "source_2025_station_sequences": " | ".join(sorted(sequences[rid, sid])),
            "longitude": stop.get("longitude", ""), "latitude": stop.get("latitude", ""),
            "ride_nope": ride, "goff_nope": goff,
            "ride_rank": None, "goff_rank": None, "ride_share_pct": None, "goff_share_pct": None})
    detail, summary, top = [], [], []
    for rid, rows in sorted(groups.items()):
        totals = {field: sum(r[field] for r in rows) for field in ("ride_nope", "goff_nope")}
        known = [r for r in rows if r["sttn_id"] not in ("", "~")]
        for field, prefix in [("ride_nope", "ride"), ("goff_nope", "goff")]:
            values = sorted((r[field] for r in known if r[field] > 0), reverse=True)
            ranks = {value: values.index(value)+1 for value in set(values)}
            for r in rows:
                r[prefix+"_share_pct"] = round(100*r[field]/totals[field], 6) if totals[field] else None
                if r["sttn_id"] not in ("", "~") and r[field] > 0:
                    r[prefix+"_rank"] = ranks[r[field]]
                    if ranks[r[field]] <= 5:
                        top.append({"year": 2025, "route_id": rid, "route_name_current": r["route_name_current"],
                            "company_name_current": r["company_name_current"], "metric": prefix,
                            "rank": ranks[r[field]], "sttn_id": r["sttn_id"], "sttn_nm": r["sttn_nm"],
                            "count": r[field], "route_total": totals[field], "share_pct": r[prefix+"_share_pct"],
                            "stop_on_current_route": r["stop_on_current_route"]})
        first = rows[0]
        s = {"year": 2025, "route_id": rid, "route_name_current": first["route_name_current"],
            "company_name_current": first["company_name_current"], "route_in_current_bis": first["route_in_current_bis"],
            "identified_stop_count": len(known), "ride_total": totals["ride_nope"], "goff_total": totals["goff_nope"],
            "unknown_stop_ride": sum(r["ride_nope"] for r in rows if r["sttn_id"] in ("", "~")),
            "unknown_stop_goff": sum(r["goff_nope"] for r in rows if r["sttn_id"] in ("", "~"))}
        for prefix, field in [("ride", "ride_nope"), ("goff", "goff_nope")]:
            best = [r for r in known if r[prefix+"_rank"] == 1]
            s["top_"+prefix+"_stop_ids"] = " | ".join(r["sttn_id"] for r in best)
            s["top_"+prefix+"_stop_names"] = " | ".join(r["sttn_nm"] or "(name unavailable)" for r in best)
            s["top_"+prefix+"_count_each"] = best[0][field] if best else None
        summary.append(s)
        detail.extend(rows)
    top.sort(key=lambda r: (r["route_id"], r["metric"], r["rank"], r["sttn_id"]))
    if args.danoje:
        source_route_names = defaultdict(set)
        route_dates = defaultdict(set)
        stop_dates = defaultdict(set)
        for r in raw:
            source_route_names[r["rte_id"]].add(r["rte_nm"])
            route_dates[r["rte_id"]].add(r["opr_ymd"])
            stop_dates[r["rte_id"], r["sttn_id"]].add(r["opr_ymd"])
        for collection in (detail, summary, top):
            for r in collection:
                r.update(period)
                r["route_name_source_2025"] = " | ".join(sorted(source_route_names[r["route_id"]]))
                r["days_with_record"] = len(stop_dates[r["route_id"], r["sttn_id"]]) if "sttn_id" in r else len(route_dates[r["route_id"]])
    write(f"route_stop_demand_{suffix}.csv", detail)
    write(f"route_demand_summary_{suffix}.csv", summary)
    write(f"route_top_stops_{suffix}.csv", top)
    raw_totals = [sum(int(r[f]) for r in raw) for f in ("ride_nope", "goff_nope")]
    assert raw_totals == [sum(r[f] for r in detail) for f in ("ride_nope", "goff_nope")]
    assert len(detail) == len({(r["route_id"], r["sttn_id"]) for r in detail})
    report = {"source_totals_ride_goff": raw_totals, "source_routes": len(groups),
        "matched_current_routes": len(groups.keys() & routes.keys()),
        "unmatched_current_route_ids": sorted(groups.keys()-routes.keys()),
        "current_routes_without_2025_records": sorted(routes.keys()-groups.keys()),
        "route_stop_rows": len(detail), "top_rows": len(top),
        "route_stop_pairs_not_on_current_route": sum(not r["stop_on_current_route"] for r in detail),
        "ranking": "positive counts, competition rank, unknown stop ID excluded; shares use full route totals"}
    if args.danoje:
        report.update(period)
        report["daily_validation"] = daily_validation
    (OUT / f"demand_validation_{suffix}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
