"""List files in a public Google Drive folder and map point_id/pano_id -> fileId.

Writes web/public/data/<output>.json as { "<point_id>_<pano_id>": "<driveFileId>" }.
Run once per image category (original panoramas, BEV results, etc.), each
pointing at its own Drive folder and writing its own output file, e.g.:
  python build_image_map.py <img_folder_id> image_map.json
  python build_image_map.py <bev_folder_id> bev_map.json

Prerequisites:
  pip install requests
  The target Drive folder must be shared as "Anyone with the link".
  An API key with the Google Drive API enabled (Google Cloud Console ->
  APIs & Services -> Credentials -> Create Credentials -> API key).

The API key is read from web/.env (GOOGLE_DRIVE_API_KEY=...), which is
gitignored, so it is never committed.

Usage:
  python build_image_map.py <drive_folder_id> [output_filename.json]
"""
import json
import re
import sys
from pathlib import Path

import requests

WEB_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = WEB_DIR / "public" / "data"
ENV_PATH = WEB_DIR / ".env"

FILENAME_RE = re.compile(r"^point_(?P<point_id>\d+)_pano_(?P<pano_id>.+)\.jpg$")


def load_api_key() -> str:
    if not ENV_PATH.exists():
        print(f"Missing {ENV_PATH}. Create it with a line: GOOGLE_DRIVE_API_KEY=your_key")
        sys.exit(1)
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("GOOGLE_DRIVE_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    print(f"GOOGLE_DRIVE_API_KEY not found in {ENV_PATH}")
    sys.exit(1)


def list_drive_files(folder_id: str, api_key: str):
    files = []
    page_token = None
    while True:
        params = {
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": "nextPageToken, files(id, name)",
            "pageSize": 1000,
            "key": api_key,
        }
        if page_token:
            params["pageToken"] = page_token

        resp = requests.get(
            "https://www.googleapis.com/drive/v3/files", params=params, timeout=30
        )
        if not resp.ok:
            print(f"Drive API error {resp.status_code}: {resp.text}")
            sys.exit(1)

        data = resp.json()
        files.extend(data.get("files", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return files


def main():
    if len(sys.argv) not in (2, 3):
        print("Usage: python build_image_map.py <drive_folder_id> [output_filename.json]")
        sys.exit(1)
    folder_id = sys.argv[1]
    out_filename = sys.argv[2] if len(sys.argv) == 3 else "image_map.json"
    out_path = DATA_DIR / out_filename
    api_key = load_api_key()

    files = list_drive_files(folder_id, api_key)

    mapping = {}
    unmatched = 0
    for f in files:
        m = FILENAME_RE.match(f["name"])
        if not m:
            unmatched += 1
            continue
        key = f"{m.group('point_id')}_{m.group('pano_id')}"
        mapping[key] = f["id"]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as out:
        json.dump(mapping, out, ensure_ascii=False, separators=(",", ":"))

    print(f"Matched {len(mapping)} files, {unmatched} unmatched, wrote {out_path}")


if __name__ == "__main__":
    main()
