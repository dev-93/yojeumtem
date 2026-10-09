import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { productIdentity, readProductInput, selectProducts } from '../src/products.js';
import { notionReportPayload, notionTop3Payload, readKnownProducts } from '../src/report/notion.js';
import type { Report } from '../src/types.js';
const now = new Date('2026-10-09T09:00:00Z');
const product = { name: 'Acme Fold X1', brand: 'Acme', model: 'Fold X1 500ml', category: '생활/건강',
 source: 'official', sourceUrl: 'https://example.com/launch', observedAt: '2026-10-09T10:00:00+09:00',
 verifiedAt: '2026-10-09T10:00:00+09:00', publishedAt: null, whyNow: '10월 신규 출시 원문', distinctive: '접이식 구조',
 firstScene: '허락된 접이식 구조 이미지와 크기 비교', visualBasis: '브랜드 이미지 사용 허락 확인',
 purchaseUrl: 'https://example.com/buy', purchaseStatus: 'available' };
const report: Report = { date: '2026-10-09', generatedAt: now.toISOString(), timezone: 'Asia/Seoul',
 sources: { google: '', naver: '' }, counts: { googleCollected: 0, googleEligible: 0, googleReview: 0, naverQueried: 0, naverWithData: 0, ranked: 0 },
 top3: [], top10: [], excluded: [], review: [], notes: [] };

test('동일 브랜드·모델은 이름·판매처·날짜가 바뀌어도 중복이며 변형 모델은 구별한다', () => {
 assert.equal(productIdentity('Ａｃｍｅ', 'Fold  X1 500ml'), productIdentity('acme', 'fold x1 500ml'));
 const first = selectProducts([product], new Set(), now).candidates[0];
 assert.equal(selectProducts([{ ...product, name: '다른 판매처 상품명', purchaseUrl: 'https://other.example/buy' }], new Set([first.product!.productKey]), new Date('2026-10-10T09:00:00Z')).candidates.length, 0);
 assert.notEqual(productIdentity('Acme', 'Fold X1 500ml'), productIdentity('Acme', 'Fold X1 1L'));
});

test('일반어·미래 시각·오래된 확인·판매 근거 누락은 후보로 선정하지 않는다', () => {
 const invalid = [{ ...product, name: '선크림' }, { ...product, verifiedAt: '2026-10-10T10:00:00+09:00' },
 { ...product, verifiedAt: '2026-09-01T10:00:00+09:00' }, { ...product, visualBasis: '' }, { ...product, purchaseUrl: 'http://example.com' }];
 const result = selectProducts(invalid, new Set(), now);
 assert.equal(result.candidates.length, 0); assert.equal(result.excluded.length, invalid.length);
});

test('일일 누적 상한과 카테고리 다양성 때문에 부족한 후보를 억지로 채우지 않는다', () => {
 const rows = Array.from({ length: 5 }, (_, i) => ({ ...product, model: `X${i}`, category: `category${i}` }));
 assert.equal(selectProducts(rows, new Set(), now).candidates.length, 3);
 assert.equal(selectProducts(rows, new Set(), now, 2).candidates.length, 1);
 assert.equal(selectProducts(rows, new Set(), now, 3).candidates.length, 0);
 assert.equal(selectProducts([product, { ...product, model: 'X2' }], new Set(), now).candidates.length, 1);
});

test('원본은 제외 항목 포함 그대로 보존하고 기존 Notion 속성과 TOP 본문을 유지한다', () => {
 const candidates = selectProducts([product], new Set(), now).candidates;
 const rawInput = JSON.stringify({ schemaVersion: 1, products: [product, { name: '선크림' }] });
 const value = { ...report, top3: candidates, top10: candidates, rawInput, counts: { ...report.counts, ranked: 1 } };
 const payload = notionReportPayload(value) as any;
 const codes = payload.children.filter((b: any) => b.type === 'code').flatMap((b: any) => b.code.rich_text.map((t: any) => t.text.content)).join('');
 assert.equal(codes, rawInput); assert.equal(payload.properties['최종 후보'].number, 1);
 const candidate = notionTop3Payload(candidates[0], value, 'run') as any;
 assert.equal(candidate.properties['총점'].number, null);
 assert.deepEqual(candidate.properties['실행기록'].relation, [{ id: 'run' }]);
 const top = payload.children.find((b: any) => b.heading_3)?.heading_3.rich_text[0].text.content;
 assert.match(top, /^TOP 1/); assert.match(top, /Acme Fold X1/);
});

test('Notion 이력 페이지네이션과 한국시간 당일 누적을 읽고 조회 실패는 중단한다', async () => {
 const fetch = globalThis.fetch; let calls = 0;
 const key = productIdentity(product.brand, product.model);
 globalThis.fetch = async (url, options) => {
  calls += 1;
  if (String(url).includes('/query')) {
   const cursor = JSON.parse(String(options?.body)).start_cursor;
   return new Response(JSON.stringify(cursor ? { results: [], has_more: false, next_cursor: null } : {
    results: [{ id: 'p', properties: { '발견시각': { date: { start: '2026-10-08T16:00:00Z' } } } }], has_more: true, next_cursor: 'next' }));
  }
  return new Response(JSON.stringify({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: `상품 식별자: ${key}` }] } }], has_more: false, next_cursor: null }));
 };
 try {
  const history = await readKnownProducts('test', '2026-10-09');
  assert.equal(history.todayCount, 1); assert.equal(history.keys.has(key), true); assert.equal(calls, 3);
  globalThis.fetch = async () => new Response('', { status: 429 });
  await assert.rejects(readKnownProducts('test'), /조회 실패/);
 } finally { globalThis.fetch = fetch; }
});

test('입력 원본을 읽고 배열 상한·깨진 파일은 안전하게 거절한다', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'products-test-'));
 try {
  const path = join(dir, 'input.json'); const raw = JSON.stringify({ schemaVersion: 1, products: [product] });
  await writeFile(path, raw); assert.equal((await readProductInput(path)).raw, raw);
  await writeFile(path, JSON.stringify({ schemaVersion: 1, products: Array(21).fill(product) }));
  await assert.rejects(readProductInput(path), /최대 20/);
  await writeFile(path, '{'); await assert.rejects(readProductInput(path));
 } finally { await rm(dir, { recursive: true }); }
});
