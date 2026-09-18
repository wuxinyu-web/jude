var YTD_LAYOUT = (() => {
  const KEY='ytd_layout_preferences';let mode='horizontal';
  const embeddedOnly=()=>!chrome.sidePanel;
  const normalize=v=>['vertical','immersive'].includes(v)?'immersive':'horizontal';
  chrome.storage.local.get(KEY).then(data=>{mode=normalize(data[KEY]?.mode);});
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes[KEY])mode=normalize(changes[KEY].newValue?.mode);});
  async function vertical(tabId,requestedMode) {
    const tab=await chrome.tabs.get(tabId);
    if(!YTD_PLATFORM.videoIdFromUrl(tab.url))throw new Error('请先打开一个视频。');
    const prefs=(await chrome.storage.local.get(KEY))[KEY];
    const chosen=normalize(requestedMode||prefs?.mode);
    const mobile=embeddedOnly()&&chosen==='horizontal';
    const result=await chrome.tabs.sendMessage(tabId,{action:'openVerticalLayout',mode:mobile?'mobile':chosen,height:mobile?(prefs?.mobileHeight||55):(prefs?.immersiveHeight||30)});
    if(!result?.success)throw new Error(result?.error||'请刷新视频页面后重试。');
    await closePanelForTab(tabId,tab.windowId);
    await chrome.sidePanel?.setOptions({tabId,enabled:false});
    return {success:true,applied:true};
  }
  function horizontal(tabId) {
    if(embeddedOnly())return vertical(tabId,'horizontal');
    chrome.sidePanel.setOptions({tabId,path:'sidepanel.html',enabled:true});
    // This call stays in the originating user gesture, before any storage await.
    return chrome.sidePanel.open({tabId}).then(async()=>{
      await chrome.tabs.sendMessage(tabId,{action:'closeVerticalLayout'}).catch(()=>{});
      return {success:true,applied:true};
    });
  }
  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if(m.action==='syncImmersiveToolbar') {
      // An embedded extension frame may be new while its page host is still old.
      // Update only that frame's existing host; preserve playback and transcript DOM.
      const ownFrame=sender.id===chrome.runtime.id && Number.isInteger(sender.tab?.id)
        && sender.frameId>0 && sender.url===chrome.runtime.getURL('sidepanel.html?embedded=1&immersive=1');
      if(!ownFrame){reply({success:false});return false;}
      chrome.tabs.get(sender.tab.id).then(tab=>{
        if(!YTD_PLATFORM.videoIdFromUrl(tab.url))throw new Error('Unsupported page');
        return chrome.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[0]},
          func:YTD_LAYOUT_TOOLBAR.apply,args:[YTD_LAYOUT_TOOLBAR.css,sender.url]});
      }).then(results=>reply({success:results[0]?.result===true}),()=>reply({success:false}));
      return true;
    }
    if(m.action==='saveLayoutHeight') {
      if(sender.id!==chrome.runtime.id || !sender.tab?.id || !YTD_PLATFORM.videoIdFromUrl(sender.url) || !Number.isFinite(m.height) || m.height<(['immersive','mobile'].includes(m.mode)?10:30) || m.height>(['immersive','mobile'].includes(m.mode)?80:65)) {reply({success:false});return false;}
      chrome.storage.local.get(KEY).then(data=>chrome.storage.local.set({[KEY]:{...data[KEY],mode:m.mode==='mobile'?'horizontal':m.mode==='immersive'?'immersive':'vertical',[m.mode==='mobile'?'mobileHeight':m.mode==='immersive'?'immersiveHeight':'height']:m.height}})).then(()=>reply({success:true}));return true;
    }
    if(m.action!=='setLearningLayout')return;
    if(sender.id!==chrome.runtime.id || ![chrome.runtime.getURL('sidepanel.html'),chrome.runtime.getURL('options.html')].includes(sender.url?.split('?')[0]) || !['horizontal','vertical','immersive'].includes(m.mode)){
      reply({success:false,error:'不允许的布局请求。'});return false;
    }
    const tabId=sender.tab?.id ?? m.tabId;
    const fromOptions=sender.url.split('?')[0]===chrome.runtime.getURL('options.html');
    const operation=fromOptions||!Number.isInteger(tabId)?Promise.resolve({success:true,applied:false}):m.mode!=='horizontal'?vertical(tabId,m.mode):horizontal(tabId);
    operation.then(async result=>{
      const stored=(await chrome.storage.local.get(KEY))[KEY];mode=normalize(m.mode);
      await chrome.storage.local.set({[KEY]:{...stored,mode,height:stored?.height||45}});reply(result);
    },e=>reply({success:false,error:'布局切换失败，请刷新视频页面后重试。'+(e.message||'')}));return true;
  });
  return {isVertical:()=>embeddedOnly()||mode!=='horizontal',vertical};
})();
