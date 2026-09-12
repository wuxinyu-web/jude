/* Shared by fresh content scripts and existing immersive hosts after updates. */
var YTD_LAYOUT_TOOLBAR = {
  css: `
        header{position:absolute;inset:0 0 auto;height:40px;padding:0;background:transparent;color:#bfc2bc;border:0;font-size:11px;z-index:2;pointer-events:none}
        header>span{display:none}header button{pointer-events:auto;height:32px;padding:4px 6px;margin:4px 0}
        iframe{height:100%;background:#121313}
        #dockFullscreen{position:absolute;left:4px;width:42px}
        #resize{position:absolute;left:50%;transform:translateX(-50%);width:64px;flex:none;font-size:0;border-radius:4px}
        #resize:after{content:"━━";font-size:13px}#resize:hover{background:#252c24}
        #close{position:absolute;right:4px;width:28px;font-size:18px}
        header button:focus-visible{outline:2px solid #b3c59f;outline-offset:-2px}
        @media(max-width:600px){#dockFullscreen{left:0;width:30px;font-size:10px}#resize{left:30px;width:24px;transform:none}#close{right:0;width:26px}}
      `,
  apply: function(css, expectedFrameUrl) {
    const shadow=document.getElementById('ytd-layout-dock')?.shadowRoot;
    if(!shadow || !document.documentElement.hasAttribute('data-ytd-immersive'))return false;
    if(expectedFrameUrl && shadow.querySelector('iframe')?.src!==expectedFrameUrl)return false;
    let style=shadow.getElementById('ytd-compact-toolbar');
    if(!style){style=document.createElement('style');style.id='ytd-compact-toolbar';shadow.append(style);}
    style.textContent=css;
    const close=shadow.getElementById('close');
    if(close){close.textContent='×';close.title='关闭学习区';}
    return true;
  }
};
