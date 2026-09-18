/* Local original-audio transcription. No caption back-translation or cloud upload. */
var YTD_ASR_CORE = (() => {
  function validateResult(result, videoId) {
    if (!result || result.videoId !== videoId || result.language !== 'en' || result.source !== 'local-asr') throw new Error('转写结果与当前视频不匹配。');
    if (!Array.isArray(result.transcript) || !result.transcript.length || result.transcript.length > 20000) throw new Error('转写结果为空或过大。');
    const range=result.range;
    if(range && (!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start||range.end>86400||range.end-range.start>1200))throw new Error('学习片段范围无效。');
    if(range&&result.processedUntil!==undefined&&(!Number.isFinite(result.processedUntil)||result.processedUntil<range.start||result.processedUntil>range.end))throw new Error('片段进度无效。');
    let chars = 0, previous = -1;
    const transcript = result.transcript.map(item => {
      if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 4000 || !Number.isFinite(item.start) || !Number.isFinite(item.duration) || item.start < 0 || item.duration <= 0 || item.start < previous || item.start + item.duration > (range?range.end+0.5:10805) || (range&&item.start<range.start)) throw new Error('转写文本或时间戳无效。');
      previous = item.start; chars += item.text.length;
      if (chars > 2 * 1024 * 1024) throw new Error('转写文本过大。');
      return {text:item.text.trim(),start:item.start,duration:item.duration};
    });
    return {transcript,language:'en',source:'local-asr',videoId,...(result.partial===true?{partial:true}:{} ),...(range?{range:{start:range.start,end:range.end},...(result.processedUntil!==undefined?{processedUntil:result.processedUntil}:{})}:{})};
  }
  function alignChinese(group, source) {
    const end = group.start + group.duration;
    return source.filter(item => item.start < end && item.start + item.duration > group.start).map(item=>item.text).join(' ').trim();
  }
  function alignChineseSentence(group,source){
    const end=group.start+group.duration;
    const matches=source.filter(item=>item.start<end && item.start+item.duration>group.start);
    if(!matches.length || matches.some(item=>item.start<group.start-0.5 || item.start+item.duration>end+0.5))return "";
    return matches.map(item=>item.text).join(' ').trim();
  }
  function readyToApply(result,hasEnglish=false){return result?.partial!==true||hasEnglish||(Array.isArray(result.transcript)&&result.transcript.length>=20);}
  function segmentsForDuration(duration){
    if(!Number.isFinite(duration)||duration<=10800||duration>86400)return [];
    return Array.from({length:Math.ceil(duration/1200)},(_,i)=>({start:i*1200,end:Math.min(duration,(i+1)*1200)}));
  }
  function mergeSegment(previous,result){
    const end=result.partial?result.processedUntil??Math.max(...result.transcript.map(s=>s.start+s.duration)):result.range.end;
    return [...previous.filter(s=>s.start+s.duration<=result.range.start||s.start>=end),...result.transcript]
      .sort((a,b)=>a.start-b.start).filter((s,i,all)=>!i||s.start!==all[i-1].start||s.text!==all[i-1].text);
  }
  return {segmentsForDuration,mergeSegment,validateResult,alignChinese,alignChineseSentence,readyToApply};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = YTD_ASR_CORE;

if (typeof document !== 'undefined' && globalThis.YTD_PANEL) (() => {
  const P = YTD_PANEL, root = document.getElementById('localAsrPanel');
  if (!root) return;
  if(chrome.runtime.getURL('').startsWith('safari-web-extension:')){
    root.replaceChildren();root.hidden=false;const hint=document.createElement('p');hint.textContent='iPhone 使用视频原生字幕；电脑本地原声转写暂不可用。';root.append(hint);
    globalThis.YTD_ASR_UI={videoChanged:()=>{},refresh:()=>{},ensureAutomatic:async()=>false,state:()=>({busy:false,running:false})};return;
  }
  let videoId = null, job = null, busy = false, generation = 0, autoApply = null, restoration=Promise.resolve(), automaticBusy=false,lastApplied=null,polling=false;
  const $ = id => document.getElementById(id);
  let chunks=[],selectedChunk=0;
  const chunkBar=document.createElement('div');chunkBar.className='asr-chunks';chunkBar.hidden=true;
  const chunkSelect=document.createElement('select');chunkSelect.setAttribute('aria-label','学习片段');
  function chunkButton(text,fn){const b=document.createElement('button');b.type='button';b.className='learning-button';b.textContent=text;b.addEventListener('click',fn);return b;}
  const previous=chunkButton('上一段',()=>selectChunk(selectedChunk-1));
  const next=chunkButton('下一段',()=>selectChunk(selectedChunk+1));
  const here=chunkButton('当前播放片段',()=>refreshChunks(true));
  chunkSelect.addEventListener('change',()=>selectChunk(Number(chunkSelect.value)));
  chunkBar.append(previous,chunkSelect,next,here);root.prepend(chunkBar);
  function timeLabel(n){return `${Math.floor(n/3600)}:${String(Math.floor(n%3600/60)).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}`;}
  function selectChunk(index){selectedChunk=Math.max(0,Math.min(chunks.length-1,index));render();notice('已选择学习片段，点击「转写本段」开始；视频播放位置不变。');}
  async function refreshChunks(follow=false){
    const id=videoId,snapshot=generation;
    try{
      const r=await chrome.runtime.sendMessage({action:'relayToContent',payload:{action:'getCurrentTime'}});
      if(id!==videoId||snapshot!==generation||!r?.success||r.response?.videoId!==id)return;
      const duration=r.response.duration;
      if(!Number.isFinite(duration)||duration<=0)return;
      const old=chunks.length;chunks=YTD_ASR_CORE.segmentsForDuration(duration);
      if(!old||follow)selectedChunk=Math.min(chunks.length-1,Math.floor((r.response.currentTime||0)/1200));
      chunkSelect.replaceChildren(...chunks.map((c,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`第 ${i+1} 段 / ${chunks.length} · ${timeLabel(c.start)}–${timeLabel(c.end)}`;return o;}));render();
    }catch{}
  }
  async function request(path, method='GET', body) {
    let response;
    try {
      response = await fetch('http://127.0.0.1:8766' + path, {method, headers:{'Content-Type':'application/json','X-Study-Extension':chrome.runtime.id},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
    } catch { throw new Error('本地转写服务未连接。请先打开「启动本地原声转写.command」，再重试。'); }
    const raw = await response.text();
    if(raw.length > 4*1024*1024) throw new Error('转写结果过大。');
    const data = JSON.parse(raw);
    if(!response.ok) throw new Error(data.error || '本地转写请求失败。');
    return data;
  }
  function notice(text) { $('localAsrStatus').textContent=text;document.dispatchEvent(new Event('ytdAsrStatus')); }
  function render() {
    const context = P.context(); root.hidden=!YTD_PLATFORM.biliParts(context.videoId);
    if(root.hidden)return;
    const running=job && !['completed','cancelled','failed'].includes(job.status);
    $('localAsrStorageHint').hidden=!(busy||running);
    chunkBar.hidden=!chunks.length;root.dataset.segmented=String(Boolean(chunks.length));
    chunkSelect.value=String(selectedChunk);chunkSelect.disabled=busy||Boolean(running);
    previous.disabled=busy||Boolean(running)||selectedChunk<=0;next.disabled=busy||Boolean(running)||selectedChunk>=chunks.length-1;here.disabled=busy||Boolean(running);
    $('localAsrStart').disabled=busy||Boolean(running);
    $('localAsrStart').textContent=context.source==='local-asr'?'重新转写原声':job&&['failed','cancelled'].includes(job.status)?'重试转写':'转写英文原声';
    if(chunks.length)$('localAsrStart').textContent='转写本段';
    $('localAsrCancel').hidden=!running;
    $('localAsrApply').hidden=job?.status!=='completed'||context.source==='local-asr';
    $('localAsrRestore').hidden=!context.hasNativeBackup;
    $('localAsrProgress').hidden=!running;
    $('localAsrProgress').value=Number(job?.progress)||0;
    if(job){const count=Array.isArray(job.result?.transcript)?job.result.transcript.length:0;
      const preload=running&&context.source!=='local-asr'?` · 首批预加载 ${Math.min(count,20)} / 20 句`:count?` · 已准备 ${count} 句`:'';
      notice(`${job.message}${running?` · ${Math.floor(Number(job.progress)||0)}%`:''}${preload}`);
    }
  }
  async function applyAvailable(){
    if(!job?.result||autoApply!==P.context().generation)return;
    if(!YTD_ASR_CORE.readyToApply(job.result,P.context().source==='local-asr'))return;
    const stamp=`${job.id}:${job.status}:${job.result.revision||0}:${job.result.transcript?.length}`;
    if(stamp===lastApplied)return;
    const id=videoId,snapshot=generation;
    await P.applyASRProgress(YTD_ASR_CORE.validateResult(job.result,id));
    if(snapshot!==generation||id!==videoId)return;
    lastApplied=stamp;autoApply=job.status==='completed'?null:P.context().generation;
  }
  async function poll() {
    if(!job||['completed','cancelled','failed'].includes(job.status)||busy||polling)return;
    const id=videoId,snapshot=generation,jobId=job.id;polling=true;
    try {
      const result=await request('/jobs/'+jobId);
      if(id!==videoId||snapshot!==generation||job?.id!==jobId)return;
      job=result;await applyAvailable();render();
    }catch(error){if(id===videoId&&snapshot===generation)notice(error.message);}finally{polling=false;}
  }
  async function loadVideo() {
    const id=P.context().videoId;
    if(id===videoId){render();return;}
    videoId=id;job=null;chunks=[];selectedChunk=0;autoApply=null;lastApplied=null;busy=false;const snapshot=++generation;
    notice('仅从实际音频转写英文，不把中文字幕翻译成原声台词。音频在本机处理，识别结果仍需听音核对。');render();
    if(!YTD_PLATFORM.biliParts(id))return;
    await refreshChunks(true);
    const saved=await chrome.storage.local.get('local_asr_job_'+id);
    if(snapshot!==generation)return;
    const jobId=saved['local_asr_job_'+id];
    if(!/^[a-f0-9]{32}$/.test(jobId||''))return;
    try{const result=await request('/jobs/'+jobId);if(snapshot===generation){job=result;if(result.range&&!['completed','failed','cancelled'].includes(result.status))selectedChunk=Math.floor(result.range.start/1200);render();}}catch(error){if(snapshot===generation)notice(error.message);}
  }
  function videoChanged(){if(P.context().videoId!==videoId)restoration=loadVideo();return restoration;}
  async function start(){
    await videoChanged();if(busy)return;
    const id=videoId,snapshot=generation;if(!YTD_PLATFORM.biliParts(id))return;
    await refreshChunks();if(snapshot!==generation||busy)return;
    const range=chunks[selectedChunk];
    busy=true;job=null;render();notice('正在连接本地转写服务…');
    try{
      await chrome.storage.session.set({['local_asr_auto_'+id]:true});
      if(YTD_PLATFORM.biliParts(id)?.episodeId){const health=await request('/health');if(!health.capabilities?.includes('episodes-v1'))throw new Error('本地服务需更新：请重新打开转写服务启动器，再点击生成字幕。');}
      if(range){const health=await request('/health');if(!health.capabilities?.includes('segments-v1'))throw new Error('本地服务需更新：请关闭并重新打开启动器，再转写学习片段。');}
      const result=await request('/jobs','POST',{videoId:id,...(range?{range}:{})});
      await chrome.storage.local.set({['local_asr_job_'+id]:result.id});
      if(snapshot!==generation)return;
      job=result;autoApply=P.context().generation;lastApplied=null;await applyAvailable();render();
    }catch(error){if(snapshot===generation)notice(error.message);}finally{if(snapshot===generation){busy=false;render();document.dispatchEvent(new Event('ytdAsrStatus'));}}
  }
  async function cancel(){
    const snapshot=generation,jobId=job?.id;if(!jobId)return;
    try{const result=await request('/jobs/'+jobId,'DELETE');if(snapshot===generation){job=result;autoApply=null;render();}}catch(error){notice(error.message);}
  }
  // Entering immersion authorizes local original-audio processing. Restore a
  // running/completed job before considering a new one; never retry a failure loop.
  async function ensureAutomatic({retry=false}={}){
    if(automaticBusy)return;automaticBusy=true;
    try{
      await videoChanged();const c=P.context(),id=videoId,snapshot=generation;
      if(!YTD_PLATFORM.biliParts(id)||(!/^(ai-)?zh(?:-|$)/i.test(c.language||'')&&!c.partial)||busy)return;
      if(job?.status==='completed'){autoApply=c.generation;await applyAvailable();render();return;}
      if(job&&!['failed','cancelled'].includes(job.status)){autoApply=c.generation;await applyAvailable();render();return;}
      const saved=await chrome.storage.session.get('local_asr_auto_'+id);if(snapshot!==generation)return;
      if(saved['local_asr_auto_'+id]&&!retry){if(!job)notice('自动转写尚未完成。请确认本地服务已启动，然后点击「双语」或「转写英文原声」重试。');return;}
      await start();
    }catch(e){notice(e.message);}finally{automaticBusy=false;}
  }
  $('localAsrStart').addEventListener('click',start);
  $('localAsrCancel').addEventListener('click',cancel);
  $('localAsrApply').addEventListener('click',async()=>{try{await P.applyASR(YTD_ASR_CORE.validateResult(job.result,videoId));render();}catch(error){notice(error.message);}});
  $('localAsrRestore').addEventListener('click',async()=>{try{await P.restoreNativeTranscript();render();}catch(error){notice(error.message);}});
  globalThis.YTD_ASR_UI={videoChanged,refresh:render,notice,start,cancel,ensureAutomatic,state:()=>({busy,running:Boolean(job&&!['completed','failed','cancelled'].includes(job.status)),message:$('localAsrStatus').textContent,status:job?.status,progress:Number(job?.progress)||0})};
  setInterval(poll,2000);void videoChanged();
})();
