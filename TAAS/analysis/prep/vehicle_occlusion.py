# -*- coding: utf-8 -*-
"""
DSI 파이프라인 산출물에서 '차량이 만든 추가 차폐'를 뽑는다.

  road_occluded_frac      구조물만 반영한 도로 차폐율  (= 정적 DSI 의 근거)
  road_occluded_frac_veh  차량까지 포함한 도로 차폐율
  차이                     = 차량 점유로 생긴 추가 차폐

★ 이름 주의: 이것은 '불법주정차'가 아니다. 촬영 순간의 주차·정차·주행 차량이 모두 섞여 있고
  네이버 촬영 1회의 스냅샷이라 분포가 아닌 단일 관측이다. 실제 불법주정차 자료가 확보되면
  같은 자리에 갈아끼울 수 있도록 별도 컬럼으로 둔다.
"""
import glob
import json
import re
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
DATA = BASE / "data"
sys.stdout.reconfigure(encoding="utf-8")
VERSION = "260820"

FIELDS = ["dsi_refined", "dsi_veh", "road_occluded_frac", "road_occluded_frac_veh",
          "veh_blocked_fwd", "veh_blocked_bwd", "road_domain_m2", "valid",
          "sight_flag", "sight_flag_veh", "confidence"]

files = sorted(glob.glob(str(ROOT / f"output/{VERSION}/*_dsi.json")))
print(f"파일 {len(files):,}개 읽는 중...", flush=True)
rows, bad = [], 0
for k, f in enumerate(files):
    m = re.search(r"point_(\d+)_pano_", f)
    if not m:
        bad += 1; continue
    try:
        d = json.load(open(f, encoding="utf-8"))
    except Exception:
        bad += 1; continue
    r = {"point_id": int(m.group(1))}
    for c in FIELDS:
        r[c] = d.get(c)
    rows.append(r)
    if (k + 1) % 8000 == 0:
        print(f"  {k+1:,}/{len(files):,}", flush=True)

df = pd.DataFrame(rows)
print(f"읽음 {len(df):,}개 (실패 {bad})")

df["veh_extra_occ"] = df.road_occluded_frac_veh - df.road_occluded_frac
df["dsi_veh_delta"] = df.dsi_veh - df.dsi_refined

out = DATA / f"vehicle_occlusion_{VERSION}.csv"
df.to_csv(out, index=False, encoding="utf-8-sig")

ok = df[df.valid == True]
print(f"\nvalid {len(ok):,}개")
for c in ["road_occluded_frac", "road_occluded_frac_veh", "veh_extra_occ",
          "dsi_refined", "dsi_veh", "dsi_veh_delta", "veh_blocked_fwd", "veh_blocked_bwd"]:
    s = pd.to_numeric(ok[c], errors="coerce").dropna()
    print(f"  {c:<24} 중앙 {s.median():7.4f}  평균 {s.mean():7.4f}  "
          f"p90 {s.quantile(.9):7.4f}  max {s.max():7.4f}")
print(f"\n차량 차폐가 0인 지점: {(pd.to_numeric(ok.veh_extra_occ, errors='coerce') <= 0).sum():,} "
      f"({(pd.to_numeric(ok.veh_extra_occ, errors='coerce') <= 0).mean()*100:.0f}%)")
print(f"-> {out}")
