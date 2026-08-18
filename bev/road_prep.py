"""도로망·도로면 전처리 (전체 1회 실행, 결과는 03에서 캐시로 읽는다)

03의 A_shadow 도메인은 "카메라에서 도로를 따라 R미터 이내"인 도로를 필요로 한다.
원본 도로구간(강릉시내.shp)은 T자 교차에서 옆길 끝점이 본선의 *중간*에 닿기 때문에
끝점끼리 잇는 방식으로는 망이 이어지지 않는다(±40m 확보 실패 54.1%). unary_union으로
교차점에서 노드화한 뒤 5m로 조밀화하면 휴리스틱 없이 1.0%까지 떨어진다.

입력
  GIS/노드링크/강릉시내.shp                        도로구간 LineString (EPSG:5179, cp949)
  GIS/실폭도로/TL_SPRD_RW_51_202608.shp            실폭도로 폴리곤 (강원도 전체, 124MB)
  GIS/historical_panoids_filtered.csv              카메라 위치 (검증용)

출력
  GIS/road_graph.npz          xy(N,2) EPSG:5179 / li,lj(M,) 링크 / lw(M,) 링크 길이(m)
  GIS/gangneung_roadsurface.gpkg   강릉 bbox로 자른 실폭도로 폴리곤 (원본은 GitHub 100MB 한도 초과)
"""
import math
import sys
import warnings
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree
from shapely.ops import unary_union

warnings.filterwarnings("ignore")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

EPSG = 5179                 # Korea 2000 / Unified CS, 미터 단위
STEP = 5.0                  # 그래프 조밀화 간격(m). 카메라 스냅 오차 ≈ STEP/2
PAD = 300.0                 # 폴리곤 클립 여유(m)

LINE_SHP = Path("GIS/노드링크/강릉시내.shp")
SURF_SHP = Path("GIS/실폭도로/TL_SPRD_RW_51_202608.shp")
CSV = Path("GIS/historical_panoids_filtered.csv")
GRAPH_OUT = Path("GIS/road_graph.npz")
SURF_OUT = Path("GIS/gangneung_roadsurface.gpkg")


def build_graph(lines):
    """도로구간 LineString -> (노드 좌표, 링크 인덱스, 링크 길이).

    unary_union이 모든 교차점에서 선을 쪼개므로(noding) T자 교차가 제대로 연결된다.
    각 조각을 STEP 간격으로 조밀화하되 끝점은 반드시 보존한다 -> 조각 사이는
    끝점 좌표가 정확히 일치해 근접 조인 없이 이어진다."""
    parts = unary_union(lines)
    parts = list(parts.geoms) if hasattr(parts, "geoms") else [parts]

    ids = {}
    li, lj, lw = [], [], []

    def nid(x, y):
        k = (round(x, 3), round(y, 3))      # mm 단위 반올림으로 끝점 일치를 흡수
        if k not in ids:
            ids[k] = len(ids)
        return ids[k]

    for g in parts:
        length = g.length
        ds = list(np.arange(0.0, length, STEP)) + [length]
        pts = [g.interpolate(d) for d in ds]
        idx = [nid(p.x, p.y) for p in pts]
        for (a, b), (pa, pb) in zip(zip(idx, idx[1:]), zip(pts, pts[1:])):
            w = pa.distance(pb)
            if w > 0:
                li.append(a); lj.append(b); lw.append(w)

    xy = np.zeros((len(ids), 2))
    for (x, y), i in ids.items():
        xy[i] = (x, y)
    return xy, np.array(li, np.int32), np.array(lj, np.int32), np.array(lw, np.float32), len(parts)


