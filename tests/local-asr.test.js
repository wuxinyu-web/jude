const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../lib/local-asr.js');
const id='BV1bfLwz1Eu4',result={videoId:id,language:'en',source:'local-asr',transcript:[{text:'An object at rest stays at rest.',start:20,duration:4}]};
test('local ASR accepts English audio results with source identity and timestamps',()=>{
 assert.deepEqual(C.validateResult(result,id),result);
 assert.throws(()=>C.validateResult({...result,videoId:id+'_p2'},id),/不匹配/);
 assert.throws(()=>C.validateResult({...result,source:'translated'},id),/不匹配/);
 assert.throws(()=>C.validateResult({...result,language:'zh'},id),/不匹配/);
});
test('malformed, oversized and out-of-order ASR output cannot replace the source',()=>{
 for(const transcript of [[],[{text:'hello',start:-1,duration:3}],[{text:'x',start:0,duration:Infinity}],[{text:'x'.repeat(4001),start:0,duration:1}],[{text:'one',start:4,duration:1},{text:'two',start:2,duration:1}]])assert.throws(()=>C.validateResult({...result,transcript},id));
});
test('Chinese captions are aligned by overlapping time spans, never rewritten as English',()=>{
 const source=[{text:'第一句',start:20,duration:3},{text:'第二句',start:23,duration:3},{text:'后面的句子',start:40,duration:2}];
 assert.equal(C.alignChinese({start:20,duration:6},source),'第一句 第二句');
 assert.equal(C.alignChinese({start:26,duration:10},source),'');
});
