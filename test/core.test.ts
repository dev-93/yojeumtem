import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetrics, properties, chunks, postTitle, isRepost, collectablePosts, sourceText, schemaProblems, metrics } from '../src/core.ts';
test('0과 미제공 지표를 구분한다',()=>{
 const data=normalizeMetrics([{name:'views',values:[{value:0}]}]);
 assert.equal(data.views,0); assert.equal(data.likes,null);
});
test('성과 요청 실패는 이전 성과·관측시각을 덮어쓰지 않는다',()=>{
 const p=properties({id:'1',timestamp:'2026-11-17T00:00:00Z'});
 assert.equal('views' in p,false); assert.equal('마지막 수집' in p,false);
 assert.equal('직접 메모' in p,false);
});
test('유니코드 분할 후 본문이 동일하다',()=>{
 const original='😀가'.repeat(3000);assert.equal(chunks(original).join(''),original);
 assert.ok(chunks(original).every(x=>x.length<=1800));
});

test('간소화한 속성과 Status 형식으로 저장한다',()=>{
 const p=properties({id:'1',timestamp:'2026-11-17T00:00:00Z'},normalizeMetrics([{name:'views',values:[{value:0}]}]));
 assert.deepEqual(p['수집 상태'],{status:{name:'일부 지표 미확인'}});
 assert.ok('마지막 수집' in p);
 for(const k of ['계정 ID','유형','원문 구분','본문 확인 시각','성과 관측 시각']) assert.equal(k in p,false);
});

test('본문 없는 리포스트를 사진·영상으로 표시하지 않는다',()=>{
 const p={id:'1',timestamp:'2026-11-17T00:00:00Z',text:'',media_type:'REPOST_FACADE',reposted_post:null};
 assert.equal(isRepost(p),true);assert.equal(postTitle(p),'[리포스트 · 성과 미제공]');
 assert.equal(postTitle({...p,media_type:'IMAGE'}),'[사진 · 본문 없음]');
});

test('Threads 채널은 설정하고 수동 속성과 제휴링크 Relation은 갱신 payload에서 건드리지 않는다',()=>{
 const p=properties({id:'1',timestamp:'2026-11-17T00:00:00Z'});
 assert.deepEqual(p['채널'],{select:{name:'Threads'}});
 for(const key of ['제휴링크','제작 방식','정보태그 조회','영상 길이(초)']) assert.equal(key in p,false);
 assert.deepEqual(properties({id:'2',timestamp:'2026-11-17T00:00:00Z'})['채널'],{select:{name:'Threads'}});
});

test('원문 블록에는 객체가 아닌 Threads 게시물 텍스트를 선택한다',()=>{
 const text='본문 😀 여러 줄\n두 번째 줄';
 assert.equal(sourceText({id:'1',timestamp:'2026-11-17T00:00:00Z',text}),text);
 assert.equal(sourceText({id:'2',timestamp:'2026-11-17T00:00:00Z',text_attachment:{plain_text:text}}),text);
 assert.equal(sourceText({id:'3',timestamp:'2026-11-17T00:00:00Z',text_attachment:{text:{content:text}}}),text);
 assert.equal(sourceText({id:'4',timestamp:'2026-11-17T00:00:00Z',text_attachment:[{plain_text:'첫 줄'},{text:'둘째 줄'}]}),'첫 줄\n둘째 줄');
});

test('콘텐츠 DB 필수 속성과 신규 속성 타입 및 Threads Select 옵션을 확인한다',()=>{
 const schema:Record<string,any>={'게시글':{type:'title'},'Threads ID':{type:'rich_text'},'원문 URL':{type:'url'},'게시 시각':{type:'date'},'마지막 수집':{type:'date'},'수집 상태':{type:'status',status:{options:[{name:'정상'},{name:'일부 지표 미확인'}]}},'채널':{type:'select',select:{options:[{name:'Threads'}]}},'제휴링크':{type:'relation'},'제작 방식':{type:'select'},'정보태그 조회':{type:'number'},'영상 길이(초)':{type:'number'}};
 for(const key of metrics) schema[key]={type:'number'};
 assert.deepEqual(schemaProblems(schema),[]);
 delete schema['Threads ID']; schema['채널'].select.options=[];
 assert.ok(schemaProblems(schema).some(problem=>problem.includes('Threads ID: 속성 누락')));
 assert.ok(schemaProblems(schema).some(problem=>problem.includes('옵션 Threads 누락')));
});

test('리포스트 식별은 유지하고 수집 대상에서 걸러낼 수 있다',()=>{
 const repost={id:'1',timestamp:'2026-11-17T00:00:00Z',media_type:'REPOST_FACADE'};
 const original={id:'2',timestamp:'2026-11-17T00:00:00Z',media_type:'TEXT_POST',is_quote_post:true};
 assert.equal(isRepost(repost),true);
 assert.equal(isRepost(original),false);
 assert.deepEqual(collectablePosts([repost,original]),[original]);
});
