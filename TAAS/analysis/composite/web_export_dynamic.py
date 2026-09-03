# -*- coding: utf-8 -*-
"""
웹 버전 산출 — 동적 지수를 결합한 DSI (26.08.20. 2차)

D-17 의 4단계를 **지점 단위**로 적용해 `dsi_map_<VERSION>.json` 을 만든다. 웹의 버전 체계가
이 파일을 출발점으로 삼으므로(도로·노선 집계는 여기서 파생), 지점 단위로 내면 기존 집계
스크립트 두 개를 그대로 재사용할 수 있다.

    web/scripts/build_road_dsi_map.py <v>   -> road_dsi_map_<v>.json
    web/scripts/build_bus_route_dsi.py <v>  -> bus_route_dsi_<v>.json

링크 단위(`link_dynamic_index.csv`)와 방법은 같고 대상만 다르다. 웹은 roads.geojson 을
그리는데 그 엣지는 지점에서 집계되므로, 지점에서 시작하는 편이 기하 불일치가 없다.

    DSI_t = α·DSI_static + (1-α)·(β·V_norm + (1-β)·P_resid)
      β = 0.398   원시 사고지점 자료로 유도 (D-20 · X-25)
      α = 0.35    설계 시나리오 0.20/0.35/0.50 의 대표값 (D-21). 자료로 유도되지 않는다
      V_norm  계측 교차로 진입량/차수를 IDW(k=5,p=1) 로 보간한 근사   ★ 예측 아님 (D-17)
      P_resid 차량 차폐에서 통행량 성분을 뺀 잔차                     (D-13 · A-08)

**기존 버전 파일은 건드리지 않는다.** 새 id 로만 쓴다.

사용:
  python web_export_dynamic.py [버전id] [통행량csv]
    기본값 260820_2 / traffic_aadt.csv   (평시 연평균)
    이벤트판 danoje / traffic_danoje.csv (강릉단오제 기간, D-24)
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy import stats
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
DATA = BASE / "data"
WEB = ROOT / "web" / "public" / "data"
sys.stdout.reconfigure(encoding="utf-8")

SRC_VERSION = "260820"       # 정적 DSI 를 가져오는 파이프라인 판
VERSION = sys.argv[1] if len(sys.argv) > 1 else "260820_2"
TRAFFIC = sys.argv[2] if len(sys.argv) > 2 else "traffic_aadt.csv"
BASELINE = "260820_2"        # 정규화 기준점을 만드는 판 (평시)
ANCHORS = DATA / "norm_anchors.json"
K, P = 5, 1.0
CLIP = (0.01, 0.99)
BETA = 0.398                      # 원시 사고자료 재유도 (D-20)
ALPHA = 0.35                      # 설계 시나리오 0.20/0.35/0.50 의 대표값 (D-21)
SNAP_M, FAR_M = 60.0, 1000.0


def ends(g):
    g = g.geoms[0] if g.geom_type.startswith("Multi") else g
    cs = list(g.coords)
    return cs[0], cs[-1]


# 판마다 따로 정규화하면 판 간 비교가 성립하지 않는다 — 축제로 통행량 수준이 올라가도
# 각자 0~1 로 다시 펴지면서 상승분이 상쇄된다. 그래서 **기준판(평시)의 기준점을 고정해
# 모든 판이 같은 척도를 쓴다** (D-24). 이벤트판의 v_norm 은 1 을 넘을 수 있고, 그것이
# "평시 최대보다 통행량이 많다"를 뜻한다.
_anchors = {} if VERSION == BASELINE else json.loads(ANCHORS.read_text(encoding="utf-8"))


def norm(s, key):
    if VERSION == BASELINE:
        lo, hi = s.quantile(CLIP)
        c = s.clip(lo, hi)
        a = {"lo": float(lo), "hi": float(hi), "min": float(c.min()), "max": float(c.max())}
        _anchors[key] = a
        return (c - a["min"]) / (a["max"] - a["min"])
    # 다른 판에는 **선형 변환만** 적용하고 클리핑은 하지 않는다. 기준판의 상한으로 자르면
    # 축제의 초과분이 그대로 잘려 나가 애초에 하려던 비교가 무의미해진다.
    a = _anchors[key]
    return (s - a["min"]) / (a["max"] - a["min"])


# ---------- 1단계: 계측점 단위 보정 (진입량 / 차수) ----------
ln = gpd.read_file(ROOT / "GIS/NODE_LINK_GANGNEUNG.gpkg", layer="moct_link_").to_crs(5179)
deg, pos = {}, {}
for _, r in ln.iterrows():
    a, b = ends(r.geometry)
    pos.setdefault(r.F_NODE, a); pos.setdefault(r.T_NODE, b)
    deg[r.F_NODE] = deg.get(r.F_NODE, 0) + 1
    deg[r.T_NODE] = deg.get(r.T_NODE, 0) + 1
nodes = list(pos)
NPOS = np.array([pos[n] for n in nodes])

tv = pd.read_csv(DATA / TRAFFIC, encoding="utf-8-sig")[["cid", "aadt"]]
print(f"버전 {VERSION} · 통행량 {TRAFFIC}")
geo = pd.read_csv(DATA / "traffic_points_vworld.csv", encoding="utf-8-sig").dropna(subset=["lon"])
geo["cid"] = geo.cid.astype(str); tv["cid"] = tv.cid.astype(str)
tp = geo.merge(tv, on="cid")
tpg = gpd.GeoDataFrame(tp, geometry=gpd.points_from_xy(tp.lon, tp.lat), crs=4326).to_crs(5179)
TP = np.array([[g.x, g.y] for g in tpg.geometry])
d_sn, i_sn = cKDTree(NPOS).query(TP)
dg = np.array([deg[nodes[i]] for i in i_sn], float)
dg[d_sn > SNAP_M] = np.nan
dg = np.where(np.isnan(dg), np.nanmedian(dg), dg)
v_adj = tp.aadt.to_numpy() / dg
print(f"계측점 {len(tp)}개 · 진입량 중앙 {np.median(tp.aadt):,.0f} → 링크 몫 {np.median(v_adj):,.0f}")

# ---------- 지점 자료 ----------
veh = pd.read_csv(DATA / f"vehicle_occlusion_{SRC_VERSION}.csv", encoding="utf-8-sig")
veh = veh[veh.valid == True]
pt = gpd.read_file(ROOT / "GIS/gangneung_point.gpkg")[["point_id", "geometry"]].to_crs(5179)
d = pt.merge(veh[["point_id", "dsi_refined", "veh_extra_occ"]], on="point_id", how="inner")
PX = np.array([[g.x, g.y] for g in d.geometry])
print(f"지점 {len(d):,}개 (정적 DSI = {SRC_VERSION} 판의 dsi_refined)")

# ---------- 2·3단계: 지점 위치에서 IDW + 정규화 ----------
dist, idx = cKDTree(TP).query(PX, k=K)
w = 1.0 / np.maximum(dist, 1.0) ** P
d["v_pt"] = (w * v_adj[idx]).sum(1) / w.sum(1)
d["d_near"] = dist[:, 0]
# 동적 항 신뢰도 (D-25) — 정적 confidence 와 성격이 다르다. 저쪽은 BEV 계측 품질이고
# 이쪽은 **보간 근거의 질**이다. 두 축을 본다.
#   d_near  근거가 얼마나 가까운가
#   disp    참조한 k개 계측값이 서로 얼마나 어긋나는가 (최대/최소 배율)
# disp 를 함께 보는 이유: 교통량은 공간적으로 매끄럽지 않아(X-17) 가깝다고 비슷하지 않다.
# 계측점이 붙어 있어도 서로 3배씩 차이 나면 그 사이를 보간한 값은 믿을 게 못 된다.
ref = v_adj[idx]
d["disp"] = ref.max(1) / np.maximum(ref.min(1), 1.0)
d["v_norm"] = norm(d.v_pt, "v")
d["dsi_static_n"] = norm(d.dsi_refined, "dsi")
d["p_norm"] = norm(d.veh_extra_occ, "p")
if VERSION == BASELINE:
    ANCHORS.write_text(json.dumps(_anchors, indent=2), encoding="utf-8")
    print(f"정규화 기준점 저장 -> {ANCHORS}")
else:
    print(f"정규화 기준점 로드 (기준판 {BASELINE}) — v_norm 범위 "
          f"{d.v_norm.min():.3f}~{d.v_norm.max():.3f}")

# ---------- 통행량 성분 제거 (D-13 · A-08) ----------
pr = lambda a: stats.rankdata(a) / len(a)
rv, rp = pr(d.v_norm), pr(d.p_norm)
d["p_resid"] = pr(rp - np.polyval(np.polyfit(rv, rp, 1), rv))
print(f"주정차대리 ~ 보간통행량  원지표 rho {stats.spearmanr(d.p_norm, d.v_norm).statistic:+.3f}"
      f"  →  잔차 rho {stats.spearmanr(d.p_resid, d.v_norm).statistic:+.3f}")

# ---------- 4단계: 결합 ----------
d["dsi_dynamic"] = BETA * d.v_norm + (1 - BETA) * d.p_resid
d["dsi_t"] = ALPHA * d.dsi_static_n + (1 - ALPHA) * d.dsi_dynamic
far = d.d_near > FAR_M
d.loc[far, "dsi_t"] = d.loc[far, "dsi_static_n"]          # 동적 항을 신뢰하지 않는다
d["dyn_conf"] = np.where(far, 0,
                         np.where((d.d_near <= 300) & (d.disp <= 2.5), 2, 1))
print("동적 신뢰도  " + " · ".join(
    f"{k} {int((d.dyn_conf == k).sum()):,} ({(d.dyn_conf == k).mean():.1%})" for k in (2, 1, 0)))
print(f"계측점 {FAR_M:.0f}m 초과라 정적값만 쓴 지점 {int(far.sum()):,} ({far.mean():.1%})")

t1, t2 = d.dsi_t.quantile([1 / 3, 2 / 3])
grade = lambda v: "Safe" if v < t1 else ("Caution" if v < t2 else "High-risk")
print(f"\ndsi_t  min {d.dsi_t.min():.4f}  중앙 {d.dsi_t.median():.4f}  max {d.dsi_t.max():.4f}")
print(f"pointTerciles: [{t1:.4f}, {t2:.4f}]")

# ---------- dsi_map_<VERSION>.json ----------
# α 를 웹에서 조절할 수 있도록 **정적·동적 성분을 함께 싣는다** (D-23).
#   dsi = α·s + (1-α)·d  를 브라우저가 다시 계산하고 임계도 그때 다시 뽑는다.
#   dsi/grade 는 기본 α 로 미리 채워 두어, 성분을 모르는 소비자도 그대로 쓸 수 있다.
# 정적전용 지점(계측점 FAR_M 초과)은 d 를 s 와 같게 둬서 α 와 무관하게 정적값이 나온다.
d["s"] = d.dsi_static_n
d["d_dyn"] = np.where(far, d.dsi_static_n, d.dsi_dynamic)

src = json.loads((WEB / f"dsi_map_{SRC_VERSION}.json").read_text(encoding="utf-8"))
key_of = {int(k.split("_")[0]): k for k in src}
out, miss = {}, 0
for pid, val, sv, dv, dcv in zip(d.point_id, d.dsi_t, d.s, d.d_dyn, d.dyn_conf):
    k = key_of.get(int(pid))
    if k is None:
        miss += 1
        continue
    out[k] = {"dsi": round(float(val), 4), "grade": grade(val),
              "s": round(float(sv), 4), "d": round(float(dv), 4), "dc": int(dcv)}
path = WEB / f"dsi_map_{VERSION}.json"
path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"\n키 매칭 {len(out):,}/{len(d):,} (누락 {miss})")
print(f"-> {path}")

# 도로·노선 집계는 web/scripts 의 공용 스크립트를 재사용한다. 성분별 집계를 얻기 위해
# s / d 를 각각 dsi 로 담은 임시 지점맵을 만들어 같은 스크립트에 태운다 — 집계 규칙
# (특히 노선 버퍼)을 복제하지 않기 위해서다. build_alpha_parts.py 가 이어서 처리한다.
for tag, col in (("s", "s"), ("d", "d_dyn")):
    tmp = {key_of[int(pid)]: {"dsi": round(float(v), 4), "grade": "Caution"}
           for pid, v in zip(d.point_id, d[col]) if int(pid) in key_of}
    tp_path = WEB / f"dsi_map_{VERSION}{tag}.json"
    tp_path.write_text(json.dumps(tmp, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {tp_path}  (임시 — build_alpha_parts.py 가 병합 후 삭제)")

print(f"\n다음: python web/scripts/build_alpha_parts.py {VERSION}")

d[["point_id", "dsi_refined", "dsi_static_n", "v_pt", "v_norm", "veh_extra_occ",
   "p_norm", "p_resid", "dsi_dynamic", "dsi_t", "d_near", "disp", "dyn_conf"]].to_csv(
    DATA / f"point_dynamic_{VERSION}.csv", index=False, encoding="utf-8-sig")
print(f"-> {DATA / f'point_dynamic_{VERSION}.csv'} (진단용)")
