import { readFile, mkdir, open, unlink, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request, ApiError } from './http.ts';
import { metrics, isRepost, postTitle, normalizeMetrics, properties, paragraph, rich, type Post } from './core.ts';

// 명시적으로 지정한 전용 설정 파일만 읽는다.
async function config() {
  if (process.env.THREADS_SYNC_ENV_FILE) {
    const text=await readFile(resolve(process.env.THREADS_SYNC_ENV_FILE),'utf8');
    for (const line of text.split('\n')) {
      const m=line.match(/^([A-Z_]+)=(.*)$/); if (!m) continue;
      const value=m[2]!.trim().replace(/^(['"])(.*)\1$/, '$2');
      if (!process.env[m[1]!]) process.env[m[1]!]=value;
    }
  }
  const need=(key:string) => {const v=process.env[key]; if(!v) throw new Error(`${key} 설정이 필요합니다.`); return v;};
  return {token:need('THREADS_ACCESS_TOKEN'), user:need('THREADS_USER_ID'), notion:need('NOTION_TOKEN'), parent:need('NOTION_PARENT_PAGE_ID'), ds:process.env.NOTION_DATA_SOURCE_ID, summary:process.env.NOTION_SUMMARY_BLOCK_ID};
}
async function main() {
  const command=process.argv[2];
  if (!['doctor','setup','sync'].includes(command || '')) throw new Error('명령: doctor | setup | sync [--full] [--dry-run]');
  const c=await config();
  const threads=(path:string, query:Record<string,string>={}) => {
    const url=new URL(`https://graph.threads.com/v1.0/${path}`);
    for(const [k,v] of Object.entries({...query,access_token:c.token})) url.searchParams.set(k,v);
    return request(url);
  };
  const notion=(path:string, method='GET', body?:unknown) => request(new URL(`https://api.notion.com/v1/${path}`),method,body,{'Authorization':`Bearer ${c.notion}`, 'Notion-Version':'2025-09-03'});
  const me=await threads('me',{fields:'id,username'});
  if(me.id!==c.user) throw new Error('인증 계정 ID와 THREADS_USER_ID가 다릅니다.');
  if(command==='doctor') {
    await notion(`pages/${c.parent}`);
    const posts=await threads(`${c.user}/threads`,{fields:'id',limit:'1'});
    if(posts.data?.[0]) await threads(`${posts.data[0].id}/insights`,{metric:metrics.join(',')});
    if(c.ds) await notion(`data_sources/${c.ds}`);
    console.log('계정·Notion 접근 확인 완료. 게시글이 있는 경우 인사이트 읽기도 확인했습니다.'); return;
  }
  const dir=resolve(process.env.THREADS_SYNC_STATE_DIR || '.runtime/threads-sync'); await mkdir(dir,{recursive:true});
  let lock;
  try { lock=await open(`${dir}/lock`,'wx'); } catch {throw new Error('실행 잠금이 있습니다. 다른 실행이 종료됐는지 확인하세요.');}
  try {
    if(command==='setup') {
      // 부모 페이지의 동일 이름 DB를 먼저 확인해 재생성을 방지한다.
      let cursor: string|undefined;
      do {
        const result=await notion(`blocks/${c.parent}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}`:''}`);
        if(result.results.some((b:any)=>b.type==='child_database' && b.child_database.title==='Threads 게시글')) throw new Error('Threads 게시글 DB가 이미 있습니다. 기존 DB의 data source ID를 설정하세요.');
        cursor=result.has_more ? result.next_cursor : undefined;
      } while(cursor);
      const schema: Record<string,unknown>={'게시글':{title:{}},'원문 URL':{url:{}},'게시 시각':{date:{}},'마지막 수집':{date:{}},'수집 상태':{status:{}}};
      schema['Threads ID']={rich_text:{}};
      for(const name of metrics) schema[name]={number:{format:'number'}};
      const db=await notion('databases','POST',{parent:{type:'page_id',page_id:c.parent},title:rich('Threads 게시글'),initial_data_source:{properties:schema}});
      console.log(`DB 생성 완료: ${db.url}\nNOTION_DATA_SOURCE_ID=${db.data_sources?.[0]?.id || 'DB에서 확인 필요'}`);
      // 요약은 기존 페이지 전체를 수정하지 않고 전용 블록을 만든다.
      const summary=await notion(`blocks/${c.parent}/children`,'PATCH',{children:[paragraph('Threads 수집: 아직 실행되지 않았습니다.')]});
      console.log(`NOTION_SUMMARY_BLOCK_ID=${summary.results[0].id}`); return;
    }
    if(!c.ds) throw new Error('setup 후 NOTION_DATA_SOURCE_ID를 설정하세요.');
    const dry=process.argv.includes('--dry-run');
    let state:{completedAt?:string; fullAt?:string}={};
    try {state=JSON.parse(await readFile(`${dir}/state.json`,'utf8'));} catch(e:any) {if(e.code!=='ENOENT') throw new Error('수집 상태 파일을 읽을 수 없습니다.');}
    const full=process.argv.includes('--full') || !state.completedAt || !state.fullAt || Date.now()-Date.parse(state.fullAt)>7*86400000;
    const since=full ? undefined : new Date(Math.min(Date.now()-14*86400000,Date.parse(state.completedAt!)-2*86400000)).toISOString();
    const posts:Post[]=[]; let after:string|undefined;
    do {
      const page=await threads(`${c.user}/threads`,{fields:'id,text,timestamp,permalink,media_type,is_quote_post,reposted_post,text_attachment',limit:'100',...(since?{since}:{}),...(after?{after}:{})});
      posts.push(...page.data); after=page.paging?.cursors?.after;
      if(!page.paging?.next) after=undefined;
      if(posts.length>=1000 && after) throw new Error('초기 수집 상한 1,000개에 도달했습니다. 저장 전 중단했습니다. 기간 분할 수집이 필요합니다.');
    } while(after);
    const unique=[...new Map(posts.map(p=>[p.id,p])).values()];
    let failed=0, saved=0, unavailable=0; const ranked:Array<{title:string;views:number;replies:number}>=[];
    for(const p of unique) {
      let values;
      try {values=normalizeMetrics((await threads(`${p.id}/insights`,{metric:metrics.join(',')})).data);} catch(e) {if(e instanceof ApiError && [401,403].includes(e.status)) throw e; failed++;}
      if(values && metrics.some(k=>values[k]===null)) { if(isRepost(p)) unavailable++; else failed++; }
      if(dry) {saved++; continue;}
      const found=await notion(`data_sources/${c.ds}/query`,'POST',{filter:{property:'Threads ID',rich_text:{equals:p.id}},page_size:2});
      if(found.results.length>1) throw new Error('중복 Threads ID가 있습니다. 자동 쓰기를 중단합니다.');
      const props=properties(p,values);
      let target=found.results[0];
      const content=JSON.stringify({text:p.text??'',text_attachment:p.text_attachment??null,media_type:p.media_type??null,is_quote_post:p.is_quote_post??false,reposted_post:p.reposted_post??null});
      if(!target) target=await notion('pages','POST',{parent:{type:'data_source_id',data_source_id:c.ds},properties:props,children:[paragraph(`THREADS_SOURCE\n${content}`)]});
      else {
        await notion(`pages/${target.id}`,'PATCH',{properties:props});
        const blocks=await notion(`blocks/${target.id}/children?page_size=100`);
        const source=blocks.results.find((b:any)=>b.type==='paragraph' && b.paragraph.rich_text.map((r:any)=>r.plain_text??r.text?.content??'').join('').startsWith('THREADS_SOURCE\n'));
        if(source) await notion(`blocks/${source.id}`,'PATCH',{paragraph:{rich_text:rich(`THREADS_SOURCE\n${content}`)}});
        else await notion(`blocks/${target.id}/children`,'PATCH',{children:[paragraph(`THREADS_SOURCE\n${content}`)]});
      }
      saved++; if(values && values.views !== null) ranked.push({title:postTitle(p).slice(0,45),views:values.views??0,replies:values.replies??0});
    }
    if(!dry) {
      if(c.summary) {
        ranked.sort((a,b)=>b.views-a.views);
        const best=ranked[0];
        await notion(`blocks/${c.summary}`,'PATCH',{paragraph:{rich_text:rich(`Threads 수집 ${saved}개 · 리포스트 성과 미제공 ${unavailable}개 · 성과 미확인/일부 누락 ${failed}개. ${best?`이번 수집 범위 조회 최다: 「${best.title}」 ${best.views}회.`:''}\n기준 ${new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} KST. 각 글의 누적값이며 노출 기간은 다릅니다.`)}});
      }
      const next={completedAt:new Date().toISOString(),fullAt:full?new Date().toISOString():state.fullAt};
      await (await open(`${dir}/state.tmp`,'w',0o600)).close();
      const file=await open(`${dir}/state.tmp`,'w'); await file.writeFile(JSON.stringify(next)); await file.close(); await rename(`${dir}/state.tmp`,`${dir}/state.json`);
    }
    console.log(`${dry?'읽기 검증':'동기화'} 완료: ${saved}개, 리포스트 성과 미제공 ${unavailable}개 · 성과 미확인/일부 누락 ${failed}개. 원문은 로그에 출력하지 않았습니다.`);
  } finally {await lock.close(); await unlink(`${dir}/lock`);}
}
main().catch(e=>{console.error(e instanceof ApiError?e.message:e.message || '실행 실패'); process.exitCode=1;});
