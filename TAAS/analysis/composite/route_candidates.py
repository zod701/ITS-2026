# -*- coding: utf-8 -*-
"""
셔틀 노선 후보 Top 3 — 강릉단오제전수교육관 ↔ 강릉역, 위험도 최소 경로

readme 7 단계(안전성·수요 결합 노선 최적화)의 **안전성 축만** 구현한 것이다. 수요는
아직 결합하지 않으므로 "위험도가 가장 낮은 경로"이지 "최적 노선"이 아니다.

**망**: GIS/road_graph.npz (실폭도로에서 뽑은 5m 간격 격자망, EPSG:5179, 98,486 노드).
web/public/data/roads.geojson 은 렌더링용이라 엣지끼리 정점을 공유하지 않는다 — 정점을
1m 격자로 붙여도 최대 연결요소가 전체의 0.5% 라 경로 탐색에 쓸 수 없다.

**엣지 비용**: 엣지 중점에서 MATCH_M 안에 있는 roads.geojson 엣지의 DSI 를 가져와

    cost(e) = DSI_a(e) x len(e)          DSI_a = a*s + (1-a)*d   (versions.ts combineAlpha)

즉 **누적 위험 노출**(DSI·m)로 탐색한다. 최단경로 문제가 성립하려면 비용이 길이에
비례해야 하므로 탐색은 이 값으로 한다.

**순위는 길이가중 평균 DSI 로 매긴다.** 웹이 기존 노선 A/B/C 의 위험도를 '평균 DSI' 로
표시하므로(BusRouteButton), 같은 잣대라야 후보를 기존 노선과 나란히 놓고 읽을 수 있다.
다만 평균만 보면 한없이 돌아가는 경로가 이기므로 **최단거리의 DETOUR_MAX 배** 안으로
길이를 제한한다. 기준 길이는 DSI 를 무시한 순수 최단경로로 따로 구한다.
두 잣대(평균 DSI · 누적 노출)의 순위가 갈리면 실행 로그에 함께 찍는다.

DSI 가 없는 엣지(8.8%)는 **아예 지운다**. 미계측 도로를 지나면 "위험도가 가장 낮다"는
말 자체가 성립하지 않는다. 남은 부분망의 최대 연결요소는 83,375 노드이고 두 거점이 모두
여기 붙는다.

**대안 3 개**: 최단경로를 찾을 때마다 그 경로의 엣지 비용에 PENALTY 를 곱하고 다시 푼다
(plateau/penalty 방식). Yen 의 k-최단경로는 한 블록만 다른 경로를 내놓아 '대안'이 되지
않는다. 후보를 넉넉히 뽑은 뒤 겹침이 심한 것을 걸러내고, **원래 비용**으로 다시 재어
상위 3 개를 고른다.

정류장은 목적함수에 넣지 않았다 — 넣으면 "위험도 순위"가 아니게 된다. 대신 경로마다
STOP_M 안의 정류장 수를 세어 동점 판정과 참고 지표로만 쓴다.

사용:
  python route_candidates.py [버전id] [알파]
    기본값 danoje_2026 / 0.35   (웹 지도 기본 판·기본 알파)
"""
import json
import sys
from collections import defaultdict
from heapq import heappop, heappush
from pathlib import Path

import numpy as np
from pyproj import Transformer
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent      # analysis/<그룹>
BASE = HERE.parent                          # analysis
TAAS = BASE.parent                          # TAAS
ROOT = TAAS.parent                          # 저장소 루트
WEB = ROOT / "web" / "public" / "data"
sys.stdout.reconfigure(encoding="utf-8")

VERSION = sys.argv[1] if len(sys.argv) > 1 else "danoje_2026"
ALPHA = float(sys.argv[2]) if len(sys.argv) > 2 else 0.35

