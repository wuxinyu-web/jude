document.getElementById('open').addEventListener('click',async()=>{
  const button=document.getElementById('open'),status=document.getElementById('status');button.disabled=true;status.textContent='正在打开…';
  try{const result=await chrome.runtime.sendMessage({action:'openSidePanel'});if(!result?.success)throw new Error(result?.error||'请刷新视频网页，并允许句得访问此网站。');window.close();}
  catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});
document.getElementById('settings').addEventListener('click',()=>chrome.runtime.openOptionsPage());
