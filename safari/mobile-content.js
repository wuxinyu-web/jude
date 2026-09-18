/* Mobile sites do not have the desktop action row. This is our own entry only. */
(()=>{
  let button;const id='jude-mobile-entry-'+chrome.runtime.id;
  function update(){
    if(!YTD_PLATFORM.videoIdFromUrl(location.href)||!document.querySelector('video')){button?.remove();button=null;return;}
    if(button?.isConnected)return;
    button=document.createElement('button');button.id=id;button.type='button';button.textContent='句得 · 学英语';
    button.style.cssText='position:fixed;right:12px;bottom:calc(20px + env(safe-area-inset-bottom));z-index:2147482000;min-height:44px;padding:10px 16px;border:1px solid #e3dccd;border-radius:24px;background:#304e43;color:white;font:600 15px system-ui;box-shadow:0 3px 14px #0003';
    button.addEventListener('click',async()=>{button.disabled=true;try{const r=await chrome.runtime.sendMessage({action:'openSidePanel'});if(!r?.success)throw Error(r?.error||'请刷新后重试');}catch(e){button.textContent=e.message;}finally{button.disabled=false;}});
    document.body.append(button);
  }
  update();const timer=setInterval(update,1500);window.addEventListener('pagehide',()=>{clearInterval(timer);button?.remove();},{once:true});
})();
