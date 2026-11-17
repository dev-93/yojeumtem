import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetrics, properties, chunks, postTitle, isRepost } from '../src/core.ts';
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
