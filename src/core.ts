export const metrics = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'] as const;
export type Metric = typeof metrics[number];
export type Post = { id: string; text?: string; timestamp: string; permalink?: string; media_type?: string; is_quote_post?: boolean; reposted_post?: unknown; text_attachment?: unknown };
export const isRepost = (post: Post) => post.media_type === 'REPOST_FACADE' || Boolean(post.reposted_post);
export function postTitle(post: Post): string {
  if (post.text?.trim()) return post.text.slice(0, 80);
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
    '수집 상태':{status:{name:values && metrics.every(k => values[k] !== null) ? '정상' : '일부 지표 미확인'}}
  };
  if (values) {
    for (const k of metrics) props[k] = {number:values[k]};
    props['마지막 수집'] = {date:{start:new Date().toISOString()}};
  }
  return props;
}
