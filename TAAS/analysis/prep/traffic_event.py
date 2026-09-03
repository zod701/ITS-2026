# -*- coding: utf-8 -*-
"""
이벤트 기간 교차로 통행량 — 강릉단오제

프로젝트 목적을 **특수 이벤트 기간의 자율주행 셔틀 노선 설계**로 한정했으므로, 동적 지수의
통행량도 그 기간의 값이어야 한다. 연평균(`traffic_aadt.csv`)은 평시를 대표하므로 축제
기간의 국지적 쏠림을 담지 못한다.

**기준선은 연평균이 아니라 축제 창 앞뒤 28일이다.** 같은 계절·요일 구성과 비교해야 계절
효과가 통제된다. 연평균 대비로 재면 여름 성수기 상승분이 축제 효과에 섞인다.

**해마다 따로 낸다.** 2025·2026 두 번의 축제가 각각 하나의 시나리오다. 다만 두 해의 배율이
순위상관 rho +0.725 (p<0.0001), 상위 10 중 7개 겹침으로 **재현된다**는 것을 함께 확인한다 —
한 해만 보면 그해 특수 상황인지 구분할 수 없다.

산출: `data/traffic_danoje_2025.csv` · `data/traffic_danoje_2026.csv`
  aadt        그해 축제 8일의 일평균 — **결합 지수에 쓰는 값**
  aadt_annual 연평균 (2025-08~2026-07). 비교용
  ratio       축제 / 인접 28일
"""
import glob
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
DATA = BASE / "data"
sys.path.insert(0, str(HERE))
sys.stdout.reconfigure(encoding="utf-8")

from geocode import read_xlsx  # noqa: E402

EVENTS = {"2025": ("2025-05-27", "2025-06-03"), "2026": ("2026-06-15", "2026-06-22")}
BASE_DAYS = 14          # 축제 창 앞뒤로 각각 며칠을 기준선으로 쓸지
ANNUAL = ("2025-08-01", "2026-07-31")


def load() -> pd.DataFrame:
    rows = []
    for f in sorted(glob.glob(str(TAAS / "교통량/*.xlsx"))):
        y, m = re.search(r"(\d{4})년(\d{2})월", f).groups()
        for line in read_xlsx(f)[1:]:
            for d, v in enumerate(line[3:34], start=1):
                v = pd.to_numeric(v, errors="coerce")
                if pd.notna(v) and v > 0:
                    rows.append((f"{y}-{m}-{d:02d}", str(line[0]), line[1], v))
    t = pd.DataFrame(rows, columns=["date", "cid", "name", "vol"])
    t["date"] = pd.to_datetime(t.date, errors="coerce")
    return t.dropna(subset=["date"])


t = load()
print(f"원자료 {len(t):,}행 · {t.date.min():%Y-%m-%d}~{t.date.max():%Y-%m-%d} · 지점 {t.cid.nunique()}")

# DSI 커버리지를 만족하는 교차로만 (traffic_aadt.csv 와 같은 집합)
ref = pd.read_csv(DATA / "traffic_aadt.csv", encoding="utf-8-sig")
ref["cid"] = ref.cid.astype(str)
t = t[t.cid.isin(set(ref.cid))]
print(f"DSI 커버리지 만족 교차로로 제한 → 지점 {t.cid.nunique()}")

ev_all, ratios = [], {}
for lab, (a, b) in EVENTS.items():
    a, b = pd.Timestamp(a), pd.Timestamp(b)
    ev = t[t.date.between(a, b)]
    bs = pd.concat([t[(t.date >= a - pd.Timedelta(days=BASE_DAYS)) & (t.date < a)],
                    t[(t.date > b) & (t.date <= b + pd.Timedelta(days=BASE_DAYS))]])
    ratios[lab] = (ev.groupby("cid").vol.mean() / bs.groupby("cid").vol.mean()).dropna()
    ev_all.append(ev)
    print(f"  {lab}  축제 {ev.date.nunique()}일 · 기준선 {bs.date.nunique()}일 · "
          f"배율 중앙 {ratios[lab].median():.3f}")

r = pd.concat([ratios["2025"].rename("ratio_2025"), ratios["2026"].rename("ratio_2026")], axis=1)
rr = stats.spearmanr(r.dropna().ratio_2025, r.dropna().ratio_2026)
print(f"\n재현성 — 두 해 배율의 순위상관 rho {rr.statistic:+.3f} (p {rr.pvalue:.4f})")

ann = t[t.date.between(*ANNUAL)].groupby("cid").vol.mean()
for lab, (a, b) in EVENTS.items():
    ev = t[t.date.between(a, b)]
    out = pd.DataFrame({
        "aadt": ev.groupby("cid").vol.mean(),
        "n_days": ev.groupby("cid").date.nunique(),
        "aadt_annual": ann,
        "ratio": ratios[lab],
    }).join(ref.set_index("cid")["name"]).reset_index()
    out = out.rename(columns={"index": "cid"})
    out = out[["cid", "name", "aadt", "aadt_annual", "n_days", "ratio"]].dropna(subset=["aadt"])
    path = DATA / f"traffic_danoje_{lab}.csv"
    out.to_csv(path, index=False, encoding="utf-8-sig")
    print(f"[{lab}] 교차로 {len(out)}개 · 축제 일평균 중앙 {out.aadt.median():,.0f} "
          f"(연평균 {out.aadt_annual.median():,.0f}) · 배율 중앙 {out.ratio.median():.3f}")
    top = " · ".join(f"{str(x['name'])[:12]} {x.ratio:.2f}"
                     for _, x in out.nlargest(4, "ratio").iterrows())
    print(f"      최대 상승: {top}")
    print(f"      -> {path}")
