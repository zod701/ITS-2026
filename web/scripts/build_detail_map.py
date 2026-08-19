"""Map point_detail bucket number -> Drive fileId for one version.

The per-point detail is ~12 MB per version (100 bucket files). Committing that
every time the pipeline is re-run would grow the repo and the Vercel deployment
without bound, so the buckets live on Drive next to the BEV images and only this
small index (~4 KB) is committed.

Writes web/public/data/detail_map_<version>.json as { "<bucket>": "<driveFileId>" }.
The web reads it through /api/point-detail, which fetches the bucket server-side
(the API key stays out of the browser) and lets the CDN cache the response.

Prerequisites: upload web/public/data/point_detail_<version>/*.json into the same
Drive folder that holds this version's BEV images, shared as "Anyone with the link"
("Google Drive upload.ps1" does both in one run).

Usage:
  python build_detail_map.py <drive_folder_id> <version>
"""
import json
import re
import sys
from pathlib import Path

import requests

WEB_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = WEB_DIR / "public" / "data"
ENV_PATH = WEB_DIR / ".env"

BUCKET_RE = re.compile(r"^(?P<bucket>\d+)\.json$")


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


def list_json_files(folder_id: str, api_key: str):
    # mimeType 로 걸러 3만여 장의 JPEG 를 페이지 넘겨가며 훑지 않는다.
    files, page_token = [], None
    while True:
        params = {
            "q": (f"'{folder_id}' in parents and trashed = false "
                  "and mimeType = 'application/json'"),
            "fields": "nextPageToken, files(id, name)",
            "pageSize": 1000,
            "key": api_key,
        }
        if page_token:
            params["pageToken"] = page_token
        resp = requests.get("https://www.googleapis.com/drive/v3/files", params=params, timeout=30)
        if not resp.ok:
            print(f"Drive API error {resp.status_code}: {resp.text}")
            sys.exit(1)
        data = resp.json()
        files.extend(data.get("files", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            return files


def main():
    if len(sys.argv) != 3:
        print("Usage: python build_detail_map.py <drive_folder_id> <version>")
        sys.exit(1)
    folder_id, version = sys.argv[1], sys.argv[2]
    out_path = DATA_DIR / f"detail_map_{version}.json"

    files = list_json_files(folder_id, load_api_key())
    mapping = {}
    for f in files:
        m = BUCKET_RE.match(f["name"])
        if m:
            mapping[m.group("bucket")] = f["id"]

    if not mapping:
        print(f"No <bucket>.json files found in folder {folder_id}. "
              "Did the upload finish, and is the folder shared?")
        sys.exit(1)

    local_dir = DATA_DIR / f"point_detail_{version}"
    if local_dir.is_dir():
        local = {p.stem for p in local_dir.glob("*.json")}
        missing = sorted(local - set(mapping), key=int)
        if missing:
            print(f"경고: 로컬에 있는데 Drive 에 없는 조각 {len(missing)}개: {missing[:10]}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as out:
        json.dump(mapping, out, ensure_ascii=False, separators=(",", ":"))
    print(f"Mapped {len(mapping)} buckets, wrote {out_path} ({out_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
