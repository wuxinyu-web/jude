/* Runs only on YouTube. Owns reversible distraction styles and playback samples. */
(() => {
  globalThis.__ytdStudyCleanup?.();
  const controller=new AbortController(), signal=controller.signal;
  let session=null,busy=false,buffering=true,seeking=false,video=null,timer;
  const attr="data-ytd-study-focus";
  const style=document.createElement("style");style.id="ytd-study-focus-style";
  style.textContent=`html[${attr}] ytd-watch-next-secondary-results-renderer,
    html[${attr}] #comments, html[${attr}] .ytp-endscreen-content,
    html[${attr}] .ytp-ce-element, html[${attr}] .ytp-autonav-endscreen-upnext-container,
    html[${attr}] .recommend-list-v1, html[${attr}] .video-page-card-small,
    html[${attr}] #comment, html[${attr}] #commentapp, html[${attr}] bili-comments,
    html[${attr}] .bpx-player-ending-related, html[${attr}] .bpx-player-ending-panel {display:none!important;}`;
  document.documentElement.appendChild(style);
  const videoId=()=>YTD_PLATFORM.videoIdFromUrl(location.href);
  const focusOn=()=>session && session.status!=="ended" && session.reduceDistractions && session.videoId===videoId();
  function update(s){
    session=s;
    document.documentElement.toggleAttribute(attr,!!focusOn());
    if(video && s && s.videoId===videoId() && ["due","review","paused"].includes(s.status))video.pause();
  }
  async function pulse(){
    if(busy)return;
    busy=true;
    try{
      const response=await chrome.runtime.sendMessage({action:"studyPulse",visible:document.visibilityState==="visible",
        playing:!!video&&!video.paused&&!video.ended,buffering:buffering||!video||video.readyState<3,seeking:seeking||!!video?.seeking,ended:!!video?.ended});
      if(response?.success)update(response.session);
    }catch{cleanup();}finally{busy=false;}
  }
  function bindVideo(){
    const next=document.querySelector("video");if(next===video)return;video=next;
    if(video){buffering=video.readyState<3;seeking=video.seeking;}
  }
  function playback(event){
    if(!(event.target instanceof HTMLVideoElement))return;
    bindVideo();
    if(["waiting","stalled","loadstart"].includes(event.type))buffering=true;
    if(["playing","canplay"].includes(event.type))buffering=false;
    if(event.type==="seeking")seeking=true;
    if(event.type==="seeked")seeking=false;
    // A changed URL can occur before the next worker heartbeat. Stop auto-next
    // immediately, without navigating back or altering YouTube account settings.
    if(event.type==="play" && session && session.status!=="ended"){
      if((session.reduceDistractions && session.videoId!==videoId()) || ["due","review"].includes(session.status))event.target.pause();
    }
    if(event.type==="ended" && focusOn()){
      event.target.pause();
      document.querySelector(".ytp-autonav-endscreen-upnext-cancel-button")?.click();
    }
    void pulse();
  }
  for(const name of ["play","playing","pause","waiting","stalled","loadstart","canplay","seeking","seeked","ended"])
    document.addEventListener(name,playback,{capture:true,signal});
  document.addEventListener("visibilitychange",()=>void pulse(),{signal});
  window.addEventListener("focus",()=>void pulse(),{signal});window.addEventListener("blur",()=>void pulse(),{signal});
  document.addEventListener("yt-navigate-finish",()=>{bindVideo();document.documentElement.removeAttribute(attr);void pulse();},{signal});
  const onMessage=(m,_sender,reply)=>{if(m.action==="studyControl"){bindVideo();update(m.session);reply({success:true});void pulse();}};
  chrome.runtime.onMessage.addListener(onMessage);
  timer=setInterval(()=>{bindVideo();void pulse();},1000);
  function cleanup(){controller.abort();clearInterval(timer);style.remove();document.documentElement.removeAttribute(attr);chrome.runtime.onMessage.removeListener(onMessage);}
  globalThis.__ytdStudyCleanup=cleanup;
  window.addEventListener("pagehide",cleanup,{once:true});bindVideo();void pulse();
})();
