import type { Candidate, Report } from '../types.js';

// 쿠팡 파트너스 × 인스타 트렌드 실험 페이지 아래의 실행 기록 DB
export const NOTION_DATA_SOURCE_ID = 'b94fbf44-68b3-46f2-aab3-a74b20841ce5';
export const NOTION_TOP3_DATA_SOURCE_ID = '973e5e8f-76d9-463b-9234-62b45c7cce4c';
const NOTION_API = 'https://api.notion.com/v1/pages';
export const NOTION_VERSION = '2025-09-03';

type RichText = { type: 'text'; text: { content: string } };
type Block = Record<string, unknown>;

function richText(value: string): RichText[] {
  const characters = Array.from(value);
  const parts: RichText[] = [];
  for (let index = 0; index < characters.length; index += 1800) {
    parts.push({ type: 'text', text: { content: characters.slice(index, index + 1800).join('') } });
  }
  return parts.length ? parts : [{ type: 'text', text: { content: '' } }];
}

function block(type: 'paragraph' | 'heading_2' | 'heading_3' | 'bulleted_list_item', value: string): Block {
  return { object: 'block', type, [type]: { rich_text: richText(value) } };
}

function koreanDateTime(iso: string): { title: string; notionDate: string } {
  const value = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium'
  }).format(new Date(iso));
  return { title: `${value.slice(0, 16)} 쇼핑 트렌드`, notionDate: `${value.replace(' ', 'T')}+09:00` };
}

function candidateBlocks(candidate: Candidate): Block[] {
  if (candidate.product) {
    const p = candidate.product;
    return [
      block('heading_3', `TOP ${candidate.rank} · ${p.name} · ${p.category}`),
      block('paragraph', `상품 식별자: ${p.productKey}`),
      block('bulleted_list_item', `브랜드·모델: ${p.brand} / ${p.model}`),
      block('bulleted_list_item', `출처: ${p.source} · ${p.sourceUrl} · 관측 ${p.observedAt} · 원문 게시 ${p.publishedAt ?? '미확인'}`),
      block('bulleted_list_item', `왜 지금: ${p.whyNow} · 독특한 점: ${p.distinctive}`),
      block('bulleted_list_item', `첫 화면: ${p.firstScene} · 사용할 화면 근거: ${p.visualBasis}`),
      block('bulleted_list_item', `판매: ${p.purchaseStatus} · ${p.purchaseUrl} · 확인 ${p.verifiedAt}`),
      block('paragraph', '입력자가 확인한 관측이며 화제성·영상 반응·구매 전환은 검증 전입니다. 점수 평가 미실시.')
    ];
  }
  const signal = candidate.shopping;
  const change = signal?.changePercent === null ? '기준 기간 평균 0' :
    signal?.changePercent === undefined ? '확인 불가' : `${signal.changePercent > 0 ? '+' : ''}${signal.changePercent}%`;
  const shoppingStatus = signal ? { rising: '상승', flat: '보합', falling: '하락', no_data: '데이터 부족' }[signal.status] : '';
  const sources = [candidate.google ? 'Google' : '', signal ? 'Naver' : ''].filter(Boolean).join(' + ');
  return [
    block('heading_3', `TOP ${candidate.rank}${candidate.rank <= 3 ? ' ⭐' : ''} · ${candidate.keyword} · ${candidate.scores.totalScore}점 · ${sources}`),
    block('bulleted_list_item', candidate.google
      ? `Google: 표시 트래픽 ${candidate.google.approxTraffic.toLocaleString('ko-KR')}+ · ${candidate.google.publishedAt}`
      : 'Google: 현재 RSS에서 발견되지 않음'),
    block('bulleted_list_item', signal
      ? `네이버에서 이 상품을 눌러본 관심 흐름: ${shoppingStatus} · 최근 3일 평균이 앞선 7일 평균 대비 ${change} · 기간 ${signal.startDate}~${signal.endDate} · 평균 지표 ${signal.recentAverage}/${signal.priorAverage} · 관측 ${signal.dataPoints}일 (판매량·절대 클릭 수가 아님)`
      : 'Naver: 이 키워드는 독립 조회 목록에 없어 미조회'),
    block('bulleted_list_item', `예상 카테고리: ${candidate.category} · 점수: 트렌드 ${candidate.scores.trendScore ?? '미수집'}, 쇼핑 ${candidate.scores.shoppingScore ?? '미수집'}, 상품 ${candidate.scores.productFitScore}, 콘텐츠 ${candidate.scores.contentFitScore}`),
    block('paragraph', '사람이 확인할 것: 왜 지금 관심받는가? 실제 쿠팡 상품과 자연스럽게 연결되는가? Instagram에서 어떤 유용한 정보로 풀 것인가?')
  ];
}

