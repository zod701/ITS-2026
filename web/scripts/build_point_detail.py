"""Build the per-point detail map the web panel shows next to DSI.

dsi_map_<version>.json stays small because the map colors 4.5k roads from it.
This file carries the rest of the numbers printed on the BEV image title —
occlusion breakdown, sight distance, pose fit, seam residuals, ground faces —
and the panel fetches it only for the version being viewed.

Writes web/public/data/point_detail_<version>/<bucket>.json, where bucket is
point_id // BUCKET_SIZE, each file being
{ "<point_id>_<pano_id>": { short keys below } }.

Sharding matters: the whole map is ~11 MB, which the panel would have to pull
before showing a single point. Bucketing by point_id keeps one fetch at a few
hundred KB, and because point_id runs along the road, panning to a neighbouring
point usually hits a bucket the browser already cached.

  ro   road_occluded_frac        rm  road_occluded_m      rs  road_span_m
  ru   road_unknown_frac         lv  l_vis_m              lf  l_vis_fwd_m
  lb   l_vis_bwd_m               ds  d_stopping_m         sl  speed_limit_kmh
  rc   road_class                sf  sight_flag (true/false/null)
  pf   pose.fit_score            pfar/pfwd/pbwd  pose.fit_far/fwd/bwd
  dyaw pose.dyaw_deg             dx/dy  pose.dx_m / dy_m  cl  pose.clipped
  seam [left|front, front|right, right|back, back|left]
  sm   calib.seam_rms_rel        f3  ground faces with >=300px   v  valid
  cv   calib_valid   rk  road_known_enough   pc  pose_converged
  om   on_mapped_road            cof cam_off_road_m

Fields a run did not record are omitted, so older versions simply show fewer
rows (the 260818 run has no seam_per / fit_far / clipped / faces300).
`f3` is recomputed from calib.n_ground_px so it exists for those runs too.

Usage:
  python build_point_detail.py <version> [bev_dir]
    bev_dir defaults to output/<version>.
"""
import json
import sys
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = WEB_DIR.parent

SEAM_ORDER = ["left|front", "front|right", "right|back", "back|left"]
GROUND_PX_MIN = 300      # bev_core.GROUND_PX_MIN — faces300 의 정의
BUCKET_SIZE = 1000       # 웹(PointDetailPanel)의 계산식과 반드시 같아야 한다


def put(out, key, value):
    if value is not None:
        out[key] = value


def main():
    if len(sys.argv) not in (2, 3):
        raise SystemExit("Usage: python build_point_detail.py <version> [bev_dir]")
    version = sys.argv[1]
    bev_dir = Path(sys.argv[2]) if len(sys.argv) == 3 else REPO_ROOT / "output" / version
    out_dir = WEB_DIR / "public" / "data" / f"point_detail_{version}"

    if not bev_dir.is_dir():
        raise SystemExit(f"bev_dir not found: {bev_dir}")

    buckets = {}
    n_records = 0
    for path in bev_dir.glob("*_dsi.json"):
        pano = path.name[: -len("_dsi.json")]
        if not pano.startswith("point_") or "_pano_" not in pano:
            continue
        point_id, _, pano_id = pano[len("point_"):].partition("_pano_")

        r = json.loads(path.read_text(encoding="utf-8"))
        calib = r.get("calib") or {}
        pose = r.get("pose") or {}

        d = {}
        for key, src in [
            ("ro", "road_occluded_frac"), ("rm", "road_occluded_m"),
            ("rs", "road_span_m"), ("ru", "road_unknown_frac"),
            ("lv", "l_vis_m"), ("lf", "l_vis_fwd_m"), ("lb", "l_vis_bwd_m"),
            ("ds", "d_stopping_m"), ("sl", "speed_limit_kmh"), ("rc", "road_class"),
            # valid 와 그것을 이루는 게이트들. 웹이 판정 불가의 "원인이 된 줄"을 빨갛게 칠한다.
            # 게이트 구성은 실행마다 다르다 — 260819 부터 pose_converged 가 빠지고
            # on_mapped_road(+cam_off_road_m) 가 들어왔다. 없는 것은 그냥 빠진다.
            ("v", "valid"), ("cv", "calib_valid"), ("rk", "road_known_enough"),
            ("pc", "pose_converged"), ("om", "on_mapped_road"), ("cof", "cam_off_road_m"),
        ]:
            put(d, key, r.get(src))
        # sight_flag 은 True/False/None 셋이고 None(판정 불가)도 의미가 있어 그대로 넘긴다.
        if "sight_flag" in r:
            d["sf"] = r["sight_flag"]

        for key, src in [
            ("pf", "fit_score"), ("pfar", "fit_far"), ("pfwd", "fit_fwd"),
            ("pbwd", "fit_bwd"), ("dyaw", "dyaw_deg"), ("dx", "dx_m"), ("dy", "dy_m"),
            ("cl", "clipped"),
        ]:
            put(d, key, pose.get(src))

        put(d, "sm", calib.get("seam_rms_rel"))
        seam_per = calib.get("seam_per")
        if seam_per:
            d["seam"] = [seam_per.get(k) for k in SEAM_ORDER]

        # faces300: 최신 실행은 필드로 갖고 있고, 옛 실행은 면별 지면 픽셀 수에서 다시 센다.
        if calib.get("faces300") is not None:
            d["f3"] = calib["faces300"]
        elif calib.get("n_ground_px"):
            d["f3"] = sum(1 for px in calib["n_ground_px"] if px >= GROUND_PX_MIN)

        buckets.setdefault(int(point_id) // BUCKET_SIZE, {})[f"{point_id}_{pano_id}"] = d
        n_records += 1

    if not buckets:
        raise SystemExit(f"No usable *_dsi.json under {bev_dir}; refusing to write {out_dir}")

    # 재실행 시 옛 조각이 남지 않게 디렉터리를 비우고 쓴다 (지점이 줄어든 실행도 있다).
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.json"):
        stale.unlink()

    total = 0
    for bucket, records in sorted(buckets.items()):
        path = out_dir / f"{bucket}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, separators=(",", ":"))
        total += path.stat().st_size

    print(f"Wrote {n_records} point details to {out_dir} "
          f"({len(buckets)} buckets, {total / 1e6:.1f} MB total, "
          f"{total / len(buckets) / 1e3:.0f} KB per fetch)")


if __name__ == "__main__":
    main()
