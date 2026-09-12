/* One timestamped cue at a time; collections stay in the existing library. */
var YTD_IMMERSIVE_CORE=(()=>{
  function cueAt(segments,time){
    if(!Number.isFinite(time)||time<0)return null;
    let low=0,high=segments.length-1,index=-1;
    while(low<=high){const mid=(low+high)>>1;if(segments[mid].start<=time){index=mid;low=mid+1;}else high=mid-1;}
    const cue=segments[index];return cue&&time<cue.start+cue.duration?cue:null;
  }
  function tokens(text){return [...text.matchAll(/(?:[A-Za-z]\.)+[A-Za-z]\.?|[A-Za-z]+(?:[’'\-][A-Za-z]+)*/g)].map(m=>({term:m[0],start:m.index,end:m.index+m[0].length}));}
  // One request at a time, with only the latest queued cue retained after seeking.
  function translationQueue(request,changed){
    const states=new Map();let busy=false,pending=null;
    async function drain(){if(busy||!pending)return;const item=pending;pending=null;busy=true;
      try{const text=await request(item.value);if(!text?.trim())throw new Error('中文翻译暂不可用。');states.set(item.key,{text});}
      catch(e){states.set(item.key,{error:e.message||'中文翻译失败，请重试。'});}
      finally{busy=false;while(states.size>150)states.delete(states.keys().next().value);changed();void drain();}
    }
    return {get:key=>states.get(key),ensure(key,value){if(states.has(key))return;if(pending)states.delete(pending.key);states.set(key,{loading:true});pending={key,value};void drain();},retry(key,value){if(states.get(key)?.loading)return;states.delete(key);this.ensure(key,value);}};
  }
  return {cueAt,tokens,translationQueue};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=YTD_IMMERSIVE_CORE;
if(typeof document!=='undefined' && /(?:[?&])immersive=1(?:&|$)/.test(location.search))(()=>{
  const P=YTD_PANEL,L=YTD_LEARNING_UI;
  document.documentElement.classList.add('immersive');
  let cue=null,signature='',videoId=null,generation=null,locked=false,showChinese=true,timer=null,press=null,suppressClick=false,pending=null;
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const root=el('section',undefined,'immersive-stage');root.id='immersiveStage';root.setAttribute('aria-label','沉浸式同步台词');
  const toolbar=el('nav',undefined,'immersive-toolbar'),time=el('span','等待字幕…','immersive-time');toolbar.append(time);
  const status=el('p','','immersive-status');status.setAttribute('role','status');
  const text=el('div','正在载入字幕…','immersive-cue');text.id='immersiveCue';
  const chinese=el('p','','immersive-translation');chinese.hidden=true;
  const body=el('div',undefined,'immersive-caption');body.append(text,chinese);
  const button=(label,title,fn)=>{const b=el('button',label);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>status.textContent=e.message));return b;};
  async function full(view){
    const c=P.context();await chrome.storage.session.set({ytd_immersive_return:{tabId:c.tabId,view}});
    const r=await chrome.runtime.sendMessage({action:'setLearningLayout',mode:'vertical',tabId:c.tabId});if(!r?.success)throw new Error(r?.error||'请刷新视频页面后重试。');
  }
  const resume=button('跟上播放','回到当前正在播放的台词',()=>{locked=false;signature='';resume.hidden=true;L.immersiveClose?.();if(pending)render(pending);});resume.hidden=true;
  const star=button('☆','收藏整句（也可以长按台词空白处）',()=>save(null));
  const bilingual=button('双语','显示或收起中文对照',()=>{showChinese=!showChinese;bilingual.textContent=showChinese?'双语':'英文';bilingual.setAttribute('aria-pressed',String(showChinese));renderChinese();});bilingual.setAttribute('aria-pressed','true');
  const retryChinese=button('重试中文','重新翻译当前台词',()=>{if(valid())translations.retry(translationKey(),{text:cue.text,videoTitle:P.context().videoTitle});});retryChinese.hidden=true;
  toolbar.append(resume,star,bilingual,retryChinese,button('展开字幕 ↓','返回完整字幕和学习工具',()=>full('transcript')),button('收藏库','打开收藏库',()=>full('library')));
  root.append(toolbar,body,status);document.body.append(root);
  text.title='点单词查释义；长按单词收藏，长按空白处收藏整句';
  const metadata=term=>{const c=P.context();return {term:term||cue.text,sourceExcerpt:cue.text,context:cue.text,videoId:c.videoId,videoTitle:c.videoTitle,channelName:c.channelName,timestamp:cue.start};};
  const valid=()=>cue&&P.context().videoId===videoId&&P.context().generation===generation;
  const translations=YTD_IMMERSIVE_CORE.translationQueue(async value=>{
    const r=await chrome.runtime.sendMessage({action:'translateContent',content:{segments:[{id:'cue',text:value.text}]},contentType:'transcriptBatch',targetLanguage:'zh',videoTitle:value.videoTitle});
    if(!r?.success)throw new Error(r?.error||'中文翻译失败，请重试。');
    return r.translatedContent?.segments?.find(s=>s.id==='cue')?.text;
  },()=>renderChinese());
  const translationKey=()=>`${videoId}:${generation}:${cue?.start}:${cue?.text}`;
  function renderChinese(){
    chinese.hidden=!showChinese;retryChinese.hidden=true;if(!showChinese||!cue){chinese.textContent='';return;}
    if(/^(ai-)?zh(?:-|$)/i.test(P.context().language||'')){chinese.textContent='当前只有中文。点「展开字幕」转写英文原声，完成后自动显示双语。';return;}
    const native=P.captionTranslation(cue);if(native){chinese.textContent=native;return;}
    const key=translationKey();translations.ensure(key,{text:cue.text,videoTitle:P.context().videoTitle});const state=translations.get(key);
    chinese.textContent=state?.text||state?.error||'正在准备中文…';retryChinese.hidden=!state?.error;
  }
  function render(detail){
    pending=detail;const c=P.context();
    if(c.videoId!==videoId||c.generation!==generation){clearTimeout(timer);press=null;locked=false;signature='';cue=null;videoId=c.videoId;generation=c.generation;status.textContent='';resume.hidden=true;}
    if(detail.videoId!==videoId||detail.generation!==generation)return;
    if(locked)return;
    const next=YTD_IMMERSIVE_CORE.cueAt(P.rawSegments(),detail.currentTime),sig=next?`${next.start}:${next.text}`:'gap';
    if(sig===signature){renderChinese();return;}signature=sig;cue=next;text.replaceChildren();status.textContent='';
    if(!cue){text.textContent=P.rawSegments().length?'…':'尚无可用字幕，请打开完整字幕检查或转写原声。';time.textContent='当前没有台词';star.disabled=true;renderChinese();return;}
    star.disabled=false;time.textContent=`${Math.floor(cue.start/60)}:${String(Math.floor(cue.start%60)).padStart(2,'0')}`;
    let end=0;for(const token of YTD_IMMERSIVE_CORE.tokens(cue.text)){
      text.append(document.createTextNode(cue.text.slice(end,token.start)));const word=button(token.term,`查询 ${token.term}；长按收藏`,()=>lookup(word));word.className='immersive-word';word.dataset.term=token.term;text.append(word);end=token.end;
    }text.append(document.createTextNode(cue.text.slice(end)));body.scrollTop=0;if(!matchMedia('(prefers-reduced-motion: reduce)').matches)text.animate([{opacity:.6,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:160});renderChinese();
  }
  function hold(){locked=true;resume.hidden=false;L.immersiveActivity();}
  function lookup(word){if(suppressClick||!valid())return;hold();L.immersiveLookup(metadata(word.dataset.term),word.getBoundingClientRect());}
  async function save(term){
    if(!valid())return;hold();const meta=metadata(term),snapshot=`${videoId}:${generation}`;status.textContent='正在收藏…';
    const result=await chrome.runtime.sendMessage({action:term?'saveVocabulary':'saveSentence',...meta});
    if(snapshot!==`${P.context().videoId}:${P.context().generation}`)return;
    if(!result?.success){status.textContent=result?.error||'收藏失败，请重试。';return;}
    status.textContent=result.alreadySaved?'已经收藏过了':'已收藏 ✓';await L.refreshLibrary();await P.refreshVocabulary();
    if(!term && !result.alreadySaved)chrome.runtime.sendMessage({action:'analyzeSentence',id:result.entry.id}).then(r=>{if(!r?.success&&valid())status.textContent='原句已收藏；解析未完成，可到收藏库重试。';}).catch(()=>{});
  }
  text.addEventListener('pointerdown',e=>{
    if(e.button!==0||!valid())return;clearTimeout(timer);suppressClick=false;press={x:e.clientX,y:e.clientY,wasLocked:locked,term:e.target.closest('.immersive-word')?.dataset.term||null};
    locked=true;const snapshot=`${videoId}:${generation}`;timer=setTimeout(()=>{if(!press||snapshot!==`${P.context().videoId}:${P.context().generation}`)return;suppressClick=true;save(press.term).catch(e=>status.textContent=e.message);},600);
  });
  function cancel(){clearTimeout(timer);if(press&&!suppressClick)locked=press.wasLocked;press=null;}
  document.addEventListener('pointermove',e=>{if(press&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>8)cancel();});
  document.addEventListener('pointerup',()=>{cancel();setTimeout(()=>suppressClick=false,0);});text.addEventListener('pointercancel',cancel);
  window.addEventListener('blur',cancel);text.addEventListener('contextmenu',e=>e.preventDefault());
  globalThis.YTD_IMMERSIVE_UI={reset:()=>{cancel();locked=false;signature='';cue=null;videoId=null;pending=null;text.textContent='正在载入字幕…';chinese.hidden=true;status.textContent='';resume.hidden=true;}};
  document.addEventListener('visibilitychange',()=>{cancel();if(document.hidden){locked=false;signature='';}});
  document.addEventListener('ytdPlayback',e=>render(e.detail));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){cancel();locked=false;signature='';resume.hidden=true;L.immersiveClose?.();}});
  P.switchTab('transcript');
})();
