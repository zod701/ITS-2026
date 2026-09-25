# 강릉 BIS 정류장과 2025 승하차

## 출력

- `bus_stops_2025_annual_and_danoje.csv`: 사용자 BIS TXT의 1,271개 ID를 기준으로 좌표, 2025 연간 승하차, 2025-05-27~2025-06-03 기간 합계 결합.
- `bus_stops_2025_danoje_daily.csv`: 1,271개 ID × 8일 = 10,168행. 일별 승하차와 기록 유무.
- `smartcard_unmatched_bis.csv`: 현재 BIS TXT에 없는 스마트카드 ID의 수치를 기간별로 보존. `2025`, `danoje_total`, 개별 날짜는 서로 다른 집계 단위이므로 이 파일 전체를 합산하면 안 됨.
- `bus_stops_vworld_original.geojson`: 교체 전 웹 데이터 원본.
- `web_stop_location_comparison.csv`: 교체 전 361개 지점 각각의 명칭 대응 후보·거리·판정.
- `bis_station_snapshot.json`: 공식 BIS 공개 응답과 수집 시각.
- `validation_report.json`: 원본 해시, 전체/결합/미매칭 합계, 위치 차이 통계.

## 좌표와 범위

출처: https://bis.gn.go.kr/search/station (강릉시 BIS 공개 정류장 검색).
TXT의 ID·명칭을 기준으로 API의 `stationId2`에 정확히 연결하고 `coordnatesx`(경도), `coordnatesy`(위도)를 사용했다. 1,271개 모두 ID·명칭 일치하며 좌표가 있다. 이름 기반 지오코딩은 필요하지 않았다.
좌표는 수집 시점의 BIS 정보이며 2025 당시 위치를 입증하지는 않는다.

전체 CSV는 BIS TXT 전역이다. 웹 GeoJSON만 기존 지도 사각 범위
`128.8598787651,37.7321168224,128.9546660985,37.811142202`로 제한하여 431개를 수록했다.
행정경계나 분석 도로의 버퍼로 자른 결과는 아니다.

## 수치 해석

연간 값은 `2025.csv`를 `sttn_id`별로 합산했고 `station_year.csv`의 ID별 합계와도 전수 대조했다.
단오제는 제공된 `station_0527.csv`부터 `station_0603.csv`까지 8개 파일이다. 파일명에 연도가 없어 사용자 요청에 따라 2025년으로 해석했다.
CSV에 해당 ID 기록이 없으면 빈 값으로 남겼으며, 실제 기록의 0과 구분했다.
단오제 합계는 존재하는 날짜의 기록만 합산한 값이다. `danoje_days_with_record`와 `danoje_days_supplied`를 함께 확인해야 한다.
현재 BIS의 60개 ID는 연간 기록이 없고, 연간 스마트카드의 19개 ID는 BIS 목록에 없다. 현재 목록과 2025 자료 간 차이를 분석지 외부라는 이유로 일괄 처리하지 않았다.

## 위치 비교

정규화한 명칭 또는 같은 스마트카드 ID의 명칭을 후보로 삼았다. 가장 가까운 후보가 200m 이내이고, 차순위와 거리 차이가 5m 이상이며, 여러 옛 지점이 동일 ID에 대응하지 않는 190쌍만 통계에 사용했다.
20m 초과 11쌍(5.79%), 50m 초과 4쌍(2.11%). 나머지 171개는 미확정이다.
이 값은 원자료 간 좌표 차이의 근사치이며, 실제 정류장 이전 비율이나 기존 361개 전체의 변경률은 아니다.

## 재생성

저장소 루트에서 `python TAAS/analysis/prep/build_bus_stop_demand.py` 실행.
공식 좌표를 새로 수집할 때만 `--refresh-bis`를 추가한다. 새 스냅샷과 TXT의 ID가 맞지 않으면 실행이 중단된다.
기존 VWorld 수집 스크립트 `bus_stops.py`는 과거 수집용이며 새 웹 데이터를 덮어쓸 수 있으므로 재생성에는 사용하지 않는다.
`demand/`는 저장소의 기존 `.gitignore` 대상이다. CSV·원본 스냅샷은 로컬에 저장되며 웹 GeoJSON과 생성 스크립트는 버전 관리 대상이다.
