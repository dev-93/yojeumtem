import 'dotenv/config';
import { readProductInput, selectProducts } from './products.js';
import { readKnownProducts, saveNotionReport } from './report/notion.js';
import type { Report } from './types.js';

async function main(): Promise<void> {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const args = process.argv.slice(2);
  const preview = args.includes('--preview');
  const inputIndex = args.indexOf('--input');
  if (args.some((arg, i) => arg !== '--preview' && arg !== '--input' && !(inputIndex >= 0 && i === inputIndex + 1))) throw new Error('사용법: npm run daily -- [--input 파일] [--preview]');
  if (inputIndex >= 0 && !args[inputIndex + 1]) throw new Error('--input 파일 경로 필요');
  const input = await readProductInput(inputIndex >= 0 ? args[inputIndex + 1] : 'data/products.json');
  const token = process.env.NOTION_TOKEN?.trim();
  if (!preview && !token) throw new Error('NOTION_TOKEN이 없습니다.');
  const history = preview || input.rows.length === 0 ? { keys: new Set<string>(), todayCount: 0 } : await readKnownProducts(token!, date);
  const { candidates, excluded } = selectProducts(input.rows, history.keys, now, history.todayCount);
  const report: Report = {
    date, generatedAt: now.toISOString(), timezone: 'Asia/Seoul', sources: { google: '사용 안 함', naver: '사용 안 함' },
    counts: { googleCollected: 0, googleEligible: 0, googleReview: 0, naverQueried: 0, naverWithData: 0, ranked: candidates.length },
    top3: candidates, top10: candidates, review: [], excluded, rawInput: input.raw,
    notes: ['구체 상품 원문 입력 기반. Google RSS·고정 네이버 키워드 수집은 사용하지 않습니다.',
      '점수는 평가 미실시입니다. 입력 순서에서 필수 근거·상품 중복·카테고리 다양성을 검사해 최대 3개를 선정합니다.',
      '출처 페이지 자동 확인이나 SNS 화제성 검증을 수행한 결과가 아닙니다. 입력자는 실제 원문과 판매·화면 근거를 확인해야 합니다.',
      ...(preview ? ['미리보기는 외부 API를 호출하지 않아 기존 Notion 중복을 검사하지 않습니다.'] : [])]
  };
  if (preview) { console.log(JSON.stringify(report, null, 2)); return; }
  const result = await saveNotionReport(report, token!);
  console.log(`상품 입력 ${input.rows.length}개 → 검토 후보 ${result.top3Saved}개`);
  console.log(`Notion 실행기록: ${result.runUrl}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : '상품 수집 실패'); process.exitCode = 1; });
