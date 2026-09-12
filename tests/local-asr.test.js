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

test('partial original-audio results retain the incomplete marker',()=>{const r={videoId:'BV1bfLwz1Eu4',language:'en',source:'local-asr',partial:true,transcript:[{text:'Hello.',start:0,duration:2}]};assert.equal(C.validateResult(r,r.videoId).partial,true);});

test('first English buffer requires 20 captions, except completed short videos and existing English updates',()=>{assert.equal(C.readyToApply({partial:true,transcript:Array(19)}),false);assert.equal(C.readyToApply({partial:true,transcript:Array(20)}),true);assert.equal(C.readyToApply({partial:false,transcript:Array(3)}),true);assert.equal(C.readyToApply({partial:true,transcript:Array(3)},true),true);});

test('movie ASR accepts timestamps beyond 90 minutes but rejects over three hours',()=>{
 assert.equal(C.validateResult({...result,transcript:[{text:'The end.',start:6790,duration:10}]},id).transcript[0].start,6790);
 assert.throws(()=>C.validateResult({...result,transcript:[{text:'Too long.',start:10805,duration:2}]},id));
});

test('sentence Chinese does not repeat a broad native paragraph under shorter English rows',()=>{
 const broad=[{start:0,duration:30,text:'多个句子组成的一大段中文'}];
 assert.equal(C.alignChineseSentence({start:4,duration:5},broad),'');
 assert.equal(C.alignChineseSentence({start:0,duration:4},[{start:0,duration:4,text:'这一句对应的中文'}]),'这一句对应的中文');
});
