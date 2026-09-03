"""평시 기준 등급 임계 격자 — 판 간 비교가 성립하도록 임계를 공유한다.

α 를 움직이면 값 분포가 통째로 이동하므로 임계를 고정하면 등급이 한쪽으로 쏠린다. 반대로
판마다 임계를 따로 뽑으면 두 판을 나란히 놓고도 어느 쪽이 위험한지 말할 수 없다
(TAAS/method.md D-23 · D-24).

절충: **임계는 α 별로 두되 항상 기준판(평시) 분포에서 뽑는다.**
  같은 α 에서 모든 판이 같은 임계 → 판 간 비교 성립
  α 를 움직이면 임계도 따라 움직임 → 슬라이더는 의미 유지

산출 `terciles_grid.json` = {"road": {"0.35": [t1, t2], ...}, "point": {...}}
아울러 모든 판의 `grade` 필드를 기본 α 의 이 임계로 다시 쓴다.

Usage:
  python build_tercile_grid.py <기준판> [다른판 ...]
"""
import json
import sys
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent
DATA = WEB_DIR / "public" / "data"
STEP = 0.05
DEFAULT_ALPHA = 0.35


def terciles(values):
    v = sorted(values)
    at = lambda q: v[min(len(v) - 1, int(q * len(v)))]
    return [round(at(1 / 3), 4), round(at(2 / 3), 4)]


def combined(recs, a):
    return [a * r["s"] + (1 - a) * r["d"] for r in recs]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python build_tercile_grid.py <기준판> [다른판 ...]")
    base, others = sys.argv[1], sys.argv[2:]

    grid = {}
    for kind, stem in (("road", "road_dsi_map"), ("point", "dsi_map")):
        recs = list(json.loads((DATA / f"{stem}_{base}.json").read_text(encoding="utf-8")).values())
        if not recs or "s" not in recs[0]:
            raise SystemExit(f"{stem}_{base}.json 에 성분(s·d)이 없다 — build_alpha_parts.py 를 먼저 돌릴 것")
        g = {}
        a = 0.0
        while a <= 1.0 + 1e-9:
            g[f"{a:.2f}"] = terciles(combined(recs, a))
            a += STEP
        grid[kind] = g
        print(f"{kind:<6} α 격자 {len(g)}점  "
              f"α=0.00 {g['0.00']}  α={DEFAULT_ALPHA:.2f} {g[f'{DEFAULT_ALPHA:.2f}']}  α=1.00 {g['1.00']}")

    (DATA / "terciles_grid.json").write_text(
        json.dumps(grid, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {DATA / 'terciles_grid.json'}")

    # 모든 판의 grade 를 기본 α 의 공통 임계로 다시 쓴다
    print("\n기본 α 임계로 grade 재계산 · 등급 분포")
    for v in [base] + others:
        for kind, stem in (("road", "road_dsi_map"), ("point", "dsi_map")):
            f = DATA / f"{stem}_{v}.json"
            m = json.loads(f.read_text(encoding="utf-8"))
            t1, t2 = grid[kind][f"{DEFAULT_ALPHA:.2f}"]
            cnt = {"Safe": 0, "Caution": 0, "High-risk": 0}
            for r in m.values():
                x = DEFAULT_ALPHA * r["s"] + (1 - DEFAULT_ALPHA) * r["d"]
                r["dsi"] = round(x, 4)
                r["grade"] = "Safe" if x < t1 else ("Caution" if x < t2 else "High-risk")
                cnt[r["grade"]] += 1
            f.write_text(json.dumps(m, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            n = sum(cnt.values())
            print(f"  {v:<10} {kind:<6} Safe {cnt['Safe'] / n:5.1%} · "
                  f"Caution {cnt['Caution'] / n:5.1%} · High-risk {cnt['High-risk'] / n:5.1%}")


if __name__ == "__main__":
    main()
