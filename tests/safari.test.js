const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {safariManifest}=require('../scripts/package-safari.cjs'),P=require('../lib/platform.js');
test('Safari manifest removes desktop-only APIs, adds exact mobile origins, and preserves Chrome manifest',()=>{
  const chrome=JSON.parse(fs.readFileSync('manifest.json','utf8')),before=JSON.stringify(chrome),m=safariManifest(chrome);
  assert.equal(JSON.stringify(chrome),before);assert.equal(m.side_panel,undefined);assert.equal(m.minimum_chrome_version,undefined);
  assert.ok(!m.permissions.includes('sidePanel'));assert.ok(!m.host_permissions.some(p=>p.includes('127.0.0.1')));
  assert.equal(m.action.default_popup,'safari/popup.html');assert.equal(m.options_ui.open_in_tab,undefined);
  assert.ok(m.content_scripts[0].matches.includes('https://m.youtube.com/*'));
  assert.ok(m.web_accessible_resources[0].matches.includes('https://m.bilibili.com/*'));
  assert.ok(!m.host_permissions.includes('<all_urls>'));
});
test('mobile identities reuse existing collections and reject lookalike domains',()=>{
  assert.equal(P.videoIdFromUrl('https://m.youtube.com/watch?v=abcDEF12345'),'abcDEF12345');
  assert.equal(P.videoIdFromUrl('https://m.bilibili.com/video/BV1xx411c7mD?p=2'),'BV1xx411c7mD_p2');
  for(const url of ['https://m.youtube.com.evil.test/watch?v=abcDEF12345','http://m.youtube.com/watch?v=abcDEF12345']){
    assert.equal(P.supported(url),false);assert.equal(P.parse(url),null);
  }
});
test('mobile library exposes a dedicated Excel export and system share fallback',()=>{
  const ui=fs.readFileSync('lib/learning-ui.js','utf8'),css=fs.readFileSync('safari/mobile.css','utf8');
  assert.match(ui,/button\("导出 Excel",exportLibraryExcel,"learning-button library-excel-export"\)/);
  assert.match(ui,/YTD_EXCEL\.libraryToBlob\(entries\)/);assert.match(ui,/navigator\.share\(\{files:\[file\]/);
  assert.match(css,/\.library-excel-export\s*\{[^}]*flex:\s*1 0 100%/s);
});
function layoutHarness(){
  const calls=[],data={},listeners=[];
  const c={URL,console,YTD_PLATFORM:P,YTD_LAYOUT_TOOLBAR:{},closePanelForTab:async()=>{},chrome:{
    runtime:{id:'safari',getURL:p=>'safari-web-extension://fixture/'+p,onMessage:{addListener:f=>listeners.push(f)}},
    storage:{local:{get:async()=>data,set:async v=>Object.assign(data,v)},onChanged:{addListener(){}}},
    tabs:{get:async()=>({id:7,url:'https://m.youtube.com/watch?v=abcDEF12345'}),sendMessage:async(id,m)=>{calls.push(m);return {success:true};}},
  }};
  vm.createContext(c);vm.runInContext(fs.readFileSync('lib/layout-worker.js','utf8'),c);
  const send=(m,s)=>new Promise(resolve=>{const async=listeners[0](m,s,resolve);if(async!==true)resolve({success:false});});
  return {c,calls,data,send};
}
test('Safari opens complete embedded learning UI without sidePanel and can return from immersion',async()=>{
  const h=layoutHarness();assert.equal(h.c.YTD_LAYOUT.isVertical(),true);
  await h.c.YTD_LAYOUT.vertical(7);assert.equal(h.calls.at(-1).mode,'mobile');assert.equal(h.calls.at(-1).height,55);
  await h.c.YTD_LAYOUT.vertical(7,'immersive');assert.equal(h.calls.at(-1).mode,'immersive');
  const r=await h.send({action:'setLearningLayout',mode:'horizontal'},{id:'safari',tab:{id:7},url:'safari-web-extension://fixture/sidepanel.html?embedded=1&immersive=1'});
  assert.equal(r.success,true);assert.equal(h.calls.at(-1).mode,'mobile');
});
test('mobile height saves independently; site scripts cannot invoke extension-page layout APIs',async()=>{
  const h=layoutHarness(),sender={id:'safari',tab:{id:7},url:'https://m.youtube.com/watch?v=abcDEF12345'};
  assert.equal((await h.send({action:'saveLayoutHeight',height:60,mode:'mobile'},sender)).success,true);
  assert.equal(h.data.ytd_layout_preferences.mobileHeight,60);assert.equal(h.data.ytd_layout_preferences.mode,'horizontal');
  assert.equal((await h.send({action:'saveLayoutHeight',height:100,mode:'mobile'},sender)).success,false);
  assert.equal((await h.send({action:'setLearningLayout',mode:'horizontal'},sender)).success,false);
});
test('Safari worker starts without Chrome-only sidePanel or setAccessLevel and rejects foreign popup requests',async()=>{
  const handlers=[],event={addListener(){}},opened=[];
  const c={console,URL,TextDecoder,TextEncoder,AbortController,setTimeout,clearTimeout,importScripts(){},YTD_PLATFORM:P,
    YTD_LAYOUT:{isVertical:()=>true,vertical:async id=>{opened.push(id);return {success:true};}},
    YTD_SETTINGS:{STORAGE_KEY:'settings'},chrome:{storage:{local:{}},action:{onClicked:event},
      runtime:{id:'safari',getURL:p=>'safari-web-extension://fixture/'+p,onMessage:{addListener:f=>handlers.push(f)},onInstalled:event},
      tabs:{onUpdated:event,onActivated:event,query:async()=>[{id:7}]}}};
  vm.createContext(c);vm.runInContext(fs.readFileSync('background.js','utf8'),c);
  const send=s=>new Promise(resolve=>handlers[0]({action:'openSidePanel'},s,resolve));
  assert.equal((await send({id:'other',url:'safari-web-extension://fixture/safari/popup.html'})).success,false);
  assert.equal((await send({id:'safari',url:'safari-web-extension://fixture/safari/popup.html'})).success,true);
  assert.deepEqual(opened,[7]);
});
