const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../lib/challenge-core'),W=require('../lib/challenge-worker');
const source=[{start:0,duration:5,text:'This perspective will help you figure out the answer.'},{start:5,duration:5,text:'A reliable friend will look after your family.'}];
const questions=[{kind:'word',prompt:'观点；看法',answer:'perspective',accepted:['viewpoint'],start:0},{kind:'phrase',prompt:'弄清楚；想明白',answer:'figure out',accepted:['work out'],start:0}];
function fixture(){let time=10000000000,env={videoId:'BV1xx411c7mD',foreground:true},calls=0,reply={questions};const data={};const storage={get:async k=>({[k]:structuredClone(data[k])}),set:async x=>Object.assign(data,structuredClone(x))};const ai=async()=>{calls++;if(reply instanceof Error)throw reply;return {text:JSON.stringify(reply)};};const create=()=>W.create({storage,ai,loadPrompt:async()=>'',environment:async()=>env,now:()=>time});const service=create();return {service,create,data,setReply:r=>reply=r,setEnv:e=>env=e,advance:n=>time+=n,calls:()=>calls};}
async function started(f){await f.service.command({command:'start',tabId:1,videoId:'BV1xx411c7mD',videoTitle:'本集'});const s=(await f.service.get()).session;await f.service.command({command:'source',sessionId:s.id,videoId:s.videoId,tabId:1,cues:source});return s;}
async function watch(f){for(let n=0;n<=4;n++){f.advance(1000);await f.service.pulse({documentId:'doc',position:n,playing:true,visible:true,online:true,buffering:false,seeking:false},1);}}
test('grounded Chinese-only distinct questions and category-specific pass thresholds',()=>{
 const qs=C.validateQuestions({questions:[...questions,questions[0],{...questions[0],answer:'invented'},{...questions[1],prompt:'figure out 是什么'}]},source);assert.equal(qs.length,2);assert.throws(()=>C.validateQuestions({questions:[{...questions[0],answer:'invented'}]},source));
 const full=[...Array.from({length:8},(_,i)=>({id:'w'+i,kind:'word'})),...Array.from({length:4},(_,i)=>({id:'p'+i,kind:'phrase'}))];let results=Object.fromEntries(full.slice(0,8).map(q=>[q.id,{correct:true}]));assert.equal(C.score(full,results).passed,false);for(let i=0;i<3;i++)results['p'+i]={correct:true};assert.equal(C.score(full,results).passed,true);
});
test('starts opt-in, records real playback intervals and excludes background, seek, reload, competing tab and sleep',async()=>{
 const f=fixture();assert.equal((await f.service.get()).session,null);await started(f);await watch(f);let s=(await f.service.get()).session;assert.equal(s.watchedSeconds,4);
 await f.service.pulse({documentId:'doc',position:500,playing:true,visible:true,online:true},2);f.advance(1000);await f.service.pulse({documentId:'doc',position:500,playing:true,visible:true,online:true,seeking:true},1);assert.equal((await f.service.get()).session.watchedSeconds,4);
 f.advance(1000);await f.service.pulse({documentId:'doc',position:501,playing:true,visible:false,online:true},1);f.advance(120000);await f.service.pulse({documentId:'doc2',position:505,playing:true,visible:true,online:true},1);assert.equal((await f.service.get()).session.watchedSeconds,4);
 const restored=f.create();assert.equal((await restored.get()).session.needsResume,true);f.advance(1000);await restored.pulse({documentId:'doc2',position:506,playing:true,visible:true,online:true},1);assert.equal((await restored.get()).session.watchedSeconds,4);
 await restored.command({command:'resume',sessionId:s.id,tabId:1});assert.equal((await restored.get()).session.needsResume,false);
});
test('empty collection supplements from watched cues, caches paper, accepts synonyms and releases gate after pass',async()=>{
 const f=fixture(),s=await started(f);await watch(f);await f.service.generate({sessionId:s.id});let current=(await f.service.get()).session;assert.equal(current.questions.length,2);assert.equal(current.questions[0].answer,undefined);await f.service.generate({sessionId:s.id});assert.equal(f.calls(),1);
 const gate=await f.service.pulse({position:4,documentId:'doc',visible:true,online:true},1);assert.equal(gate.gate.blocked,true);
 await f.service.submit({sessionId:s.id,answers:{q1:'Viewpoint',q2:'work out'}});current=(await f.service.get()).session;assert.equal(current.status,'passed');assert.equal(current.attempts.length,1);assert.equal(f.calls(),1);assert.equal((await f.service.pulse({},1)).gate,null);
});
test('failed first attempt, preserved draft, wrong-only resit, original score remains unchanged',async()=>{
 const f=fixture(),s=await started(f);await watch(f);await f.service.generate({sessionId:s.id});await f.service.command({command:'draft',sessionId:s.id,answers:{q1:'wrong',q2:'figure out'}});assert.equal((await f.service.get()).session.draft.q1,'wrong');
 f.setReply({results:[{id:'q1',correct:false,feedback:'含义不符'}]});await f.service.submit({sessionId:s.id,answers:{q1:'wrong',q2:'figure out'}});let v=(await f.service.get()).session;assert.equal(v.status,'retry');assert.equal(v.attempts[0].score.word.correct,0);
 await f.service.submit({sessionId:s.id,answers:{q1:'perspective'}});v=(await f.service.get()).session;assert.equal(v.status,'passed');assert.equal(v.attempts.length,2);assert.equal(v.attempts[0].score.word.correct,0);
 await assert.rejects(f.service.submit({sessionId:s.id,answers:{q1:'perspective'}}));assert.equal((await f.service.get()).session.attempts.length,2);
});
test('no subtitles, generation failure, uncertain grading and exit never fabricate results',async()=>{
 const f=fixture(),s=await started(f);await assert.rejects(f.service.generate({sessionId:s.id}),/已观看/);assert.equal(f.calls(),0);await watch(f);f.setReply(Error('offline'));await assert.rejects(f.service.generate({sessionId:s.id}));assert.equal((await f.service.get()).session.status,'watching');
 f.setReply({questions});await f.service.generate({sessionId:s.id});f.setReply({results:[{id:'q1',correct:null}]});await assert.rejects(f.service.submit({sessionId:s.id,answers:{q1:'uncertain',q2:'figure out'}}));assert.equal((await f.service.get()).session.attempts.length,0);
 await f.service.command({command:'exit',sessionId:s.id});assert.equal((await f.service.get()).session.status,'exited');assert.equal((await f.service.pulse({},1)).gate,null);
});
test('video change blocks enrolled tab; clear and 90-day retention leave collections intact',async()=>{
 const f=fixture(),s=await started(f);f.data.ytd_vocabulary=[{term:'kept'}];f.setEnv({videoId:'BV2xx411c7mD',foreground:true});assert.equal((await f.service.pulse({},1)).gate.blocked,true);await assert.rejects(f.service.command({command:'resume',sessionId:s.id,tabId:1}));
 await f.service.clear();assert.equal((await f.service.get()).session,null);assert.equal(f.data.ytd_vocabulary[0].term,'kept');assert.equal(C.clean({sessions:[{schemaVersion:1,createdAt:0}]},100*86400000).sessions.length,0);
});
test('exiting while provider is pending prevents late paper resurrection',async()=>{
 let release;const f=fixture(),s=await started(f);await watch(f);
 const storage={get:async k=>({[k]:structuredClone(f.data[k])}),set:async x=>Object.assign(f.data,structuredClone(x))};
 const service=W.create({storage,ai:()=>new Promise(r=>release=r),loadPrompt:async()=>'',environment:async()=>({videoId:s.videoId,foreground:true}),now:()=>10000010000});
 const pending=service.generate({sessionId:s.id});while(!release)await new Promise(r=>setImmediate(r));await service.command({command:'exit',sessionId:s.id});release({text:JSON.stringify({questions})});await pending;assert.equal((await service.get()).session.status,'exited');assert.equal((await service.get()).session.questions.length,0);
});

