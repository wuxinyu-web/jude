const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const C=require("../lib/learning-core.js");
const {createServices,KEYS}=require("../lib/learning-worker.js");
const input={term:"The book which she recommended changed my perspective.",videoId:"abcDEF12345",videoTitle:"English lesson",timestamp:62,context:"A reader describes a book.",tabId:7};
const analysis={translationZh:"她推荐的那本书改变了我的看法。",mainClause:"The book changed my perspective. 主语是 the book。",breakdown:"which she recommended 是定语从句，修饰 book。",grammarTags:["定语从句"],expressionTags:["普通表达"]};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(options={}){
  const data=structuredClone(options.data||{});let time=100000;const calls=[];let env={foreground:true,videoId:input.videoId,windowId:3};
  const storage={get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values))};
  const service=createServices({storage,ai:async request=>{calls.push(request);return options.ai?options.ai(request):{text:JSON.stringify(analysis)};},
    loadPrompt:async (file,heading,vars)=>JSON.stringify({file,heading,vars}),validateVocabulary:JSON.parse,now:()=>time,
    environment:async()=>env,control:async s=>calls.push({control:s.status})});
  return {service,data,calls,advance:n=>time+=n,setEnv:e=>env={...env,...e},time:()=>time};
}
test("English hover boundaries keep contractions and hyphenated words intact",()=>{
  assert.equal(C.englishWordAt("It's a well-known fact.",2).term,"It's");
  assert.equal(C.englishWordAt("It's a well-known fact.",12).term,"well-known");
  assert.equal(C.englishWordAt("word, next",4),null);
  assert.equal(C.englishWordAt("The U.S. market",6).term,"U.S.");
  assert.equal(C.englishWordAt("中文",1),null);
});
test("sentence validation preserves short fragments, rejects oversized and invalid origins",()=>{
  const s=C.makeSentence({...input,term:"If only."},100,"s1");assert.equal(s.term,"If only.");assert.equal(s.timestampSeconds,62);assert.match(s.timestampedUrl,/t=62s$/);
  assert.throws(()=>C.makeSentence({...input,term:"a".repeat(4001)},1,"s"));
  assert.throws(()=>C.makeSentence({...input,videoId:'"><script>'},1,"s"));
  assert.throws(()=>C.makeSentence({...input,timestamp:-1},1,"s"));
});
test("AI analyses are bounded plain text and labels come only from known sets",()=>{
  assert.deepEqual(C.validateAnalysis({...analysis,grammarTags:["定语从句","定语从句","malicious"]}).grammarTags,["定语从句"]);
  assert.throws(()=>C.validateAnalysis({...analysis,breakdown:"<img src=x>"}));
  assert.throws(()=>C.validateAnalysis({...analysis,translationZh:""}));
  assert.throws(()=>C.validateAnalysis({...analysis,mainClause:"x".repeat(3001)}));
});
test("filters combine video, tags, query, review and deterministic sorting without mutating data",()=>{
  const items=[{id:"a",term:"Zoo",videoId:"one",createdAt:2,timestampSeconds:30,grammarTags:["定语从句"]},
    {id:"b",term:"apple",videoId:"one",createdAt:3,timestampSeconds:10,grammarTags:["定语从句"]},
    {id:"c",term:"Banana",videoId:"two",createdAt:1,timestampSeconds:1}];
  assert.deepEqual(C.filterEntries(items,{sort:"az"}).map(e=>e.id),["b","c","a"]);
  assert.deepEqual(C.filterEntries(items,{videoId:"one",sort:"video"}).map(e=>e.id),["b","a"]);
  assert.deepEqual(C.filterEntries(items,{grammar:"定语从句",review:"again"},{a:{result:"again"}}).map(e=>e.id),["a"]);
  assert.deepEqual(C.filterEntries(items,{query:"APPLE"}).map(e=>e.id),["b"]);assert.equal(items[0].id,"a");
});
test("multi-label groups intentionally repeat display cards while export deduplicates IDs",()=>{
  const s={id:"s",grammarTags:["定语从句","状语从句"]};const groups=C.groupEntries([s],"grammar");assert.equal(groups.length,2);assert.equal(C.uniqueEntries(groups.flatMap(g=>g[1])).length,1);
  assert.equal(C.groupEntries([{id:"empty"}],"grammar")[0][0],"未分类");
});
test("sentence source is durably saved before any provider request and duplicate clicks do not overwrite it",async()=>{
  const h=harness();const results=await Promise.all([h.service.saveSentence(input),h.service.saveSentence(input)]);
  assert.equal(h.data[KEYS.sentences].length,1);assert.equal(h.calls.length,0);assert.equal(results[1].alreadySaved,true);
  assert.equal(results[0].entry.analysisStatus,"pending");
});
test("capacity rejection preserves all 500 existing sentences and does not call AI",async()=>{
  const entries=Array.from({length:500},(_,i)=>({id:`s${i}`,normalizedTerm:`entry ${i}`}));const h=harness({data:{[KEYS.sentences]:entries}});
  await assert.rejects(h.service.saveSentence(input),/500/);assert.deepEqual(h.data[KEYS.sentences],entries);assert.equal(h.calls.length,0);
});
test("failed analysis preserves source and retry fills validated analysis",async()=>{
  let fail=true;const h=harness({ai:async()=>{if(fail)throw new Error("provider offline");return {text:JSON.stringify(analysis)};}});
  const {entry}=await h.service.saveSentence(input);await assert.rejects(h.service.analyzeSentence(entry.id));
  assert.equal(h.data[KEYS.sentences][0].term,input.term);assert.equal(h.data[KEYS.sentences][0].analysisStatus,"error");
  fail=false;await h.service.analyzeSentence(entry.id);assert.equal(h.data[KEYS.sentences][0].analysisStatus,"ready");
});
test("deletion during analysis cannot resurrect a sentence; duplicate analyses share one request",async()=>{
  const gate=deferred(),started=deferred();const h=harness({ai:async()=>{started.resolve();return gate.promise;}});
  const {entry}=await h.service.saveSentence(input);const a=h.service.analyzeSentence(entry.id),b=h.service.analyzeSentence(entry.id);await started.promise;
  await h.service.deleteSentence(entry.id);gate.resolve({text:JSON.stringify(analysis)});await Promise.all([a,b]);
  assert.deepEqual(h.data[KEYS.sentences],[]);assert.equal(h.calls.length,1);
});
test("manually edited tags win over an in-flight AI analysis",async()=>{
  const gate=deferred(),started=deferred();const h=harness({ai:async()=>{started.resolve();return gate.promise;}});
  const {entry}=await h.service.saveSentence(input);const job=h.service.analyzeSentence(entry.id);await started.promise;
  await h.service.editSentence({id:entry.id,grammarTags:["其他"],expressionTags:["俚语"]});gate.resolve({text:JSON.stringify(analysis)});await job;
  assert.deepEqual(h.data[KEYS.sentences][0].grammarTags,["其他"]);assert.deepEqual(h.data[KEYS.sentences][0].expressionTags,["俚语"]);
});
test("lookup cache separates context, deduplicates in-flight calls and does not persist before collection",async()=>{
  const h=harness({ai:async()=>({text:JSON.stringify({meaningZh:"含义",explanationZh:"语境",phonetic:""})})});
  await Promise.all([h.service.lookupVocabulary(input),h.service.lookupVocabulary(input)]);await h.service.lookupVocabulary(input);assert.equal(h.calls.length,1);
  await h.service.lookupVocabulary({...input,context:"A different context."});assert.equal(h.calls.length,2);assert.deepEqual(h.data,{});
});
test("lookup concurrency is bounded and failures are retryable rather than cached",async()=>{
  const gate=deferred();let fail=true;const h=harness({ai:async()=>{await gate.promise;if(fail)throw new Error("offline");return {text:'{"meaningZh":"词义"}'};}});
  const a=h.service.lookupVocabulary({...input,term:"a"}),b=h.service.lookupVocabulary({...input,term:"b"});
  await assert.rejects(h.service.lookupVocabulary({...input,term:"c"}),/正在查询/);gate.resolve();await Promise.allSettled([a,b]);fail=false;
  await h.service.lookupVocabulary({...input,term:"a"});assert.equal(h.calls.length,3);
});
test("review updates are separate from legacy vocabulary and reject missing IDs",async()=>{
  const legacy={id:"old",term:"old word",unknownField:"keep"};const h=harness({data:{ytd_vocabulary:[legacy]}});
  await h.service.markReview({id:"old",result:"again"});assert.deepEqual(h.data.ytd_vocabulary,[legacy]);assert.equal(h.data[KEYS.reviews].old.result,"again");
  await assert.rejects(h.service.markReview({id:"gone",result:"known"}));
});
const sample={foreground:true,videoId:input.videoId,playing:true,buffering:false,seeking:false,activityActive:false,reviewActive:false};
test("study ticks use elapsed real time, ignore playback speed and seeking jumps, and exclude inactive samples",()=>{
  let s=C.makeSession(input,0,"s");s=C.tickSession(s,{...sample,currentTime:10,playbackRate:2},1000,"boot");
  s=C.tickSession(s,{...sample,currentTime:900,playbackRate:2},3000,"boot");assert.equal(s.watchMs,2000);
  for(const invalid of [{foreground:false},{buffering:true},{seeking:true},{videoId:"other"},{playing:false}]){
    s=C.tickSession(s,{...sample,...invalid},4000,"boot");s=C.tickSession(s,{...sample,...invalid},6000,"boot");assert.equal(s.watchMs,2000);
  }
});
test("sleep, heartbeat gaps, worker restart and backward clocks never accrue offline time",()=>{
  let s=C.makeSession(input,0,"s");s=C.tickSession(s,sample,1000,"one");s=C.tickSession(s,sample,600000,"one");assert.equal(s.watchMs,0);
  s=C.tickSession(s,sample,602000,"two");assert.equal(s.watchMs,0);s=C.tickSession(s,sample,601000,"two");assert.equal(s.watchMs,0);
});
test("interacting during buffering or seeking cannot turn playback stalls into study activity",()=>{
  for(const invalid of [{buffering:true},{seeking:true},{playing:false,seeking:true}]){
    let s=C.makeSession(input,0,"s");
    const busy={...sample,activityActive:true,...invalid};
    s=C.tickSession(s,busy,1000,"boot");s=C.tickSession(s,busy,3000,"boot");
    assert.equal(s.watchMs,0);assert.equal(s.activityMs,0);
  }
});
test("priority is review then activity then watching; deadline never caps time or pauses task",()=>{
  let s=C.makeSession({...input,minutes:1},0,"s");s.targetMs=3000;
  s=C.tickSession(s,{...sample,activityActive:true},1000,"boot");s=C.tickSession(s,{...sample,activityActive:true},3000,"boot");
  assert.equal(s.watchMs,0);assert.equal(s.activityMs,2000);
  s=C.tickSession(s,{...sample,activityActive:true,reviewActive:true},4000,"boot");s=C.tickSession(s,{...sample,activityActive:true,reviewActive:true},6000,"boot");
  assert.equal(s.reviewMs,2000);assert.equal(C.totalMs(s),4000);assert.equal(s.status,"running");assert.equal(C.progress(s).remaining,0);assert.equal(C.progress(s).allMet,false);
});
test("daily summaries split time across midnight and return exactly seven local days",()=>{
  const midnight=new Date(2026,8,12).getTime();let s=C.makeSession(input,midnight-1000,"s");
  s=C.tickSession(s,sample,midnight-1000,"boot");s=C.tickSession(s,sample,midnight+1000,"boot");
  assert.equal(s.daily["2026-09-11"].watchMs,1000);assert.equal(s.daily["2026-09-12"].watchMs,1000);assert.equal(C.summary([s],midnight).length,7);
});
test("session start validates active video, goals allow zero and unrelated tabs cannot tick",async()=>{
  const h=harness();h.setEnv({foreground:false});await assert.rejects(h.service.studyCommand({...input,command:"start"}));
  h.setEnv({foreground:true});await h.service.studyCommand({...input,command:"start",wordGoal:0,sentenceGoal:0});
  assert.equal((await h.service.getStudy()).current.wordGoal,0);
  await h.service.pulse({...sample,visible:true},88);assert.equal((await h.service.getStudy()).current.lastSample,null);
  await assert.rejects(h.service.studyCommand({...input,command:"start"}),/先结束/);
});
test("closing the side panel does not interrupt watching, but its activity heartbeat expires",async()=>{
  const h=harness();await h.service.studyCommand({...input,command:"start"});
  await h.service.pulse({...sample,visible:true},7);h.advance(2000);await h.service.pulse({...sample,visible:true},7);assert.equal((await h.service.getStudy()).current.watchMs,2000);
  await h.service.panelActivity({...input,interaction:true,activity:true});await h.service.pulse({...sample,visible:true,playing:false},7);h.advance(2000);await h.service.pulse({...sample,visible:true,playing:false},7);assert.equal((await h.service.getStudy()).current.activityMs,2000);
  h.advance(6000);await h.service.pulse({...sample,visible:true,playing:false},7);assert.equal((await h.service.getStudy()).current.activityMs,2000);
});
test("unrelated panel views cannot accrue transcript activity even after a recent click",async()=>{
  const h=harness();await h.service.studyCommand({...input,command:"start"});
  await h.service.panelActivity({...input,interaction:true,activity:false});
  await h.service.pulse({...sample,visible:true,playing:false},7);h.advance(2000);
  await h.service.pulse({...sample,visible:true,playing:false},7);
  assert.equal((await h.service.getStudy()).current.activityMs,0);
});
test("switching videos pauses the bound session; resume requires the same video and explicitly rebinds a foreground tab",async()=>{
  const h=harness();await h.service.studyCommand({...input,command:"start"});h.setEnv({videoId:"other12345"});await h.service.pulse({...sample,visible:true},7);
  assert.equal((await h.service.getStudy()).current.status,"paused");await assert.rejects(h.service.studyCommand({...input,command:"resume"}));
  h.setEnv({videoId:input.videoId});await h.service.studyCommand({...input,tabId:8,command:"resume"});assert.equal((await h.service.getStudy()).current.tabId,8);await h.service.studyCommand({...input,command:"resume"});
  assert.equal((await h.service.getStudy()).current.status,"running");
});
test("collection goals use distinct newly saved IDs of the bound video; end preserves summary",async()=>{
  const h=harness();await h.service.studyCommand({...input,command:"start"});await h.service.addCollection("word","w1",input.videoId);await h.service.addCollection("word","w1",input.videoId);await h.service.addCollection("word","w2","other12345");
  assert.deepEqual((await h.service.getStudy()).current.wordIds,["w1"]);await h.service.studyCommand({...input,command:"end"});assert.equal((await h.service.getStudy()).current.status,"ended");
});
test("release contains Study instead of Ask and no web-search permission",()=>{
  const root=path.resolve(__dirname,"..");const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.json")));
  assert.match(manifest.name,/开发版/);assert.equal(manifest.version,"1.12.2");assert.equal(manifest.host_permissions.length,7);
  const html=fs.readFileSync(path.join(root,"sidepanel.html"),"utf8");assert.match(html,/data-tab="study"/);assert.doesNotMatch(html,/data-tab="ask"/);
  const bg=fs.readFileSync(path.join(root,"background.js"),"utf8");assert.doesNotMatch(bg,/action === "(?:askVideo|suggestVideoQuestions)"/);
  assert.equal(fs.existsSync(path.join(root,"prompts/ask.md")),false);
});

