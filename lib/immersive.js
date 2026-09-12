/* Immersion is the existing transcript pane below the player, not a second UI. */
if(typeof document!=='undefined' && /(?:[?&])immersive=1(?:&|$)/.test(location.search))(()=>{
  document.documentElement.classList.add('immersive');
  const P=YTD_PANEL;let automaticVideo=null,languageKey='';
  const back=document.createElement('button');back.type='button';back.className='enhance-btn';back.id='returnToSidebar';back.textContent='↗';back.title='回到左右布局';back.setAttribute('aria-label','回到左右布局');
  back.addEventListener('click',()=>{
    back.disabled=true;
    chrome.runtime.sendMessage({action:'setLearningLayout',mode:'horizontal',tabId:P.context().tabId}).then(r=>{if(!r?.success)throw new Error(r?.error||'请刷新页面后重试。');}).catch(e=>{document.getElementById('playbackPositionStatus').textContent=e.message;}).finally(()=>back.disabled=false);
  });
  document.querySelector('.transcript-actions').prepend(back);
  // Keep progress and recovery beside the language controls, even after scrolling.
  const asr=document.getElementById('localAsrPanel');
  document.querySelector('.sticky-control-row').append(asr);
  function synchronize(){
    const c=P.context();if(!c.videoId||!P.rawSegments().length)return;
    const key=c.videoId+':'+c.language;
    if(key!==languageKey){languageKey=key;if(!/^(ai-)?zh(?:-|$)/i.test(c.language||''))void P.setTranscriptMode('bilingual');}
    const chinese=/^(ai-)?zh(?:-|$)/i.test(c.language||'');
    document.documentElement.toggleAttribute('data-awaiting-english',chinese);
    if(chinese&&automaticVideo!==c.videoId){automaticVideo=c.videoId;void globalThis.YTD_ASR_UI?.ensureAutomatic();}
  }
  document.addEventListener('ytdPlayback',synchronize);
  globalThis.YTD_IMMERSIVE_UI={reset:()=>{languageKey='';}};
  P.switchTab('transcript');synchronize();
})();
