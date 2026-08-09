"""03_bev_shadow_gpu.ipynb 전용: BEV 탑뷰 시각화(fig 렌더링+저장)를 별도 프로세스에서 처리하기
위한 워커 모듈. Windows의 ProcessPoolExecutor(spawn)는 자식 프로세스가 import 가능한
top-level 함수만 피클링할 수 있어 노트북 셀 안에 직접 정의할 수 없다(모듈 파일로 분리 필수).
GPU 계산(raycast/IPM)은 여기 없다 — CUDA 컨텍스트는 자식 프로세스와 공유되지 않고,
렌더링 자체도 CPU(matplotlib) 작업이라 GPU가 필요 없다.
"""
import math
import warnings

import numpy as np


def render_and_save(args):
    """args: dict(bev, shadow_occ, shadow_veh, ray_hits_occ, ray_hits_veh, center, grid_res,
    include_vehicles, n_arrows, out_path, suptitle, title_occupancy, title_occ, title_veh,
    legend_colors=[(rgb01_tuple, label), ...]).
    반환: out_path (완료 확인용)."""
    warnings.filterwarnings("ignore")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.patches as mpatches
    import matplotlib.pyplot as plt
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_agg import FigureCanvasAgg

    bev = args["bev"]
    shadow_occ = args["shadow_occ"]
    shadow_veh = args["shadow_veh"]
    ray_hits_occ = args["ray_hits_occ"]
    ray_hits_veh = args["ray_hits_veh"]
    center = args["center"]
    grid_res = args["grid_res"]
    include_vehicles = args["include_vehicles"]
    n_arrows = args["n_arrows"]
    out_path = args["out_path"]

    legend_handles = [mpatches.Patch(color=c, label=l) for c, l in args["legend_colors"]]
    legend_handles.append(plt.Line2D([0], [0], marker="^", color="blue", markersize=8,
                                      linestyle="None", label="Vehicle (origin)"))

    def render_shadow(ax, bev_arr, shadow_grid, ray_hits, title, origin):
        srgb = bev_arr.copy(); srgb[shadow_grid] = [255, 200, 0]
        ax.imshow(srgb, origin="upper")
        stepn = max(1, len(ray_hits) // n_arrows)
        for ang, hd in ray_hits[::stepn]:
            a = math.radians(ang)
            ax.annotate("", xy=(origin[0] + math.sin(a) * hd / grid_res,
                                origin[1] - math.cos(a) * hd / grid_res),
                        xytext=origin, arrowprops=dict(arrowstyle="->", color="blue", lw=0.5))
        ax.plot(origin[0], origin[1], "b^", markersize=10)
        ax.set_title(title, fontsize=9); ax.axis("off")

    fig = Figure(figsize=(6, 18)); FigureCanvasAgg(fig)
    axes = fig.subplots(3, 1)

    axes[0].imshow(bev, origin="upper")
    axes[0].plot(center[0], center[1], "b^", markersize=10)
    axes[0].set_title(args["title_occupancy"], fontsize=9); axes[0].axis("off")
    axes[0].legend(handles=legend_handles, loc="upper right", fontsize=7)

    render_shadow(axes[1], bev, shadow_occ, ray_hits_occ, args["title_occ"], center)

    if include_vehicles:
        render_shadow(axes[2], bev, shadow_veh, ray_hits_veh, args["title_veh"], center)
    else:
        axes[2].axis("off")

    fig.suptitle(args["suptitle"], fontsize=10, y=1.01)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120, bbox_inches="tight")
    fig.clear()
    plt.close(fig)
    return out_path