test("legacy collections remain collections and never fabricate practice outcomes",()=>{
  const d=C.normalizeStudy({currentId:"old",sessions:[{id:"old",startedAt:1000,status:"review",wordIds:["w1"],watchMs:12,practicedWordIds:["fake"]}]},2000);
  assert.equal(d.schemaVersion,2);assert.deepEqual(d.sessions[0].wordIds,["w1"]);assert.deepEqual(d.sessions[0].practicedWordIds,[]);assert.equal(d.sessions[0].watchMs,12);assert.equal(d.sessions[0].status,"paused");
});
test("manual pause survives playback, foreground and review events until explicit resume",async()=>{
  const h=harness();await h.service.studyCommand({...input,command:"start"});await h.service.pulse({...sample,visible:true},7);h.advance(1000);await h.service.pulse({...sample,visible:true},7);
  await h.service.studyCommand({...input,command:"pause"});h.advance(1000);await h.service.pulse({...sample,visible:true},7);h.advance(1000);await h.service.pulse({...sample,visible:true},7);
  let s=(await h.service.getStudy()).current;assert.equal(s.status,"paused");assert.equal(s.watchMs,1000);
  await h.service.studyCommand({...input,command:"resume"});await h.service.pulse({...sample,visible:true},7);h.advance(1000);await h.service.pulse({...sample,visible:true},7);assert.equal((await h.service.getStudy()).current.watchMs,2000);
});
test("refresh document ID pauses; restart and reopening restore progress without offline credit",async()=>{
  const h=harness();await h.service.studyCommand({...input,command:"start"});await h.service.pulse({...sample,visible:true,documentId:"doc1",position:30},7);h.advance(1000);await h.service.pulse({...sample,visible:true,documentId:"doc1",position:31},7);
  await h.service.pulse({...sample,visible:true,documentId:"doc2",position:0},7);let s=(await h.service.getStudy()).current;assert.equal(s.status,"paused");assert.equal(s.pauseReason,"restore");assert.equal(s.position,31);assert.equal(s.watchMs,1000);
  await h.service.studyCommand({...input,command:"resume"});const restarted=harness({data:h.data});s=(await restarted.service.getStudy()).current;assert.equal(s.status,"paused");assert.equal(s.watchMs,1000);
});
test("review and subtitle activity expire at 60 seconds; passive pings do not renew them",async()=>{
  for(const mode of ["review","activity"]){const h=harness();await h.service.studyCommand({...input,command:"start"});await h.service.panelActivity({...input,[mode]:true,interaction:true});
    const v={...sample,visible:true,playing:false};await h.service.pulse(v,7);h.advance(1000);await h.service.pulse(v,7);const key=mode==="review"?"reviewMs":"activityMs";assert.equal((await h.service.getStudy()).current[key],1000);
    h.advance(59000);await h.service.panelActivity({...input,[mode]:true});await h.service.pulse(v,7);h.advance(1000);await h.service.pulse(v,7);assert.equal((await h.service.getStudy()).current[key],1000);
  }
});
test("offline, duplicate events and another tab cannot add time; foreground resumes automatically",async()=>{
  const h=harness();await h.service.studyCommand({...input,command:"start"});const v={...sample,visible:true};await h.service.pulse(v,7);h.advance(1000);
  await Promise.all([h.service.pulse(v,7),h.service.pulse(v,7),h.service.pulse(v,8)]);assert.equal((await h.service.getStudy()).current.watchMs,1000);
  await h.service.pulse({...v,online:false},7);h.advance(1000);await h.service.pulse({...v,online:false},7);assert.equal((await h.service.getStudy()).current.watchMs,1000);
  h.setEnv({foreground:false});await h.service.pulse(v,7);h.advance(1000);await h.service.pulse(v,7);h.setEnv({foreground:true});await h.service.pulse(v,7);h.advance(1000);await h.service.pulse(v,7);assert.equal((await h.service.getStudy()).current.watchMs,2000);
});
test("distinct practice goals require self-assessment, repeated practice updates pending only",async()=>{
  const h=harness({data:{ytd_vocabulary:[{id:"w1",videoId:input.videoId}],ytd_sentences:[{id:"s1",videoId:input.videoId}]}});
  await h.service.studyCommand({...input,command:"start",wordGoal:1,sentenceGoal:1});await h.service.addCollection("word","w1",input.videoId);let s=(await h.service.getStudy()).current;assert.equal(C.progress(s).words,0);
  await h.service.markReview({id:"w1",result:"unsure",sessionId:s.id,tabId:7});await h.service.markReview({id:"w1",result:"again",sessionId:s.id,tabId:7});
  s=(await h.service.getStudy()).current;assert.equal(C.progress(s).words,1);assert.equal(C.progress(s).pending,1);
  await h.service.markReview({id:"w1",result:"known",sessionId:s.id,tabId:7});await h.service.markReview({id:"s1",result:"known",sessionId:s.id,tabId:7});
  s=(await h.service.getStudy()).current;assert.equal(C.progress(s).pending,0);assert.equal(C.progress(s).sentences,1);assert.equal(C.progress(s).allMet,false);
  h.data.ytd_study.sessions[0].watchMs=s.targetMs;assert.equal(C.progress((await h.service.getStudy()).current).allMet,true);
  await h.service.studyCommand({...input,command:"pause"});await assert.rejects(h.service.markReview({id:"w1",result:"known",sessionId:s.id,tabId:7}));
});
test("early end keeps real progress; continue restores same task; export and clear exclude collections",async()=>{
  const word={id:"w1",videoId:input.videoId};const h=harness({data:{ytd_vocabulary:[word],ytd_notes:[{id:"n1"}]}});await h.service.studyCommand({...input,command:"start"});
  await h.service.studyCommand({...input,command:"end"});const s=(await h.service.getStudy()).current;assert.equal(C.progress(s).allMet,false);
  await h.service.studyCommand({...input,command:"resume"});assert.equal((await h.service.getStudy()).current.id,s.id);
  const exported=await h.service.exportStudy();assert.equal(exported.data.schemaVersion,2);assert.equal(exported.data.sessions[0].runtimeBoot,undefined);
  await h.service.clearStudy();assert.equal((await h.service.getStudy()).current,null);assert.deepEqual(h.data.ytd_vocabulary,[word]);assert.deepEqual(h.data.ytd_notes,[{id:"n1"}]);
});
test("90 day retention removes expired records even without starting a new task",()=>{
  const now=100*86400000,d=C.normalizeStudy({currentId:"old",sessions:[{id:"old",startedAt:0},{id:"new",startedAt:now-1}]},now);assert.equal(d.currentId,null);assert.equal(d.sessions.length,1);
});

test("resume before deadline does not dismiss the future time prompt; legacy position remains unknown",async()=>{
  const h=harness();await h.service.studyCommand({...input,command:"start"});await h.service.studyCommand({...input,command:"pause"});await h.service.studyCommand({...input,command:"resume"});assert.equal((await h.service.getStudy()).current.timeAcknowledged,false);
  const old=C.normalizeStudy({sessions:[{id:"old",startedAt:1000,wordIds:[],sentenceIds:[]}]},2000).sessions[0];assert.equal(old.positionKnown,false);
});

test("reopening the study panel preserves progress and requires explicit continuation",async()=>{
  const h=harness();await h.service.studyCommand({...input,command:"start"});await h.service.panelOpened({...input});let s=(await h.service.getStudy()).current;assert.equal(s.status,"paused");assert.equal(s.pauseReason,"restore");assert.equal(s.restorePlayback,false);
  await h.service.studyCommand({...input,command:"resume"});assert.equal((await h.service.getStudy()).current.status,"running");
});
