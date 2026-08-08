"""List files in a shared Google Drive folder and map point_id/pano_id -> fileId.

Writes web/public/data/image_map.json as { "<point_id>_<pano_id>": "<driveFileId>" }.

Prerequisites:
  pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
  A Google Cloud OAuth client credentials.json (Desktop app) placed next to this script,
  or set GOOGLE_APPLICATION_CREDENTIALS for a service account with access to the folder.

Usage:
  python build_image_map.py <drive_folder_id>
"""
import json
import re
import sys
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent
OUT_PATH = WEB_DIR / "public" / "data" / "image_map.json"

FILENAME_RE = re.compile(r"^point_(?P<point_id>\d+)_pano_(?P<pano_id>.+)\.jpg$")


def list_drive_files(folder_id: str):
    from googleapiclient.discovery import build
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    import pickle

    SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
    token_path = Path(__file__).parent / "token.pickle"
    creds = None
    if token_path.exists():
        creds = pickle.loads(token_path.read_bytes())
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                str(Path(__file__).parent / "credentials.json"), SCOPES
            )
            creds = flow.run_local_server(port=0)
        token_path.write_bytes(pickle.dumps(creds))

    service = build("drive", "v3", credentials=creds)
    files = []
    page_token = None
    while True:
        resp = service.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            fields="nextPageToken, files(id, name)",
            pageSize=1000,
            pageToken=page_token,
        ).execute()
        files.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return files


def main():
    if len(sys.argv) != 2:
        print("Usage: python build_image_map.py <drive_folder_id>")
        sys.exit(1)
    folder_id = sys.argv[1]

    files = list_drive_files(folder_id)

    mapping = {}
    unmatched = 0
    for f in files:
        m = FILENAME_RE.match(f["name"])
        if not m:
            unmatched += 1
            continue
        key = f"{m.group('point_id')}_{m.group('pano_id')}"
        mapping[key] = f["id"]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as out:
        json.dump(mapping, out, ensure_ascii=False, separators=(",", ":"))

    print(f"Matched {len(mapping)} files, {unmatched} unmatched, wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
