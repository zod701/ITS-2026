"""One-shot re-sync of all web DSI-derived data after re-running 03_bev_shadow_gpu.ipynb.

Runs, in dependency order (all for one version label, e.g. 260818):
  1. build_dsi_map.py        <bev_dir>/*_dsi.json  -> web/public/data/dsi_map_<v>.json
  2. build_road_dsi_map.py   dsi_map_<v>.json      -> web/public/data/road_dsi_map_<v>.json
  3. build_bus_route_dsi.py  dsi_map_<v>.json      -> web/public/data/bus_route_dsi_<v>.json
  4. build_point_detail.py   <bev_dir>/*_dsi.json  -> web/public/data/point_detail_<v>/

Each step's output feeds the next, so order matters -- this script exists so
you don't have to remember it or re-derive it each time.

This does NOT re-run the 03 notebook and does NOT touch the BEV image files
on Google Drive/bev_map_<version>.json -- if the BEV *images* changed (not just
the DSI numbers) and were uploaded to Drive as a new dated folder, run
  python build_image_map.py <bev_folder_id> bev_map_<version>.json _bev360
separately first (this script doesn't know your Drive folder ID), and add the
version to BEV_VERSIONS in app/components/PointDetailPanel.tsx so the panel
can offer it. <version> is the Drive folder name, e.g. 260818.

Usage:
  python rebuild_dsi_data.py <version> [bev_dir]
    bev_dir is passed to build_dsi_map.py only (defaults to output/03_bev2).
"""
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent

STEPS = [
    "build_dsi_map.py",
    "build_road_dsi_map.py",
    "build_bus_route_dsi.py",
    "build_point_detail.py",
]
# bev_dir(선택 인자)을 받는 스크립트. 나머지는 dsi_map_<v>.json 만 읽는다.
TAKES_BEV_DIR = {"build_dsi_map.py", "build_point_detail.py"}


def main():
    if len(sys.argv) not in (2, 3):
        raise SystemExit("Usage: python rebuild_dsi_data.py <version> [bev_dir]")
    version = sys.argv[1]
    bev_dir = sys.argv[2:3]

    for script in STEPS:
        print(f"=== {script} ===")
        args = [version] + (bev_dir if script in TAKES_BEV_DIR else [])
        result = subprocess.run([sys.executable, str(SCRIPTS_DIR / script), *args])
        if result.returncode != 0:
            print(f"{script} failed (exit {result.returncode}), stopping.")
            sys.exit(result.returncode)
    print(f"\n{version} DSI 데이터 재생성 완료. web/public/data/*_{version}.json 을 확인하고,"
          f"\napp/versions.ts 의 임계값(pointTerciles/roadTerciles)을 새 분포로 재적합했는지"
          f" 확인한 뒤 git commit/push 하세요.")


if __name__ == "__main__":
    main()
