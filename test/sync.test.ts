import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import { metrics, sourceMarker } from '../src/core.ts';
import type { request } from '../src/http.ts';

const userId='test-user';
const post={id:'post-1',text:'테스트 Threads 본문 😀',timestamp:'2026-11-23T00:00:00Z',permalink:'https://threads.example/post-1',media_type:'TEXT_POST'};
const repost={id:'repost-1',text:'리포스트는 제외',timestamp:'2026-11-22T00:00:00Z',media_type:'REPOST_FACADE'};
const values=metrics.map(name=>({name,values:[{value:name==='views'?60:1}]}));

function mockApi(seed?:{id:string;blocks:any[]}, options:{childDatabaseTitle?:string;dataSource?:boolean;schema?:Record<string,any>}={}) {
  const pages=new Map<string,{id:string;properties:any;blocks:any[]}>();
  if(seed) pages.set(post.id,{id:seed.id,properties:{'제휴링크':{relation:[{id:'affiliate-1'}]},'제작 방식':{select:{name:'수동'}}},blocks:seed.blocks});
  const calls:Array<{url:string;method:string;body:any}> = [];
  const summaryUpdates:any[]=[];
  let nextPage=0;
  const fakeRequest=(async(url:URL,method='GET',body?:unknown)=>{
    const pathname=url.pathname;
    const parsedBody=body as any;
    calls.push({url:url.toString(),method,body:parsedBody});
    if(url.hostname==='graph.threads.com') {
      if(pathname.endsWith('/me')) return {id:userId,username:'test'};
      if(pathname.endsWith('/threads')) return {data:[post,repost]};
      if(pathname.endsWith('/post-1/insights')) return {data:values};
      if(pathname.endsWith('/repost-1/insights')) throw new Error('Repost insights must not be requested');
      throw new Error(`Unexpected Threads request ${pathname}`);
    }
    if(url.hostname!=='api.notion.com') throw new Error(`Unexpected host ${url.hostname}`);
    if(pathname==='/v1/data_sources/ds' && options.dataSource) return {properties:options.schema ?? validSchema()};
    if(pathname==='/v1/pages/parent' && method==='GET') return {id:'parent'};
    if(pathname==='/v1/blocks/parent/children' && options.childDatabaseTitle) return {results:[{type:'child_database',id:'existing-db',child_database:{title:options.childDatabaseTitle}}],has_more:false};
    if(pathname==='/v1/data_sources/ds/query') {
      const id=parsedBody.filter.property==='Threads ID' ? parsedBody.filter.rich_text.equals : '';
      const page=pages.get(id);
      return {results:page?[{id:page.id,properties:page.properties}]:[]};
    }
    if(pathname==='/v1/pages' && method==='POST') {
      const id=`created-${++nextPage}`;
      const page={id,properties:parsedBody.properties,blocks:parsedBody.children.map((block:any,index:number)=>({id:`block-${id}-${index}`,type:'paragraph',paragraph:block.paragraph}))};
      const threadId=parsedBody.properties['Threads ID'].rich_text.map((x:any)=>x.text.content).join('');
      pages.set(threadId,page);
      return {id};
    }
    const pageMatch=pathname.match(/^\/v1\/pages\/([^/]+)$/);
    if(pageMatch && method==='PATCH') {
      const page=[...pages.values()].find(x=>x.id===pageMatch[1]);
      assert.ok(page,'Expected existing page to patch');
      page.properties={...page.properties,...parsedBody.properties};
      return {id:page.id};
    }
    const blocksMatch=pathname.match(/^\/v1\/blocks\/([^/]+)\/children$/);
    if(blocksMatch && method==='GET') {
      const page=[...pages.values()].find(x=>x.id===blocksMatch[1]);
      return {results:page?.blocks ?? []};
    }
    const blockMatch=pathname.match(/^\/v1\/blocks\/([^/]+)$/);
    if(blockMatch && method==='PATCH') {
      if(blockMatch[1]==='summary') {summaryUpdates.push(parsedBody);return {id:'summary'};}
      for(const page of pages.values()) {
        const block=page.blocks.find(x=>x.id===blockMatch[1]);
        if(block) {block.paragraph=parsedBody.paragraph;return {id:block.id};}
      }
      throw new Error(`Unknown block ${blockMatch[1]}`);
    }
    if(blocksMatch && method==='PATCH') return {results:[]};
    throw new Error(`Unexpected Notion request ${method} ${pathname}`);
  }) as typeof request;
  return {fakeRequest,pages,calls,summaryUpdates};
}

