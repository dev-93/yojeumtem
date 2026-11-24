export const metrics = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'] as const;
export type Metric = typeof metrics[number];
export type Post = { id: string; text?: string; timestamp: string; permalink?: string; media_type?: string; is_quote_post?: boolean; reposted_post?: unknown; text_attachment?: unknown };
export const isRepost = (post: Post) => post.media_type === 'REPOST_FACADE' || Boolean(post.reposted_post);
export const collectablePosts = (posts: Post[]) => posts.filter(post => !isRepost(post));
export const sourceMarker = 'THREADS_SOURCE\n';
function attachmentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(attachmentText).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    for (const key of ['plain_text', 'text', 'content']) {
      const text = attachmentText(item[key]);
      if (text) return text;
    }
  }
  return '';
}
export function sourceText(post: Post): string {
  return post.text?.trim() ? post.text : attachmentText(post.text_attachment);
}
export function postTitle(post: Post): string {
  const text=sourceText(post);
  if (text.trim()) return text.slice(0, 80);
  if (isRepost(post)) return '[리포스트 · 성과 미제공]';
  const labels: Record<string, string> = {IMAGE:'[사진 · 본문 없음]', VIDEO:'[영상 · 본문 없음]', CAROUSEL_ALBUM:'[사진/영상 모음 · 본문 없음]'};
  return labels[post.media_type || ''] || '[본문 없음]';
}
export function normalizeMetrics(data: Array<{name: string; values?: Array<{value: unknown}>}>) {
  return Object.fromEntries(metrics.map(name => {
    const value = data.find(x => x.name === name)?.values?.[0]?.value;
    return [name, typeof value === 'number' && Number.isFinite(value) ? value : null];
  })) as Record<Metric, number | null>;
}
export function chunks(value: string): string[] {
  const chars = Array.from(value); const result = [];
  for (let i = 0; i < chars.length; i += 900) result.push(chars.slice(i, i + 900).join(''));
  return result.length ? result : [''];
}
export const rich = (text: string) => chunks(text).map(content => ({type:'text', text:{content}}));
export const paragraph = (text: string) => ({object:'block', type:'paragraph', paragraph:{rich_text:rich(text)}});
export function properties(post: Post, values?: Record<Metric, number | null>) {
  const props: Record<string, unknown> = {
    '게시글': {title: rich(postTitle(post))},
    'Threads ID': {rich_text:rich(post.id)},
    '원문 URL':{url:post.permalink || null}, '게시 시각':{date:{start:post.timestamp}},
    '채널':{select:{name:'Threads'}},
    '수집 상태':{status:{name:values && metrics.every(k => values[k] !== null) ? '정상' : '일부 지표 미확인'}}
  };
  if (values) {
    for (const k of metrics) props[k] = {number:values[k]};
    props['마지막 수집'] = {date:{start:new Date().toISOString()}};
  }
  return props;
}

export function schemaProblems(schema: Record<string, any>): string[] {
  const expected: Record<string, string> = {
    '게시글':'title', 'Threads ID':'rich_text', '원문 URL':'url', '게시 시각':'date',
    '마지막 수집':'date', '수집 상태':'status', '채널':'select',
    '제휴링크':'relation', '제작 방식':'select', '정보태그 조회':'number', '영상 길이(초)':'number',
    ...Object.fromEntries(metrics.map(name => [name, 'number']))
  };
  const problems = Object.entries(expected).flatMap(([name, type]) => {
    if (!schema[name]) return [`${name}: 속성 누락`];
    return schema[name].type === type ? [] : [`${name}: ${type} 타입 필요 (현재 ${schema[name].type ?? '알 수 없음'})`];
  });
  const channel = schema['채널'];
  if (channel?.type === 'select' && !channel.select?.options?.some((option: any) => option.name === 'Threads')) {
    problems.push('채널: Select 옵션 Threads 누락');
  }
  const status = schema['수집 상태'];
  if (status?.type === 'status') {
    for (const name of ['정상', '일부 지표 미확인']) {
      if (!status.status?.options?.some((option: any) => option.name === name)) problems.push(`수집 상태: Status 옵션 ${name} 누락`);
    }
  }
  return problems;
}
