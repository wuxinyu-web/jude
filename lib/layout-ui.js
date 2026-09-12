/* Two layouts: the full sidebar and transcript-only immersion. */
(() => {
  const select=document.getElementById('learningLayout'),watch=document.getElementById('enterImmersive');
  if(!select&&!watch)return;
  const status=document.getElementById('layoutStatus');let mode='horizontal';
  function sync(value){mode=['vertical','immersive'].includes(value)?'immersive':'horizontal';if(select)select.value=mode;}
  chrome.storage.local.get('ytd_layout_preferences').then(data=>sync(data.ytd_layout_preferences?.mode));
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.ytd_layout_preferences)sync(changes.ytd_layout_preferences.newValue?.mode);});
  async function change(next){
    const controls=[select,watch].filter(Boolean);controls.forEach(c=>c.disabled=true);status.textContent='';
    try{const r=await chrome.runtime.sendMessage({action:'setLearningLayout',mode:next,tabId:globalThis.YTD_PANEL?.context().tabId});if(!r?.success)throw new Error(r?.error||'布局切换失败，请刷新视频页面后重试。');sync(next);status.textContent=r.applied?'':'布局已保存，下次打开学习区时使用。';}
    catch(e){status.textContent=e.message;if(select)select.value=mode;}finally{controls.forEach(c=>c.disabled=false);}
  }
  select?.addEventListener('change',()=>change(select.value));watch?.addEventListener('click',()=>change('immersive'));
})();