MATCH_M = 10.0        # 그래프 엣지에 DSI 를 붙일 최대 거리
STOP_M = 30.0         # 경로가 '지난다'고 볼 정류장까지의 거리
PENALTY = 4.0         # 이미 쓴 엣지에 매길 배수. 클수록 대안이 멀리 떨어진다
N_DRAW = 14           # 뽑아 볼 후보 수 (여기서 상위 3 개를 고른다)
MAX_OVERLAP = 0.55    # 앞선 후보와 이만큼 넘게 겹치면 같은 노선으로 본다 (길이 기준)
DETOUR_MAX = 1.8      # 순수 최단거리 대비 허용 우회 배수. 이보다 길면 후보에서 뺀다

TO_5179 = Transformer.from_crs(4326, 5179, always_xy=True)
TO_4326 = Transformer.from_crs(5179, 4326, always_xy=True)


def combine_alpha(s, d, alpha):
    """versions.ts 의 combineAlpha 와 같은 식."""
    return alpha * s + (1 - alpha) * d


def build_graph():
    """5m 격자망에 DSI 를 붙이고, DSI 가 없는 엣지를 지운 부분망을 돌려준다."""
    z = np.load(ROOT / "GIS/road_graph.npz")
    xy, li, lj, lw = z["xy"], z["li"], z["lj"], z["lw"]

    roads = json.loads((WEB / "roads.geojson").read_text(encoding="utf-8"))
    dsi = json.loads((WEB / f"road_dsi_map_{VERSION}.json").read_text(encoding="utf-8"))

    # roads.geojson 을 5m 로 조밀화해 KD-tree 를 만든다. 선분 최근접이 아니라 점 최근접
    # 이지만, 조밀 간격이 격자 간격과 같아 오차가 매칭 임계보다 훨씬 작다.
    pts, lab = [], []
    for f in roads["features"]:
        eid = f["properties"]["edge_id"]
        if eid not in dsi:
            continue
        cs = np.asarray(f["geometry"]["coordinates"])
        P = np.column_stack(TO_5179.transform(cs[:, 0], cs[:, 1]))
        for a, b in zip(P[:-1], P[1:]):
            n = max(1, int(np.hypot(*(b - a)) // 5))
            for t in np.linspace(0, 1, n + 1):
                pts.append(a + t * (b - a))
                lab.append(eid)
    tree = cKDTree(np.asarray(pts))
    lab = np.asarray(lab)

    d, i = tree.query((xy[li] + xy[lj]) / 2)
    keep = d <= MATCH_M
    eids = lab[i]

    value = {k: combine_alpha(v["s"], v["d"], ALPHA) if "s" in v else v["dsi"]
             for k, v in dsi.items()}
    edge_dsi = np.array([value[e] for e in eids])

    print(f"[망] 노드 {len(xy):,} 엣지 {len(li):,} "
          f"-> DSI {MATCH_M:.0f}m 매칭 {keep.sum():,} ({keep.mean()*100:.1f}%)")
    return xy, li[keep], lj[keep], lw[keep], edge_dsi[keep], eids[keep]


def dijkstra(n, adj, src, dst, mult):
    """mult[엣지번호] 배수를 곱한 비용으로 최단경로. (경로 노드열, 엣지열) 반환."""
    INF = float("inf")
    dist = [INF] * n
    prev = [(-1, -1)] * n
    dist[src] = 0.0
    pq = [(0.0, src)]
    while pq:
        dcur, u = heappop(pq)
        if dcur > dist[u] + 1e-12:
            continue
        if u == dst:
            break
        for v, ei, w in adj[u]:
            nd = dcur + w * mult[ei]
            if nd < dist[v] - 1e-12:
                dist[v] = nd
                prev[v] = (u, ei)
                heappush(pq, (nd, v))
    if dist[dst] == INF:
        return None, None
    nodes, edges, cur = [dst], [], dst
    while cur != src:
        u, ei = prev[cur]
        edges.append(ei)
        nodes.append(u)
        cur = u
    return nodes[::-1], edges[::-1]


def main():
    xy, li, lj, lw, edsi, eids = build_graph()
    m = len(li)
    adj = defaultdict(list)
    for k in range(m):
        a, b, w = int(li[k]), int(lj[k]), float(lw[k]) * float(edsi[k])
        adj[a].append((b, k, w))
        adj[b].append((a, k, w))

    # 남은 부분망의 최대 연결요소에만 붙인다.
    p = list(range(len(xy)))

    def find(x):
        while p[x] != x:
            p[x] = p[p[x]]
            x = p[x]
        return x

    for a, b in zip(li, lj):
        ra, rb = find(int(a)), find(int(b))
        if ra != rb:
            p[ra] = rb
    comp = defaultdict(list)
    for n_ in set(li.tolist()) | set(lj.tolist()):
        comp[find(int(n_))].append(int(n_))
    giant = np.array(sorted(max(comp.values(), key=len)))
    gtree = cKDTree(xy[giant])

    lms = json.loads((WEB / "landmarks.geojson").read_text(encoding="utf-8"))
    ends = {}
    for ft in lms["features"]:
        lon, lat = ft["geometry"]["coordinates"]
        X, Y = TO_5179.transform(lon, lat)
        dd, ii = gtree.query([X, Y])
        ends[ft["properties"]["name"]] = (int(giant[ii]), float(dd))
        print(f"[거점] {ft['properties']['name']:<12} 최근접 노드 #{giant[ii]} (접근 {dd:.0f}m)")

    (src, dsrc), (dst, ddst) = ends["강릉단오제전수교육관"], ends["강릉역"]

    stops = json.loads((WEB / "bus_stops.geojson").read_text(encoding="utf-8"))
    sxy = np.array([TO_5179.transform(*f["geometry"]["coordinates"])
                    for f in stops["features"]])
    sname = [f["properties"]["name"] for f in stops["features"]]
    stree = cKDTree(sxy)

    terciles = json.loads((WEB / "terciles_grid.json").read_text(encoding="utf-8"))
    t1, t2 = terciles["road"][f"{round(ALPHA/0.05)*0.05:.2f}"]

    def measure(nodes, edges):
        length = float(sum(lw[e] for e in edges))
        exposure = float(sum(lw[e] * edsi[e] for e in edges))
        share = {"Safe": 0.0, "Caution": 0.0, "High-risk": 0.0}
        for e in edges:
            g = "Safe" if edsi[e] < t1 else ("Caution" if edsi[e] < t2 else "High-risk")
            share[g] += float(lw[e])
        near = stree.query_ball_point(xy[nodes], STOP_M)
        idx = sorted({j for lst in near for j in lst})
        return {"length_m": length, "exposure": exposure,
                "mean_dsi": exposure / length,
                "share": {k: v / length for k, v in share.items()},
                "stop_idx": idx,
                "stops": sorted({sname[j] for j in idx})}

    # 우회 상한의 기준이 되는 순수 최단거리. 비용을 길이로만 둔 별도 인접표로 푼다.
    dist_adj = defaultdict(list)
    for k in range(m):
        a, b, w = int(li[k]), int(lj[k]), float(lw[k])
        dist_adj[a].append((b, k, w))
        dist_adj[b].append((a, k, w))
    _, sp_edges = dijkstra(len(xy), dist_adj, src, dst, np.ones(m))
    l_min = float(sum(lw[e] for e in sp_edges))
    cap = DETOUR_MAX * l_min
    print(f"[기준] 순수 최단거리 {l_min/1000:.2f}km -> 허용 길이 {cap/1000:.2f}km "
          f"({DETOUR_MAX} 배)")

    # 후보 뽑기 — 쓴 엣지에 PENALTY 를 곱해 가며 반복한다.
    mult = np.ones(m)
    cands = []
    for it in range(N_DRAW):
        nodes, edges = dijkstra(len(xy), adj, src, dst, mult)
        if nodes is None:
            break
        eset = set(edges)
        rec = measure(nodes, edges)
        dup = False
        for c in cands:
            inter = sum(lw[e] for e in eset & c["eset"])
            if inter / min(c["length_m"], rec["length_m"]) > MAX_OVERLAP:
                dup = True
                break
        rec.update(nodes=nodes, edges=edges, eset=eset)
        if not dup:
            cands.append(rec)
        print(f"  후보 {it+1}: {rec['length_m']/1000:5.2f}km  평균DSI {rec['mean_dsi']:.4f}  "
              f"노출 {rec['exposure']:8.0f}  정류장 {len(rec['stops']):3d}"
              + ("   [겹침 - 버림]" if dup else ""))
        for e in edges:
            mult[e] *= PENALTY

    # 우회 상한을 넘는 후보는 뺀다 — 평균만 낮추려 한없이 도는 경로를 막는다.
    for c in cands:
        if c["length_m"] > cap:
            print(f"  [상한 초과] {c['length_m']/1000:.2f}km > {cap/1000:.2f}km "
                  f"(평균DSI {c['mean_dsi']:.4f}) — 제외")
    cands = [c for c in cands if c["length_m"] <= cap]

    # 평균 DSI 오름차순 Top 3. 동점이면 정류장이 많은 쪽.
    cands.sort(key=lambda c: (round(c["mean_dsi"], 4), -len(c["stops"])))
    top = cands[:3]

    # 누적 노출로 매기면 순위가 달라지는지 확인해 함께 남긴다.
    by_exp = sorted(cands, key=lambda c: c["exposure"])[:3]
    if [id(c) for c in by_exp] != [id(c) for c in top]:
        print("\n[주의] 두 잣대의 순위가 다르다 — 누적 노출 기준 Top 3 은")
        for r, c in enumerate(by_exp, 1):
            print(f"    {r}위 {c['length_m']/1000:.2f}km 평균DSI {c['mean_dsi']:.4f} "
                  f"노출 {c['exposure']:.0f}")

    print(f"\n=== Top 3 (판 {VERSION} · alpha={ALPHA} · 평균 DSI 기준) ===")
    feats = []
    for rank, c in enumerate(top, 1):
        sh = c["share"]
        print(f"  {rank}위  {c['length_m']/1000:.2f}km  평균DSI {c['mean_dsi']:.4f}  "
              f"노출 {c['exposure']:.0f}  정류장 {len(c['stop_idx'])}개소  "
              f"Safe {sh['Safe']*100:.0f}% / Caution {sh['Caution']*100:.0f}% / "
              f"High-risk {sh['High-risk']*100:.0f}%")
        lon, lat = TO_4326.transform(xy[c["nodes"], 0], xy[c["nodes"], 1])
        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString",
                         "coordinates": [[round(a, 7), round(b, 7)] for a, b in zip(lon, lat)]},
            "properties": {
                "rank": rank,
                "length_km": round(c["length_m"] / 1000, 2),
                "mean_dsi": round(c["mean_dsi"], 4),
                "exposure": round(c["exposure"], 1),
                # 지도에 찍히는 점 개수와 같아야 하므로 **위치** 기준으로 센다.
                # 도로 양쪽의 상·하행 승강장은 이름이 같아도 서로 다른 자리라 따로 센다
                # (bus_stops.py 가 그 둘을 병합하지 않는 것과 같은 이유).
                "n_stops": len(c["stop_idx"]),
                "stops": c["stops"],
                "share_safe": round(sh["Safe"], 3),
                "share_caution": round(sh["Caution"], 3),
                "share_highrisk": round(sh["High-risk"], 3),
            },
        })

    out = {"type": "FeatureCollection",
           "features": feats,
           "meta": {"version": VERSION, "alpha": ALPHA,
                    "from": "강릉단오제전수교육관", "to": "강릉역",
                    "access_m": {"강릉단오제전수교육관": round(dsrc), "강릉역": round(ddst)},
                    "objective": f"최단거리의 {DETOUR_MAX} 배 이내에서 길이가중 평균 DSI 최소",
                    "shortest_km": round(l_min / 1000, 2),
                    "detour_max": DETOUR_MAX,
                    "match_m": MATCH_M, "stop_m": STOP_M}}
    path = WEB / "route_candidates.geojson"
    path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"\n-> {path}")

    # 경유 정류장을 따로 낸다. 한 정류장이 여러 후보에 걸리므로(강릉역·KTX역승강장은 셋 다)
    # 후보별로 점을 복제하지 않고 ranks 배열에 어느 후보가 지나는지를 적는다 — 지도는
    # 켜져 있는 후보가 ranks 에 하나라도 있으면 그 점을 그린다.
    ranks_of = defaultdict(list)
    for rank, c in enumerate(top, 1):
        for j in c["stop_idx"]:
            ranks_of[j].append(rank)
    stop_feats = []
    for j in sorted(ranks_of, key=lambda k: sname[k]):
        src_ft = stops["features"][j]
        stop_feats.append({
            "type": "Feature",
            "geometry": src_ft["geometry"],
            "properties": {"name": sname[j],
                           "addr": src_ft["properties"].get("addr", ""),
                           "ranks": ranks_of[j]},
        })
    spath = WEB / "route_candidate_stops.geojson"
    spath.write_text(json.dumps({"type": "FeatureCollection", "features": stop_feats},
                                ensure_ascii=False), encoding="utf-8")
    shared = sum(1 for v in ranks_of.values() if len(v) > 1)
    print(f"-> {spath}  (고유 {len(stop_feats)}개소, 둘 이상 공유 {shared}개소)")

    # 노선은 한 판(SELECT)에서 뽑았지만, 웹은 어느 판으로도 볼 수 있어야 한다. 같은 경로를
    # 판마다 다시 재어 bus_route_dsi_<판>.json 과 같은 꼴로 낸다 - 웹이 A/B/C 를 다루는
    # 방식(성분 s·d 를 받아 α 로 합성)을 그대로 쓰면 슬라이더가 실시간으로 먹는다.
    # 성분이 없는 옛 판은 s = d = dsi 로 둔다. 그러면 α 와 무관하게 그 판의 값이 나온다.
    print()
    for path_v in sorted((WEB).glob("road_dsi_map_*.json")):
        v = path_v.name[len("road_dsi_map_"):-len(".json")]
        table = json.loads(path_v.read_text(encoding="utf-8"))
        out_v = {}
        for rank, c in enumerate(top, 1):
            ns = nd = den = 0.0
            for e in c["edges"]:
                rec = table.get(eids[e])
                if rec is None:
                    continue                      # 이 판에는 그 도로의 값이 없다
                L = float(lw[e])
                ns += float(rec.get("s", rec["dsi"])) * L
                nd += float(rec.get("d", rec["dsi"])) * L
                den += L
            if den == 0:
                continue
            out_v[str(rank)] = {
                "s": round(ns / den, 4),
                "d": round(nd / den, 4),
                "dsi": round(combine_alpha(ns / den, nd / den, ALPHA), 4),
                # 이 판이 값을 가진 구간의 길이 비율. 낮으면 평균이 노선 일부만 대표한다.
                "coverage": round(den / c["length_m"], 3),
            }
        vpath = WEB / f"route_candidate_dsi_{v}.json"
        vpath.write_text(json.dumps(out_v, ensure_ascii=False), encoding="utf-8")
        cov = min((r["coverage"] for r in out_v.values()), default=0)
        print(f"-> {vpath.name}  " +
              " / ".join(f"{k}위 {r['dsi']:.4f}" for k, r in out_v.items()) +
              f"   (최소 커버리지 {cov*100:.0f}%)")


if __name__ == "__main__":
    main()
