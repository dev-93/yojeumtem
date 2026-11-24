import { readFile, mkdir, open, unlink, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request, ApiError } from './http.ts';
import { metrics, isRepost, collectablePosts, postTitle, normalizeMetrics, properties, paragraph, rich, sourceMarker, sourceText, schemaProblems, type Post } from './core.ts';

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
export async function run(command:string, args:string[]=[], requestFn:typeof request=request) {
  if (!['doctor','setup','sync'].includes(command || '')) throw new Error('명령: doctor | setup | sync [--full] [--dry-run]');
  const c=await config();
  const threads=(path:string, query:Record<string,string>={}) => {
    const url=new URL(`https://graph.threads.com/v1.0/${path}`);
    for(const [k,v] of Object.entries({...query,access_token:c.token})) url.searchParams.set(k,v);
    return requestFn(url);
  };
  const notion=(path:string, method='GET', body?:unknown) => requestFn(new URL(`https://api.notion.com/v1/${path}`),method,body,{'Authorization':`Bearer ${c.notion}`, 'Notion-Version':'2025-09-03'});
  const me=await threads('me',{fields:'id,username'});
  if(me.id!==c.user) throw new Error('인증 계정 ID와 THREADS_USER_ID가 다릅니다.');
  if(command==='doctor') {
    await notion(`pages/${c.parent}`);
    const posts=await threads(`${c.user}/threads`,{fields:'id',limit:'1'});
    if(posts.data?.[0]) await threads(`${posts.data[0].id}/insights`,{metric:metrics.join(',')});
    if(!c.ds) throw new Error('NOTION_DATA_SOURCE_ID 설정이 필요합니다. 기존 콘텐츠 DB의 Data Source ID를 설정하세요.');
    const dataSource=await notion(`data_sources/${c.ds}`);
    const problems=schemaProblems(dataSource.properties || {});
    if(problems.length) throw new Error(`콘텐츠 DB 스키마 확인 실패:\n- ${problems.join('\n- ')}`);
    console.log('계정·Notion 접근 및 콘텐츠 DB 필수 속성·타입 확인 완료. 게시글이 있는 경우 인사이트 읽기도 확인했습니다.'); return;
  }
  const dir=resolve(process.env.THREADS_SYNC_STATE_DIR || '.runtime/threads-sync'); await mkdir(dir,{recursive:true});
  let lock;
  try { lock=await open(`${dir}/lock`,'wx'); } catch {throw new Error('실행 잠금이 있습니다. 다른 실행이 종료됐는지 확인하세요.');}
  try {
    if(command==='setup') {
      // setup은 기존 운영 DB를 재사용하며 새 DB나 요약 블록을 만들지 않는다.
      if(c.ds) {
        const dataSource=await notion(`data_sources/${c.ds}`);
        const problems=schemaProblems(dataSource.properties || {});
        if(problems.length) throw new Error(`설정된 Data Source의 스키마가 올바르지 않습니다:\n- ${problems.join('\n- ')}`);
        console.log(`기존 콘텐츠 DB 확인 완료. DB를 새로 만들지 않았습니다.\nNOTION_DATA_SOURCE_ID=${c.ds}`);
        if(c.summary) console.log(`기존 요약 블록 유지: NOTION_SUMMARY_BLOCK_ID=${c.summary}`);
        return;
      }
      // 옛 이름과 새 이름 모두 찾아 기존 DB를 재사용하도록 안내한다.
      let cursor: string|undefined;
      const existing:Array<{id:string;title:string}> = [];
      do {
        const result=await notion(`blocks/${c.parent}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}`:''}`);
        existing.push(...result.results.filter((b:any)=>b.type==='child_database' && ['Threads 게시글','콘텐츠 DB'].includes(b.child_database.title)).map((b:any)=>({id:b.id,title:b.child_database.title})));
        cursor=result.has_more ? result.next_cursor : undefined;
      } while(cursor);
      if(existing.length) throw new Error(`기존 DB(${[...new Set(existing.map(x=>x.title))].join(', ')})를 찾았습니다. 생성하지 않았습니다. 현재 DB의 기존 Data Source ID를 NOTION_DATA_SOURCE_ID에 설정하세요.`);
      throw new Error('기존 Threads 게시글/콘텐츠 DB를 찾지 못했습니다. 운영 DB를 새로 만들지 않도록 setup을 중단했습니다. 기존 Data Source ID를 설정하세요.');
    }
    if(!c.ds) throw new Error('setup 후 NOTION_DATA_SOURCE_ID를 설정하세요.');
    const dry=args.includes('--dry-run');
    let state:{completedAt?:string; fullAt?:string}={};
    try {state=JSON.parse(await readFile(`${dir}/state.json`,'utf8'));} catch(e:any) {if(e.code!=='ENOENT') throw new Error('수집 상태 파일을 읽을 수 없습니다.');}
    const full=args.includes('--full') || !state.completedAt || !state.fullAt || Date.now()-Date.parse(state.fullAt)>7*86400000;
    const since=full ? undefined : new Date(Math.min(Date.now()-14*86400000,Date.parse(state.completedAt!)-2*86400000)).toISOString();
    const posts:Post[]=[]; let after:string|undefined;
    do {
      const page=await threads(`${c.user}/threads`,{fields:'id,text,timestamp,permalink,media_type,is_quote_post,reposted_post,text_attachment',limit:'100',...(since?{since}:{}),...(after?{after}:{})});
      posts.push(...page.data); after=page.paging?.cursors?.after;
      if(!page.paging?.next) after=undefined;
      const collectableCount=new Set(posts.filter(p=>!isRepost(p)).map(p=>p.id)).size;
      if(collectableCount>=1000 && after) throw new Error('초기 수집 상한 1,000개에 도달했습니다. 저장 전 중단했습니다. 기간 분할 수집이 필요합니다.');
    } while(after);
    const unique=[...new Map(posts.map(p=>[p.id,p])).values()];
    const reposts=unique.filter(isRepost).length;
    const collectable=collectablePosts(unique);
    let failed=0, saved=0; const ranked:Array<{title:string;views:number;replies:number}>=[];
    for(const p of collectable) {
      let values;
      try {values=normalizeMetrics((await threads(`${p.id}/insights`,{metric:metrics.join(',')})).data);} catch(e) {if(e instanceof ApiError && [401,403].includes(e.status)) throw e; failed++;}
      if(values && metrics.some(k=>values[k]===null)) failed++;
      if(dry) {saved++; continue;}
      const found=await notion(`data_sources/${c.ds}/query`,'POST',{filter:{property:'Threads ID',rich_text:{equals:p.id}},page_size:2});
      if(found.results.length>1) throw new Error('중복 Threads ID가 있습니다. 자동 쓰기를 중단합니다.');
      const props=properties(p,values);
      let target=found.results[0];
      const content=`${sourceMarker}${sourceText(p)}`;
      if(!target) target=await notion('pages','POST',{parent:{type:'data_source_id',data_source_id:c.ds},properties:props,children:[paragraph(content)]});
      else {
        await notion(`pages/${target.id}`,'PATCH',{properties:props});
        const blocks=await notion(`blocks/${target.id}/children?page_size=100`);
        const source=blocks.results.find((b:any)=>b.type==='paragraph' && b.paragraph.rich_text.map((r:any)=>r.plain_text??r.text?.content??'').join('').startsWith(sourceMarker));
        if(source) await notion(`blocks/${source.id}`,'PATCH',{paragraph:{rich_text:rich(content)}});
        else await notion(`blocks/${target.id}/children`,'PATCH',{children:[paragraph(content)]});
      }
      saved++; if(values && values.views !== null) ranked.push({title:postTitle(p).slice(0,45),views:values.views??0,replies:values.replies??0});
    }
    if(!dry) {
      if(c.summary) {
        ranked.sort((a,b)=>b.views-a.views);
        const best=ranked[0];
         await notion(`blocks/${c.summary}`,'PATCH',{paragraph:{rich_text:rich(`Threads 수집 ${saved}개 · 리포스트 제외 ${reposts}개 · 성과 미확인/일부 누락 ${failed}개. ${best?`이번 수집 범위 조회 최다: 「${best.title}」 ${best.views}회.`:''}\n기준 ${new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} KST. 각 글의 누적값이며 노출 기간은 다릅니다.`)}});
      }
      const next={completedAt:new Date().toISOString(),fullAt:full?new Date().toISOString():state.fullAt};
      await (await open(`${dir}/state.tmp`,'w',0o600)).close();
      const file=await open(`${dir}/state.tmp`,'w'); await file.writeFile(JSON.stringify(next)); await file.close(); await rename(`${dir}/state.tmp`,`${dir}/state.json`);
    }
    console.log(`${dry?'읽기 검증':'동기화'} 완료: ${saved}개, 리포스트 제외 ${reposts}개 · 성과 미확인/일부 누락 ${failed}개. 원문은 로그에 출력하지 않았습니다.`);
  } finally {await lock.close(); await unlink(`${dir}/lock`);}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv[2] || '', process.argv.slice(3)).catch(e=>{console.error(e instanceof ApiError?e.message:e.message || '실행 실패'); process.exitCode=1;});
}
