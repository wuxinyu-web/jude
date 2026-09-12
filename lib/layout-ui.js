/* The same layout preference is available in the panel and settings page. */
(() => {
  const select=document.getElementById('learningLayout');if(!select)return;
  const status=document.getElementById('layoutStatus');
  if(globalThis.YTD_PANEL&&!location.search.includes('immersive=1'))chrome.storage.session.get('ytd_immersive_return').then(async data=>{const target=data.ytd_immersive_return;if(!target)return;const tab=await chrome.tabs.getCurrent();if(tab?.id===target.tabId){await chrome.storage.session.remove('ytd_immersive_return');YTD_PANEL.switchTab(target.view==='library'?'library':'transcript');}});
  chrome.storage.local.get('ytd_layout_preferences').then(data=>{select.value=['vertical','immersive'].includes(data.ytd_layout_preferences?.mode)?data.ytd_layout_preferences.mode:'horizontal';});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.ytd_layout_preferences)select.value=['vertical','immersive'].includes(changes.ytd_layout_preferences.newValue?.mode)?changes.ytd_layout_preferences.newValue.mode:'horizontal';});
  select.addEventListener('change',async()=>{
    select.disabled=true;status.textContent='';
    try {
      const result=await chrome.runtime.sendMessage({action:'setLearningLayout',mode:select.value,tabId:globalThis.YTD_PANEL?.context().tabId});
      if(!result?.success)throw new Error(result?.error||'布局切换失败，请刷新视频页面后重试。');
      status.textContent=result.applied?'':'布局已保存，下次点击视频上的「英语学习」时使用。';
    }catch(error){status.textContent=error.message;}finally{select.disabled=false;}
  });
})();
