# -*- coding: utf-8 -*-
"""
KoROAD 세부링크 도로위험지수 API 클라이언트

endpoint : GET https://opendata.koroad.or.kr/data/rest/road/dgdgr/link
params   : authKey, searchLineString(EPSG:4326 LineString), vhctyCd, type, numOfRows, pageNo
응답     : 입력 폴리라인의 세그먼트마다 anals_value(위험지수), anals_grd(위험등급) 1건

실측으로 확인한 resultCode (2026-08-24)
  00  NORMAL_CODE                        정상
  03  NODATA_ERROR                       해당 없음
  10  INVALID_REQUEST_PARAMETER_ERROR    파라미터 오류 **또는** 입력 세그먼트 중 하나라도
                                         내부 세부링크에 매칭되지 않는 경우 (요청 전체가 실패)
  30  SERVICE_KEY_IS_NOT_REGISTERED_ERROR 인증키 미등록/일일 허용량 소진으로 차단
  (그 밖에 허용량 초과 직후에는 API 경로 자체가 connect timeout 으로 응답하지 않기도 함)

★ 10 과 '네트워크 실패/키 차단'은 반드시 구분해야 한다.
  전자는 "그 구간에 세부링크가 없다"는 데이터상의 사실이지만
  후자는 "못 물어봤다"이므로, 이를 결측으로 뭉개면 매칭률 통계가 그대로 오염된다.
  -> 30 / 네트워크 실패는 즉시 QuotaError 로 올려 실행을 중단시킨다.
"""
import os, time, requests
from concurrent.futures import ThreadPoolExecutor

_ENV = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
URL = "https://opendata.koroad.or.kr/data/rest/road/dgdgr/link"
CHUNK = 5
VHCTY = {"01": "승용차", "02": "버스", "03": "택시", "04": "화물차"}


class QuotaError(RuntimeError):
    """인증키 차단(30) 또는 네트워크 실패. 결과를 신뢰할 수 없으므로 실행 중단용."""


def load_key(path=_ENV):
    for line in open(path, encoding="utf-8"):
        if "DANGER_INDEX_API_KEY" in line:
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("DANGER_INDEX_API_KEY not found in " + path)


def _fmt(coords):
    return "LineString(" + ",".join(f"{x:.8f} {y:.8f}" for x, y in coords) + ")"


class Client:
    """budget: 이번 실행에서 쓸 최대 호출 수. 일일 허용량을 태우지 않기 위한 안전장치."""

    def __init__(self, key=None, sleep=0.1, timeout=20, retry=1, budget=2000):
        self.key = key or load_key()
        self.s = requests.Session()
        self.sleep, self.timeout, self.retry, self.budget = sleep, timeout, retry, budget
        self.calls = 0
        self.codes = {}          # resultCode 별 카운트 (진단용)

    def _raw(self, coords, vhcty):
        if self.calls >= self.budget:
            raise QuotaError(f"call budget {self.budget} 초과 — 실행 중단")
        params = {"authKey": self.key, "searchLineString": _fmt(coords), "vhctyCd": vhcty,
                  "type": "json", "numOfRows": 100, "pageNo": 1}
        last = None
        for a in range(self.retry + 1):
            self.calls += 1
            try:
                j = self.s.get(URL, params=params, timeout=self.timeout).json()
            except Exception as e:
                last = f"{type(e).__name__}"
                if self.sleep: time.sleep(self.sleep)
                time.sleep(0.5 * (a + 1))
                continue
            if self.sleep: time.sleep(self.sleep)
            code = j.get("resultCode")
            self.codes[code] = self.codes.get(code, 0) + 1
            if code == "30":
                raise QuotaError(f"resultCode=30 {j.get('resultMsg')} — 일일 허용량 소진/키 차단")
            return j
        self.codes["NETFAIL"] = self.codes.get("NETFAIL", 0) + 1
        raise QuotaError(f"네트워크 실패({last}) — 허용량 소진 시 API 경로가 응답하지 않음")

    @staticmethod
    def _items(j):
        it = (j.get("items") or {}).get("item") or []
        return [it] if isinstance(it, dict) else it

    def _walk(self, coords, vhcty, lo, hi, sink):
        """[lo,hi) 세그먼트 조회. 10 이면 이분 분할해 매칭 가능한 것만 건진다."""
        if lo >= hi: return
        j = self._raw(coords[lo:hi + 1], vhcty)
        if j.get("resultCode") == "00":
            for k, it in enumerate(self._items(j)):
                if lo + k < hi:
                    sink[lo + k] = (float(it["anals_value"]), int(it["anals_grd"]))
            return
        if hi - lo == 1:
            return                        # 단일 세그먼트도 실패 -> 세부링크 없음(진짜 결측)
        mid = (lo + hi) // 2
        self._walk(coords, vhcty, lo, mid, sink)
        self._walk(coords, vhcty, mid, hi, sink)

    def _pack(self, coords, sink):
        return [{"seg_i": i, "p0": coords[i], "p1": coords[i + 1],
                 "value": sink.get(i, (None, None))[0], "grade": sink.get(i, (None, None))[1]}
                for i in range(len(coords) - 1)]

    def query(self, coords, vhcty="02"):
        nseg = len(coords) - 1
        sink = {}
        for i in range(0, nseg, CHUNK):
            self._walk(coords, vhcty, i, min(i + CHUNK, nseg), sink)
        return self._pack(coords, sink)

    def query_parallel(self, coords, vhcty="02", workers=4):
        """CHUNK 단위 병렬. 동시성이 높으면 차단을 유발하니 workers 는 보수적으로."""
        nseg = len(coords) - 1
        def job(lo):
            local = {}
            self._walk(coords, vhcty, lo, min(lo + CHUNK, nseg), local)
            return local
        sink = {}
        with ThreadPoolExecutor(max_workers=workers) as ex:
            for local in ex.map(job, range(0, nseg, CHUNK)):   # 예외는 여기서 전파됨
                sink.update(local)
        return self._pack(coords, sink)
