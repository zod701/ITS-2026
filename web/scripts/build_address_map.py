"""Build pano_id -> address map from GIS/historical_panoids_filtered.csv.

Writes web/public/data/address_map.json as { "<pano_id>": "<address>" },
where address is "<description> <title>" (e.g. "강원특별자치도 강릉시 지변동 동해대로").

Usage:
  python build_address_map.py
"""
import csv
import json
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = WEB_DIR.parent
CSV_PATH = REPO_ROOT / "GIS" / "historical_panoids_filtered.csv"
OUT_PATH = WEB_DIR / "public" / "data" / "address_map.json"


def main():
    mapping = {}
    with open(CSV_PATH, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            pano_id = row["pano_id"].strip()
            description = row["description"].strip()
            title = row["title"].strip()
            if not pano_id or pano_id in mapping:
                continue
            address = f"{description} {title}".strip()
            if address:
                mapping[pano_id] = address

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as out:
        json.dump(mapping, out, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {len(mapping)} addresses to {OUT_PATH}")


if __name__ == "__main__":
    main()
