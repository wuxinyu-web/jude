/* Vocabulary, sentence, study and export interfaces share the existing panel. */
(() => {
  if(globalThis.YTD_LEARNING_UI)return;
  const C=YTD_LEARNING,P=YTD_PANEL;
  const $=id=>document.getElementById(id);
  const state={sentences:[],reviews:{},prefs:{},query:"",scope:"video",sort:"newest",grammar:"",expression:"",group:"",review:"",
    selected:new Set(),libraryGeneration:0,captureGeneration:0,study:null,reviewQueue:[],reviewIndex:0,revealed:false,reviewDone:false,tab:"transcript",lastInteraction:0};
  let initialized=false,captureInstalled=false,leaveTimer=null,hoverTimer=null,selectionTimer=null,hoverKey="",hoverPoint=null,float=null,dragging=false,lastPanelPing=0,studyPollBusy=false,panelOpened=false;
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
    const search=el("input");search.type="search";search.placeholder="搜索词句、释义或视频…";search.setAttribute("aria-label","搜索词句");search.autocomplete="off";search.name="library-search";search.value=state.query;
    search.addEventListener("input",()=>{state.query=search.value;state.selected.clear();renderLibrary();});root.append(search,row);
    const extra=el("div",undefined,"learning-filters");
    extra.append(selectControl("复习状态",[["","全部"],["unreviewed","未练习"],["unsure","不熟"],["again","没记住"],["known","记住了"]],state.review,v=>setFilter("review",v)));
    if(ctx().libraryView==="sentences"){
      extra.append(selectControl("语法结构",[["","全部语法"],...C.GRAMMAR.map(t=>[t,t])],state.grammar,v=>setFilter("grammar",v)),
        selectControl("表达类型",[["","全部表达"],...C.EXPRESSIONS.map(t=>[t,t])],state.expression,v=>setFilter("expression",v)),
        selectControl("分组",[["","不分组"],["grammar","按语法分组"],["expression","按表达分组"]],state.group,v=>setFilter("group",v)));
    }
    root.append(extra);
    const actions=el("div",undefined,"learning-actions");actions.append(
      button("全选当前结果",()=>{activeEntries().forEach(e=>state.selected.add(e.id));renderLibrary();}),
      button("清除选择",()=>{state.selected.clear();renderLibrary();}),button("下载 Word",()=>openExport(),"learning-button primary"),
      button("导出 Excel",exportLibraryExcel,"learning-button library-excel-export"));
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
    if(!entries.length){root.append(el("p",kind==="sentences"?"还没有符合条件的长难句。划选英文字幕后点击「收藏句子」。":"还没有符合条件的词条。悬停英文单词查看释义，再点击收藏。","learning-empty"));return;}
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
    const review=state.reviews[e.id];if(review)card.append(el("p",`${review.result==="known"?"记住了":review.result==="unsure"?"不熟":"没记住"} · ${new Date(review.reviewedAt).toLocaleDateString()}`,"learning-muted"));
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
    d.append(selectControl("版式",[["handout","纯讲义版"],["handout-quiz","讲义＋测试题版（参考答案在最后）"]],mode,v=>mode=v),
      selectControl("导出范围",[["filtered","当前筛选结果"],["selected","勾选的词句"]],scope,v=>{scope=v;update();}));
    const combine=el("label",undefined,"learning-check"),checkbox=el("input");checkbox.type="checkbox";checkbox.addEventListener("change",()=>{combined=checkbox.checked;update();});combine.append(checkbox,el("span","合并单词与长难句（沿用各自适用的筛选条件）"));
    d.append(combine,count,el("p","A4 黑白排版 · 文件在本机生成 · 未完成的解析会明确标记","learning-muted"),status);
    download=button("生成并下载",async()=>{
      const entries=candidates();if(!entries.length)return;download.disabled=true;status.textContent="正在生成 Word…";
      try{const blob=await YTD_WORD.toBlob(entries,{mode});const url=URL.createObjectURL(blob),a=el("a");a.href=url;a.download=`句得-${mode==="handout-quiz"?"讲义与测试题":"纯讲义"}-${new Date().toISOString().slice(0,10)}.docx`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status.textContent="Word 已生成，请查看下载列表。";}
      catch{status.textContent="生成失败，请重试。";}finally{update();}
    },"learning-button primary");d.append(download);update();
  }
  async function saveWorkbook(blob,filename){
    const mobile=globalThis.matchMedia?.("(pointer: coarse)")?.matches;
    if(mobile&&typeof File==="function"&&navigator.share&&navigator.canShare){
      const file=new File([blob],filename,{type:blob.type});
      if(navigator.canShare({files:[file]})){
        try{await navigator.share({files:[file],title:"句得词句库"});return "已打开系统分享，可保存到文件或发送到其他应用。";}
        catch(error){if(error?.name==="AbortError")return "已取消导出。";throw error;}
      }
    }
    const url=URL.createObjectURL(blob),a=el("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    return "Excel 已生成，请查看下载列表。";
  }
  async function exportLibraryExcel(){
    const entries=C.uniqueEntries([...entriesFor("vocabulary"),...entriesFor("sentences")]);
    if(!entries.length)throw new Error("当前范围没有可导出的生词或长难句。");
    const filename=`句得-词句库-${C.dayKey(Date.now())}.xlsx`;
    toast(await saveWorkbook(YTD_EXCEL.libraryToBlob(entries),filename));
  }
  function hideFloat(){clearTimeout(selectionTimer);selectionTimer=null;clearTimeout(leaveTimer);leaveTimer=null;globalThis.CSS?.highlights?.delete("ytd-hover-word");clearTimeout(hoverTimer);hoverTimer=null;hoverKey="";state.captureGeneration++;float?.remove();float=null;}
  function placeFloat(rect){
    const box=el("div",undefined,"learning-float");box.setAttribute("role","dialog");box.setAttribute("aria-label","字幕词句操作");
    box.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();});box.addEventListener("click",e=>e.stopPropagation());
    document.body.append(box);float=box;
    box.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-312))}px`;
    box.style.top=`${Math.max(8,Math.min(rect.bottom+8,innerHeight-270))}px`;
    return box;
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
    const point=document.caretPositionFromPoint?.(x,y);
    const caret=document.caretRangeFromPoint?.(x,y)||(point?{startContainer:point.offsetNode,startOffset:point.offset}:null);if(!caret || caret.startContainer.nodeType!==Node.TEXT_NODE)return null;
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
    return {range,meta:metadata(word.term,root),rect:range.getBoundingClientRect(),key:`${ctx().videoId}:${root.closest(".transcript-entry").dataset.seconds}:${word.start}:${word.term}`};
  }
  async function lookup(item,generation){
    void pingPanel(true);
    const videoId=ctx().videoId,box=placeFloat(item.rect);
    const current=()=>generation===state.captureGeneration&&videoId===ctx().videoId&&box===float;
    box.classList.add("learning-word-float");
    const header=el("div",undefined,"learning-word-header"),actions=el("div",undefined,"learning-word-actions");
    const body=el("div",undefined,"learning-word-definition");body.setAttribute("aria-live","polite");
    const already=words().some(e=>e.normalizedTerm===C.normalize(item.meta.term));
    const save=button(already?"已收藏":"收藏单词",async(_e,b)=>{
      if(b.disabled)return;
      box.dataset.pinned="true";b.disabled=true;b.textContent="收藏中…";
      try{
        // The worker shares the pending lookup: saving never starts a second
        // definition request or stores placeholder enrichment.
        const r=await send("saveVocabulary",item.meta);
        b.textContent=r.alreadySaved?"已收藏":"已收藏 ✓";
        await P.refreshVocabulary();void pollStudy();
      }catch(error){b.disabled=false;b.textContent="收藏单词";if(current())showError(error);}
    },"learning-button primary");save.disabled=already;
    actions.append(button("发音",()=>P.speak(item.meta.term)),save,button("关闭",hideFloat));
    header.append(el("strong",item.meta.term),actions);box.append(header,body);
    box.style.left=`${Math.max(8,Math.min(item.rect.left,innerWidth-box.offsetWidth-8))}px`;
    const run=async()=>{
      body.replaceChildren(el("p","正在查词…","learning-muted"));
      try{
        const result=await send("lookupVocabulary",item.meta);if(!current())return;
        body.replaceChildren();if(result.enrichment.phonetic)body.append(el("p",result.enrichment.phonetic,"learning-muted"));
        body.append(el("p",result.enrichment.meaningZh),el("p",result.enrichment.explanationZh,"learning-muted"));
      }catch(error){if(!current())return;body.replaceChildren(el("p",error.message),button("重试",run));}
    };
    await run();
  }
  function extractSelection(selection){
    if(!ctx().segments.length)return null;
    if(!selection?.rangeCount||selection.isCollapsed)return null;
    const range=selection.getRangeAt(0),list=$("transcriptList");if(!list?.contains(range.startContainer)||!list.contains(range.endContainer))return null;
    // Native sentence selection may end on the row/span boundary; collect only
    // intersecting English text below rather than rejecting those boundaries.
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
    const item=extractSelection(window.getSelection());if(!item)return;void pingPanel(true);
    if(float?.dataset.selectionTerm===item.meta.term)return;
    hideFloat();const box=placeFloat(item.rect);box.dataset.selectionTerm=item.meta.term;box.dataset.pinned="true";
    box.append(el("strong","已选中句子"),el("p",item.meta.term.slice(0,140),"selection-preview"));
    box.append(button("收藏句子",async(_e,b)=>{
      const followSnapshot=P.sentenceFollowSnapshot();
      b.disabled=true;b.textContent="保存中…";
      try{const r=await send("saveSentence",item.meta);b.textContent=r.alreadySaved?"已收藏":"原句已保存 ✓";hideFloat();void P.followAfterSentenceSave(followSnapshot);await refreshLibrary();void pollStudy();
        if(!r.alreadySaved)void analyze(r.entry.id).catch(e=>toast(`原句已保存；${e.message}`,true));
      }catch(e){b.disabled=false;b.textContent="收藏句子";throw e;}
    },"learning-button primary"),button("解释",()=>{hideFloat();return P.explain(item.meta);}),button("收藏词／短语",async(_e,b)=>{
      b.disabled=true;try{await send("saveVocabulary",item.meta);b.textContent="已收藏 ✓";await P.refreshVocabulary();void pollStudy();}catch(e){b.disabled=false;throw e;}
    }),button("关闭",hideFloat));
  }
  function installCapture(){
    if(captureInstalled)return;captureInstalled=true;
    let touchStart=null,touchClick=null;
    document.addEventListener('click',e=>{
      if(touchClick&&Date.now()-touchClick.time<750&&touchClick.root===e.target.closest?.('.transcript-original,.transcript-text')){
        touchClick=null;e.preventDefault();e.stopImmediatePropagation();
      }
    },true);
    document.addEventListener("pointermove",e=>{
      if(e.pointerType==="touch")return;
      if(float?.contains(e.target)){clearTimeout(leaveTimer);leaveTimer=null;return;}
      if(dragging||!window.getSelection()?.isCollapsed)return;
      const item=wordAtPoint(e.clientX,e.clientY);
      if(!item){
        if(hoverKey && !leaveTimer && !float?.dataset.pinned){
          if(float)leaveTimer=setTimeout(hideFloat,250);else hideFloat();
        }
        return;
      }
      clearTimeout(leaveTimer);leaveTimer=null;
      if(item.key===hoverKey)return;hideFloat();hoverKey=item.key;hoverPoint=item;
      // Paint the exact word without wrapping text or disturbing native selection.
      if(globalThis.CSS?.highlights && globalThis.Highlight)CSS.highlights.set("ytd-hover-word",new Highlight(item.range));
      const generation=state.captureGeneration;hoverTimer=setTimeout(()=>void lookup(hoverPoint,generation),600);
    });
    document.addEventListener("pointerdown",e=>{if(float?.contains(e.target))return;touchStart=e.pointerType==="touch"?{x:e.clientX,y:e.clientY,time:Date.now()}:null;dragging=true;hideFloat();});
    const scheduleSelection=()=>{clearTimeout(selectionTimer);selectionTimer=setTimeout(()=>{if(!dragging)selectionActions();},80);};
    document.addEventListener("selectionchange",()=>{if(!dragging && !window.getSelection()?.isCollapsed)scheduleSelection();});
    document.addEventListener("pointerup",e=>{
      dragging=false;if(float?.contains(e.target))return;
      const tap=touchStart;touchStart=null;
      if(e.pointerType==='touch'&&tap&&Date.now()-tap.time<500&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<10&&window.getSelection()?.isCollapsed){
        const item=wordAtPoint(e.clientX,e.clientY);
        if(item){touchClick={root:e.target.closest?.('.transcript-original,.transcript-text'),time:Date.now()};hideFloat();hoverKey=item.key;hoverPoint=item;void lookup(item,state.captureGeneration);return;}
      }
      scheduleSelection();
    });
    document.addEventListener("mouseup",e=>{if(!float?.contains(e.target))scheduleSelection();});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")hideFloat();});
    document.addEventListener("keyup",e=>{if(e.key==='Shift')selectionActions();});
    document.addEventListener("pointercancel",()=>{touchStart=null;dragging=false;hideFloat();});
    $("contentArea")?.addEventListener("scroll",()=>{if(hoverKey && !float?.dataset.pinned)hideFloat();},{passive:true});
    // Focus can change while clicking an action inside the embedded iframe.
    // Visibility/context changes close the card; blur must not swallow that click.
    window.addEventListener("blur",()=>{dragging=false;});
  }
  function formatStudyClock(ms,{remaining=false}={}){
    const seconds=Math.max(0,(remaining?Math.ceil:Math.floor)((Number(ms)||0)/1000));
    return `${Math.floor(seconds/3600)}h ${String(Math.floor(seconds%3600/60)).padStart(2,"0")}m ${String(seconds%60).padStart(2,"0")}s`;
  }
  function formatTime(ms){const sec=Math.max(0,Math.floor((ms||0)/1000));return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;}
  async function command(command,extra={}){const c=ctx();await send("studyCommand",{command,videoId:c.videoId,videoTitle:c.videoTitle,tabId:c.tabId,...extra});await pollStudy(true);}
  async function pollStudy(force=false){
    if(studyPollBusy)return;studyPollBusy=true;
    try{if(!panelOpened&&ctx().tabId&&ctx().videoId){panelOpened=true;try{await send("studyPanelOpened",{tabId:ctx().tabId});}catch(e){panelOpened=false;throw e;}}state.study=await send("getStudy");
      const c=ctx(),current=state.study.current;
      if(c.videoId&&c.tabId&&!document.hidden&&(!current||current.status!=="running"||current.videoId!==c.videoId||current.tabId!==c.tabId)){
        try{
          await send("studyCommand",{command:"auto",videoId:c.videoId,videoTitle:c.videoTitle,tabId:c.tabId,minutes:180,wordGoal:0,sentenceGoal:0,reduceDistractions:false});
          state.study=await send("getStudy");
        }catch{/* Foreground validation prevents background windows from starting a session. */}
      }
      renderStudy();}catch(error){if(force)showError(error);}finally{studyPollBusy=false;}
  }
  async function exportRecords(){const r=await send("exportStudy"),url=URL.createObjectURL(YTD_EXCEL.toBlob(r.data));const a=el("a");a.href=url;a.download=`句得-学习记录-${C.dayKey(Date.now())}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function clearRecords(){if(!window.confirm("确认清空全部自由学习、闯关试卷、作答成绩、时长与练习进度？收藏的词句、笔记和收藏库自评会保留。"))return;await send("clearStudy");state.reviewQueue=[];state.newTask=false;await pollStudy(true);}
  function returnVideo(){state.reviewQueue=[];state.reviewDone=true;void pingPanel(false);P.switchTab("transcript");if(state.study?.current?.status!=="ended")void command("video").catch(showError);}
  function openRecords(){
    const d=dialog("学习记录");
    const rules=el("details");rules.append(el("summary","计时说明"),el("p","前台播放、字幕操作和复习自动记录，暂停、后台及无有效操作时不计时。记录仅存本机，保留 90 天。"));
    d.append(rules,button("导出 Excel",exportRecords),button("清空学习记录",async()=>{await clearRecords();d.close();}));
  }
  function renderStudyChart(){
    const host=$("studyHomeHistory"),days=state.study?.days||[];if(!host)return;
    const key=days.map(d=>d.day).join(',');
    if(host.dataset.days!==key){
      host.dataset.days=key;host.replaceChildren(el("h3","最近 7 天"));
      const chart=el("div",undefined,"study-chart");
      days.forEach(day=>{const b=button("",()=>{state.selectedHistoryDay=day.day;renderStudyChart();},"study-day");b.append(el("span",undefined,"study-day-bar"),el("span",day.day.slice(5)));chart.append(b);});
      const detail=el("p",undefined,"learning-muted");detail.id="studyHomeDayDetail";host.append(chart,detail);
    }
    const selected=days.find(d=>d.day===state.selectedHistoryDay)||days.at(-1),max=Math.max(1,...days.map(C.totalMs));
    [...host.querySelectorAll('.study-day')].forEach((b,i)=>{const day=days[i];b.firstChild.style.height=`${Math.max(2,64*C.totalMs(day)/max)}px`;b.setAttribute('aria-pressed',String(day===selected));b.setAttribute('aria-label',`${day.day}，有效学习 ${formatStudyClock(C.totalMs(day))}`);});
    if(selected)$("studyHomeDayDetail").textContent=`${selected.day} · 观看 ${formatStudyClock(selected.watchMs)} ／ 操作 ${formatStudyClock(selected.activityMs)} ／ 复习 ${formatStudyClock(selected.reviewMs)}`;
  }
  function renderStudy(){
    const root=$("studyPanel");if(!root||!state.study)return;
    if(!root.dataset.simple){
      root.dataset.simple="true";root.replaceChildren();
      const label=el("p","今天已学习","learning-muted"),clock=el("p",undefined,"study-simple-clock");clock.id="studyToday";
      const status=el("p",undefined,"learning-muted");status.id="studySimpleStatus";
      const actions=el("div",undefined,"study-simple-actions");actions.append(button("复习收藏",()=>startReview(),"learning-button primary"),button("学习记录",openRecords));
      const review=el("div");review.id="studyReview";const history=el("section");history.id="studyHomeHistory";root.append(label,clock,status,history,actions,review);
    }
    const today=state.study.days?.at(-1);$("studyToday").textContent=formatStudyClock(today?C.totalMs(today):0);
    $("studySimpleStatus").textContent=ctx().videoId?"边看边学，时长自动记录":"打开视频，即可开始学习";
    renderStudyChart();renderReview();
  }
  async function startReview(filter="all"){
    await refreshLibrary();await P.refreshVocabulary();
    state.reviewQueue=[...words(),...sentences()].sort((a,b)=>(state.reviews[a.id]?.result==='known')-(state.reviews[b.id]?.result==='known'));
    if(!state.reviewQueue.length){toast("还没有收藏，先在字幕中收藏喜欢的词句吧。");return;}
    state.reviewIndex=0;state.revealed=false;state.reviewDone=false;state.focusReview=true;
    const current=state.study?.current;
    if(current?.status==='running'&&current.videoId===ctx().videoId)await command("review");
    P.switchTab("study");renderReview();
  }
  function renderReview(){
    const root=$("studyReview");if(!root)return;
    const s=state.study?.current,sig=`${s?.status}:${s?.activityMode}:${state.reviewIndex}:${state.revealed}:${state.reviewQueue.length}:${state.reviewDone}`;
    if(root.dataset.signature===sig)return;root.dataset.signature=sig;root.replaceChildren();
    if(!state.reviewQueue.length)return;
    if(!state.reviewQueue.length){root.append(button("加载本次复习卡",()=>startReview()));return;}
    const e=state.reviewQueue[state.reviewIndex];
    if(!e){root.append(el("h3","本轮练习完成"),el("p","自评已保存。一次“记住了”不代表已经掌握。"),button("返回视频",returnVideo));return;}
    root.className="learning-review-card";root.append(el("p",`词句 ${state.reviewIndex+1} / ${state.reviewQueue.length}`,"learning-muted"),el("h3",e.term));
    if(!state.revealed)root.append(button("回忆后查看答案",()=>{state.revealed=true;void pingPanel(true);renderReview();},"learning-button primary"));
    else{
      root.append(el("p",e.kind==="sentence"?e.translationZh||"解析未完成，可到收藏库重试。":e.meaningZh),el("p",e.kind==="sentence"?[e.mainClause,e.breakdown].filter(Boolean).join("\n"):e.explanationZh));
      for(const [value,label]of [["known","记住了"],["unsure","不熟"],["again","没记住"]])root.append(button(label,async(_event,b)=>{b.disabled=true;try{await send("markReview",{id:e.id,result:value,sessionId:s?.status==="running"&&s.videoId===e.videoId&&s.videoId===ctx().videoId?s.id:undefined,tabId:ctx().tabId});state.reviews[e.id]={result:value,reviewedAt:Date.now()};state.reviewIndex++;state.revealed=false;state.reviewDone=state.reviewIndex>=state.reviewQueue.length;void pingPanel(true);renderReview();await pollStudy(true);}catch(error){b.disabled=false;throw error;}}));
    }
    if(state.focusReview){state.focusReview=false;requestAnimationFrame(()=>{root.scrollIntoView({block:"center"});root.querySelector("button")?.focus({preventScroll:true});});}
  }
  async function pingPanel(interaction=false,hidden=false){
    const now=Date.now();if(!interaction&&!hidden&&now-lastPanelPing<1000)return;lastPanelPing=now;
    const c=ctx();if(!c.videoId||!c.tabId)return;
    await send("studyPanelActivity",{tabId:c.tabId,videoId:c.videoId,interaction,
      activity:["transcript","library"].includes(state.tab),
      review:state.tab==="study"&&state.study?.current?.activityMode==="review"&&state.study?.current?.status==="running"&&state.reviewQueue.length>0&&!state.reviewDone,
      hidden:hidden||document.visibilityState!=="visible"}).catch(()=>{});
  }
  function tabChanged(tab){state.tab=tab;hideFloat();renderToolbar();renderLibrary();void pingPanel();if(tab==="study")void pollStudy();}
  function videoChanged(){globalThis.YTD_IMMERSIVE_UI?.reset();hideFloat();state.selected.clear();state.reviewQueue=[];state.reviewDone=false;void refreshLibrary().catch(showError);void pollStudy();}
  async function init(){
    if(initialized)return;initialized=true;
    try{const data=await send("getLearningLibrary");state.sentences=data.sentences;state.reviews=data.reviews;state.prefs=data.prefs;Object.assign(state,data.prefs.library||{});}catch(error){showError(error);}
    $("librarySentencesTab")?.addEventListener("click",()=>{P.switchLibraryView("sentences");renderToolbar();renderLibrary();});
    for(const id of ["libraryVocabularyTab","libraryNotesTab"])$(id)?.addEventListener("click",()=>{renderToolbar();renderLibrary();});
    P.switchLibraryView("vocabulary");renderToolbar();renderLibrary();installCapture();void pollStudy();
    chrome.runtime.onMessage.addListener(m=>{if(m.action==="learningChanged"){void refreshLibrary().catch(showError);void pollStudy();}if(m.action==="vocabularySaved")void P.refreshVocabulary();});
    for(const event of ["click","keydown"])document.addEventListener(event,e=>{
      if(e.isTrusted&&(e.target.closest?.("#studyReview button, .learning-float button")))void pingPanel(true);
    },{capture:true,passive:true});
    setInterval(()=>{void pingPanel();void pollStudy();},500);
    document.addEventListener("visibilitychange",()=>{hideFloat();void pingPanel(false,document.visibilityState!=="visible");});
    window.addEventListener("pagehide",()=>void pingPanel(false,true));
  }
  globalThis.YTD_LEARNING_UI={isTranscriptInteracting:()=>Boolean(hoverKey || float || dragging),installCapture,tabChanged,videoChanged,refreshLibrary,renderLibrary,extractSelection,wordAtPoint,entriesFor,state,
    immersiveLookup:(meta,rect)=>{hideFloat();void lookup({meta,rect},state.captureGeneration);},
    immersiveActivity:()=>pingPanel(true),immersiveClose:()=>{dragging=false;hideFloat();}};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void init());else void init();
})();
