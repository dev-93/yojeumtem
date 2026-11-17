import https from 'node:https';
export class ApiError extends Error {
  status: number;
  constructor(status: number) { super(`API 요청 실패 (HTTP ${status}). 인증·권한·서비스 상태를 확인하세요.`); this.status=status; }
}
export async function request(url: URL, method = 'GET', body?: unknown, headers: Record<string,string> = {}): Promise<any> {
  for (let attempt=0; attempt<4; attempt++) {
    const response = await new Promise<{status:number; retry?:string; text:string}>((resolve,reject) => {
      const req = https.request(url, {method, headers:{'Content-Type':'application/json', ...headers}}, res => {
        let text=''; res.on('data', x => text += x); res.on('end', () => resolve({status:res.statusCode || 0, retry:res.headers['retry-after'], text}));
      });
      req.setTimeout(30000, () => req.destroy(new Error('요청 시간 초과. 저장 여부 확인 후 다시 실행하세요.')));
      req.on('error', () => reject(new Error('네트워크 요청 실패. 저장 여부 확인 후 다시 실행하세요.')));
      if (body !== undefined) req.write(JSON.stringify(body)); req.end();
    });
    if (response.status>=200 && response.status<300) return JSON.parse(response.text);
    // 쓰기 결과가 불확실한 5xx는 자동 재시도하지 않는다.
    if (attempt<3 && (response.status===429 || (method==='GET' && response.status>=500))) {
      const seconds=Number(response.retry ?? 2 ** attempt);
      if (!Number.isFinite(seconds) || seconds>60) throw new ApiError(response.status);
      await new Promise(resolve=>setTimeout(resolve, Math.max(1,seconds)*1000)); continue;
    }
    throw new ApiError(response.status);
  }
}
