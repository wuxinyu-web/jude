/* Serialized local mutations; provider calls run outside the storage queue. */
var YTD_LEARNING_WORKER = (() => {
  const C = typeof YTD_LEARNING !== "undefined" ? YTD_LEARNING : require("./learning-core.js");
  const KEYS = {sentences:"ytd_sentences", reviews:"ytd_reviews", study:"ytd_study", prefs:"ytd_learning_preferences"};
  function createServices({storage, ai, loadPrompt, validateVocabulary, now=Date.now, notify=()=>{}, environment=async()=>({}), control=async()=>{}}) {
    let queue=Promise.resolve(), lookupActive=0;
    const boot=`${now()}-${Math.random()}`, lookups=new Map(), inFlight=new Map(), analyses=new Map();
    const panel={at:0,interaction:0,activity:false,review:false,videoId:null,tabId:null};
    const mutate=fn=>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;};
    const read=async(key,fallback)=> (await storage.get(key))[key] ?? fallback;
    const publish=()=>notify({action:"learningChanged"});
    const uid=prefix=>`${prefix}_${now()}_${Math.random().toString(36).slice(2,10)}`;
    async function lookupVocabulary(m) {
      const term=C.text(m.term,1000);
      if(!term || String(m.term).length>1000)throw new Error("词条过长或为空。");
      const source={selectedText:term,sourceExcerpt:C.text(m.sourceExcerpt,3000),transcriptContext:C.text(m.context,12000),videoTitle:C.text(m.videoTitle,500)};
      const key=JSON.stringify([C.normalize(term),m.videoId,source.sourceExcerpt,source.transcriptContext]);
      const cached=lookups.get(key);
      if(cached && now()-cached.at<30*60*1000)return cached.value;
      if(inFlight.has(key))return inFlight.get(key);
      if(lookupActive>=2)throw new Error("正在查询其他单词，请稍后重试。");
      const job=(async()=>{
        lookupActive++;
        try {
          const vars={selectedTextJson:JSON.stringify(term),sourceExcerptJson:JSON.stringify(source.sourceExcerpt),transcriptContextJson:JSON.stringify(source.transcriptContext),videoTitleJson:JSON.stringify(source.videoTitle)};
          const system=await loadPrompt("vocabulary.md","System prompt",vars);
          const user=await loadPrompt("vocabulary.md","User prompt",vars);
          const result=await ai({maxTokens:768,temperature:0.2,responseFormat:{type:"json_object"},messages:[{role:"system",content:system},{role:"user",content:user}]});
          const value=validateVocabulary(result.text,term);
          lookups.set(key,{at:now(),value});
          while(lookups.size>200)lookups.delete(lookups.keys().next().value);
          return value;
        } finally {lookupActive--;}
      })();
      inFlight.set(key,job);
      try{return await job;}finally{inFlight.delete(key);}
    }
    async function getLibrary(){return {sentences:await read(KEYS.sentences,[]),reviews:await read(KEYS.reviews,{}),prefs:await read(KEYS.prefs,{})};}
    async function addCollection(kind,id,videoId) {
      return mutate(async()=>{
        const data=await read(KEYS.study,{sessions:[],currentId:null});
        const s=data.sessions.find(s=>s.id===data.currentId);
        if(!s || s.status!=="running" || s.videoId!==videoId)return;
        const key=kind==="sentence"?"sentenceIds":"wordIds";
        if(!s[key].includes(id)){s[key].push(id);await storage.set({[KEYS.study]:data});publish();}
      });
    }
    async function saveSentence(m){
      const result=await mutate(async()=>{
        const entries=await read(KEYS.sentences,[]);
        const entry=C.makeSentence(m,now(),uid("sentence"));
        const existing=entries.find(e=>e.videoId===entry.videoId && e.normalizedTerm===entry.normalizedTerm);
        if(existing)return {entry:existing,alreadySaved:true};
        if(entries.length>=500)throw new Error("长难句库已满（500 条），请先删除部分条目。");
        await storage.set({[KEYS.sentences]:[entry,...entries]});publish();return {entry,alreadySaved:false};
      });
      if(!result.alreadySaved)await addCollection("sentence",result.entry.id,result.entry.videoId);
      // UI explicitly requests analysis after the durable save, so a closed panel
      // cannot lose the source even if Chrome terminates the worker.
      return result;
    }
    async function analyzeSentence(id){
      if(analyses.has(id))return analyses.get(id);
      if(analyses.size>=2)throw new Error("正在解析其他句子，请稍后重试。");
      const job=(async()=>{
        const entry=await mutate(async()=>{
          const entries=await read(KEYS.sentences,[]),e=entries.find(e=>e.id===id);
          if(!e)throw new Error("原句已删除。");
          e.analysisStatus="pending";e.analysisError="";e.analysisRevision=(e.analysisRevision||0)+1;
          await storage.set({[KEYS.sentences]:entries});publish();return {...e};
        });
        try{
          const vars={sourceJson:JSON.stringify({sentence:entry.term,context:entry.context,videoTitle:entry.videoTitle})};
          const result=await ai({maxTokens:3000,temperature:0.2,responseFormat:{type:"json_object"},messages:[
            {role:"system",content:await loadPrompt("sentence.md","System prompt",vars)},
            {role:"user",content:await loadPrompt("sentence.md","User prompt",vars)}]});
          const analysis=C.validateAnalysis(result.text);
          return await mutate(async()=>{
            const entries=await read(KEYS.sentences,[]),e=entries.find(e=>e.id===id);
            if(!e || e.analysisRevision!==entry.analysisRevision)return {removed:true};
            const manual=e.tagsEdited?{grammarTags:e.grammarTags,expressionTags:e.expressionTags}:{};
            Object.assign(e,analysis,manual,{analysisStatus:"ready",analysisError:""});
            await storage.set({[KEYS.sentences]:entries});publish();return {entry:e};
          });
        }catch(error){
          await mutate(async()=>{const entries=await read(KEYS.sentences,[]),e=entries.find(e=>e.id===id);
            if(e && e.analysisRevision===entry.analysisRevision){e.analysisStatus="error";e.analysisError="解析未完成，请重试。";await storage.set({[KEYS.sentences]:entries});publish();}});
          throw error;
        }
      })();
      analyses.set(id,job);try{return await job;}finally{analyses.delete(id);}
    }
    async function editSentence(m){return mutate(async()=>{
      const entries=await read(KEYS.sentences,[]), e=entries.find(e=>e.id===m.id);
      if(!e)throw new Error("原句已删除。");
      e.grammarTags=C.tags(m.grammarTags,C.GRAMMAR);e.expressionTags=C.tags(m.expressionTags,C.EXPRESSIONS);e.tagsEdited=true;
      await storage.set({[KEYS.sentences]:entries});publish();return {entry:e};
    });}
    async function deleteSentence(id){return mutate(async()=>{
      const entries=await read(KEYS.sentences,[]), reviews=await read(KEYS.reviews,{});delete reviews[id];
      await storage.set({[KEYS.sentences]:entries.filter(e=>e.id!==id),[KEYS.reviews]:reviews});publish();return {};
    });}
    async function markReview(m){return mutate(async()=>{
      if(!["known","again"].includes(m.result))throw new Error("无效的复习状态。");
      const sentences=await read(KEYS.sentences,[]),words=await read("ytd_vocabulary",[]);
      if(![...sentences,...words].some(e=>e.id===m.id))throw new Error("词句已删除。");
      const reviews=await read(KEYS.reviews,{});reviews[m.id]={result:m.result,reviewedAt:now()};
      await storage.set({[KEYS.reviews]:reviews});publish();return {};
    });}
    async function getStudy(){const d=await read(KEYS.study,{sessions:[],currentId:null});return {...d,current:d.sessions.find(s=>s.id===d.currentId)||null,days:C.summary(d.sessions,now())};}
    async function studyCommand(m){
      const env=await environment(m.tabId);
      return mutate(async()=>{
        const d=await read(KEYS.study,{sessions:[],currentId:null});let s=d.sessions.find(s=>s.id===d.currentId);
        if(m.command==="start"){
          if(s && s.status!=="ended")throw new Error("请先结束当前学习。");
          if(!env.foreground || env.videoId!==m.videoId)throw new Error("请在前台打开要学习的 YouTube 视频。");
          s=C.makeSession({...m,windowId:env.windowId},now(),uid("study"));d.sessions.push(s);d.currentId=s.id;
          const prefs=await read(KEYS.prefs,{});await storage.set({[KEYS.prefs]:{...prefs,session:C.preferences(m)}});
        }else{
          if(!s)throw new Error("还没有开始学习。");
          if(s.status==="ended")throw new Error("本次学习已结束，请开始新任务。");
          if(["resume","extend","review"].includes(m.command) && (!env.foreground || env.videoId!==s.videoId || m.tabId!==s.tabId))throw new Error("请返回本次学习的视频。");
          if(m.command==="pause")s.status="paused";
          else if(m.command==="resume")s.status=s.watchMs+s.activityMs>=s.targetMs?"due":"running";
          else if(m.command==="extend"){s.targetMs+=300000;s.status="running";}
          else if(m.command==="review")s.status="review";
          else if(m.command==="end"){s.status="ended";s.endedAt=now();}
          else if(m.command==="distractions")s.reduceDistractions=Boolean(m.enabled);
          else throw new Error("未知学习操作。");
          s.lastSample=null;
        }
        // Summaries are local and bounded to 90 days; never prune the current session.
        d.sessions=d.sessions.filter(e=>e.id===d.currentId || e.startedAt>=now()-90*86400000);
        await storage.set({[KEYS.study]:d});await control(s);publish();return {session:s};
      });
    }
    async function panelActivity(m){
      panel.at=now();panel.videoId=m.videoId;panel.tabId=m.tabId;panel.review=m.review===true;
      panel.activity=m.activity===true;
      if(m.interaction)panel.interaction=now();if(m.hidden)panel.at=0;
      return {};
    }
    async function pulse(m,tabId){
      const env=await environment(tabId);
      return mutate(async()=>{
        const d=await read(KEYS.study,{sessions:[],currentId:null});let s=d.sessions.find(s=>s.id===d.currentId);
        if(!s || s.status==="ended" || s.tabId!==tabId)return {session:null};
        const previousStatus=s.status;
        if(env.videoId!==s.videoId || (m.ended && s.status==="running")){s.status="paused";s.lastSample=null;}
        const panelLive=panel.tabId===tabId && panel.videoId===s.videoId && now()-panel.at<5000 && now()-panel.interaction<60000;
        s=C.tickSession(s,{...m,videoId:env.videoId,foreground:env.foreground && m.visible===true,
          activityActive:panelLive && panel.activity && !panel.review,reviewActive:panelLive && panel.review},now(),boot);
        d.sessions=d.sessions.map(e=>e.id===s.id?s:e);await storage.set({[KEYS.study]:d});
        if(previousStatus!==s.status){await control(s);publish();}
        return {session:s};
      });
    }
    async function setPreferences(m){return mutate(async()=>{
      const prefs=await read(KEYS.prefs,{});
      // Only allow bounded, non-secret UI preferences, not arbitrary extension storage.
      if(m.library && typeof m.library==="object"){
        const input=m.library;
        prefs.library={scope:input.scope==="all"?"all":"video",sort:["newest","oldest","az","video"].includes(input.sort)?input.sort:"newest",
          group:["grammar","expression"].includes(input.group)?input.group:"",grammar:C.tags([input.grammar],C.GRAMMAR)[0]||"",expression:C.tags([input.expression],C.EXPRESSIONS)[0]||"",
          review:["known","again","unreviewed"].includes(input.review)?input.review:""};
      }
      await storage.set({[KEYS.prefs]:prefs});return {};
    });}
    return {lookupVocabulary,getLibrary,saveSentence,analyzeSentence,editSentence,deleteSentence,markReview,addCollection,getStudy,studyCommand,panelActivity,pulse,setPreferences};
  }
  function install(){
    const services=createServices({storage:chrome.storage.local,ai:requestAiCompletion,loadPrompt:loadPromptSection,validateVocabulary:validateVocabularyEnrichment,
      notify:m=>chrome.runtime.sendMessage(m).catch(()=>{}),
      environment:async tabId=>{try{const t=await chrome.tabs.get(tabId),w=await chrome.windows.get(t.windowId);
        return {foreground:t.active&&w.focused,videoId:C.videoIdFromUrl(t.url),windowId:t.windowId};}catch{return {}; }},
      control:async s=>{try{await chrome.tabs.sendMessage(s.tabId,{action:"studyControl",session:s});}catch{/* The tab may have closed. */}}
    });
    globalThis.YTD_LEARNING_SERVICES=services;
    const handlers={lookupVocabulary:m=>services.lookupVocabulary(m).then(enrichment=>({enrichment})),getLearningLibrary:()=>services.getLibrary(),
      saveSentence:m=>services.saveSentence(m),analyzeSentence:m=>services.analyzeSentence(m.id),editSentence:m=>services.editSentence(m),
      deleteSentence:m=>services.deleteSentence(m.id),markReview:m=>services.markReview(m),getStudy:()=>services.getStudy(),
      studyCommand:m=>services.studyCommand(m),studyPanelActivity:m=>services.panelActivity(m),setLearningPreferences:m=>services.setPreferences(m)};
    chrome.runtime.onMessage.addListener((m,sender,reply)=>{
      if(m.action==="studyPulse"){
        if(sender.id!==chrome.runtime.id || !sender.tab?.id)return false;
        services.pulse(m,sender.tab.id).then(v=>reply({success:true,...v}),()=>reply({success:false}));return true;
      }
      if(!handlers[m.action])return false;
      // Collection/data APIs are extension-page only, never content-script readable.
      if(sender.id!==chrome.runtime.id || sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(""))){reply({success:false,error:"Not permitted"});return false;}
      handlers[m.action](m).then(v=>reply({success:true,...v}),e=>reply({success:false,error:e.message}));return true;
    });
    chrome.tabs.onRemoved.addListener(tabId=>{
      services.getStudy().then(d=>{if(d.current?.tabId===tabId && d.current.status!=="ended")return services.studyCommand({command:"end",tabId});}).catch(()=>{});
    });
    // Clear obsolete web-search credentials/cache fields without touching learning data.
    chrome.storage.local.get(null).then(async data=>{
      const changes={};
      if(data.ytd_settings && Object.hasOwn(data.ytd_settings,"tavilyApiKey")){
        const {tavilyApiKey,...rest}=data.ytd_settings;changes.ytd_settings=rest;
      }
      for(const [key,value]of Object.entries(data))if(key.startsWith("digest_") && value && ("askSuggestions" in value || "askSuggestionsContextReduced" in value)){
        const {askSuggestions,askSuggestionsContextReduced,...rest}=value;changes[key]=rest;
      }
      if(Object.keys(changes).length)await chrome.storage.local.set(changes);
    }).catch(()=>{});
    return services;
  }
  if(typeof chrome!=="undefined" && typeof requestAiCompletion==="function")install();
  return {createServices,KEYS};
})();
if(typeof module!=="undefined" && module.exports)module.exports=YTD_LEARNING_WORKER;
