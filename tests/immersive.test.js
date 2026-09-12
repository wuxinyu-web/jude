const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../lib/immersive.js');
test('immersive cues follow raw timestamps and clear gaps, not inferred translations',()=>{const a=[{start:2,duration:3,text:'First.'},{start:9,duration:4,text:'Second.'}];assert.equal(C.cueAt(a,1),null);assert.equal(C.cueAt(a,2),a[0]);assert.equal(C.cueAt(a,5),null);assert.equal(C.cueAt(a,9),a[1]);assert.equal(C.cueAt(a,13),null);assert.equal(C.cueAt(a,NaN),null);assert.equal(C.cueAt([],1),null);});
test('immersive word targets preserve apostrophes, hyphens and abbreviations',()=>{assert.deepEqual(C.tokens("It's well-known in the U.S., isn't it?").map(w=>w.term),["It's","well-known","in","the","U.S.","isn't","it"]);});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('immersive translations serialize requests, discard queued stale cues and retain cache',async()=>{
  const calls=[],resolvers=[];const q=C.translationQueue(value=>{calls.push(value);return new Promise(r=>resolvers.push(r));},()=>{});
  q.ensure('video1:a','a');q.ensure('video1:b','b');q.ensure('video2:c','c');
  assert.deepEqual(calls,['a']);assert.equal(q.get('video1:b'),undefined);
  resolvers.shift()('甲');await tick();assert.deepEqual(calls,['a','c']);
  resolvers.shift()('丙');await tick();assert.equal(q.get('video2:c').text,'丙');assert.equal(q.get('video1:a').text,'甲');
  q.ensure('video2:c','c');assert.equal(calls.length,2);
});
test('immersive translation failure remains explicit until retry, never fabricates a translation',async()=>{
  let calls=0;const q=C.translationQueue(async()=>{if(++calls===1)throw new Error('配置密钥后重试');return '重试成功';},()=>{});
  q.ensure('a','hello');await tick();assert.equal(q.get('a').error,'配置密钥后重试');q.ensure('a','hello');assert.equal(calls,1);
  q.retry('a','hello');await tick();assert.equal(q.get('a').text,'重试成功');
});
