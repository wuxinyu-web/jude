// Prepend globalThis.JUDE_TEST_CONFIG={root,spaceId,screenshot} and run via ego-browser nodejs.
// Synthetic video only: no accounts, transcripts, providers, or stored user data.
const fs = await import('node:fs/promises');
const assert = (await import('node:assert/strict')).default;
const {root,spaceId,screenshot} = globalThis.JUDE_TEST_CONFIG;
const source = await fs.readFile(root + '/lib/layout-content.js', 'utf8');
const task = await taskSpace(spaceId);
const page = task.page('p2');
await page.goto('about:blank');
await page.evaluate(() => {
  document.body.innerHTML = `<style>
    body{margin:0}main{transform:translateZ(0)}
    #movie_player{position:relative;width:640px;height:360px;background:black;overflow:hidden}
    .html5-video-container{position:relative;height:0}
    video{position:absolute;width:640px;height:360px;left:120px;top:24px}
    .native-overlay{position:absolute;inset:0;background:black;visibility:hidden}
    .native-controls{position:absolute;bottom:0;color:white}
  </style><main><div id="movie_player"><div class="html5-video-container"><video muted playsinline></video></div><div class="native-overlay"></div><div class="native-controls">Native controls</div></div><aside>Recommendations</aside></main>`;
  let listener;
  globalThis.chrome = {runtime:{id:'layout-fixture',getURL:()=> 'about:blank',sendMessage:async()=>({success:true}),onMessage:{addListener:fn=>listener=fn,removeListener:()=>{}}}};
  globalThis.YTD_PLATFORM={videoIdFromUrl:()=> 'fixture'};
  globalThis.YTD_LAYOUT_TOOLBAR={apply:()=>{},css:''};
  globalThis.layoutMessage=message=>new Promise(resolve=>listener(message,{id:'layout-fixture'},resolve));
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
  const ctx=canvas.getContext('2d');
  globalThis.drawVideo=setInterval(()=>{ctx.fillStyle='#2c8a73';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='30px sans-serif';ctx.fillText('Jude video visibility regression',65,175);},50);
  document.querySelector('video').srcObject=canvas.captureStream(20);
});
await page.evaluate(source);
await page.evaluate(async()=>{await document.querySelector('video').play();await layoutMessage({action:'openVerticalLayout',height:30,mode:'immersive'});});
await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
const measure=()=>page.evaluate(()=>{
  const video=document.querySelector('video'),player=document.querySelector('#movie_player'),v=video.getBoundingClientRect(),p=player.getBoundingClientRect();
  return {video:v.toJSON(),player:p.toJSON(),overlay:getComputedStyle(document.querySelector('.native-overlay')).visibility,
    controls:getComputedStyle(document.querySelector('.native-controls')).visibility,decoded:video.readyState>=2,
    onTop:document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)===video};
});
const first=await measure();console.log(first);
assert.ok(first.video.height>100,'decoded video must have nonzero rendered height');
assert.equal(first.overlay,'hidden','native hidden overlays must stay hidden');
assert.equal(first.controls,'visible');assert.equal(first.onTop,true,'video must be visible at player center');
for(const height of [10,65,80]){
  await page.evaluate(async height=>{await layoutMessage({action:'closeVerticalLayout'});await layoutMessage({action:'openVerticalLayout',height,mode:'immersive'});},height);
  const r=await measure();
  assert.ok(Math.abs(r.video.height-r.player.height)<1,'video follows dock resizing');
  assert.ok(Math.abs(r.video.top-r.player.top)<1,'native inline offsets cannot displace video');
  assert.equal(r.onTop,true);
}
await page.evaluate(async()=>{await layoutMessage({action:'closeVerticalLayout'});clearInterval(drawVideo);document.querySelector('video').srcObject.getTracks().forEach(t=>t.stop());globalThis.__ytdLayoutCleanup();});
const restored=await page.evaluate(()=>({height:document.querySelector('video').getBoundingClientRect().height,top:getComputedStyle(document.querySelector('video')).top,overlay:getComputedStyle(document.querySelector('.native-overlay')).visibility,dock:!!document.querySelector('#ytd-layout-dock')}));
assert.deepEqual(restored,{height:360,top:'24px',overlay:'hidden',dock:false});
console.log('PASS: decoded video visibility, native overlay, resize, offsets and close restoration');
