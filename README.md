# 요즘템 (yojeumtem) · 구체 상품 콘텐츠 후보

> 검증된 구체 상품 원문 기반 요즘템 콘텐츠 후보 선정 및 텔레그램 일일 브리핑 파이프라인

검색량 기반 고정 키워드 후보 대신 **확인한 상품 원문 → 소개 이유·제작 근거 검사 → 상품 중복 방지 → 하루 최대 3개** 흐름을 사용합니다. Google RSS·고정 네이버 조회는 daily에서 제거했습니다. 유료 AI API는 사용하지 않습니다.

```bash
npm run daily -- --preview                 # 외부 호출·쓰기 없음
npm run daily -- --input data/products.json --preview
npm run daily                             # 기존 Notion DB에 기록
npm run check
npm test
```

Node.js 22+와 기존 NOTION_TOKEN이 필요합니다. 미리보기에는 토큰이 필요 없습니다. `data/products.json`은 빈 입력으로 시작합니다. **URL만 넣으면 자동으로 상품을 읽거나 신상품을 발굴하는 기능은 아직 없습니다.** 확인한 상품 정보를 아래 형식으로 입력하세요. 운영자 우선순위 순서에서 조건을 통과한 후보를 선정합니다.

```json
{
  "schemaVersion": 1,
  "products": [{
    "name": "브랜드와 모델이 포함된 구체 상품명",
    "brand": "브랜드",
    "model": "정확한 모델·세대·용량·구성",
    "category": "생활/건강",
    "source": "official",
    "sourceUrl": "https://example.com/product",
    "observedAt": "2026-10-09T10:00:00+09:00",
    "verifiedAt": "2026-10-09T10:00:00+09:00",
    "publishedAt": null,
    "whyNow": "원문으로 확인한 최근 소개 이유",
    "distinctive": "구체적으로 다른 특징",
    "firstScene": "실제로 만들 수 있는 첫 화면",
    "visualBasis": "보유 제품 또는 사용 허락을 확인한 이미지 등",
    "purchaseUrl": "https://example.com/buy",
    "purchaseStatus": "available"
  }]
}
```

예제는 실제 후보가 아닙니다. source는 official/social, 판매 상태는 available/preorder/funding입니다. 관측·확인 시각은 시간대 포함이며 미래 값은 제외합니다. 확인 후 14일이 넘으면 재확인해야 합니다. 최초 관측을 출시일로 바꾸지 않습니다. HTTPS 공개 URL만 입력하고 비밀값·개인정보는 넣지 않습니다.

## 보존·중복·선정

- 실행당 입력 최대 20개·60KB. 입력 원본 전체는 제외 전 그대로 기존 Notion 실행 페이지 코드 블록에 저장합니다. 사이트 HTTP 응답을 보존한 것은 아닙니다. 과거 수집 원본은 복원하지 못합니다.
- 상품은 브랜드+모델을 정규화한 키로 식별합니다. 동일 제품의 판매처 차이는 합치고 세대·용량·구성은 모델에 명시합니다. 상품명 유사도로 다른 상품을 임의 병합하지 않습니다.
- 기존 후보 본문의 상품 키를 읽어 이미 저장한 상품은 제외합니다. 일부 후보 저장 후 실패해도 재실행에서 성공분은 다시 만들지 않습니다. 조회 실패 시 쓰기를 중단합니다.
- 한국시간 하루 최대 3개, 실행당 카테고리 최대 1개. 일반 키워드·필수 근거 누락·오래된 확인은 제외합니다. 점수로 빈자리를 채우지 않습니다. 총점은 미평가로 비워 둡니다.
- 하루 상한은 새 상품 후보 행 기준입니다. 동일 카테고리 제한은 실행 단위이며 최근 7일 다양성은 아직 구현하지 않았습니다.
- 기존 키워드 후보·사용자 메모·검토상태를 변경하지 않습니다. 원본과 관측 날짜·출처는 본문에, 관계·속성명은 기존 형식으로 유지합니다. 신규 후보가 없으면 실행 기록만 생성합니다.
- Notion에 원자적 유일 키가 없어 **Railway를 단일 쓰기 실행자로 사용**합니다. 다른 환경의 daily 쓰기를 겹쳐 실행하지 마세요. 미리보기는 기존 Notion 중복·당일 누적 수를 검사하지 않습니다.

## 예약·AI

Railway 17:00 daily, Mac 18:00 Codex 해석·Telegram 명령은 유지합니다. 최신 TOP 본문과 최종 후보 수가 실제 신규 상품만 포함하므로 후보 0개에서는 AI 호출과 추천을 생략합니다. 현재 콘텐츠 해석은 소비자 불편 근거도 확인하며 입력의 화제성·판매 주장을 자동 사실로 취급하지 않습니다.

배포 이미지에 data/products.json을 포함해야 합니다. 빈 입력을 배포하면 후보가 0개인 상태가 계속됩니다. 공개 상품 정보만 커밋하거나 별도 --input 파일을 운영합니다. 공식 신제품 피드와 허용된 SNS 연동은 후속 작업이며 아직 추가하지 않았습니다.

기존 명령 `briefing:read`, `briefing:send`, `briefing:scheduled`, `schedule:status`와 Telegram 봇 설정은 유지합니다. 운영 문서는 [Railway](docs/railway.md), [콘텐츠 해석](docs/content-briefing.md)을 참고하세요. 자동 Instagram 게시·제휴 링크 생성은 범위 밖입니다.
