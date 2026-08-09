"""Build point_id_pano_id -> DSI summary map from output/03_bev_gpu/*_dsi.json.

Writes web/public/data/dsi_map.json as
{ "<point_id>_<pano_id>": { "dsi": <float>, "grade": <str> } }.

Unlike image maps, this reads local pipeline output directly (not Google Drive) —
the DSI values themselves are small JSON, not images, so they're committed straight
into web/public/data/.

Usage:
  python build_dsi_map.py
"""
import json
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = WEB_DIR.parent
BEV_DIR = REPO_ROOT / "output" / "03_bev_gpu"
OUT_PATH = WEB_DIR / "public" / "data" / "dsi_map.json"


def main():
    mapping = {}
    skipped = 0
    for path in BEV_DIR.glob("*_dsi.json"):
        pano = path.name[: -len("_dsi.json")]
        # pano stem: point_{point_id}_pano_{pano_id}
        if not pano.startswith("point_") or "_pano_" not in pano:
            skipped += 1
            continue
        point_id, _, pano_id = pano[len("point_"):].partition("_pano_")
        key = f"{point_id}_{pano_id}"

        rec = json.loads(path.read_text(encoding="utf-8"))
        dsi = rec.get("dsi_refined")
        grade = rec.get("grade")
        if dsi is None or grade is None:
            skipped += 1
            continue
        mapping[key] = {"dsi": dsi, "grade": grade}

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as out:
        json.dump(mapping, out, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {len(mapping)} DSI records to {OUT_PATH} ({skipped} skipped)")


if __name__ == "__main__":
    main()