function validSchema() {
  const properties:Record<string,any>={'게시글':{type:'title'},'Threads ID':{type:'rich_text'},'원문 URL':{type:'url'},'게시 시각':{type:'date'},'마지막 수집':{type:'date'},'수집 상태':{type:'status',status:{options:[{name:'정상'},{name:'일부 지표 미확인'}]}},'채널':{type:'select',select:{options:[{name:'Threads'},{name:'인스타 릴스'},{name:'네이버 클립'},{name:'네이버 블로그'}]}},'제휴링크':{type:'relation'},'제작 방식':{type:'select'},'정보태그 조회':{type:'number'},'영상 길이(초)':{type:'number'}};
  for(const name of metrics) properties[name]={type:'number'};
  return properties;
}

async function withConfig<T>(action:()=>Promise<T>):Promise<T> {
  const keys=['THREADS_ACCESS_TOKEN','THREADS_USER_ID','NOTION_TOKEN','NOTION_PARENT_PAGE_ID','NOTION_DATA_SOURCE_ID','NOTION_SUMMARY_BLOCK_ID','THREADS_SYNC_STATE_DIR','THREADS_SYNC_ENV_FILE'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const dir=await mkdtemp(join(tmpdir(),'yojeumtem-sync-test-'));
  Object.assign(process.env,{THREADS_ACCESS_TOKEN:'test-token',THREADS_USER_ID:userId,NOTION_TOKEN:'test-notion-token',NOTION_PARENT_PAGE_ID:'parent',NOTION_DATA_SOURCE_ID:'ds',NOTION_SUMMARY_BLOCK_ID:'summary',THREADS_SYNC_STATE_DIR:dir});
  delete process.env.THREADS_SYNC_ENV_FILE;
  try {return await action();}
  finally {
    await rm(dir,{recursive:true,force:true});
    for(const key of keys) {
      if(previous[key]===undefined) delete process.env[key];
      else process.env[key]=previous[key];
    }
  }
}

test('sync creates once, then upserts the same Threads ID without touching manual fields or reposts',async()=>withConfig(async()=>{
  const mock=mockApi();
  await run('sync',['--full'],mock.fakeRequest);
  await run('sync',['--full'],mock.fakeRequest);

  const creates=mock.calls.filter(call=>call.url==='https://api.notion.com/v1/pages' && call.method==='POST');
  assert.equal(creates.length,1,'Repeated sync must not create a duplicate row');
  const created=creates[0]!.body;
  assert.deepEqual(created.properties['채널'],{select:{name:'Threads'}});
  assert.equal(created.properties.views.number,60);
  assert.equal(created.properties.likes.number,1);
  assert.equal('제휴링크' in created.properties,false);
  assert.equal('제작 방식' in created.properties,false);
  const createdText=created.children[0].paragraph.rich_text.map((part:any)=>part.text.content).join('');
  assert.equal(createdText,`${sourceMarker}${post.text}`);

  const updates=mock.calls.filter(call=>/^https:\/\/api\.notion\.com\/v1\/pages\/created-1$/.test(call.url) && call.method==='PATCH');
  assert.equal(updates.length,1,'Second sync should update the existing row');
  assert.equal('제휴링크' in updates[0]!.body.properties,false);
  assert.equal('제작 방식' in updates[0]!.body.properties,false);
  assert.equal(mock.calls.filter(call=>call.url.includes('/repost-1/insights')).length,0);
  assert.equal(mock.calls.filter(call=>call.url.endsWith('/data_sources/ds/query') && call.body.filter.rich_text.equals===repost.id).length,0);
  assert.equal(mock.summaryUpdates.length,2);
  for(const update of mock.summaryUpdates) {
    const summary=update.paragraph.rich_text.map((part:any)=>part.text.content).join('');
    assert.match(summary,/Threads 수집 1개/);
    assert.match(summary,/리포스트 제외 1개/);
    assert.doesNotMatch(summary,/인스타 릴스|네이버 클립|네이버 블로그/);
  }
}));

test('sync replaces a legacy JSON source block with text and leaves manual properties out of the patch',async()=>withConfig(async()=>{
  const legacy=JSON.stringify({text:post.text,text_attachment:null,media_type:'TEXT_POST',is_quote_post:false,reposted_post:null});
  const mock=mockApi({id:'existing-page',blocks:[{id:'legacy-source',type:'paragraph',paragraph:{rich_text:[{plain_text:`${sourceMarker}${legacy}`}]}}]});
  await run('sync',['--full'],mock.fakeRequest);

  const propsPatch=mock.calls.find(call=>call.url==='https://api.notion.com/v1/pages/existing-page' && call.method==='PATCH');
  assert.ok(propsPatch);
  assert.equal('제휴링크' in propsPatch.body.properties,false);
  assert.equal('제작 방식' in propsPatch.body.properties,false);
  assert.deepEqual(propsPatch.body.properties['채널'],{select:{name:'Threads'}});
  const blockPatch=mock.calls.find(call=>call.url==='https://api.notion.com/v1/blocks/legacy-source' && call.method==='PATCH');
  assert.ok(blockPatch);
  const text=blockPatch.body.paragraph.rich_text.map((part:any)=>part.text.content).join('');
  assert.equal(text,`${sourceMarker}${post.text}`);
  assert.equal(text.includes('text_attachment'),false);
  assert.equal(mock.calls.filter(call=>call.url==='https://api.notion.com/v1/pages' && call.method==='POST').length,0);
  const saved=mock.pages.get(post.id);
  assert.deepEqual(saved?.properties['제휴링크'],{relation:[{id:'affiliate-1'}]});
  assert.deepEqual(saved?.properties['제작 방식'],{select:{name:'수동'}});
}));

test('setup validates and reuses the configured Data Source without creating a database or summary block',async()=>withConfig(async()=>{
  const mock=mockApi(undefined,{dataSource:true});
  await run('setup',[],mock.fakeRequest);
  assert.equal(mock.calls.filter(call=>call.method==='POST').length,0);
  assert.equal(mock.calls.filter(call=>call.url==='https://api.notion.com/v1/data_sources/ds').length,1);
  assert.equal(mock.summaryUpdates.length,0);
}));

test('setup refuses to create a database when either legacy or renamed DB already exists',async()=>withConfig(async()=>{
  for(const title of ['Threads 게시글','콘텐츠 DB']) {
    delete process.env.NOTION_DATA_SOURCE_ID;
    const mock=mockApi(undefined,{childDatabaseTitle:title});
    await assert.rejects(run('setup',[],mock.fakeRequest),/기존 DB.*생성하지 않았습니다/);
    assert.equal(mock.calls.filter(call=>call.method==='POST').length,0);
    assert.equal(mock.calls.some(call=>call.url==='https://api.notion.com/v1/databases'),false);
    process.env.NOTION_DATA_SOURCE_ID='ds';
  }
}));

test('doctor rejects a content DB whose Threads channel option is missing',async()=>withConfig(async()=>{
  const schema=validSchema();
  schema['채널'].select.options=schema['채널'].select.options.filter((option:any)=>option.name!=='Threads');
  const mock=mockApi(undefined,{dataSource:true,schema});
  await assert.rejects(run('doctor',[],mock.fakeRequest),/채널: Select 옵션 Threads 누락/);
}));
