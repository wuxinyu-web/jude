const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const C=require('../lib/sync-core');

function harness(extra={},fetchOverride=null){
  const store={ytd_sync_config:{provider:'supabase-v1',email:'a@example.com',deviceId:'desktop',accessToken:'a'.repeat(48),refreshToken:'r'.repeat(48),expiresAt:Date.now()+3600000},...structuredClone(extra)};
  const alarms=new Map();let calls=0,respond;
  const response=new Promise(resolve=>respond=records=>resolve(new Response(JSON.stringify(records))));
  const context={YTD_SYNC_CORE:C,JUDE_SYNC_CONFIG:{supabaseUrl:'https://project.supabase.co',supabaseAnonKey:'p'.repeat(40)},crypto:require('node:crypto').webcrypto,URL,TextDecoder,Uint8Array,AbortSignal,console,
    fetch:async(...args)=>{calls++;return fetchOverride?fetchOverride(...args):response;},
    chrome:{storage:{local:{get:async keys=>structuredClone(keys===null?store:Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>Object.hasOwn(store,k)).map(k=>[k,store[k]]))),set:async data=>Object.assign(store,structuredClone(data)),remove:async key=>{delete store[key];},clear:async()=>{for(const key of Object.keys(store))delete store[key];}},onChanged:{addListener(){}}},alarms:{create:async(key,value)=>alarms.set(key,value),get:async key=>alarms.get(key),clear:async key=>alarms.delete(key),onAlarm:{addListener(){}}},runtime:{id:'extension',getURL:path=>'chrome-extension://extension/'+path,sendMessage:async()=>{},onMessage:{addListener(){}}}}};
  vm.createContext(context);
  for(const file of ['lib/data-lock.js','lib/sync-client.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
  return {client:context.YTD_SYNC_CLIENT,store,respond,calls:()=>calls,context};
}
const until=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(predicate());};

test('signed-out sync sends no network request',async()=>{
  const h=harness({ytd_sync_config:{}});await h.client.syncNow();assert.equal(h.calls(),0);
});
test('a collection added during a network wait survives remote application',async()=>{
  const h=harness({ytd_notes:[{id:'one',text:'first'}]});const promise=h.client.syncNow();await until(()=>h.calls()===1);
  h.store.ytd_notes.push({id:'two',text:'saved while offline'});
  h.respond({'ytd_notes/three':{value:{id:'three',text:'other device'},deviceId:'mobile',updatedAt:10}});
  await promise;assert.deepEqual(h.store.ytd_notes.map(n=>n.id).sort(),['one','three','two']);
});
test('logout during a pending sync cannot restore a token or apply remote data',async()=>{
  const h=harness({ytd_notes:[{id:'one'}]});const promise=h.client.syncNow();await until(()=>h.calls()===1);
  await h.client.logout();h.respond({'ytd_notes/two':{value:{id:'two'},deviceId:'mobile',updatedAt:10}});await promise;
  assert.equal(h.store.ytd_sync_config.accessToken,'');assert.deepEqual(h.store.ytd_notes,[{id:'one'}]);
});
test('another account cannot receive the retained local library',async()=>{
  const h=harness();await assert.rejects(h.client.verifyCode({consent:true,email:'b@example.com',code:'123456'}),/另一个/);assert.equal(h.calls(),0);
});
test('failed sync leaves the library and persisted change journal intact',async()=>{
  const h=harness({ytd_notes:[{id:'one'}]});h.context.fetch=async()=>{throw Error('offline');};
  await assert.rejects(h.client.syncNow(),/offline/);assert.deepEqual(h.store.ytd_notes,[{id:'one'}]);assert.ok(h.store.ytd_sync_records['ytd_notes/one']);
});
test('untrusted remote namespace rejects entire batch without changing local data',async()=>{
  const h=harness({ytd_notes:[{id:'one'}]});const promise=h.client.syncNow();await until(()=>h.calls()===1);
  h.respond({'ytd_settings/key':{value:{aiApiKey:'injected'},deviceId:'bad',updatedAt:1}});
  await assert.rejects(promise,/无效/);assert.deepEqual(h.store.ytd_notes,[{id:'one'}]);assert.equal(h.store.ytd_settings,undefined);
});
test('OTP request uses the configured Supabase auth endpoint and public key',async()=>{
  let request;
  const h=harness({ytd_sync_config:{}},async(url,options)=>{request={url,options};return new Response('{}');});
  await h.client.sendCode({email:'  User@Example.com '});
  assert.equal(request.url,'https://project.supabase.co/auth/v1/otp');
  assert.equal(request.options.headers.apikey,'p'.repeat(40));
  assert.deepEqual(JSON.parse(request.options.body),{email:'user@example.com',create_user:true});
});
test('OTP verification creates a session and performs first sync',async()=>{
  const replies=[{access_token:'a'.repeat(48),refresh_token:'r'.repeat(48),expires_in:3600},{}];
  const h=harness({ytd_sync_config:{}},async()=>new Response(JSON.stringify(replies.shift())));
  const state=await h.client.verifyCode({email:'user@example.com',code:'123456',consent:true});
  assert.equal(state.loggedIn,true);assert.equal(h.store.ytd_sync_config.provider,'supabase-v1');assert.equal(h.calls(),2);
});
test('expired access token refreshes before uploading records',async()=>{
  const replies=[{access_token:'n'.repeat(48),refresh_token:'s'.repeat(48),expires_in:3600},{}];
  const h=harness({ytd_sync_config:{provider:'supabase-v1',email:'a@example.com',deviceId:'desktop',accessToken:'a'.repeat(48),refreshToken:'r'.repeat(48),expiresAt:0}},async()=>new Response(JSON.stringify(replies.shift())));
  await h.client.syncNow();assert.equal(h.store.ytd_sync_config.accessToken,'n'.repeat(48));assert.equal(h.calls(),2);
});