test('buffering, offline, duplicate samples and 2x playback preserve unique coverage',async()=>{
 const f=fixture();await started(f);const pulse=(position,extra={})=>f.service.pulse({documentId:'d',position,visible:true,playing:true,online:true,...extra},1);
 await pulse(0);f.advance(1000);await pulse(2);await pulse(2);assert.equal((await f.service.get()).session.watchedSeconds,2);
 f.advance(1000);await pulse(4,{buffering:true});f.advance(1000);await pulse(6,{online:false});f.advance(1000);await pulse(8);assert.equal((await f.service.get()).session.watchedSeconds,2);
 f.advance(1000);await pulse(10);assert.equal((await f.service.get()).session.watchedSeconds,4);
});
test('restored quiz and typed answers are reused, with no repeated generation call',async()=>{
 const f=fixture(),s=await started(f);await watch(f);await f.service.generate({sessionId:s.id});await f.service.command({command:'draft',sessionId:s.id,answers:{q1:'viewpoint',q2:'figure out'}});
 const restored=f.create();assert.equal((await restored.get()).session.draft.q1,'viewpoint');await restored.generate({sessionId:s.id});assert.equal(f.calls(),1);assert.equal((await restored.exportData()).sessions.length,1);
});

test('rewatch clears episode-end gate without stale ended sample re-locking it',async()=>{
 const f=fixture(),s=await started(f);await watch(f);assert.equal((await f.service.pulse({ended:true,position:5},1)).gate.blocked,true);
 await f.service.command({command:'rewatch',sessionId:s.id});const r=await f.service.pulse({ended:true,position:5},1);assert.equal(r.gate.blocked,false);assert.ok(r.gate.rewatchToken);
});

