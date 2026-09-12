const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../lib/immersive.js');
test('immersive cues follow raw timestamps and clear gaps, not inferred translations',()=>{const a=[{start:2,duration:3,text:'First.'},{start:9,duration:4,text:'Second.'}];assert.equal(C.cueAt(a,1),null);assert.equal(C.cueAt(a,2),a[0]);assert.equal(C.cueAt(a,5),null);assert.equal(C.cueAt(a,9),a[1]);assert.equal(C.cueAt(a,13),null);assert.equal(C.cueAt(a,NaN),null);assert.equal(C.cueAt([],1),null);});
test('immersive word targets preserve apostrophes, hyphens and abbreviations',()=>{assert.deepEqual(C.tokens("It's well-known in the U.S., isn't it?").map(w=>w.term),["It's","well-known","in","the","U.S.","isn't","it"]);});
