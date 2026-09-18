// Run through ego-browser with globalThis.JUDE_TEST_CONFIG={root,spaceId}. Synthetic data only.
const fs=await import('node:fs/promises'),assert=(await import('node:assert/strict')).default;
const {root,spaceId}=globalThis.JUDE_TEST_CONFIG;
const task=await taskSpace(spaceId),p=task.page('p1');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await p.goto('about:blank');
await p.evaluate(()=>{
 document.head.innerHTML='<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:20px/1.7 sans-serif}.transcript-entry{padding:30px 16px}.learning-float{position:fixed;background:#eee;padding:12px;z-index:100}button{min-height:44px}</style>';
 document.body.innerHTML='<div id="contentArea"><div id="transcriptList"><div class="transcript-entry" data-segment-index="0" data-seconds="0"><span class="transcript-text">Consistency is important.</span></div></div></div>';
 Object.defineProperty(document,'readyState',{value:'loading',configurable:true});window.fixtureCalls=[];window.fixtureSeeks=0;
 chrome.runtime={sendMessage:async m=>{fixtureCalls.push(m);return {success:true,enrichment:{meaningZh:'坚持',explanationZh:'合成测试'},current:null,days:[]};}};
 window.YTD_PANEL={context:()=>({videoId:'abcDEF12345',tabId:7,videoTitle:'fixture',segments:[{text:'Consistency is important.',start:0}]}),vocabulary:()=>[],refreshVocabulary:async()=>{},speak:()=>{}};
 document.querySelector('.transcript-entry').addEventListener('click',()=>fixtureSeeks++);
});
await p.evaluate(await fs.readFile(root+'/lib/learning-core.js','utf8'));
await p.evaluate(await fs.readFile(root+'/lib/learning-ui.js','utf8'));
await p.evaluate(()=>YTD_LEARNING_UI.installCapture());
const result=await p.evaluate(async()=>{
 const el=document.querySelector('.transcript-text'),range=document.createRange();range.setStart(el.firstChild,0);range.setEnd(el.firstChild,11);const r=range.getBoundingClientRect(),x=r.left+15,y=r.top+10;
 const event=(type,px=x)=>el.dispatchEvent(new PointerEvent(type,{pointerId:1,pointerType:'touch',clientX:px,clientY:y,bubbles:true,cancelable:true}));
 event('pointerdown');event('pointerup');el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));await Promise.resolve();await Promise.resolve();
 const first={term:document.querySelector('.learning-float strong')?.textContent,calls:fixtureCalls.filter(m=>m.action==='lookupVocabulary').length,seeks:fixtureSeeks};
 YTD_LEARNING_UI.immersiveClose();event('pointerdown');event('pointermove',x+30);event('pointerup',x+30);await Promise.resolve();
 return {...first,afterScroll:fixtureCalls.filter(m=>m.action==='lookupVocabulary').length,floatAfterScroll:!!document.querySelector('.learning-float'),width:innerWidth};
});console.log(result);assert.equal(result.term,'Consistency');assert.equal(result.calls,1);assert.equal(result.seeks,0);assert.equal(result.afterScroll,1);assert.equal(result.floatAfterScroll,false);
console.log('PASS: 390px touch lookup, no accidental seek, swipe does not look up');

await p.evaluate(()=>{const root=document.querySelector('.transcript-text'),r=document.createRange();r.selectNodeContents(root);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});
await p.waitForFunction(()=>!!document.querySelector('.learning-float[data-selection-term]'));
assert.equal(await p.evaluate(()=>document.querySelector('.selection-preview').textContent),'Consistency is important.');
console.log('PASS: native sentence selection keeps the complete source and offers collection actions');
await p.goto('about:blank');
await p.evaluate(()=>{
 document.head.innerHTML='<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#movie_player{height:300px;width:640px}.html5-video-container{position:relative;height:0}video{position:absolute;height:300px;width:640px}</style>';
 document.body.innerHTML='<main><div id="movie_player"><div class="html5-video-container"><video></video></div></div></main>';
 let listener;chrome.runtime={id:'fixture',getURL:path=> 'about:blank?'+path.split('?')[1],sendMessage:async()=>({success:true}),onMessage:{addListener:f=>listener=f,removeListener:()=>{}}};
 window.YTD_PLATFORM={videoIdFromUrl:()=> 'abcDEF12345'};window.YTD_LAYOUT_TOOLBAR={apply:()=>{},css:''};
 window.sendLayout=m=>new Promise(resolve=>listener(m,{id:'fixture'},resolve));
});
await p.evaluate(await fs.readFile(root+'/lib/layout-content.js','utf8'));
await p.evaluate(()=>sendLayout({action:'openVerticalLayout',mode:'mobile',height:55}));
const geometry=await p.evaluate(()=>{const host=document.querySelector('#ytd-layout-dock'),player=document.querySelector('#movie_player'),video=document.querySelector('video'),frame=host.shadowRoot.querySelector('iframe');return {width:innerWidth,video:video.getBoundingClientRect().toJSON(),player:player.getBoundingClientRect().toJSON(),dock:host.getBoundingClientRect().toJSON(),src:frame.getAttribute('src'),inline:video.playsInline,immersive:document.documentElement.hasAttribute('data-ytd-immersive')};});
assert.equal(geometry.width,390);assert.ok(geometry.video.height>100);assert.ok(Math.abs(geometry.video.height-geometry.player.height)<1);assert.ok(Math.abs(geometry.player.bottom-geometry.dock.top)<1);assert.ok(geometry.src.endsWith('&mobile=1'));assert.equal(geometry.immersive,false);assert.equal(geometry.inline,true);
await p.evaluate(()=>sendLayout({action:'closeVerticalLayout'}));assert.equal(await p.evaluate(()=>document.querySelector('video').hasAttribute('playsinline')),false);
console.log('PASS: 390px full learning frame, video geometry, inline playback attribute and restoration');