test('classroom tests reject offensive context, clues and alternatives without substring false positives',()=>{
 assert.equal(C.classroomSafe('We assess the classic assignment.'),true);
 for(const text of ['Fuck that.', '色情内容', 'sexual innuendo', 'a naked person']) assert.equal(C.classroomSafe(text),false);
 assert.equal(C.cues([{start:0,duration:2,text:'This fucking perspective helps.'}]).length,0);
 const unsafe=[{...questions[0],explanation:'下流的含义'},{...questions[0],accepted:['shit']},{...questions[0],prompt:'色情观点'}];
 assert.throws(()=>C.validateQuestions({questions:unsafe},source));
 assert.throws(()=>C.validateQuestions({questions:[questions[0]]},[{...source[0],text:'This fucking perspective helps.'}]));
 assert.equal(C.validateQuestions({questions:[...unsafe,...questions]},source).length,2);
});

async function parentStarted(f){
 const r=await f.service.parentCommand({command:'setup',tabId:1});assert.match(r.pin,/^\d{9}$/);
 await f.service.parentCommand({command:'activate',tabId:1,videoId:'BV1xx411c7mD',pin:r.pin});
 return {pin:r.pin,s:(await f.service.get()).session};
}
const parentWords=['reliable','efficient','perspective','approach','consider','maintain','improve','confident','essential','accurate'];
const parentSources=parentWords.map((w,i)=>({start:i*5,duration:5,text:`We consider ${w} a useful expression for this lesson.`}));
const parentQuestions=[...parentWords.map((w,i)=>({kind:'word',prompt:`词汇释义第${i+1}项`,answer:w,start:i*5})),...parentSources.slice(0,5).map((s,i)=>({kind:'sentence',prompt:`请翻译中文语境第${i+1}句`,answer:s.text,start:s.start}))];
async function parentQuiz(f){const p=await parentStarted(f);const d=f.data[C.KEY].sessions[0];d.ranges=[[0,50]];d.cues=parentSources;f.setReply({questions:parentQuestions});await f.service.generate({sessionId:p.s.id});return p;}
test('parent key is shown only during setup, stored hashed, required for exit/clear and survives service restart',async()=>{
 const f=fixture(),{pin,s}=await parentStarted(f);
 assert.equal((await f.service.get()).parent.enabled,true);
 assert.equal(JSON.stringify(f.data).includes(pin),false);
 assert.equal(JSON.stringify(await f.service.exportData()).includes('hash'),false);
 assert.equal((await f.create().get()).parent.enabled,true);
 await assert.rejects(f.service.command({command:'exit',sessionId:s.id,tabId:1}),/密钥/);
 await assert.rejects(f.service.command({command:'start',tabId:1,videoId:s.videoId}),/家长模式/);
 await assert.rejects(f.service.clear(),/家长/);
 for(let i=0;i<5;i++)await assert.rejects(f.service.parentCommand({command:'unlock',pin:'wrong'}));
 await assert.rejects(f.service.parentCommand({command:'unlock',pin}),/稍后/);
 f.advance(60001);await f.service.parentCommand({command:'unlock',pin});
 assert.equal((await f.service.get()).parent.enabled,false);assert.equal((await f.service.get()).session.status,'exited');
});
test('parent exam has 10 words and 5 sentences, 8/10 inclusive and no short-paper pass',()=>{
 const qs=C.validateQuestions({questions:parentQuestions},parentSources,{parentMode:true});assert.equal(qs.length,15);
 const results=Object.fromEntries(qs.slice(0,13).map(q=>[q.id,{correct:true}]));
 assert.equal(C.score(qs,results,{parentMode:true}).points,8);assert.equal(C.score(qs,results,{parentMode:true}).passed,true);
 delete results[qs[12].id];assert.equal(C.score(qs,results,{parentMode:true}).passed,false);
 assert.throws(()=>C.validateQuestions({questions:parentQuestions.slice(0,14)},parentSources,{parentMode:true}));
});
test('failed parent test requires reviewing every wrong item and retaking entire paper; no accumulated pass',async()=>{
 const f=fixture(),{s}=await parentQuiz(f);let current=(await f.service.get()).session;
 f.setReply({results:current.questions.map(q=>({id:q.id,correct:false,feedback:'请复习。'}))});
 await f.service.submit({sessionId:s.id,answers:Object.fromEntries(current.questions.map(q=>[q.id,'wrong']))});
 current=(await f.service.get()).session;assert.equal(current.status,'review');assert.equal(current.score.points,0);
 await assert.rejects(f.service.submit({sessionId:s.id,answers:{}}));
 await assert.rejects(f.service.command({command:'retest',sessionId:s.id}),/复习/);
 for(const q of current.questions)await f.service.command({command:'reviewWrong',sessionId:s.id,questionId:q.id,result:'known'});
 await f.service.command({command:'retest',sessionId:s.id});current=(await f.service.get()).session;
 assert.equal(current.status,'quiz');assert.equal(current.questions[0].answer,undefined);assert.equal(current.attempts[0].results,undefined);
 const full=f.data[C.KEY].sessions[0].questions;await f.service.submit({sessionId:s.id,answers:Object.fromEntries(full.map(q=>[q.id,q.answer]))});
 current=(await f.service.get()).session;assert.equal(current.status,'passed');assert.equal(current.score.points,10);assert.equal(current.attempts[0].score.points,0);
});
test('parent mode gates other tabs and automatically enrolls next video after pass',async()=>{
 const f=fixture(),{s}=await parentQuiz(f);
 f.setEnv({videoId:'BVother',foreground:true});let r=await f.service.pulse({position:0,visible:true,online:true},2);assert.equal(r.gate.blocked,true);assert.equal(r.gate.parentMode,true);
 f.data[C.KEY].sessions[0].status='passed';r=await f.service.pulse({position:0,visible:true,online:true,videoTitle:'Next'},2);
 assert.equal(r.gate.videoId,'BVother');const next=(await f.service.get()).session;assert.equal(next.parentMode,true);assert.notEqual(next.id,s.id);
 f.setEnv({videoId:s.videoId,foreground:true});r=await f.service.pulse({position:0},1);assert.equal(r.gate,null);
});
test('collection completion uses distinct current watched terms, requires full viewing, and never reports mastery',async()=>{
 const f=fixture(),{s}=await parentStarted(f),stored=f.data[C.KEY].sessions[0];stored.cues=parentSources;stored.ranges=[[0,50]];
 f.data.ytd_vocabulary=parentWords.map((term,i)=>({id:'w'+i,term,videoId:s.videoId,createdAt:s.createdAt}));
 f.data.ytd_sentences=parentSources.slice(0,5).map((c,i)=>({id:'s'+i,term:c.text,videoId:s.videoId,createdAt:s.createdAt}));
 let r=await f.service.pulse({position:50,duration:100,ended:true},1);assert.equal(r.gate.blocked,true);
 stored.duration=50;r=await f.service.pulse({position:50,duration:50,ended:true},1);assert.equal(r.gate,null);
 const done=(await f.service.get()).session;assert.equal(done.completion,'collection');assert.equal(done.score,undefined);
});

