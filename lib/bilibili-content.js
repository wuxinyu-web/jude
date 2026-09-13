/* Read Bilibili's visible player; never replace framework-owned player DOM. */
(()=>{
  const video=()=>document.querySelector('.bpx-player-video-wrap video')||document.querySelector('video');
  const title=()=>document.querySelector('h1.video-title')?.textContent.trim()||document.title.replace(/_哔哩哔哩.*$/,'').trim();
  let timer;
  chrome.runtime.onMessage.addListener((m,_sender,reply)=>{
    const v=video();
    if(m.action==='getVideoInfo'){reply({title:title(),channelName:document.querySelector('.up-name')?.textContent.trim()||'',description:document.querySelector('#v_desc')?.textContent.trim()||'',duration:Number(v?.duration)||0,videoId:YTD_PLATFORM.videoIdFromUrl(location.href)});return false;}
    if(m.action==='getCurrentTime'){reply({hasVideo:Boolean(v),currentTime:Number(v?.currentTime)||0,duration:Number.isFinite(v?.duration)?v.duration:0,paused:v?.paused??true,videoId:YTD_PLATFORM.videoIdFromUrl(location.href)});return false;}
    if(m.action==='seekTo'){const seconds=Number(m.seconds);if(v&&Number.isFinite(seconds)&&seconds>=0){v.currentTime=seconds;if(m.play){Promise.resolve(v.play()).then(()=>reply({success:true})).catch(()=>reply({success:false,error:'无法自动播放，请点击播放器播放后重试。'}));return true;}reply({success:true});}else reply({success:false});return false;}
    if(m.action==='highlightMoments'||m.action==='showNoteSavedFeedback'){reply({success:true});return false;}
  });
  function mount(){
    if(!YTD_PLATFORM.videoIdFromUrl(location.href))return;
    if(document.getElementById('ytd-digest-button'))return;
    const parent=document.querySelector('.video-toolbar-left')||document.querySelector('.video-toolbar-container')||document.querySelector('.video-info-container')||document.querySelector('.mediainfo_mediaInfo__Cpow4')||document.querySelector('#bilibili-player')?.parentElement||document.querySelector('.bpx-player-container')?.parentElement;
    if(!parent)return;
    const b=document.createElement('button');b.id='ytd-digest-button';b.type='button';b.textContent='英语学习';b.title='打开字幕、词句收藏与学习计时';
    b.style.cssText='background:#ce674d;color:white;border:0;border-radius:18px;padding:8px 16px;margin:6px;cursor:pointer;font:600 14px sans-serif;white-space:nowrap';
    b.addEventListener('click',()=>chrome.runtime.sendMessage({action:'openSidePanel'}).catch(()=>{}));parent.append(b);
    const note=document.createElement('button');note.id='ytd-note-button';note.type='button';note.textContent='记笔记';note.style.cssText=b.style.cssText;
    note.addEventListener('click',async()=>{
      if(!video())return;note.disabled=true;note.textContent='正在保存…';
      try{const r=await chrome.runtime.sendMessage({action:'saveNote',videoId:YTD_PLATFORM.videoIdFromUrl(location.href),timestamp:Math.max(0,video().currentTime-3),videoTitle:title(),channelName:document.querySelector('.up-name')?.textContent.trim()||''});
        note.textContent=r.success?'笔记已保存':'保存失败';note.title=r.success?'已保存至收藏库':r.message||r.error||'请重试';
      }catch{note.textContent='保存失败';}finally{note.disabled=false;setTimeout(()=>note.textContent='记笔记',2500);}
    });parent.append(note);
  }
  // Wait for the page to hydrate before adding controls outside the player.
  timer=setInterval(mount,1500);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
})();
