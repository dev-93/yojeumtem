import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Candidate, ProductObservation, Report } from './types.js';

export const productPolicy = { maximumInput: 20, maximumCandidates: 3, maximumAgeDays: 14 } as const;
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export function productIdentity(brand: string, model: string): string {
  // model은 용량·세대·구성처럼 구별해야 하는 변형까지 포함한다. 판매처·제목은 키에 넣지 않는다.
  return createHash('sha256').update(JSON.stringify([normalize(brand), normalize(model)])).digest('hex');
}
function text(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error(`${name} 누락 또는 길이 초과`);
  return value.trim();
}
function url(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('HTTPS 원문·구매 URL 필요');
  return parsed.toString();
}
function date(value: string, now: Date): string {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) > now.getTime()) throw new Error('시간대가 있는 실제 관측 시각 필요');
  return new Date(value).toISOString();
}
export function parseProduct(row: unknown, now: Date): ProductObservation {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('상품 객체 필요');
  const input = row as Record<string, unknown>;
  const fields = ['name', 'brand', 'model', 'category', 'whyNow', 'distinctive', 'firstScene', 'visualBasis'] as const;
  const values = Object.fromEntries(fields.map(key => [key, text(input, key)])) as Pick<ProductObservation, typeof fields[number]>;
  if (normalize(values.name) === normalize(values.category) || normalize(values.name) === normalize(values.brand) || ['선크림', '밀폐용기', '한우 국거리', '에어프라이어', '과일', '샤인머스캣', '양념 소불고기'].includes(normalize(values.name))) throw new Error('일반 키워드가 아닌 구체 상품명 필요');
  if (input.source !== 'official' && input.source !== 'social') throw new Error('official 또는 social 원문 필요');
  if (!['available', 'preorder', 'funding'].includes(String(input.purchaseStatus))) throw new Error('판매 상태 확인 필요');
  const observedAt = date(text(input, 'observedAt'), now);
  const verifiedAt = date(text(input, 'verifiedAt'), now);
  if (now.getTime() - Date.parse(verifiedAt) > productPolicy.maximumAgeDays * 86400000) throw new Error('판매·화면 근거 확인 후 14일 초과');
  const publishedAt = input.publishedAt === null ? null : date(text(input, 'publishedAt'), now);
  return { ...values, productKey: productIdentity(values.brand, values.model), source: input.source,
    sourceUrl: url(text(input, 'sourceUrl')), purchaseUrl: url(text(input, 'purchaseUrl')),
    purchaseStatus: input.purchaseStatus as ProductObservation['purchaseStatus'], observedAt, verifiedAt, publishedAt };
}
export function selectProducts(rows: unknown[], known: Set<string>, now: Date, todayCount = 0): { candidates: Candidate[]; excluded: Report['excluded'] } {
  const candidates: Candidate[] = [];
  const excluded: Report['excluded'] = [];
  const seen = new Set(known);
  const categories = new Set<string>();
  for (const row of rows) {
    const name = row && typeof row === 'object' ? String((row as Record<string, unknown>).name ?? '이름 없음').slice(0, 80) : '형식 오류';
    try {
      const product = parseProduct(row, now);
      if (seen.has(product.productKey)) throw new Error('동일 브랜드·모델 상품: 이미 저장 또는 이번 입력 중복');
      seen.add(product.productKey);
      if (candidates.length + todayCount >= productPolicy.maximumCandidates) throw new Error('일일 후보 상한 3개');
      if (categories.has(normalize(product.category))) throw new Error('동일 카테고리: 이번 실행에서 1개만 선정');
      categories.add(normalize(product.category));
      // 0은 평가 미실시를 뜻한다. 근거 없는 화제성·콘텐츠 적합성 점수를 만들지 않는다.
      candidates.push({ rank: candidates.length + 1, keyword: product.name, category: product.category, product,
        scores: { trendScore: null, shoppingScore: null, productFitScore: 0, contentFitScore: 0, totalScore: 0 }, google: null, shopping: null });
    } catch (error) { excluded.push({ keyword: name, source: '상품', reason: error instanceof Error ? error.message : '입력 검증 실패' }); }
  }
  return { candidates, excluded };
}
export async function readProductInput(path: string): Promise<{ rows: unknown[]; raw: string }> {
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > 60000) throw new Error('상품 원본은 실행당 60KB 이하로 입력하세요.');
  const input = JSON.parse(raw) as { schemaVersion?: number; products?: unknown[] };
  if (input.schemaVersion !== 1 || !Array.isArray(input.products) || input.products.length > productPolicy.maximumInput) throw new Error('schemaVersion=1, products 배열(최대 20개)이 필요합니다.');
  // URL 입력은 확인된 공개 판매 정보만 허용한다. 토큰·개인정보를 넣지 않는다.
  return { rows: input.products, raw };
}