test('parent pending confirmation expires without enabling or exporting credentials',async()=>{
 const f=fixture();const {pin}=await f.service.parentCommand({command:'setup',tabId:1});
 await assert.rejects(f.service.parentCommand({command:'activate',pin:'bad',tabId:1,videoId:'BV1xx411c7mD'}));assert.equal((await f.service.get()).parent.enabled,false);
 f.advance(600001);await assert.rejects(f.service.parentCommand({command:'activate',pin,tabId:1,videoId:'BV1xx411c7mD'}),/过期/);
});
test('parent review replay opens only the selected source range temporarily, retest closes it',async()=>{
 const f=fixture(),{s}=await parentQuiz(f);const stored=f.data[C.KEY].sessions[0];stored.status='review';stored.results={};
 await f.service.command({command:'reviewReplay',sessionId:s.id,questionId:stored.questions[0].id});
 let r=await f.service.pulse({position:1,visible:true,online:true,playing:true},1);assert.equal(r.gate.blocked,false);assert.ok(r.gate.replay);
 r=await f.service.pulse({position:6},1);assert.equal(r.gate.blocked,true);
 f.advance(60001);r=await f.service.pulse({position:1},1);assert.equal(r.gate.blocked,true);assert.equal(r.gate.replay,null);
});
test('parent restriction remains enabled after retention expires; duplicate collections never fill goals',async()=>{
 const f=fixture(),{s}=await parentStarted(f);const stored=f.data[C.KEY].sessions[0];stored.cues=parentSources;stored.ranges=[[0,50]];
 f.data.ytd_vocabulary=Array.from({length:15},(_,i)=>({id:'w'+i,term:'reliable',videoId:s.videoId,createdAt:s.createdAt}));
 f.data.ytd_sentences=[];assert.equal((await f.service.get()).session.collection.words,1);
 f.advance(91*86400000);assert.equal((await f.service.get()).parent.enabled,true);assert.equal((await f.service.get()).session,null);
 const r=await f.service.pulse({position:0,visible:true},1);assert.equal(r.gate.parentMode,true);assert.equal((await f.service.get()).session.parentMode,true);
});

