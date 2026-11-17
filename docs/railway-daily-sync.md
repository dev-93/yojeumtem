# 매일 한 번 수집

별도의 인사이트 DB는 추가하지 않는다. 기존 요약은 게시글 누적값의 현재 스냅샷이며 계정 전체의 최근 N일 도달/조회 집계가 아니다. 최근 글만 골라도 수치 자체는 각 글의 누적값이므로 기간 조회수라고 부르지 않는다.

## Railway 배포 설정

- Dockerfile로 빌드한다. 실행에는 npm 패키지 설치나 프론트 서버가 필요하지 않다.
- 시작 명령: `npm run sync`
- Cron: `0 9 * * *` — UTC 09:00, 한국시간 매일 18:00.
- 재시작 정책: Never. 완료 후 종료하는 배치다.
- Volume을 `/data`에 연결한다. 상태·실행 잠금은 `/data/threads-sync`에 저장한다.
- 같은 서비스는 한 번에 하나만 실행한다. 비정상 종료 뒤 잠금이 남으면 실행 유무를 확인한 뒤 해제한다.
- Git에 올릴 항목은 코드·Dockerfile·문서다. `.env*`·`.runtime`은 배포 소스에 포함하지 않는다.

Variables에는 로컬 비공개 설정의 아래 키를 입력한다. 값을 문서나 로그에 적지 않는다.

- `THREADS_ACCESS_TOKEN`
- `THREADS_USER_ID`
- `NOTION_TOKEN`
- `NOTION_PARENT_PAGE_ID`
- `NOTION_DATA_SOURCE_ID`
- `NOTION_SUMMARY_BLOCK_ID` (요약 사용 시)

`THREADS_SYNC_ENV_FILE`은 Railway에 설정하지 않는다. Railway Variables를 직접 읽는다. `/data` 볼륨은 수집 상태를 보존하며 Railway Variables의 토큰을 자동 갱신하는 기능은 아니다.

## 운영 확인

첫 배포 실행과 다음 정기 실행 로그, Notion 마지막 수집 시각을 확인한 뒤 운영 완료로 판단한다. 토큰 자동 갱신은 아직 없으므로 장기 무인 운영 전에 갱신·영속 저장을 구현해야 한다. 만료·권한 취소 시 재인증이 필요하다.

이 파일은 배포 설정 안내이며 실제 서비스 생성·예약 등록 완료를 뜻하지 않는다.