export function notionReportPayload(report: Report, dataSourceId = NOTION_DATA_SOURCE_ID): Record<string, unknown> {
  const { title, notionDate } = koreanDateTime(report.generatedAt);
  const top3 = report.top3.map((candidate) => {
    if (candidate.product) return `${candidate.rank}. ${candidate.keyword} (상품 원문 · 점수 미평가)`;
    const status = candidate.shopping ? { rising: '상승', flat: '보합', falling: '하락', no_data: '데이터 부족' }[candidate.shopping.status] : 'Naver 미수집';
    return `${candidate.rank}. ${candidate.keyword} (${candidate.scores.totalScore}점, ${status})`;
  }).join(' · ') || '없음';
  const children: Block[] = [
    block('heading_2', '우선 확인 TOP 3'),
    block('paragraph', top3),
    block('paragraph', report.rawInput !== undefined ? `상품 원문 입력 → 신규 검토 후보 ${report.counts.ranked}개 · 제외 ${report.excluded.length}개` : `Google 수집 ${report.counts.googleCollected}개(상품 후보 ${report.counts.googleEligible}개, 미분류 ${report.counts.googleReview}개) · Naver 독립 조회 ${report.counts.naverQueried}개(추이 확보 ${report.counts.naverWithData}개) · 최종 후보 ${report.counts.ranked}개`),
    block('paragraph', report.rawInput !== undefined ? '구체 상품 입력 기반: 점수와 검색량으로 선정하지 않습니다. 원문·소개 이유·제작·판매 근거를 확인하세요.' : '네이버 상대 지표는 판매량이나 절대 클릭 수가 아닙니다.'),
    ...report.notes.map((note) => block('bulleted_list_item', note)),
    block('heading_2', 'TOP 10')
  ];
  if (report.top10.length === 0) children.push(block('paragraph', '선정 가능한 후보가 없습니다. 점수나 키워드를 임의로 채우지 않았습니다.'));
  else children.push(...report.top10.flatMap(candidateBlocks));
  children.push(block('heading_2', '미분류 · 사람 확인'));
  if (report.review.length === 0) children.push(block('paragraph', '없음'));
  else children.push(...report.review.map((item) => block(
    'bulleted_list_item',
    `${item.keyword} · Google 표시 트래픽 ${item.approxTraffic.toLocaleString('ko-KR')}+ · ${item.reason}${item.newsTitles[0] ? ` · 관련 뉴스: ${item.newsTitles[0]}` : ''}`
  )));
  children.push(block('heading_2', '제외된 키워드'));
  if (report.excluded.length === 0) children.push(block('paragraph', '없음'));
  else children.push(...report.excluded.map((item) => block('bulleted_list_item', `${item.keyword} [${item.source}]: ${item.reason}`)));
  if (children.length > 100) throw new Error('Notion 페이지 블록 100개 제한을 초과했습니다. 후보 수 또는 제외 목록을 줄이세요.');
  if (report.rawInput !== undefined) {
    children.push(block('heading_2', '입력 원본 · 검증·제외 전 보존'));
    const chars = Array.from(report.rawInput);
    for (let i = 0; i < chars.length; i += 1800) children.push({ object: 'block', type: 'code', code: { language: 'plain text', rich_text: richText(chars.slice(i, i + 1800).join('')) } });
  }
  if (children.length > 100) throw new Error('Notion 원본·후보 블록 상한 초과');
  return {
    parent: { type: 'data_source_id', data_source_id: dataSourceId },
    properties: {
      '실행': { title: richText(title) },
      '실행시각': { date: { start: notionDate } },
      '상태': { select: { name: report.top10.length ? '후보 있음' : '후보 없음' } },
      'Google 수집': { number: report.counts.googleCollected },
      '미분류 수': { number: report.counts.googleReview },
      '쇼핑 후보': { number: report.counts.naverWithData },
      '최종 후보': { number: report.counts.ranked },
      'TOP 3': { rich_text: richText(top3) }
    },
    children
  };
}

export function notionTop3Payload(candidate: Candidate, report: Report, runPageId: string): Record<string, unknown> {
  const { notionDate } = koreanDateTime(report.generatedAt);
  const properties: Record<string, unknown> = {
    '키워드': { title: richText(candidate.keyword) },
    '발견시각': { date: { start: notionDate } },
    '총점': { number: candidate.product ? null : candidate.scores.totalScore },
    '예상 카테고리': { rich_text: richText(candidate.category) },
    '검토상태': { select: { name: '미검토' } },
    '실행기록': { relation: [{ id: runPageId }] }
  };
  return {
    parent: { type: 'data_source_id', data_source_id: NOTION_TOP3_DATA_SOURCE_ID },
    properties,
    children: [
      ...candidateBlocks(candidate),
      block('heading_2', '검토 메모'),
      block('paragraph', '판단 이유 · 연결할 상품 · Instagram 콘텐츠 아이디어를 이 아래에 기록하세요.')
    ]
  };
}

