var YTD_LAYOUT = (() => {
  const KEY='ytd_layout_preferences';let mode='horizontal';
  chrome.storage.local.get(KEY).then(data=>{mode=data[KEY]?.mode==='vertical'?'vertical':'horizontal';});
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes[KEY])mode=changes[KEY].newValue?.mode==='vertical'?'vertical':'horizontal';});
  async function vertical(tabId) {
    const tab=await chrome.tabs.get(tabId);
    if(!YTD_PLATFORM.videoIdFromUrl(tab.url))throw new Error('请先打开一个视频。');
    const prefs=(await chrome.storage.local.get(KEY))[KEY];
    const result=await chrome.tabs.sendMessage(tabId,{action:'openVerticalLayout',height:prefs?.height||45});
    if(!result?.success)throw new Error(result?.error||'请刷新视频页面后重试。');
    await closePanelForTab(tabId,tab.windowId);
    await chrome.sidePanel.setOptions({tabId,enabled:false});
    return {success:true,applied:true};
  }
  function horizontal(tabId) {
    chrome.sidePanel.setOptions({tabId,path:'sidepanel.html',enabled:true});
    // This call stays in the originating user gesture, before any storage await.
    return chrome.sidePanel.open({tabId}).then(async()=>{
      await chrome.tabs.sendMessage(tabId,{action:'closeVerticalLayout'}).catch(()=>{});
      return {success:true,applied:true};
    });
  }
  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if(m.action==='saveLayoutHeight') {
      if(sender.id!==chrome.runtime.id || !sender.tab?.id || !YTD_PLATFORM.videoIdFromUrl(sender.url) || !Number.isFinite(m.height) || m.height<30 || m.height>65) {reply({success:false});return false;}
      chrome.storage.local.set({[KEY]:{mode:'vertical',height:m.height}}).then(()=>reply({success:true}));return true;
    }
    if(m.action!=='setLearningLayout')return;
    if(sender.id!==chrome.runtime.id || ![chrome.runtime.getURL('sidepanel.html'),chrome.runtime.getURL('options.html')].includes(sender.url?.split('?')[0]) || !['horizontal','vertical'].includes(m.mode)){
      reply({success:false,error:'不允许的布局请求。'});return false;
    }
    const tabId=sender.tab?.id ?? m.tabId;
    const fromOptions=sender.url.split('?')[0]===chrome.runtime.getURL('options.html');
    const operation=fromOptions||!Number.isInteger(tabId)?Promise.resolve({success:true,applied:false}):m.mode==='vertical'?vertical(tabId):horizontal(tabId);
    operation.then(async result=>{
      const stored=(await chrome.storage.local.get(KEY))[KEY];mode=m.mode;
      await chrome.storage.local.set({[KEY]:{mode,height:stored?.height||45}});reply(result);
    },e=>reply({success:false,error:'布局切换失败，请刷新视频页面后重试。'+(e.message||'')}));return true;
  });
  return {isVertical:()=>mode==='vertical',vertical};
})();
