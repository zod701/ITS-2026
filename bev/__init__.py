"""03_bev_shadow_gpu.ipynb 의 헬퍼 모듈 묶음.

- bev_core          보정·투영·방사프로파일·pose정합·도로차폐 수식
- bev_render_worker 3패널 시각화 렌더 (ProcessPoolExecutor 워커)
- road_prep         도로망·도로면 전처리 (전체 1회 실행)

`bev_render_worker.render_and_save` 는 Windows(spawn) 자식 프로세스가 참조로 import 하므로
이 패키지가 sys.path 에서 보여야 한다 -> 노트북은 저장소 루트를 작업 디렉터리로 실행할 것.
전처리는 루트에서 `python -m bev.road_prep` 로 돌린다(경로가 CWD 기준이라 루트여야 한다).
"""