test('confirmed parent switch replaces an active normal challenge and preserves its record',async()=>{
 const f=fixture();const old=await started(f);const {pin}=await f.service.parentCommand({command:'setup',tabId:1});
 assert.equal((await f.service.get()).session.id,old.id);
 await assert.rejects(f.service.parentCommand({command:'activate',tabId:1,videoId:old.videoId,pin}),/普通闯关/);
 await f.service.parentCommand({command:'activate',tabId:1,videoId:old.videoId,pin,replaceChallenge:true});
 const r=await f.service.get();assert.equal(r.parent.enabled,true);assert.equal(r.session.parentMode,true);assert.equal(r.history.find(s=>s.id===old.id).status,'exited');
});

test('parent chooses a confirmed password; hash only and existing nine-digit keys remain compatible',async()=>{
 const f=fixture(),m={command:'setPassword',tabId:1,videoId:'BV1xx411c7mD',pin:'Family-2026!'};
 await assert.rejects(f.service.parentCommand({...m,confirmPin:'different'}),/不一致/);
 assert.equal((await f.service.get()).parent.enabled,false);
 await f.service.parentCommand({...m,confirmPin:m.pin});
 assert.equal((await f.service.get()).parent.enabled,true);assert.equal(JSON.stringify(f.data).includes(m.pin),false);
 await assert.rejects(f.service.parentCommand({command:'unlock',pin:'wrong-password'}),/不正确/);
 await f.create().parentCommand({command:'unlock',pin:m.pin});assert.equal((await f.service.get()).parent.enabled,false);
});
