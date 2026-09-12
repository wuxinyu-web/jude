/* Vocabulary, sentence, study and export interfaces share the existing panel. */
(() => {
  const C=YTD_LEARNING,P=YTD_PANEL;
  const $=id=>document.getElementById(id);
  const state={sentences:[],reviews:{},prefs:{},query:"",scope:"video",sort:"newest",grammar:"",expression:"",group:"",review:"",
    selected:new Set(),libraryGeneration:0,captureGeneration:0,study:null,reviewQueue:[],reviewIndex:0,revealed:false,reviewDone:false,tab:"transcript",lastInteraction:0};
  let initialized=false,captureInstalled=false,hoverTimer=null,hoverKey="",hoverPoint=null,float=null,dragging=false,lastPanelPing=0,studyPollBusy=false;
  const ctx=()=>P.context();
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const button=(text,fn,cls="learning-button")=>{const b=el("button",text,cls);b.type="button";b.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();Promise.resolve().then(()=>fn(event,b)).catch(showError);});return b;};
  const send=async(action,data={})=>{const r=await chrome.runtime.sendMessage({action,...data});if(!r?.success)throw new Error(r?.message||r?.error||"操作未完成，请重试。");return r;};
  function showError(error){toast(error?.message||String(error),true);}
  let toastTimer;
  function toast(message,error=false){let box=$("learningToast");if(!box){box=el("div",undefined,"learning-toast");box.id="learningToast";box.setAttribute("role","status");document.body.appendChild(box);}box.textContent=message;box.dataset.error=String(error);box.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.hidden=true,5000);}
  function selectControl(label,choices,value,onChange){
    const wrap=el("label",undefined,"learning-field");wrap.append(el("span",label));const select=el("select");select.setAttribute("aria-label",label);
    choices.forEach(([v,t])=>{const o=el("option",t);o.value=v;select.append(o);});select.value=value;
    select.addEventListener("change",()=>onChange(select.value));wrap.append(select);return wrap;
  }
  function setFilter(key,value){state[key]=value;if(key==="scope" && value==="all" && state.sort==="video")state.sort="newest";state.selected.clear();renderToolbar();renderLibrary();void persist();}
  async function persist(){await send("setLearningPreferences",{library:Object.fromEntries(["scope","sort","group","grammar","expression","review"].map(k=>[k,state[k]]))}).catch(showError);}
  const words=()=>P.vocabulary().map(e=>({...e,kind:"word"}));
  const sentences=()=>state.sentences.map(e=>({...e,kind:"sentence"}));
  function entriesFor(kind){return C.filterEntries(kind==="sentences"?sentences():words(),{
    videoId:state.scope==="video"?ctx().videoId:null,query:state.query,sort:state.sort,
    grammar:kind==="sentences"?state.grammar:"",expression:kind==="sentences"?state.expression:"",review:state.review},state.reviews);}
  function activeEntries(){return entriesFor(ctx().libraryView);}
  function renderToolbar(){
    const root=$("learningLibraryToolbar");if(!root)return;root.replaceChildren();root.hidden=ctx().libraryView==="notes";if(root.hidden)return;
    const row=el("div",undefined,"learning-filters");
    row.append(selectControl("范围",[["video","当前视频"],["all","全部视频"]],state.scope,v=>setFilter("scope",v)));
    const sorting=[["newest","收藏时间 · 最新"],["oldest","收藏时间 · 最早"],["az","英文 A–Z"]];if(state.scope==="video")sorting.push(["video","视频出现顺序"]);
    row.append(selectControl("排序",sorting,state.sort,v=>setFilter("sort",v)));
    const search=el("input");search.type="search";search.placeholder="搜索词句、释义或视频";search.setAttribute("aria-label","搜索词句");search.value=state.query;
    search.addEventListener("input",()=>{state.query=search.value;state.selected.clear();renderLibrary();});root.append(search,row);
    const extra=el("div",undefined,"learning-filters");
    extra.append(selectControl("复习状态",[["","全部"],["unreviewed","未复习"],["again","还要复习"],["known","记住了"]],state.review,v=>setFilter("review",v)));
    if(ctx().libraryView==="sentences"){
      extra.append(selectControl("语法结构",[["","全部语法"],...C.GRAMMAR.map(t=>[t,t])],state.grammar,v=>setFilter("grammar",v)),
        selectControl("表达类型",[["","全部表达"],...C.EXPRESSIONS.map(t=>[t,t])],state.expression,v=>setFilter("expression",v)),
        selectControl("分组",[["","不分组"],["grammar","按语法分组"],["expression","按表达分组"]],state.group,v=>setFilter("group",v)));
    }
    root.append(extra);
    const actions=el("div",undefined,"learning-actions");actions.append(
      button("全选当前结果",()=>{activeEntries().forEach(e=>state.selected.add(e.id));renderLibrary();}),
      button("清除选择",()=>{state.selected.clear();renderLibrary();}),button("下载 Word",()=>openExport(),"learning-button primary"));
    const count=el("span","","learning-muted");count.id="librarySelectionCount";actions.append(count);root.append(actions);
  }
  function renderLibrary(){
    if(!initialized)return;
    const kind=ctx().libraryView;
    $("learningLibraryToolbar").hidden=kind==="notes";
    if(kind==="notes")return;
    const root=$(kind==="sentences"?"sentencesList":"vocabularyList");if(!root)return;
    const entries=entriesFor(kind);root.replaceChildren();
    const count=$("librarySelectionCount");if(count)count.textContent=`${entries.length} 项 · 已选 ${entries.filter(e=>state.selected.has(e.id)).length} 项`;
    if(!entries.length){root.append(el("p",kind==="sentences"?"还没有符合条件的长难句。划选英文字幕后点击「收藏长难句」。":"还没有符合条件的词条。悬停英文单词查看释义，再点击收藏。","learning-empty"));return;}
    for(const [label,list]of C.groupEntries(entries,kind==="sentences"?state.group:"")){
      if(label)root.append(el("h3",`${label} · ${list.length}`,"learning-group-title"));
      for(const entry of list)root.append(entryCard(entry));
    }
  }
  function entryCard(e){
    const card=el("article",undefined,"learning-card");card.dataset.entryId=e.id;
    const header=el("div",undefined,"learning-card-heading"),check=el("input");check.type="checkbox";check.checked=state.selected.has(e.id);check.setAttribute("aria-label",`选择 ${e.term}`);
    check.addEventListener("change",()=>{if(check.checked)state.selected.add(e.id);else state.selected.delete(e.id);for(const other of document.querySelectorAll("[data-entry-id]"))if(other.dataset.entryId===e.id)other.querySelector('input[type="checkbox"]').checked=check.checked;
      const n=activeEntries().filter(e=>state.selected.has(e.id)).length;$("librarySelectionCount").textContent=`${activeEntries().length} 项 · 已选 ${n} 项`;});
    header.append(check,el("h3",e.term));card.append(header);
    if(e.kind==="word"){
      if(e.phonetic)card.append(el("p",e.phonetic,"learning-muted"));
      card.append(el("p",e.meaningZh),el("p",e.explanationZh,"learning-muted"));
      if(e.sourceExcerpt)card.append(el("blockquote",e.sourceExcerpt));
    }else if(e.analysisStatus==="ready"){
      card.append(el("p",e.translationZh));const details=el("details");details.append(el("summary","句子主干与结构拆解"),el("p",e.mainClause),el("p",e.breakdown));card.append(details);
    }else card.append(el("p",e.analysisStatus==="pending"?"原句已保存 · 解析尚未完成":"原句已保存 · 解析失败，可重试","learning-muted"));
    if(e.kind==="sentence"){
      const badges=el("div",undefined,"learning-tags");[...e.grammarTags,...e.expressionTags].forEach(t=>badges.append(el("span",t)));card.append(badges);
    }
    const info=el("p",`${e.videoTitle||"YouTube"} · ${e.timestamp} · 收藏于 ${new Date(e.createdAt).toLocaleDateString()}`,"learning-source");card.append(info);
    const review=state.reviews[e.id];if(review)card.append(el("p",`${review.result==="known"?"记住了":"还要复习"} · ${new Date(review.reviewedAt).toLocaleDateString()}`,"learning-muted"));
    const actions=el("div",undefined,"learning-actions");actions.append(button("回到视频",()=>P.seek(e)));
    if(e.kind==="word")actions.append(button("发音",()=>P.speak(e.term)));
    else{
      actions.append(button("修改分类",()=>editTags(e)));
      if(e.analysisStatus!=="ready")actions.append(button("重新解析",async(_event,b)=>{b.disabled=true;b.textContent="解析中…";try{await analyze(e.id);}finally{if(b.isConnected){b.disabled=false;b.textContent="重新解析";}}}));
    }
    actions.append(button("删除",async()=>{if(!window.confirm(`删除「${e.term.slice(0,80)}」？`))return;
      await send(e.kind==="word"?"deleteVocabulary":"deleteSentence",e.kind==="word"?{vocabularyId:e.id}:{id:e.id});state.selected.delete(e.id);await refreshLibrary();await P.refreshVocabulary();}));card.append(actions);return card;
  }
  async function refreshLibrary(){
    const generation=++state.libraryGeneration;
    const data=await send("getLearningLibrary");if(generation!==state.libraryGeneration)return;
    state.sentences=data.sentences;state.reviews=data.reviews;state.prefs=data.prefs;
    renderLibrary();
  }
  function dialog(title){
    const d=el("dialog",undefined,"learning-dialog");const heading=el("h2",title);heading.id=`learning-dialog-${Date.now()}`;d.setAttribute("aria-labelledby",heading.id);d.append(heading);
    const close=button("关闭",()=>d.close());close.classList.add("dialog-close");d.append(close);document.body.append(d);d.addEventListener("close",()=>d.remove());d.showModal();return d;
  }
  function editTags(e){
    const d=dialog("修改句子分类");d.append(el("p",e.term));
    const boxes=[];
    for(const [title,key,labels]of [["语法结构","grammarTags",C.GRAMMAR],["表达类型","expressionTags",C.EXPRESSIONS]]){
      const group=el("fieldset");group.append(el("legend",title));for(const label of labels){const l=el("label",undefined,"learning-check"),input=el("input");input.type="checkbox";input.checked=e[key].includes(label);boxes.push({input,key,label});l.append(input,el("span",label));group.append(l);}d.append(group);
    }
    d.append(button("保存分类",async()=>{const data={id:e.id,grammarTags:[],expressionTags:[]};boxes.filter(b=>b.input.checked).forEach(b=>data[b.key].push(b.label));await send("editSentence",data);await refreshLibrary();d.close();},"learning-button primary"));
  }
  function openExport(){
    const d=dialog("下载 Word");let mode="handout",scope=state.selected.size?"selected":"filtered",combined=false;
    const count=el("p","","learning-muted");const status=el("p");status.setAttribute("role","status");
    const candidates=()=>{
      const list=combined?[...entriesFor("vocabulary"),...entriesFor("sentences")]:activeEntries();
      return C.filterEntries(C.uniqueEntries(scope==="selected"?list.filter(e=>state.selected.has(e.id)):list),
        {sort:state.sort,videoId:state.scope==="video"?ctx().videoId:null});
    };
    let download;
    const update=()=>{const n=candidates().length;count.textContent=`将导出 ${n} 项，使用当前筛选和排序。`;if(download)download.disabled=n===0;};
    d.append(selectControl("版式",[["handout","学习讲义（含释义与解析）"],["quiz","自测版（答案在文末）"]],mode,v=>mode=v),
      selectControl("导出范围",[["filtered","当前筛选结果"],["selected","勾选的词句"]],scope,v=>{scope=v;update();}));
    const combine=el("label",undefined,"learning-check"),checkbox=el("input");checkbox.type="checkbox";checkbox.addEventListener("change",()=>{combined=checkbox.checked;update();});combine.append(checkbox,el("span","合并单词与长难句（沿用各自适用的筛选条件）"));
    d.append(combine,count,el("p","A4 黑白排版 · 文件在本机生成 · 未完成的解析会明确标记","learning-muted"),status);
    download=button("生成并下载",async()=>{
      const entries=candidates();if(!entries.length)return;download.disabled=true;status.textContent="正在生成 Word…";
      try{const blob=await YTD_WORD.toBlob(entries,{mode});const url=URL.createObjectURL(blob),a=el("a");a.href=url;a.download=`视频英语学习-${mode}-${new Date().toISOString().slice(0,10)}.docx`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status.textContent="Word 已生成，请查看下载列表。";}
      catch{status.textContent="生成失败，请重试。";}finally{update();}
    },"learning-button primary");d.append(download);update();
  }
  function hideFloat(){clearTimeout(hoverTimer);hoverTimer=null;hoverKey="";state.captureGeneration++;float?.remove();float=null;}
  function placeFloat(rect){
    const box=el("div",undefined,"learning-float");box.setAttribute("role","dialog");box.setAttribute("aria-label","字幕词句操作");
    box.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();});box.addEventListener("click",e=>e.stopPropagation());
    document.body.append(box);box.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-312))}px`;box.style.top=`${Math.max(8,Math.min(rect.bottom+8,window.innerHeight-270))}px`;float=box;return box;
  }
  function englishRoot(node){return (node.nodeType===Node.ELEMENT_NODE?node:node.parentElement)?.closest(".transcript-original, .transcript-text");}
  function metadata(term,root,sourceExcerpt){
    const context=ctx(),row=root.closest(".transcript-entry"),index=Number(row?.dataset.segmentIndex);
    const segment=context.segments.find(s=>s.id===row?.dataset.segmentId)||context.segments[index];
    const i=context.segments.indexOf(segment);
    return {term,sourceExcerpt:sourceExcerpt||root.textContent,context:context.segments.slice(Math.max(0,i-1),Math.max(0,i-1)+3).map(s=>s.text).join("\n"),
      videoId:context.videoId,videoTitle:context.videoTitle,channelName:context.channelName,timestamp:Number(row?.dataset.seconds)||segment?.start||0};
  }
  function wordAtPoint(x,y){
    if(!ctx().segments.length)return null;
    const caret=document.caretRangeFromPoint(x,y);if(!caret || caret.startContainer.nodeType!==Node.TEXT_NODE)return null;
    const root=englishRoot(caret.startContainer);if(!root || !$("transcriptList")?.contains(root))return null;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];let node,offset=0,target=-1;
    while((node=walker.nextNode())){nodes.push({node,start:offset,end:offset+node.length});if(node===caret.startContainer)target=offset+caret.startOffset;offset+=node.length;}
    if(target<0)return null;
    // Chromium can return the caret after the final glyph while the pointer is
    // still over that glyph. The range hit check below excludes punctuation.
    const word=C.englishWordAt(root.textContent,target)||C.englishWordAt(root.textContent,target-1);if(!word)return null;
    const start=nodes.find(n=>word.start>=n.start&&word.start<n.end),end=nodes.find(n=>word.end>n.start&&word.end<=n.end);if(!start||!end)return null;
    const range=document.createRange();range.setStart(start.node,word.start-start.start);range.setEnd(end.node,word.end-end.start);
    if(![...range.getClientRects()].some(r=>x>=r.left-1&&x<=r.right+1&&y>=r.top&&y<=r.bottom))return null;
    return {meta:metadata(word.term,root),rect:range.getBoundingClientRect(),key:`${ctx().videoId}:${root.closest(".transcript-entry").dataset.seconds}:${word.start}:${word.term}`};
  }
  async function lookup(item,generation){
    void pingPanel(true);
    const videoId=ctx().videoId,box=placeFloat(item.rect);box.append(el("strong",item.meta.term),el("p","正在查词…","learning-muted"));
    const current=()=>generation===state.captureGeneration&&videoId===ctx().videoId&&box===float;
    const run=async()=>{
      box.replaceChildren(el("strong",item.meta.term),el("p","正在查词…","learning-muted"));
      try{
        const result=await send("lookupVocabulary",item.meta);if(!current())return;
        box.replaceChildren(el("strong",item.meta.term));if(result.enrichment.phonetic)box.append(el("p",result.enrichment.phonetic,"learning-muted"));
        box.append(el("p",result.enrichment.meaningZh),el("p",result.enrichment.explanationZh,"learning-muted"));
        const already=words().some(e=>e.normalizedTerm===C.normalize(item.meta.term));
        const save=button(already?"已收藏":"收藏单词",async(_e,b)=>{b.disabled=true;try{const r=await send("saveVocabulary",item.meta);b.textContent=r.alreadySaved?"已收藏":"已收藏 ✓";await P.refreshVocabulary();void pollStudy();}catch(e){b.disabled=false;throw e;}} ,"learning-button primary");save.disabled=already;
        box.append(button("发音",()=>P.speak(item.meta.term)),save,button("关闭",hideFloat));
      }catch(error){if(!current())return;box.replaceChildren(el("strong",item.meta.term),el("p",error.message),button("重试",run),button("关闭",hideFloat));}
    };
    await run();
  }
  function extractSelection(selection){
    if(!ctx().segments.length)return null;
    if(!selection?.rangeCount||selection.isCollapsed)return null;
    const range=selection.getRangeAt(0),list=$("transcriptList");if(!list?.contains(range.startContainer)||!list.contains(range.endContainer))return null;
    if(!englishRoot(range.startContainer)||!englishRoot(range.endContainer))return null;
    const chunks=[];let first=null;
    for(const root of list.querySelectorAll(".transcript-original, .transcript-text")){
      if(!range.intersectsNode(root))continue;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node,part="";
      while((node=walker.nextNode())){if(!range.intersectsNode(node))continue;const a=node===range.startContainer?range.startOffset:0,b=node===range.endContainer?range.endOffset:node.length;part+=node.textContent.slice(a,b);}
      if(part.trim()){first ||= root;chunks.push(part.trim());}
    }
    const term=chunks.join("\n");if(!term||!/[A-Za-z]/.test(term))return null;
    return {meta:metadata(term,first,term),rect:range.getBoundingClientRect()};
  }
  async function analyze(id){try{await send("analyzeSentence",{id});}finally{await refreshLibrary();}}
  function selectionActions(){
    const item=extractSelection(window.getSelection());if(!item)return;
    hideFloat();const box=placeFloat(item.rect);box.append(el("p",item.meta.term.slice(0,140),"selection-preview"));
    box.append(button("收藏长难句",async(_e,b)=>{
      b.disabled=true;b.textContent="保存中…";
      try{const r=await send("saveSentence",item.meta);b.textContent=r.alreadySaved?"已收藏":"原句已保存 ✓";await refreshLibrary();void pollStudy();
        if(!r.alreadySaved)void analyze(r.entry.id).catch(e=>toast(`原句已保存；${e.message}`,true));
      }catch(e){b.disabled=false;b.textContent="收藏长难句";throw e;}
    },"learning-button primary"),button("解释",()=>{hideFloat();return P.explain(item.meta);}),button("收藏词／短语",async(_e,b)=>{
      b.disabled=true;try{await send("saveVocabulary",item.meta);b.textContent="已收藏 ✓";await P.refreshVocabulary();void pollStudy();}catch(e){b.disabled=false;throw e;}
    }),button("关闭",hideFloat));
  }
  function installCapture(){
    if(captureInstalled)return;captureInstalled=true;
    document.addEventListener("pointermove",e=>{
      if(float?.contains(e.target))return;
      if(dragging||!window.getSelection()?.isCollapsed)return;
      const item=wordAtPoint(e.clientX,e.clientY);
      if(!item){if(hoverKey)hideFloat();return;}
      if(item.key===hoverKey)return;hideFloat();hoverKey=item.key;hoverPoint=item;
      const generation=state.captureGeneration;hoverTimer=setTimeout(()=>void lookup(hoverPoint,generation),600);
    });
    document.addEventListener("pointerdown",e=>{if(float?.contains(e.target))return;dragging=true;hideFloat();});
    document.addEventListener("pointerup",e=>{dragging=false;if(float?.contains(e.target))return;selectionActions();});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")hideFloat();});
    $("contentArea")?.addEventListener("scroll",()=>{if(hoverKey)hideFloat();},{passive:true});
    window.addEventListener("blur",hideFloat);
  }
  function formatTime(ms){const sec=Math.max(0,Math.floor((ms||0)/1000));return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;}
  async function command(command,extra={}){const c=ctx();await send("studyCommand",{command,videoId:c.videoId,videoTitle:c.videoTitle,tabId:c.tabId,...extra});await pollStudy(true);}
  async function pollStudy(force=false){
    if(studyPollBusy&&!force)return;studyPollBusy=true;
    try{const data=await send("getStudy");const before=state.study?.current;state.study=data;
      if(before?.status!=="due"&&data.current?.status==="due")toast("学习时间到了。视频已暂停，可以开始复习。 ");renderStudy();
    }catch(error){if(force)showError(error);}finally{studyPollBusy=false;}
  }
  function renderStudy(){
    const root=$("studyPanel");if(!root||!state.study)return;
    // Preserve the start form while the student edits it between periodic polls.
    const s=state.study.current;
    const running=s&&s.status!=="ended";
    const signature=`${s?.id||"none"}:${s?.status||"idle"}`;
    if(root.dataset.signature!==signature){
      root.dataset.signature=signature;root.replaceChildren(el("h2","学习 · 专注与复习"),el("p","记录观看和复习行为，不把播放时长当作学习效果。","learning-muted"));
      if(!running){
        const form=el("form",undefined,"learning-start-form"),prefs={...C.DEFAULTS,...state.prefs.session};
        const fields={};
        for(const [key,label,min,max]of [["minutes","学习时长（分钟）",1,180],["wordGoal","单词目标",0,500],["sentenceGoal","长难句目标",0,500]]){
          const labelEl=el("label",undefined,"learning-field"),input=el("input");input.type="number";input.min=min;input.max=max;input.step=1;input.required=true;input.value=prefs[key];input.name=key;labelEl.append(el("span",label),input);form.append(labelEl);fields[key]=input;
        }
        const label=el("label",undefined,"learning-check"),check=el("input");check.type="checkbox";check.checked=prefs.reduceDistractions;label.append(check,el("span","减少干扰：隐藏推荐与评论，阻止自动连续播放"));form.append(label);
        const submit=el("button","开始学习","learning-button primary");submit.type="submit";form.append(submit);
        form.addEventListener("submit",async e=>{e.preventDefault();submit.disabled=true;try{const values=Object.fromEntries(Object.entries(fields).map(([k,input])=>[k,Number(input.value)]));await command("start",{...values,reduceDistractions:check.checked});}catch(error){showError(error);}finally{submit.disabled=false;}});root.append(form);
      }else{
        root.append(el("h3",s.videoTitle||"当前视频"));
        const controls=el("div",undefined,"learning-actions");
        if(s.status==="running")controls.append(button("暂停学习",()=>command("pause")));
        if(s.status==="paused")controls.append(button("继续学习",()=>command("resume")));
        if(["due","review"].includes(s.status))controls.append(button("加时 5 分钟",()=>{state.reviewQueue=[];return command("extend");}));
        controls.append(button("开始复习",startReview),button("结束学习",()=>{state.reviewQueue=[];return command("end");}));root.append(controls);
        const label=el("label",undefined,"learning-check"),check=el("input");check.type="checkbox";check.checked=s.reduceDistractions;check.addEventListener("change",()=>command("distractions",{enabled:check.checked}).catch(showError));label.append(check,el("span","减少推荐与评论干扰"));root.append(label);
      }
      const stats=el("div",undefined,"learning-stats");stats.id="studyStats";root.append(stats);
      const review=el("div");review.id="studyReview";root.append(review);
      root.append(el("h3","今日与最近 7 天"));const history=el("div");history.id="studyHistory";root.append(history);
      root.append(el("p","倍速和拖动不增加时长；后台、缓冲和离线不计时。暂停后的操作在最近 60 秒有交互时计时。学习记录仅保存在本机，保留 90 天。","learning-muted"));
    }
    const stats=$("studyStats");stats.replaceChildren();
    if(s){const labels={running:"学习中",paused:"已暂停",due:"时间到了",review:"复习中",ended:"本次已结束"};stats.append(el("p",`${labels[s.status]} · 剩余 ${formatTime(Math.ceil(Math.max(0,s.targetMs-s.watchMs-s.activityMs)/1000)*1000)}`));
      for(const [label,value]of [["前台观看",formatTime(s.watchMs)],["字幕与词句操作",formatTime(s.activityMs)],["翻卡复习",formatTime(s.reviewMs)],["单词",`${s.wordIds.length} / ${s.wordGoal}`],["长难句",`${s.sentenceIds.length} / ${s.sentenceGoal}`]]){const item=el("div");item.append(el("span",label),el("strong",value));stats.append(item);}}
    const history=$("studyHistory");history.replaceChildren();for(const day of state.study.days){history.append(el("p",`${day.day}${day.day===C.dayKey(Date.now())?" · 今日":""}　观看 ${formatTime(day.watchMs)} ／ 操作 ${formatTime(day.activityMs)} ／ 复习 ${formatTime(day.reviewMs)}`,"learning-history-row"));}
    renderReview();
  }
  async function startReview(){
    await refreshLibrary();await P.refreshVocabulary();
    const s=state.study?.current;if(!s)return;
    const ids=new Set([...s.wordIds,...s.sentenceIds]);
    const all=[...words(),...sentences()];state.reviewQueue=all.filter(e=>ids.has(e.id));
    // With no new collection, explicitly offer existing words from this video.
    if(!state.reviewQueue.length){const previous=all.filter(e=>e.videoId===s.videoId);if(!previous.length){toast("本次没有收藏，也没有这个视频的历史词句。可继续学习或结束。");return;}
      if(!window.confirm(`本次没有新增收藏。复习这个视频已有的 ${previous.length} 个词句？`))return;state.reviewQueue=previous;}
    state.reviewIndex=0;state.revealed=false;state.reviewDone=false;await command("review");P.switchTab("study");renderReview();
  }
  function renderReview(){
    const root=$("studyReview");if(!root)return;
    const sig=`${state.study?.current?.status}:${state.reviewIndex}:${state.revealed}:${state.reviewQueue.length}:${state.reviewDone}`;
    if(root.dataset.signature===sig)return;root.dataset.signature=sig;root.replaceChildren();
    if(state.study?.current?.status!=="review")return;
    if(!state.reviewQueue.length){root.append(button("加载本次复习卡",startReview));return;}
    const e=state.reviewQueue[state.reviewIndex];
    if(!e){root.append(el("h3","本轮复习完成"),el("p","“记住了”是你的自评，需要时可在收藏库中筛选“还要复习”。"));return;}
    root.className="learning-review-card";root.append(el("p",`词句 ${state.reviewIndex+1} / ${state.reviewQueue.length}`,"learning-muted"),el("h3",e.term));
    if(!state.revealed)root.append(button("回忆后查看答案",()=>{state.revealed=true;renderReview();},"learning-button primary"));
    else{
      root.append(el("p",e.kind==="sentence"?e.translationZh||"解析未完成，可到收藏库重试。":e.meaningZh));
      root.append(el("p",e.kind==="sentence"?[e.mainClause,e.breakdown].filter(Boolean).join("\n"):e.explanationZh));
      for(const [value,label]of [["known","记住了"],["again","还要复习"]])root.append(button(label,async(_event,b)=>{b.disabled=true;try{await send("markReview",{id:e.id,result:value});state.reviews[e.id]={result:value,reviewedAt:Date.now()};state.reviewIndex++;state.revealed=false;state.reviewDone=state.reviewIndex>=state.reviewQueue.length;renderReview();}catch(error){b.disabled=false;throw error;}}));
    }
  }
  async function pingPanel(interaction=false,hidden=false){
    const now=Date.now();if(interaction)state.lastInteraction=now;
    if(!hidden&&now-lastPanelPing<1000)return;lastPanelPing=now;
    const c=ctx();if(!c.videoId||!c.tabId)return;
    await send("studyPanelActivity",{tabId:c.tabId,videoId:c.videoId,interaction:now-state.lastInteraction<1500,
      activity:["transcript","library"].includes(state.tab),
      review:state.tab==="study"&&state.study?.current?.status==="review"&&!state.reviewDone,hidden:hidden||document.visibilityState!=="visible"}).catch(()=>{});
  }
  function tabChanged(tab){state.tab=tab;hideFloat();renderToolbar();renderLibrary();void pingPanel(true);if(tab==="study")void pollStudy();}
  function videoChanged(){hideFloat();state.selected.clear();state.reviewQueue=[];state.reviewDone=false;void refreshLibrary().catch(showError);void pollStudy();}
  async function init(){
    if(initialized)return;initialized=true;
    try{const data=await send("getLearningLibrary");state.sentences=data.sentences;state.reviews=data.reviews;state.prefs=data.prefs;Object.assign(state,data.prefs.library||{});}catch(error){showError(error);}
    $("librarySentencesTab")?.addEventListener("click",()=>{P.switchLibraryView("sentences");renderToolbar();renderLibrary();});
    for(const id of ["libraryVocabularyTab","libraryNotesTab"])$(id)?.addEventListener("click",()=>{renderToolbar();renderLibrary();});
    P.switchLibraryView("vocabulary");renderToolbar();renderLibrary();installCapture();void pollStudy();
    chrome.runtime.onMessage.addListener(m=>{if(m.action==="learningChanged"){void refreshLibrary().catch(showError);void pollStudy();}if(m.action==="vocabularySaved")void P.refreshVocabulary();});
    for(const event of ["pointerdown","keydown","scroll"])document.addEventListener(event,e=>{
      if(e.isTrusted&&(e.target.closest?.("#transcriptList, [data-panel=library], #studyReview, .learning-float") || e.type==="scroll"))void pingPanel(true);
    },{capture:true,passive:true});
    setInterval(()=>{void pingPanel();void pollStudy();},500);
    document.addEventListener("visibilitychange",()=>{hideFloat();void pingPanel(false,document.visibilityState!=="visible");});
    window.addEventListener("pagehide",()=>void pingPanel(false,true));
  }
  globalThis.YTD_LEARNING_UI={installCapture,tabChanged,videoChanged,refreshLibrary,renderLibrary,extractSelection,wordAtPoint,entriesFor,state};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void init());else void init();
})();
