import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request } from './http.ts';

async function identify() {
  const path = resolve(process.env.THREADS_SYNC_ENV_FILE || '.env.threads-sync');
  const content = await readFile(path, 'utf8');
  const token = content.match(/^THREADS_ACCESS_TOKEN=(.*)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!token) throw new Error('설정 파일에 THREADS_ACCESS_TOKEN을 입력하세요.');
  const url = new URL('https://graph.threads.com/v1.0/me');
  url.searchParams.set('fields', 'id,username');
  url.searchParams.set('access_token', token);
  const data = await request(url);
  if (typeof data.id !== 'string' || !/^\d+$/.test(data.id)) throw new Error('유효한 사용자 ID를 받지 못했습니다.');
  const line = `THREADS_USER_ID=${data.id}`;
  const updated = /^THREADS_USER_ID=.*$/m.test(content)
    ? content.replace(/^THREADS_USER_ID=.*$/m, line)
    : `${content.trimEnd()}\n${line}\n`;
  await writeFile(path, updated, { mode: 0o600 });
  console.log(`계정: ${data.username}\n사용자 ID: ${data.id}\nTHREADS_USER_ID 저장 완료`);
}
identify().catch(() => {
  console.error('사용자 ID 조회·저장 실패. 네트워크 연결과 Threads 토큰을 확인하세요. 토큰은 출력하지 않았습니다.');
  process.exitCode = 1;
});
