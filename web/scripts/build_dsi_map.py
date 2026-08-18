"""Build point_id_pano_id -> DSI summary map from a 03 run's *_dsi.json.

Writes web/public/data/dsi_map_<version>.json as
{ "<point_id>_<pano_id>": { "dsi": <float>, "grade": <str> } }.

Unlike image maps, this reads local pipeline output directly (not Google Drive) —
the DSI values themselves are small JSON, not images, so they're committed straight
into web/public/data/.

<version> labels one 03 run and must match the Drive image folder name and the
entry in app/versions.ts, e.g. 260818. DSI is *not* comparable across versions:
the formula itself changed, so each version carries its own grade thresholds.

Usage:
  python build_dsi_map.py <version> [bev_dir]
    bev_dir defaults to output/03_bev2 (relative to the repo root).
"""
import json
import sys
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = WEB_DIR.parent
DEFAULT_BEV_DIR = REPO_ROOT / "output" / "03_bev2"


def main():
    if len(sys.argv) not in (2, 3):
        raise SystemExit("Usage: python build_dsi_map.py <version> [bev_dir]")
    version = sys.argv[1]
    BEV_DIR = Path(sys.argv[2]) if len(sys.argv) == 3 else DEFAULT_BEV_DIR
    OUT_PATH = WEB_DIR / "public" / "data" / f"dsi_map_{version}.json"

    # glob 은 없는 디렉터리에서도 예외 없이 빈 결과를 준다. 그대로 진행하면 0건짜리
    # dsi_map.json 을 쓰고 뒤따르는 road/bus 스크립트까지 비워, 웹의 DSI 가 전부 사라진다.
    if not BEV_DIR.is_dir():
        raise SystemExit(f"BEV_DIR not found: {BEV_DIR}")

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

    if not mapping:
        raise SystemExit(f"No usable *_dsi.json under {BEV_DIR}; refusing to overwrite {OUT_PATH}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as out:
        json.dump(mapping, out, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {len(mapping)} DSI records to {OUT_PATH} ({skipped} skipped)")


if __name__ == "__main__":
    main()
