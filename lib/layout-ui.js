/* Contextual controls in the panel; detailed preference stays in Settings. */
(() => {
  const select=document.getElementById('learningLayout'),watch=document.getElementById('enterImmersive'),move=document.getElementById('moveLearningPanel');
  if(!select&&!watch)return;
  const status=document.getElementById('layoutStatus');let mode='horizontal';
  function sync(value){mode=['vertical','immersive'].includes(value)?value:'horizontal';if(select)select.value=mode;if(move){move.textContent=mode==='horizontal'?'放到下方 ↓':'收至右侧 →';move.title=mode==='horizontal'?'把完整学习区展开到视频下方':'把完整学习区收至视频右侧';}}
  if(globalThis.YTD_PANEL&&!location.search.includes('immersive=1'))chrome.storage.session.get('ytd_immersive_return').then(async data=>{const target=data.ytd_immersive_return;if(!target)return;const tab=await chrome.tabs.getCurrent();if(tab?.id===target.tabId){await chrome.storage.session.remove('ytd_immersive_return');YTD_PANEL.switchTab(target.view==='library'?'library':'transcript');}});
  chrome.storage.local.get('ytd_layout_preferences').then(data=>sync(data.ytd_layout_preferences?.mode));
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.ytd_layout_preferences)sync(changes.ytd_layout_preferences.newValue?.mode);});
  async function change(next){
    const controls=[select,watch,move].filter(Boolean);controls.forEach(c=>c.disabled=true);status.textContent='';
    try{const r=await chrome.runtime.sendMessage({action:'setLearningLayout',mode:next,tabId:globalThis.YTD_PANEL?.context().tabId});if(!r?.success)throw new Error(r?.error||'布局切换失败，请刷新视频页面后重试。');sync(next);status.textContent=r.applied?'':'布局已保存，下次打开学习区时使用。';}
    catch(e){status.textContent=e.message;if(select)select.value=mode;}finally{controls.forEach(c=>c.disabled=false);}
  }
  select?.addEventListener('change',()=>change(select.value));watch?.addEventListener('click',()=>change('immersive'));move?.addEventListener('click',()=>change(mode==='horizontal'?'vertical':'horizontal'));
})();