def main():
    print(f"[1/3] 도로구간 읽기: {LINE_SHP}")
    lines = gpd.read_file(LINE_SHP, encoding="cp949")
    assert lines.crs.to_epsg() == EPSG, f"예상 CRS {EPSG}, 실제 {lines.crs}"
    print(f"      선 {len(lines)}개, 총 {lines.geometry.length.sum() / 1000:.1f} km")

    xy, li, lj, lw, n_parts = build_graph(lines.geometry.values)
    print(f"      노드화 -> 조각 {n_parts}개 | 조밀화({STEP}m) -> 노드 {len(xy)}개, 링크 {len(li)}개")

    np.savez_compressed(GRAPH_OUT, xy=xy, li=li, lj=lj, lw=lw, epsg=np.int32(EPSG), step=np.float32(STEP))
    print(f"      저장: {GRAPH_OUT} ({GRAPH_OUT.stat().st_size / 1e6:.1f} MB)")

    print(f"\n[2/3] 실폭도로 클립: {SURF_SHP}")
    bbox = (xy[:, 0].min() - PAD, xy[:, 1].min() - PAD, xy[:, 0].max() + PAD, xy[:, 1].max() + PAD)
    surf = gpd.read_file(SURF_SHP, bbox=bbox, encoding="euc-kr")
    surf = surf.set_geometry(surf.geometry.make_valid())          # 원본에 winding order 오류가 있다
    surf.to_file(SURF_OUT, driver="GPKG", layer="roadsurface")
    print(f"      폴리곤 {len(surf)}개, 도로면 {surf.geometry.area.sum() / 1e6:.2f} km^2")
    print(f"      저장: {SURF_OUT} ({SURF_OUT.stat().st_size / 1e6:.1f} MB)")

    print("\n[3/3] 검증")
    df = pd.read_csv(CSV, encoding="utf-8-sig")
    tf = Transformer.from_crs(4326, EPSG, always_xy=True)
    cam = np.column_stack(tf.transform(df.pano_lon.values, df.pano_lat.values))

    tree = cKDTree(xy)
    snap, _ = tree.query(cam)
    print(f"      카메라->도로 스냅 거리: median {np.median(snap):.2f}m  p90 {np.percentile(snap, 90):.2f}m"
          f"  p99 {np.percentile(snap, 99):.1f}m")

    nodes = gpd.GeoDataFrame(geometry=gpd.points_from_xy(xy[:, 0], xy[:, 1]), crs=EPSG)
    j = gpd.sjoin(nodes, surf[["geometry"]], how="left", predicate="within")
    j = j[~j.index.duplicated(keep="first")]
    print(f"      도로 노드가 도로면 폴리곤 안: {100 * j.index_right.notna().mean():.2f}%")

    cov = coverage(xy, li, lj, lw, cam, tree)
    print(f"      +-40m 도로 확보: p10 {np.percentile(cov, 10):.0f}m  p50 {np.percentile(cov, 50):.0f}m"
          f"  |  40m 미만 {100 * (cov < 40).mean():.1f}%")
    print("\n완료. 03에서 GIS/road_graph.npz 와 GIS/gangneung_roadsurface.gpkg 를 읽는다.")


def coverage(xy, li, lj, lw, cam, tree, cap=40.0, n=2000, seed=0):
    """표본 카메라에서 도로를 따라 cap미터 이내에 있는 총 도로 길이."""
    import heapq
    adj = [[] for _ in range(len(xy))]
    for a, b, w in zip(li, lj, lw):
        adj[a].append((b, w)); adj[b].append((a, w))

    rng = np.random.default_rng(seed)
    sel = rng.choice(len(cam), min(n, len(cam)), replace=False)
    _, start = tree.query(cam[sel])

    out = np.empty(len(sel))
    for k, src in enumerate(start):
        dist = {int(src): 0.0}
        pq = [(0.0, int(src))]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, math.inf):
                continue
            for v, w in adj[u]:
                nd = d + w
                if nd <= cap and nd < dist.get(v, math.inf):
                    dist[v] = nd
                    heapq.heappush(pq, (nd, v))
        out[k] = sum(w for u in dist for v, w in adj[u] if v in dist and u < v)
    return out


if __name__ == "__main__":
    main()
