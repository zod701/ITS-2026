"""α 조절용 성분 병합 — road_dsi_map / bus_route_dsi 에 s(정적)·d(동적) 을 붙인다.

웹에서 α 를 움직이면 `dsi = α·s + (1-α)·d` 를 브라우저가 다시 계산한다
(TAAS/method.md D-23). 그러려면 도로·노선 단위에도 두 성분이 있어야 하는데, 집계 규칙
(특히 노선 버퍼 20m)을 복제하고 싶지 않으므로 **공용 스크립트를 성분별로 한 번씩 더
돌려서** 결과를 병합한다.

선행: TAAS/analysis/composite/web_export_dynamic.py 가 임시 지점맵
      dsi_map_<v>s.json / dsi_map_<v>d.json 을 만들어 둔다.

Usage:
  python build_alpha_parts.py <version>
"""
import json
import subprocess
import sys
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent
DATA = WEB_DIR / "public" / "data"
SCRIPTS = Path(__file__).resolve().parent


def build(version: str) -> None:
    for script in ("build_road_dsi_map.py", "build_bus_route_dsi.py"):
        subprocess.run([sys.executable, str(SCRIPTS / script), version],
                       check=True, cwd=str(SCRIPTS))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python build_alpha_parts.py <version>")
    v = sys.argv[1]

    for tag in ("s", "d"):
        if not (DATA / f"dsi_map_{v}{tag}.json").exists():
            raise SystemExit(f"임시 지점맵이 없다: dsi_map_{v}{tag}.json — web_export_dynamic.py 를 먼저 돌릴 것")
        build(v + tag)

    for stem in ("road_dsi_map", "bus_route_dsi"):
        main_path = DATA / f"{stem}_{v}.json"
        base = json.loads(main_path.read_text(encoding="utf-8"))
        parts = {t: json.loads((DATA / f"{stem}_{v}{t}.json").read_text(encoding="utf-8"))
                 for t in ("s", "d")}
        merged = 0
        for key, rec in base.items():
            for t in ("s", "d"):
                p = parts[t].get(key)
                if p is not None:
                    rec[t] = round(p["dsi"], 4)
            if "s" in rec and "d" in rec:
                merged += 1
        main_path.write_text(json.dumps(base, ensure_ascii=False, separators=(",", ":")),
                             encoding="utf-8")
        print(f"{stem}_{v}.json — 성분 병합 {merged}/{len(base)}")
        for t in ("s", "d"):
            (DATA / f"{stem}_{v}{t}.json").unlink(missing_ok=True)

    for t in ("s", "d"):
        (DATA / f"dsi_map_{v}{t}.json").unlink(missing_ok=True)
    print("임시 파일 정리 완료")


if __name__ == "__main__":
    main()
