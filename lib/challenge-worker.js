/* Independent opt-in challenge storage. Mutations serialized; AI outside queue. */
var YTD_CHALLENGE_WORKER=(()=>{
 const C=typeof YTD_CHALLENGE_CORE!=='undefined'?YTD_CHALLENGE_CORE:require('./challenge-core.js');
 function create({storage,ai,loadPrompt,environment,now=Date.now,notify=()=>{}}){
  let queue=Promise.resolve();const boot=String(Math.random());const flights=new Map();
  const lock=fn=>{const p=queue.then(fn,fn);queue=p.catch(()=>{});return p;};
  async function read(){const d=C.clean((await storage.get(C.KEY))[C.KEY],now());const s=d.sessions.find(s=>s.id===d.currentId);if(s&&s.boot!==boot){s.lastSample=null;if(['generating','grading'].includes(s.status)){s.status=s.questions?.length?'quiz':'watching';s.error='上次处理已中断，请重试；不会补计离开期间的观看。';}if(s.status==='watching')s.needsResume=true;s.boot=boot;}return d;}
  const save=async d=>{await storage.set({[C.KEY]:d});notify();};
  const current=d=>d.sessions.find(s=>s.id===d.currentId);
  const active=s=>s&&!['passed','exited'].includes(s.status);
  const PARENT_KEY='ytd_parent_mode';
  const parent=async()=>((await storage.get(PARENT_KEY))[PARENT_KEY]||{schemaVersion:1,enabled:false});
  const parentPublic=p=>({enabled:p.enabled===true,pending:!!p.pending&&p.pending.expires>now(),lockedUntil:p.lockedUntil||0});
  async function pinHash(pin,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:210000,hash:'SHA-256'},material,256);return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');}
  async function verifyPin(p,pin){
   if(p.lockedUntil>now())throw Error('密钥多次输入错误，请稍后再试。');
   if(typeof pin!=='string'||pin.length<6||pin.length>64||await pinHash(String(pin),p.salt)!==p.hash){p.failures=(p.failures||0)+1;if(p.failures>=5){p.lockedUntil=now()+60000;p.failures=0;}await storage.set({[PARENT_KEY]:p});throw Error('密钥不正确。');}
  }
  function newSession(d,env,m,parentMode=false){const s={schemaVersion:1,id:`challenge_${now()}_${crypto.randomUUID()}`,createdAt:now(),videoId:env.videoId,videoTitle:C.text(m.videoTitle,500),tabId:m.tabId,parentMode,status:'watching',boot,needsResume:false,ranges:[],cues:[],questions:[],results:{},attempts:[],draft:{},revision:0};d.sessions.push(s);d.currentId=s.id;return s;}
  async function parentCommand(m){const env=await environment(m.tabId);return lock(async()=>{
   let p=await parent();const d=await read();
   if(m.command==='setPassword'){
    if(p.enabled)throw Error('家长模式已开启，请先使用原密码解除。');
    if(typeof m.pin!=='string'||m.pin.length<6||m.pin.length>64)throw Error('密码请输入 6–64 位字符。');
    if(m.pin!==m.confirmPin)throw Error('两次输入的密码不一致。');
    if(!env.foreground||env.videoId!==m.videoId)throw Error('请回到当前视频启用。');
    const salt=crypto.randomUUID(),hash=await pinHash(m.pin,salt),previous=current(d);
    if(active(previous)){previous.status='exited';previous.lastSample=null;previous.revision++;}
    p={schemaVersion:1,enabled:true,hash,salt,enabledAt:now(),failures:0};newSession(d,env,m,true);
    await storage.set({[PARENT_KEY]:p,[C.KEY]:d});notify();return {parent:parentPublic(p)};
   }
   if(m.command==='setup'){
    if(p.enabled)throw Error('家长模式已开启。');if(active(current(d))&&current(d).parentMode)throw Error('家长任务正在进行中。');
    if(!env.foreground||!env.videoId)throw Error('请先在前台打开要学习的视频。');
    const bytes=crypto.getRandomValues(new Uint32Array(1));const pin=String(100000000+bytes[0]%900000000),salt=crypto.randomUUID();
    p={schemaVersion:1,enabled:false,pending:{hash:await pinHash(pin,salt),salt,expires:now()+600000}};await storage.set({[PARENT_KEY]:p});return {pin,parent:parentPublic(p)};
   }
   if(m.command==='activate'){
    if(p.enabled||!p.pending||p.pending.expires<=now())throw Error('密钥确认已过期，请重新设置。');
    if(active(current(d))&&(!m.replaceChallenge||current(d).parentMode))throw Error('请先结束当前普通闯关。');
    if(!env.foreground||env.videoId!==m.videoId)throw Error('请回到当前视频启用。');
    if(await pinHash(String(m.pin||''),p.pending.salt)!==p.pending.hash)throw Error('确认密钥不正确。');
    const previous=current(d);if(active(previous)){previous.status='exited';previous.lastSample=null;previous.revision++;}
    p={schemaVersion:1,enabled:true,hash:p.pending.hash,salt:p.pending.salt,enabledAt:now(),failures:0};newSession(d,env,m,true);
    await storage.set({[PARENT_KEY]:p,[C.KEY]:d});notify();return {parent:parentPublic(p)};
   }
   if(m.command==='cancelSetup'){if(!p.enabled)await storage.set({[PARENT_KEY]:{schemaVersion:1,enabled:false}});return {};}
   if(m.command==='unlock'){
    if(!p.enabled)return {};await verifyPin(p,m.pin);
    const s=current(d);if(active(s)){s.status='exited';s.lastSample=null;s.revision++;}
    await storage.set({[PARENT_KEY]:{schemaVersion:1,enabled:false},[C.KEY]:d});notify();return {};
   }
   throw Error('未知家长模式操作。');
  });}
  async function collectionProgress(s){const words=(await storage.get('ytd_vocabulary')).ytd_vocabulary||[],sentences=(await storage.get('ytd_sentences')).ytd_sentences||[];
   const count=entries=>new Set(entries.filter(e=>e.videoId===s.videoId&&e.createdAt>=s.createdAt&&C.classroomSafe(e.term)&&s.cues.some(c=>C.viewed(c,s.ranges)&&(` ${C.norm(c.text)} `).includes(` ${C.norm(e.term)} `))).map(e=>C.norm(e.term))).size;
   return {words:count(words),sentences:count(sentences)};
  }
  async function get(){return lock(async()=>{const d=await read();await storage.set({[C.KEY]:d});const s=current(d);if(s?.parentMode&&s.status==='watching')s.collection=await collectionProgress(s);return {parent:parentPublic(await parent()),session:C.publicSession(s),history:d.sessions.slice(-20).reverse().map(s=>({id:s.id,videoId:s.videoId,videoTitle:s.videoTitle,status:s.status,createdAt:s.createdAt,score:s.score,attempts:s.attempts?.length||0}))};});}
  async function command(m){const env=await environment(m.tabId);return lock(async()=>{const d=await read();let s=current(d);
   if(m.command==='start'){
    if((await parent()).enabled)throw Error('家长模式开启中，不能切换普通闯关。');
    if(active(s))throw Error('请先完成或退出当前闯关。');
    if(!env.foreground||env.videoId!==m.videoId)throw Error('请在前台打开当前视频。');
    if(d.sessions.length>=200)throw Error('学习记录已满，请先导出并清空学习记录。');
    s={schemaVersion:1,id:`challenge_${now()}_${Math.random().toString(36).slice(2,8)}`,createdAt:now(),videoId:env.videoId,videoTitle:C.text(m.videoTitle,500),tabId:m.tabId,status:'watching',boot,needsResume:false,ranges:[],cues:[],questions:[],results:{},attempts:[],draft:{},revision:0};d.sessions.push(s);d.currentId=s.id;
   }else{
    if(!s)throw Error('请先开始闯关。');
    if(m.sessionId&&m.sessionId!==s.id)throw Error('任务已切换，请刷新学习页。');
    if(m.command==='exit'){if((await parent()).enabled)throw Error('退出家长模式需要家长密钥，请在学习页解除。');s.status='exited';s.lastSample=null;s.revision++;}
    else if(m.command==='resume'){
     if(!env.foreground||env.videoId!==s.videoId)throw Error('请先打开本次闯关视频。');
     if(!active(s))throw Error('本次闯关已经结束。');s.tabId=m.tabId;s.needsResume=false;s.lastSample=null;
    }else if(m.command==='draft'){
     if(!['quiz','retry'].includes(s.status))return {};s.draft=Object.fromEntries(s.questions.map(q=>[q.id,C.text(m.answers?.[q.id],500)]));
    }else if(m.command==='source'){
     if(m.videoId!==s.videoId||env.videoId!==s.videoId||!active(s)||s.questions.length)return {};
     s.cues=C.cues(m.cues);
     if(JSON.stringify(s.cues).length>600000)throw Error('本集字幕过长，请使用较短的单集进行闯关。');
     }else if(m.command==='reviewWrong'){
     if(!s.parentMode||s.status!=='review'||!s.questions.some(q=>q.id===m.questionId&&!s.results[q.id]?.correct))throw Error('当前没有该待复习题。');
     if(!['known','unsure','again'].includes(m.result))throw Error('请选择复习结果。');
     s.reviewed={...s.reviewed,[m.questionId]:{at:now(),result:m.result}};
     }else if(m.command==='reviewReplay'){
     const q=s.questions.find(q=>q.id===m.questionId&&!s.results[q.id]?.correct);
     if(!s.parentMode||s.status!=='review'||!q)throw Error('请从待复习错题进入回看。');
     s.replay={start:q.start,end:q.start+Math.min(q.duration||15,30),expires:now()+60000,token:now()};
    }else if(m.command==='retest'){
     const wrong=s.questions.filter(q=>!s.results[q.id]?.correct);
     if(!s.parentMode||s.status!=='review'||wrong.some(q=>s.reviewed?.[q.id]?.result!=='known'))throw Error('请先逐项复习错题，并确认已记住后再考试。');
     s.status='quiz';s.replay=null;s.results={};s.draft={};s.retesting=true;s.reviewed={};
    }else if(m.command==='rewatch'){
     if(s.status!=='watching')throw Error('已有试卷，请完成测试或退出。');s.finished=false;s.needsResume=false;s.rewatchToken=now();
    }else throw Error('未知闯关操作。');
   }await save(d);return {session:C.publicSession(s)};
  });}
  async function pulse(m,tabId){const env=await environment(tabId);return lock(async()=>{const d=await read();let s=current(d);const guard=await parent();
   if(guard.enabled&&env.videoId){
    const allowed=d.sessions.some(e=>e.parentMode&&e.videoId===env.videoId&&e.status==='passed');
    if(allowed&&(!active(s)||s.videoId!==env.videoId))return {gate:null};
    if(!active(s)){
     if(!env.foreground)return {gate:{id:'parent',parentMode:true,blocked:true,status:'watching',videoId:env.videoId}};
     s=newSession(d,env,{tabId,videoTitle:m.videoTitle},true);await storage.set({[C.KEY]:d});
    }
   }
   if(!active(s)||(!guard.enabled&&s.tabId!==tabId))return {gate:null};
   if(guard.enabled&&env.foreground&&env.videoId===s.videoId)s.tabId=tabId;
   if(guard.enabled&&s.tabId!==tabId)return {gate:{id:s.id,parentMode:true,videoId:s.videoId,videoTitle:s.videoTitle,position:s.position||0,status:s.status,blocked:true}};
   const same=env.videoId===s.videoId,at=now(),p=Number(m.position),last=s.lastSample;
   const eligible=same&&s.status==='watching'&&!s.needsResume&&!s.finished&&env.foreground&&m.visible&&m.online&&m.playing&&!m.buffering&&!m.seeking&&Number.isFinite(p)&&p>=0;
   if(eligible&&last&&last.documentId===m.documentId){const dt=(at-last.at)/1000,dp=p-last.position;if(dt>0&&dt<=3&&dp>0&&dp<=dt*4+1)s.ranges=C.merge(s.ranges,last.position,p);}
   s.lastSample=eligible?{at,position:p,documentId:C.text(m.documentId,100)}:null;
   if(same&&Number.isFinite(p)&&p>=0)s.position=p;
   if(same&&Number.isFinite(m.duration)&&m.duration>0)s.duration=m.duration;
   if(same&&m.ended&&!(s.rewatchToken&&at-s.rewatchToken<5000)){s.finished=true;s.lastSample=null;}
   if(s.parentMode&&s.status==='watching'&&(s.finished||!same)){
    s.finished=true;s.collection=await collectionProgress(s);
    const watched=s.ranges.reduce((n,r)=>n+r[1]-r[0],0);
    if(s.collection.words>=10&&s.collection.sentences>=5&&s.duration>0&&watched>=s.duration*0.8){s.status='passed';s.completion='collection';await save(d);return {gate:null};}
   }
   await storage.set({[C.KEY]:d});return {gate:{parentMode:s.parentMode,id:s.id,videoId:s.videoId,videoTitle:s.videoTitle,position:s.position||0,status:s.status,needsResume:s.needsResume,replay:s.parentMode&&same&&s.status==='review'&&s.replay?.expires>now()?s.replay:null,blocked:!same||((s.finished||['generating','quiz','grading','retry','review'].includes(s.status))&&!(s.parentMode&&s.status==='review'&&s.replay?.expires>now()&&p>=s.replay.start&&p<s.replay.end)),finished:s.finished,rewatchToken:s.rewatchToken&&now()-s.rewatchToken<5000?s.rewatchToken:null}};
  });}
  async function generate(m){if(flights.has('generate'))return flights.get('generate');const job=(async()=>{
   const prepared=await lock(async()=>{const d=await read(),s=current(d);if(!s||s.id!==m.sessionId||!active(s))throw Error('闯关已切换或结束。');if(s.questions.length)return {existing:true};
    const watched=s.cues.filter(c=>C.viewed(c,s.ranges));if(!watched.length)throw Error('还没有可出题的已观看英文字幕。请继续观看并加载英文字幕，或退出闯关。');
    // Bound prompt cost while evenly sampling the watched portion.
    let source=watched;if(source.length>240){const step=source.length/240;source=Array.from({length:240},(_,i)=>source[Math.floor(i*step)]);}
    s.status='generating';s.error='';s.lastSample=null;s.revision++;await save(d);return {id:s.id,revision:s.revision,source,parentMode:s.parentMode};});
   if(prepared.existing)return get();
   try{const fav=(await storage.get('ytd_vocabulary')).ytd_vocabulary||[];const raw=await ai({maxTokens:7000,temperature:0.2,responseFormat:{type:'json_object'},messages:[{role:'system',content:await loadPrompt('challenge.md',prepared.parentMode?'Parent system prompt':'System prompt',{})},{role:'user',content:JSON.stringify({cues:prepared.source,favorites:fav.filter(e=>prepared.source.some(c=>C.norm(c.text).includes(C.norm(e.term)))).slice(0,30).map(e=>C.text(e.term,100))})}]});const qs=C.validateQuestions(raw.text,prepared.source,{parentMode:prepared.parentMode});
    return lock(async()=>{const d=await read(),s=current(d);if(!s||s.id!==prepared.id||s.revision!==prepared.revision)return {};s.questions=qs;s.cues=[];s.status='quiz';s.draft={};s.score=C.score(qs,{},{parentMode:s.parentMode});s.error='';await save(d);return {session:C.publicSession(s)};});
   }catch(e){await lock(async()=>{const d=await read(),s=current(d);if(s?.id===prepared.id&&s.revision===prepared.revision){s.status='watching';s.error=s.parentMode?'试题素材不足或出题失败。请继续回看、加载英文字幕后重试，或请家长解除。':'出题未完成，请重试、继续观看或退出闯关。';await save(d);}});throw Error(prepared.parentMode?'试卷未准备完成：需有适合课堂的 10 道单词与 5 道句子题。请加载更多已观看英文字幕后重试；服务失败请检查 AI 设置，或请家长解除。':'出题失败：请检查 AI 设置后重试，或退出闯关。');}
  })();flights.set('generate',job);try{return await job;}finally{flights.delete('generate');}}
  async function submit(m){if(flights.has('grade'))return flights.get('grade');const job=(async()=>{
   const p=await lock(async()=>{const d=await read(),s=current(d);if(!s||s.id!==m.sessionId||!['quiz','retry'].includes(s.status))throw Error('当前试卷不可提交。');if(s.attempts.length>=30)throw Error('本次补测已达上限，请退出后重新开始。');
    const qs=s.questions.filter(q=>!s.results[q.id]?.correct),answers=Object.fromEntries(qs.map(q=>[q.id,C.text(m.answers?.[q.id],500)]));if(qs.some(q=>!answers[q.id]))throw Error('请先填写所有待答题目。');s.draft={...s.draft,...answers};s.status='grading';s.revision++;await save(d);return {id:s.id,revision:s.revision,qs,answers};});
   try{const results={},uncertain=[];for(const q of p.qs){if(q.accepted.some(a=>C.norm(a)===C.norm(p.answers[q.id])))results[q.id]={correct:true,feedback:'回答正确。',answer:p.answers[q.id]};else uncertain.push({...q,studentAnswer:p.answers[q.id]});}
    if(uncertain.length){const r=await ai({maxTokens:2500,temperature:0,responseFormat:{type:'json_object'},messages:[{role:'system',content:await loadPrompt('challenge.md','Grading system prompt',{})},{role:'user',content:JSON.stringify({questions:uncertain})}]});const data=JSON.parse(r.text);if(!Array.isArray(data.results)||data.results.length!==uncertain.length)throw Error('Invalid grading');for(const q of uncertain){const matches=data.results.filter(v=>v.id===q.id);if(matches.length!==1||typeof matches[0].correct!=='boolean')throw Error('Uncertain grading');results[q.id]={correct:matches[0].correct,feedback:C.text(matches[0].feedback,500),answer:p.answers[q.id]};}}
    return lock(async()=>{const d=await read(),s=current(d);if(!s||s.id!==p.id||s.revision!==p.revision)return {};s.results={...s.results,...results};s.score=C.score(s.questions,s.results,{parentMode:s.parentMode});s.attempts.push({at:now(),results,score:s.score});s.status=s.score.passed?'passed':s.parentMode?'review':'retry';s.retesting=false;s.reviewed={};s.error='';s.draft={};await save(d);return {session:C.publicSession(s)};});
   }catch(e){await lock(async()=>{const d=await read(),s=current(d);if(s?.id===p.id&&s.revision===p.revision){s.status=s.parentMode?'quiz':s.attempts.length?'retry':'quiz';s.error=s.parentMode?'暂无法可靠判分，回答已保存。请重试或请家长解除，不会记为答错。':'暂无法可靠判分，回答已保存。请重试或退出，不会记为答错。';await save(d);}});throw Error('暂无法可靠判分，回答已保存，请重试或退出。');}
  })();flights.set('grade',job);try{return await job;}finally{flights.delete('grade');}}
  async function clear(){return lock(async()=>{if((await parent()).enabled)throw Error('请家长先解除家长模式，再清空学习记录。');await storage.set({[C.KEY]:{schemaVersion:1,currentId:null,sessions:[]}});notify();return {};});}
  async function exportData(){return lock(async()=>{const d=await read();return {schemaVersion:1,sessions:d.sessions.map(({lastSample,boot,tabId,cues,...s})=>s)};});}
  return {get,command,pulse,generate,submit,clear,exportData,parentCommand};
 }
 function install(){const services=create({storage:chrome.storage.local,ai:requestAiCompletion,loadPrompt:loadPromptSection,environment:async id=>{try{const t=await chrome.tabs.get(id),w=await chrome.windows.get(t.windowId);return {videoId:YTD_PLATFORM.videoIdFromUrl(t.url),foreground:t.active&&w.focused};}catch{return {}; }},notify:()=>chrome.runtime.sendMessage({action:'challengeChanged'}).catch(()=>{})});globalThis.YTD_CHALLENGES=services;
 chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(!['parentCommand','challengeGet','challengeCommand','challengeGenerate','challengeSubmit','challengePulse','challengeExit','challengeOpen'].includes(m.action))return false;
  const own=sender.id===chrome.runtime.id,extension=own&&sender.url?.startsWith(chrome.runtime.getURL(''))&&(!sender.tab||sender.url.split('?')[0]===chrome.runtime.getURL('sidepanel.html'));
  const content=own&&sender.tab?.id&&YTD_PLATFORM.videoIdFromUrl(sender.url);
  if(!extension&&!(['challengePulse','challengeExit','challengeOpen'].includes(m.action)&&content)){reply({success:false,error:'Not permitted'});return false;}
  if(sender.tab)m={...m,tabId:sender.tab.id};
  let task;if(m.action==='challengeOpen'){task=chrome.sidePanel.open({tabId:sender.tab.id}).then(()=>({}));}
  else if(m.action==='challengePulse')task=services.pulse(m,sender.tab.id);
  else if(m.action==='challengeExit')task=services.command({command:'exit',sessionId:m.sessionId,tabId:sender.tab.id});
  else if(m.action==='parentCommand')task=services.parentCommand(m);
  else if(m.action==='challengeGet')task=services.get();else if(m.action==='challengeGenerate')task=services.generate(m);else if(m.action==='challengeSubmit')task=services.submit(m);else task=services.command(m);
  task.then(v=>reply({success:true,...v}),e=>reply({success:false,error:e.message}));return true;
 });return services;}
 if(typeof chrome!=='undefined'&&typeof requestAiCompletion==='function')install();return {create};
})();
if(typeof module!=='undefined')module.exports=YTD_CHALLENGE_WORKER;
