/* Reversible vertical workspace. The site's player stays in its original DOM. */
(() => {
  globalThis.__ytdLayoutCleanup?.();
  let host, sheet, player, timer, frameObserver, ancestors = [], height = 45, mode="vertical";
  const playerNode = () => document.querySelector('#bilibili-player') || document.querySelector('#movie_player');
  function close() {
    frameObserver?.disconnect();frameObserver=null;
    host?.remove(); sheet?.remove(); host = sheet = null;
    player?.removeAttribute('data-ytd-layout-player'); player = null;
    ancestors.forEach(el => el.removeAttribute('data-ytd-layout-ancestor')); ancestors = [];
    document.documentElement.removeAttribute('data-ytd-layout');
    document.documentElement.removeAttribute('data-ytd-immersive');
    document.documentElement.style.removeProperty('--ytd-dock-height');
  }
  function size(value) {
    height = Math.max(mode==="immersive"?14:30, Math.min(mode==="immersive"?45:65, Number(value) || (mode==="immersive"?22:45)));
    document.documentElement.style.setProperty('--ytd-dock-height', mode==='immersive'?`max(150px, ${height}vh)`:height+'vh');
  }
  async function open(preferenceHeight, requestedMode="vertical") {
    if(host?.isConnected && requestedMode===mode)return {success:true};
    close();mode=requestedMode==="immersive"?"immersive":"vertical";
    const node = playerNode();
    if (!node || !YTD_PLATFORM.videoIdFromUrl(location.href)) return {success:false,error:'播放器尚未准备好，请稍后再点击英语学习。'};
    if (host?.isConnected) return {success:true};
    player = node; player.setAttribute('data-ytd-layout-player','');
    for (let p=player.parentElement;p && p!==document.body;p=p.parentElement) {p.setAttribute('data-ytd-layout-ancestor',''); ancestors.push(p);}
    document.documentElement.setAttribute('data-ytd-layout','vertical');document.documentElement.toggleAttribute('data-ytd-immersive',mode==='immersive');size(preferenceHeight);
    sheet = document.createElement('style');sheet.textContent = `
      html[data-ytd-layout=vertical],html[data-ytd-layout=vertical] body{overflow:hidden!important}
      html[data-ytd-layout=vertical] body *{visibility:hidden!important}
      html[data-ytd-layout=vertical] [data-ytd-layout-ancestor]{transform:none!important;filter:none!important;perspective:none!important;contain:none!important;overflow:visible!important;position:static!important}
      html[data-ytd-layout=vertical] [data-ytd-layout-player],html[data-ytd-layout=vertical] [data-ytd-layout-player] *{visibility:visible!important}
      html[data-ytd-layout=vertical] [data-ytd-layout-player]{position:fixed!important;inset:0 0 auto 0!important;width:100vw!important;max-width:none!important;height:calc(100vh - var(--ytd-dock-height))!important;min-height:0!important;max-height:none!important;z-index:2147483000!important;background:#000!important;margin:0!important}
      html[data-ytd-layout=vertical] [data-ytd-layout-player] video{object-fit:contain!important;width:100%!important;height:100%!important}
      html[data-ytd-layout=vertical] [data-ytd-layout-player]:fullscreen{height:100vh!important}
      html[data-ytd-layout=vertical] #ytd-layout-dock{visibility:visible!important;position:fixed!important;inset:auto 0 0 0!important;width:100vw!important;height:var(--ytd-dock-height)!important;z-index:2147483001!important}
      html[data-ytd-immersive] .bpx-player-video-area{height:100%!important}
      html[data-ytd-immersive] .bpx-player-sending-bar,html[data-ytd-immersive] .bpx-player-dm-wrap,html[data-ytd-immersive] #ytd-note-button{display:none!important}
    `;document.documentElement.append(sheet);
    host=document.createElement('div');host.id='ytd-layout-dock';
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>:host{display:block}*{box-sizing:border-box}header{height:30px;background:#f4f0e8;display:flex;align-items:center;justify-content:space-between;padding:0 12px;color:#403a33;font:13px system-ui;border-top:1px solid #d8cabb}button{font:inherit;cursor:pointer;border:0;background:none;color:inherit;padding:4px 10px}#resize{cursor:ns-resize;touch-action:none;flex:1;text-align:center}iframe{border:0;width:100%;height:calc(100% - 30px);display:block;background:#f7f4ed}</style><header><span>英语学习 · 上下布局</span><button id="resize" role="separator" aria-label="调整学习区高度，方向键可调整" aria-orientation="horizontal" aria-valuemin="30" aria-valuemax="65" aria-valuenow="${height}">↕ 拖动调整高度</button><button id="close" aria-label="关闭学习区并恢复网页">关闭学习区</button></header>`;
    if(mode==='immersive'){
      const st=document.createElement('style');st.textContent='header{height:20px;background:#121313;color:#bfc2bc;border-color:#303330;font-size:11px}header>span{display:none}iframe{height:calc(100% - 20px);background:#121313}#resize{font-size:0}#resize:after{content:"━━";font-size:13px}';shadow.append(st);
      const full=document.createElement('button');full.textContent='全屏';full.title='视频和台词一起全屏';full.addEventListener('click',()=>fullscreen());shadow.querySelector('header').prepend(full);
      shadow.getElementById('resize').setAttribute('aria-valuemin','14');shadow.getElementById('resize').setAttribute('aria-valuemax','45');
    }
    const frame=document.createElement('iframe');frame.title='视频英语学习';frame.src=chrome.runtime.getURL('sidepanel.html?embedded=1'+(mode==='immersive'?'&immersive=1':''));frame.allow='clipboard-write';shadow.append(frame);
    // Some page integrations attach an empty srcdoc to inserted frames. It
    // overrides src and prevents our own extension document from loading.
    let blankOverrides=0;
    const clearBlankOverride=()=>{if(frame.getAttribute('srcdoc')==='' && blankOverrides++<3)frame.removeAttribute('srcdoc');};
    frameObserver=new MutationObserver(clearBlankOverride);frameObserver.observe(frame,{attributes:true,attributeFilter:['srcdoc']});
    clearBlankOverride();
    const resize=shadow.getElementById('resize');
    const saveSize=()=>chrome.runtime.sendMessage({action:'saveLayoutHeight',height,mode});
    resize.addEventListener('pointerdown',e=>{resize.focus();resize.setPointerCapture(e.pointerId);e.preventDefault();});
    resize.addEventListener('pointermove',e=>{if(resize.hasPointerCapture(e.pointerId)){size((innerHeight-e.clientY)/innerHeight*100);resize.setAttribute('aria-valuenow',String(Math.round(height)));}});
    resize.addEventListener('pointerup',e=>{if(resize.hasPointerCapture(e.pointerId)){resize.releasePointerCapture(e.pointerId);void saveSize();}});
    resize.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();size(height+(e.key==='ArrowUp'?5:-5));resize.setAttribute('aria-valuenow',String(height));void saveSize();}});
    shadow.getElementById('close').addEventListener('click',close);
    document.body.append(host);clearBlankOverride();return {success:true};
  }
  function fullscreen(){
    const promise=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
    promise?.catch(()=>{});
  }
  function nativeFullscreen(e){
    if(!host || mode!=='immersive')return;
    if(e.type==='click' && e.target.closest?.('.ytp-fullscreen-button,.bpx-player-ctrl-full')){e.preventDefault();e.stopImmediatePropagation();fullscreen();}
    if(e.type==='keydown' && e.key.toLowerCase()==='f' && !e.target.closest?.('input,textarea,[contenteditable=true]')){e.preventDefault();e.stopImmediatePropagation();fullscreen();}
  }
  document.addEventListener('click',nativeFullscreen,true);document.addEventListener('keydown',nativeFullscreen,true);
  const message=(m,sender,reply)=>{
    if(sender.id!==chrome.runtime.id)return;
    if(m.action==='openVerticalLayout'){open(m.height,m.mode).then(reply,e=>reply({success:false,error:e.message}));return true;}
    if(m.action==='closeVerticalLayout'){close();reply({success:true});return false;}
  };
  chrome.runtime.onMessage.addListener(message);
  timer=setInterval(()=>{if(host && (!player?.isConnected || !YTD_PLATFORM.videoIdFromUrl(location.href)))close();},1000);
  function cleanup(){document.removeEventListener("click",nativeFullscreen,true);document.removeEventListener("keydown",nativeFullscreen,true);close();clearInterval(timer);chrome.runtime.onMessage.removeListener(message);}
  globalThis.__ytdLayoutCleanup=cleanup;window.addEventListener('pagehide',cleanup,{once:true});
})();