async function createPage(payload: Record<string, unknown>, token: string): Promise<{ id: string; url: string }> {
  if (!token.trim()) throw new Error('NOTION_TOKEN이 없습니다. 프로젝트 .env에 Notion 연동 토큰을 입력하세요.');
  const response = await fetch(NOTION_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    let code = '';
    try {
      const body = await response.json() as { code?: string };
      code = body.code ? ` (${body.code})` : '';
    } catch { /* 오류 응답이 JSON이 아닐 수 있음 */ }
    throw new Error(`Notion 저장 실패: HTTP ${response.status}${code}. 토큰과 DB 연결 권한을 확인하세요.`);
  }
  const body = await response.json() as { id?: string; url?: string };
  if (!body.id || !body.url) throw new Error('Notion은 성공을 반환했지만 새 페이지 ID 또는 URL이 없습니다.');
  return { id: body.id, url: body.url };
}

export async function saveNotionReport(report: Report, token: string): Promise<{ runUrl: string; top3Saved: number }> {
  const runPage = await createPage(notionReportPayload(report), token);
  let top3Saved = 0;
  for (const candidate of report.top3) {
    try {
      await createPage(notionTop3Payload(candidate, report, runPage.id), token);
      top3Saved += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`실행 기록은 저장됐지만 TOP 3 후보 ${top3Saved}/${report.top3.length}개만 저장됐습니다. 실행 기록: ${runPage.url}. ${message}`);
    }
  }
  return { runUrl: runPage.url, top3Saved };
}

// Notion 자체를 영속 중복 이력으로 사용한다. Railway 로컬 디스크·Mac 이력에 의존하지 않는다.
export async function readKnownProducts(token: string, date?: string): Promise<{ keys: Set<string>; todayCount: number }> {
  const keys = new Set<string>();
  let todayCount = 0;
  let cursor: string | undefined;
  do {
    const response = await fetch(`https://api.notion.com/v1/data_sources/${NOTION_TOP3_DATA_SOURCE_ID}/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }), signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`Notion 중복 조회 실패: HTTP ${response.status}. 저장을 중단합니다.`);
    const pages = await response.json() as { results: { id: string; properties?: Record<string, { date?: { start?: string } }> }[]; has_more: boolean; next_cursor: string | null };
    if (!Array.isArray(pages.results)) throw new Error('Notion 중복 조회 응답 오류');
    for (const page of pages.results) {
      let productPage = false;
      let blockCursor: string | undefined;
      do {
        const params = new URLSearchParams({ page_size: '100', ...(blockCursor ? { start_cursor: blockCursor } : {}) });
        // Notion 요청 제한을 피한다. 429 등 오류에서는 이력 없이 저장하지 않는다.
        await new Promise(resolve => setTimeout(resolve, 350));
        const response = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children?${params}`, {
          headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION }, signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw new Error(`Notion 상품 식별자 조회 실패: HTTP ${response.status}`);
        const body = await response.json() as { results: { type: string; paragraph?: { rich_text?: { plain_text?: string; text?: { content?: string } }[] } }[]; has_more: boolean; next_cursor: string | null };
        if (!Array.isArray(body.results)) throw new Error('Notion 상품 본문 응답 오류');
        for (const block of body.results) {
          const value = block.paragraph?.rich_text?.map(t => t.plain_text ?? t.text?.content ?? '').join('') ?? '';
          const match = /^상품 식별자: ([a-f0-9]{64})$/.exec(value);
          if (match) { keys.add(match[1]); productPage = true; }
        }
        if (body.has_more && (!body.next_cursor || body.next_cursor === blockCursor)) throw new Error('Notion 본문 페이지네이션 오류');
        blockCursor = body.has_more ? body.next_cursor! : undefined;
      } while (blockCursor);
      const found = page.properties?.['발견시각']?.date?.start;
      if (productPage && found && date && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(found)) === date) todayCount += 1;
    }
    if (pages.has_more && (!pages.next_cursor || pages.next_cursor === cursor)) throw new Error('Notion 후보 페이지네이션 오류');
    cursor = pages.has_more ? pages.next_cursor! : undefined;
  } while (cursor);
  return { keys, todayCount };
}
