import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const run=(args:string[])=>spawnSync(process.execPath,['--experimental-strip-types','src/cli.ts',...args],{encoding:'utf8',env:{PATH:process.env.PATH}});
test('인증이 없으면 실제 API 호출 전에 중단한다',()=>{
 const result=run(['doctor']); assert.equal(result.status,1);
 assert.match(result.stderr,/THREADS_ACCESS_TOKEN 설정이 필요/);
});
test('잘못된 명령은 실행하지 않는다',()=>{
 const result=run(['publish']); assert.equal(result.status,1); assert.match(result.stderr,/명령:/);
});
