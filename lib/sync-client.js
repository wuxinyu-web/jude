/* Optional Supabase sync. Signed-out installations make no sync requests. */
var YTD_SYNC_CLIENT = (() => {
  const C=YTD_SYNC_CORE, CONFIG='ytd_sync_config', RECORDS='ytd_sync_records';
  const PERIODIC='ytd_optional_sync', SOON='ytd_sync_soon', PROVIDER='supabase-v1';
  let running=null, epoch=0;
  const lock=YTD_DATA_LOCK;

  function deployment(){
    const raw=globalThis.JUDE_SYNC_CONFIG||{};
    let url;try{url=new URL(raw.supabaseUrl);}catch{throw Error('同步服务尚未配置，请等待发布者完成上线。');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||typeof raw.supabaseAnonKey!=='string'||raw.supabaseAnonKey.length<20)throw Error('同步服务配置无效。');
    return {url:url.origin,key:raw.supabaseAnonKey};
  }
  function normalizeEmail(value){
    const email=String(value||'').trim().toLowerCase();
    if(!/^[^@\s]{1,200}@[^@\s]{1,200}$/.test(email))throw Error('请输入有效邮箱。');
    return email;
  }
  async function config(){
    const stored=(await chrome.storage.local.get(CONFIG))[CONFIG]||{};
    if(stored.token||stored.serverUrl){
      const migrated={email:stored.email||'',deviceId:stored.deviceId||crypto.randomUUID(),lastError:''};
      await chrome.storage.local.set({[CONFIG]:migrated});return migrated;
    }
    return stored;
  }
  async function readJson(response,max=8*1024*1024){
    if(!response.body)return null;
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('同步响应过大。');}chunks.push(value);}
    if(!size)return null;
    const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
    try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw Error('同步服务返回了无效数据。');}
  }
  function friendlyError(data,status){
    const raw=String(data?.msg||data?.message||data?.error_description||data?.error||'');
    if(status===429)return '请求过于频繁，请稍后再试。';
    if(status===401||/token.*expired|invalid.*token|jwt/i.test(raw))return '登录已过期，请重新获取验证码。';
    if(/otp.*expired|invalid.*otp|token.*invalid/i.test(raw))return '验证码错误或已过期。';
    if(/email rate limit/i.test(raw))return '验证码发送过于频繁，请稍后再试。';
    return raw&&raw.length<=200?raw:'同步服务暂时不可用。';
  }
  async function api(path,{accessToken,body}={}){
    const d=deployment();
    const response=await fetch(d.url+path,{method:'POST',redirect:'error',credentials:'omit',headers:{apikey:d.key,'Content-Type':'application/json',...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(20000)});
    const data=await readJson(response);
    if(!response.ok){const e=Error(friendlyError(data,response.status));e.status=response.status;throw e;}
    return data;
  }
  async function status(){return C.publicConfig(await config());}
  async function sendCode(message){
    const email=normalizeEmail(message.email);deployment();
    await api('/auth/v1/otp',{body:{email,create_user:true}});
    return {ok:true,email};
  }
  async function verifyCode(message){
    if(message.consent!==true)throw Error('请先确认将本机学习资料合并到此账号。');
    const email=normalizeEmail(message.email),code=String(message.code||'').trim();
    if(!/^\d{6,8}$/.test(code))throw Error('请输入邮件中的验证码。');
    const ticket=++epoch,old=await config();
    if(old.email&&old.email!==email)throw Error('本机资料属于另一个同步账号。请使用独立的 Chrome 用户配置登录新账号，或先导出并重置本机数据。');
    const result=await api('/auth/v1/verify',{body:{email,token:code,type:'email'}});
    if(typeof result?.access_token!=='string'||typeof result?.refresh_token!=='string')throw Error('登录凭证无效。');
    await lock(async()=>{
      if(ticket!==epoch)throw Error('登录操作已取消。');
      await chrome.storage.local.set({[CONFIG]:{...old,provider:PROVIDER,email,accessToken:result.access_token,refreshToken:result.refresh_token,expiresAt:Date.now()+Math.max(60,Number(result.expires_in)||3600)*1000,deviceId:old.deviceId||crypto.randomUUID(),lastError:''}});
    });
    await chrome.alarms.create(PERIODIC,{periodInMinutes:15});
    try{await syncNow();}catch{/* Persistent status reports the first-sync error. */}
    return status();
  }
  async function validSession(snapshot){
    if(snapshot.expiresAt>Date.now()+60_000)return snapshot;
    if(!snapshot.refreshToken)throw Object.assign(Error('登录已过期，请重新获取验证码。'),{status:401});
    const result=await api('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:snapshot.refreshToken}});
    if(typeof result?.access_token!=='string'||typeof result?.refresh_token!=='string')throw Object.assign(Error('登录已过期，请重新获取验证码。'),{status:401});
    const updated={...snapshot,accessToken:result.access_token,refreshToken:result.refresh_token,expiresAt:Date.now()+Math.max(60,Number(result.expires_in)||3600)*1000};
    await lock(async()=>{const active=await config();if(active.refreshToken===snapshot.refreshToken)await chrome.storage.local.set({[CONFIG]:updated});});
    return updated;
  }
  async function syncNow(){
    if(running)return running;
    running=(async()=>{
      const ticket=epoch;
      const snapshot=await lock(async()=>{
        const cfg=await config();if(cfg.provider!==PROVIDER||!cfg.accessToken)return null;
        const data=await chrome.storage.local.get([...C.KEYS,RECORDS]);
        const records=C.reconcile(data,data[RECORDS]||{},cfg.deviceId,Date.now());
        await chrome.storage.local.set({[RECORDS]:records});
        return {cfg,records};
      });
      if(!snapshot)return {skipped:true,...await status()};
      let cfg=snapshot.cfg;
      try{
        cfg=await validSession(cfg);
        const remote=await api('/rest/v1/rpc/jude_sync_merge',{accessToken:cfg.accessToken,body:{incoming:snapshot.records}});
        C.validateRecords(remote);
        await lock(async()=>{
          const active=await config();if(ticket!==epoch||active.refreshToken!==cfg.refreshToken)return;
          const latest=await chrome.storage.local.get(C.KEYS);
          const current=C.reconcile(latest,snapshot.records,cfg.deviceId,Date.now());
          const merged=C.merge(current,remote),updates=C.materialize(merged);
          for(const key of ['ytd_study','ytd_challenges']){
            updates[key].currentId=latest[key]?.currentId||null;
            const existing=new Map((latest[key]?.sessions||[]).map(s=>[s.id,s]));
            updates[key].sessions=updates[key].sessions.map(s=>{const own=existing.get(s.id);return own?{...s,...Object.fromEntries(C.RUNTIME_FIELDS.filter(k=>Object.hasOwn(own,k)).map(k=>[k,own[k]]))}:{...s,status:key==='ytd_study'&&s.status==='running'?'paused':s.status,needsResume:true,lastSample:null};});
          }
          await chrome.storage.local.set({...updates,[RECORDS]:merged,[CONFIG]:{...active,lastSyncAt:Date.now(),lastError:''}});
        });
        chrome.runtime.sendMessage({action:'learningChanged'}).catch(()=>{});return status();
      }catch(error){
        await lock(async()=>{const active=await config();if(ticket!==epoch)return;await chrome.storage.local.set({[CONFIG]:{...active,...(error.status===401?{accessToken:'',refreshToken:'',expiresAt:0}:{}),lastError:error.message}});});throw error;
      }
    })().finally(()=>{running=null;});return running;
  }
  async function logout(){
    ++epoch;
    const old=await lock(async()=>{const cfg=await config();await chrome.storage.local.set({[CONFIG]:{...cfg,accessToken:'',refreshToken:'',expiresAt:0,lastError:''}});return cfg;});
    await chrome.alarms.clear(PERIODIC);await chrome.alarms.clear(SOON);
    if(old.accessToken)api('/auth/v1/logout',{accessToken:old.accessToken}).catch(()=>{});
    return status();
  }
  async function deleteAccount(){
    const cfg=await validSession(await config());if(!cfg.accessToken)throw Error('请先登录。');
    await api('/rest/v1/rpc/jude_delete_account',{accessToken:cfg.accessToken});return logout();
  }
  async function reset(){await logout();await lock(()=>chrome.storage.local.clear());return {};}
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||!C.KEYS.some(key=>changes[key]))return;config().then(async cfg=>{if(cfg.accessToken&&!await chrome.alarms.get(SOON))await chrome.alarms.create(SOON,{delayInMinutes:0.5});}).catch(()=>{});});
  chrome.alarms.onAlarm.addListener(a=>{if([PERIODIC,SOON].includes(a.name))syncNow().catch(()=>{});});
  const handlers={syncStatus:status,syncSendCode:sendCode,syncVerifyCode:verifyCode,syncNow,syncLogout:logout,syncResetLocal:reset,syncDeleteAccount:deleteAccount,syncClearNotes:()=>lock(()=>chrome.storage.local.remove('ytd_notes'))};
  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if(!Object.hasOwn(handlers,m.action))return false;
    if(sender.id!==chrome.runtime.id||sender.url?.split('?')[0]!==chrome.runtime.getURL('options.html')){reply({success:false,error:'Not permitted'});return false;}
    Promise.resolve().then(()=>handlers[m.action](m)).then(data=>reply({success:true,...data}),e=>reply({success:false,error:e.message}));return true;
  });
  status().then(s=>{if(s.loggedIn)chrome.alarms.create(PERIODIC,{periodInMinutes:15});}).catch(()=>{});
  return {deployment,sendCode,verifyCode,syncNow,logout,status};
})();
