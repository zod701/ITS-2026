"""One-shot re-sync of all web DSI-derived data after re-running 03_bev_shadow_gpu.ipynb.

Runs, in dependency order:
  1. build_dsi_map.py        output/03_bev2/*_dsi.json    -> web/public/data/dsi_map.json
  2. build_road_dsi_map.py   dsi_map.json                 -> web/public/data/road_dsi_map.json
  3. build_bus_route_dsi.py  dsi_map.json                 -> web/public/data/bus_route_dsi.json

Each step's output feeds the next, so order matters -- this script exists so
you don't have to remember it or re-derive it each time.

This does NOT re-run the 03 notebook and does NOT touch the BEV image files
on Google Drive/bev_map.json -- if the BEV *images* changed (not just the
DSI numbers) and were re-uploaded to Drive under new file IDs, run
  python build_image_map.py <bev_folder_id> bev_map.json _bev360
separately first (this script doesn't know your Drive folder ID).

Usage:
  python rebuild_dsi_data.py
"""
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent

STEPS = [
    "build_dsi_map.py",
    "build_road_dsi_map.py",
    "build_bus_route_dsi.py",
]


def main():
    for script in STEPS:
        print(f"=== {script} ===")
        result = subprocess.run([sys.executable, str(SCRIPTS_DIR / script)])
        if result.returncode != 0:
            print(f"{script} failed (exit {result.returncode}), stopping.")
            sys.exit(result.returncode)
    print("\n모든 DSI 데이터 재생성 완료. web/public/data/*.json 변경사항을 확인 후 git commit/push 하세요.")


if __name__ == "__main__":
    main()
