/* Real extension integration test. Synthetic page, captions and AI only. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(process.env.YTD_EXTENSION_DIR||path.join(__dirname,'..')),out=path.resolve(process.env.YTD_TEST_OUTPUT||path.join(root,'test-results'));
const asr=process.env.YTD_TEST_ASR==='1',noCaptions=process.env.YTD_TEST_NO_CAPTIONS==='1';
const bili=process.env.YTD_TEST_PLATFORM==='bilibili',fixtureId=bili?'BV1xx411c7mD_p2':'abcDEF12345';
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ytd-study-browser-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(150);}throw new Error(`Timed out: ${label}`);}
function attachClient(rootSession,sessionId){
  let seq=0;const pending=new Map(),errors=[];
  rootSession.on('Target.receivedMessageFromTarget',event=>{
    if(event.sessionId!==sessionId)return;const msg=JSON.parse(event.message);
    if(msg.id){const p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result);}}
    if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},15000);pending.set(id,{resolve,reject,timer});rootSession.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);});
  const evaluate=async(fn,arg)=>{const r=await send('Runtime.evaluate',{expression:`(${fn.toString()})(${JSON.stringify(arg)??'undefined'})`,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const click=async(selector,text)=>{const point=await evaluate(async({selector,text})=>{const e=[...document.querySelectorAll(selector)].find(e=>!text||e.textContent.trim()===text);if(!e)throw new Error(`Missing ${selector} ${text||''}`);const initial=e.getBoundingClientRect();const hit=document.elementFromPoint(initial.left+initial.width/2,initial.top+initial.height/2);if(initial.top<125||initial.bottom>innerHeight-100||!e.contains(hit))e.scrollIntoView({block:'center',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};},{selector,text});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});};
  const screenshot=async name=>{await sleep(350);const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name),Buffer.from(r.data,'base64'));};
  return {send,evaluate,click,screenshot,errors};
}
(async()=>{
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1200,height:900},acceptDownloads:true,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
  let panel, asrServer;
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const extensionId=new URL(worker.url()).host;
    await worker.evaluate(async({bili,fixtureId,asr,noCaptions})=>{
      const transcript=[{text:'Consistency is important when you learn something new. A little practice every day builds a useful habit.',start:0,duration:12},{text:'The book which she recommended changed my perspective, although I was initially reluctant to read it.',start:22,duration:12}];
      if(asr)for(const [i,item] of transcript.entries())item.text=i?'她推荐的书改变了我的看法。':'静止的物体将保持静止，运动的物体将保持运动。';
      for(let i=0;i<14;i++)transcript.push({text:`This is another complete practice sentence about learning English every day, number ${i+1}.`,start:45+i*20,duration:12});
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ytd_settings:{aiApiKey:'fixture-key',supadataApiKey:'fixture-key'},digest_abcDEF12345:{timestamp:Date.now(),videoTitle:'English practice fixture',channelName:'Test fixture',transcriptLanguage:'en',transcriptSource:'native',transcript,transcriptText:transcript.map(t=>t.text).join(' '),transcriptTimestamped:transcript.map(t=>`[${t.start}] ${t.text}`).join('\n')}});
      if(bili){await chrome.storage.local.remove('digest_abcDEF12345');await chrome.storage.local.set({ytd_settings:{aiApiKey:'fixture-key'}});}
      globalThis.__nativeCalls=[];globalThis.__fixtureCalls=[];globalThis.__fixtureDelay=0;
      const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{
        if(bili && /https:\/\/(api\.bilibili\.com|aisubtitle\.hdslb\.com)\//.test(String(url))){
          __nativeCalls.push(String(url));let payload;
          if(String(url).includes('/view?'))payload={code:0,data:{bvid:'BV1xx411c7mD',aid:1,title:'B 站英语课堂',owner:{name:'测试老师'},pages:[{page:1,cid:10},{page:2,cid:20,part:'英语学习 · 第二节'}]}};
          else if(String(url).includes('/nav'))payload={data:{wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',sub_url:'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'}}};
          else if(String(url).includes('/player/'))payload={code:0,data:{subtitle:{subtitles:noCaptions?[]:[{lan:asr?'ai-zh':'en',lan_doc:asr?'中文':'英语',subtitle_url:'https://aisubtitle.hdslb.com/fixture.json'}]}}};
          else payload={body:transcript.map(s=>({from:s.start,to:s.start+s.duration,content:s.text}))};
          return new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}});
        }
        if(String(url).startsWith('https://api.deepseek.com/')){
          const req=JSON.parse(options.body);__fixtureCalls.push(req);if(globalThis.__fixtureFailure)return new Response(JSON.stringify({error:{message:'测试查词失败'}}),{status:503,headers:{'Content-Type':'application/json'}});if(__fixtureDelay)await new Promise(r=>setTimeout(r,__fixtureDelay));
          let payload;try{payload=JSON.parse(req.messages[1].content);}catch{}
          if(payload?.segments){return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({segments:payload.segments.map(s=>({id:s.id,text:'中文测试译文：持续练习能够培养学习习惯。'}))})}}]}),{headers:{'Content-Type':'application/json'}});}
          const isSentence=req.messages[0].content.includes('translationZh');
          const data=isSentence?{translationZh:'这本她推荐的书改变了我的看法。',mainClause:'The book changed my perspective. 主干是主语、谓语和宾语。',breakdown:'which she recommended 是定语从句，说明是哪一本书。although 引导让步状语从句。',grammarTags:['定语从句','状语从句'],expressionTags:['普通表达']}:{meaningZh:'持续性；前后一致',explanationZh:'这里强调持续练习的习惯。',phonetic:'/kənˈsɪstənsi/'};
          return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(data)}}]}),{headers:{'Content-Type':'application/json'}});
        }
        if(String(url).startsWith('https://'))throw new Error('LIVE PROVIDER DISABLED IN FIXTURE TEST');return original(url,options);
      };
    },{bili,fixtureId,asr,noCaptions});
    await context.route(bili?'https://www.bilibili.com/**':'https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="UTF-8"><title>English practice fixture</title><style>video{width:600px;height:300px;background:#ddd}ytd-watch-metadata{display:block}</style></head><body><h1 class="video-title">英语学习测试视频</h1><div class="video-toolbar-left"></div><div class="recommend-list-v1">推荐</div><div id="movie_player" class="html5-video-player"><video muted></video></div><ytd-watch-metadata><div id="actions-inner" style="width:400px;height:40px"><div id="top-level-buttons-computed" style="width:400px;height:40px">Share</div></div></ytd-watch-metadata><div id="comments">Comments</div><ytd-watch-next-secondary-results-renderer>Recommendations</ytd-watch-next-secondary-results-renderer></body></html>`}));
    const video=await context.newPage();
    for(const p of context.pages())if(p.url().includes('options.html'))await p.close();
    await video.goto(bili?'https://www.bilibili.com/video/BV1xx411c7mD/?p=2':'https://www.youtube.com/watch?v=abcDEF12345');
    if(process.env.YTD_TEST_SEGMENTS==='1')await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{Object.defineProperty(document.querySelector('video'),'duration',{get:()=>29344,configurable:true});Object.defineProperty(document.querySelector('video'),'currentTime',{get:()=>14500,configurable:true});}});});
    await video.locator('#ytd-digest-button').click({timeout:12000});
    const cdp=await context.newCDPSession(video);let target;
    await until(async()=>{target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/sidepanel.html`);return !!target;},'side panel target');
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});panel=attachClient(cdp,sessionId);
    await panel.send('Runtime.enable');await panel.send('Page.enable');await panel.send('Emulation.setDeviceMetricsOverride',{width:420,height:900,deviceScaleFactor:1,mobile:false});
    if(noCaptions)await until(()=>panel.evaluate(()=>document.getElementById('errorBtn').textContent==='从英文原声生成字幕'),'no-caption audio action');
    else await until(()=>panel.evaluate(()=>document.querySelectorAll('.transcript-original,.transcript-text').length>=2),'rendered transcript');
    assert.equal(await panel.evaluate(()=>document.querySelector('[data-tab="ask"]')),null);
    assert.deepEqual(await panel.evaluate(()=>[...document.querySelectorAll('.tab')].map(e=>e.textContent.trim())),['字幕','概览','收藏库','学习']);
    if(bili){assert.equal(await worker.evaluate(()=>__nativeCalls.length),noCaptions?3:4);assert.ok(await worker.evaluate(()=>__nativeCalls.some(u=>u.includes('cid=20'))));}

    if(process.env.YTD_TEST_IMMERSIVE==='1'||process.env.YTD_TEST_LAYOUT==='1'){
      const setTime=t=>worker.evaluate(async t=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});await chrome.scripting.executeScript({target:{tabId:tab.id},args:[t],func:t=>Object.defineProperty(document.querySelector('video'),'currentTime',{configurable:true,get:()=>t})});},t);await setTime(2);
      assert.equal(await panel.evaluate(async()=>(await chrome.runtime.sendMessage({action:'syncImmersiveToolbar'})).success),false);
      await panel.click('#enterImmersive');let frame;
      await until(async()=>{frame=video.frames().find(f=>f.url().includes('immersive=1'));return frame&&await frame.locator('.transcript-original').count()>2;},'reused bilingual transcript',20000);
      await until(async()=>(await frame.locator('.transcript-translation').first().innerText()).includes('中文测试译文'),'default Chinese');
      assert.equal(await frame.locator('.header').isVisible(),false);assert.equal(await frame.locator('[data-panel=study]').isVisible(),false);assert.equal(await frame.locator('[data-panel=library]').isVisible(),false);
      assert.equal(await frame.locator('[data-transcript-mode=bilingual]').getAttribute('aria-pressed'),'true');
      assert.equal(await frame.locator('.transcript-original').first().innerText(),'Consistency is important when you learn something new.','one sentence per row');
      assert.ok(await frame.locator('.transcript-original').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)<=20),'smaller immersive English');
      // Reproduce an old page host around freshly loaded iframe assets.
      await video.evaluate(()=>{
        const shadow=document.querySelector('#ytd-layout-dock').shadowRoot;
        shadow.querySelector('#ytd-compact-toolbar').remove();
        const old=document.createElement('style');old.textContent='header{position:relative;height:20px;background:#121313}iframe{height:calc(100% - 20px)}';shadow.append(old);
        shadow.querySelector('#close').textContent='关闭学习区';
      });
      assert.equal(await frame.evaluate(async()=>(await chrome.runtime.sendMessage({action:'syncImmersiveToolbar'})).success),true);
      assert.equal(await frame.evaluate(async()=>(await chrome.runtime.sendMessage({action:'syncImmersiveToolbar'})).success),true);
      const toolbar=await video.evaluate(()=>{
        const host=document.querySelector('#ytd-layout-dock'),shadow=host.shadowRoot;
        return {offset:shadow.querySelector('iframe').getBoundingClientRect().top-host.getBoundingClientRect().top,
          close:shadow.querySelector('#close').textContent,styles:shadow.querySelectorAll('#ytd-compact-toolbar').length};
      });
      assert.deepEqual(toolbar,{offset:0,close:'×',styles:1});
      const geometry=await video.evaluate(()=>({p:document.querySelector('#movie_player').getBoundingClientRect().toJSON(),d:document.querySelector('#ytd-layout-dock').getBoundingClientRect().toJSON()}));assert.ok(geometry.p.height>=600);assert.ok(Math.abs(geometry.p.bottom-geometry.d.top)<2);
      await video.getByRole('separator').focus();await video.keyboard.press('ArrowUp');await until(()=>worker.evaluate(async()=>(await chrome.storage.local.get('ytd_layout_preferences')).ytd_layout_preferences.immersiveHeight===35),'resize height persists');
      // Real pointer movement crosses the iframe and exceeds the former 45vh cap.
      const grip=await video.getByRole('separator').boundingBox();
      await video.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await video.mouse.down();
      await video.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2-270,{steps:12});await video.mouse.up();
      await until(()=>worker.evaluate(async()=>Math.abs((await chrome.storage.local.get('ytd_layout_preferences')).ytd_layout_preferences.immersiveHeight-65)<1),'upward drag expands to 65 percent');
      assert.equal(await video.locator('#ytd-layout-dock').getAttribute('data-resizing'),null);
      const edge=await video.locator('#resizeEdge').boundingBox();
      await video.mouse.move(edge.x+100,edge.y+5);await video.mouse.down();
      await video.mouse.move(edge.x+100,edge.y+410,{steps:12});await video.mouse.up();
      await until(()=>worker.evaluate(async()=>Math.abs((await chrome.storage.local.get('ytd_layout_preferences')).ytd_layout_preferences.immersiveHeight-20)<1),'downward boundary drag shrinks to 20 percent');
      await video.getByRole('separator').dblclick();
      await until(()=>worker.evaluate(async()=>(await chrome.storage.local.get('ytd_layout_preferences')).ytd_layout_preferences.immersiveHeight===30),'double click resets height');
      await video.getByRole('separator').focus();await video.keyboard.press('ArrowUp');
      await frame.locator('[data-transcript-mode=original]').click();await until(async()=>await frame.locator('.transcript-original').count()===0,'original mode renders');await frame.locator('[data-transcript-mode=bilingual]').click();await until(async()=>await frame.locator('.transcript-original').count()>0,'bilingual mode renders');
      await frame.locator('#contentArea').evaluate(e=>e.scrollTop=0);await sleep(600);await video.screenshot({path:path.join(out,'before-hover.png')});
      await worker.evaluate(()=>{__fixtureDelay=3000;});
      await frame.evaluate(()=>{window.__spoken=[];window.speechSynthesis.speak=u=>window.__spoken.push(u.text);});
      const point=await frame.locator('.transcript-original').first().evaluate(e=>{const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);const n=w.nextNode();const r=document.createRange();r.setStart(n,0);r.setEnd(n,Math.min(8,n.length));const b=r.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};});const offset=await video.locator('#ytd-layout-dock iframe').boundingBox();await video.mouse.move(offset.x+point.x,offset.y+point.y);
      assert.equal(await frame.evaluate(()=>[...CSS.highlights.get('ytd-hover-word')][0].toString()),'Consistency','word paints before lookup completes');
      assert.equal(await frame.locator('.learning-float').count(),0,'lookup remains delayed');
      await video.screenshot({path:path.join(out,'word-hover-highlight.png')});
      await until(async()=>await frame.locator('.learning-word-actions button').count()===3,'all actions appear during lookup');
      assert.ok((await frame.locator('.learning-float').innerText()).includes('正在查词'));
      assert.deepEqual(await frame.locator('.learning-word-actions button').allTextContents(),['发音','收藏单词','关闭']);
      const wordHeaderGeometry=await frame.locator('.learning-word-header').evaluate(e=>{const word=e.querySelector('strong').getBoundingClientRect(),actions=e.querySelector('.learning-word-actions').getBoundingClientRect();return {right:actions.left>=word.right,aligned:Math.abs(actions.top-word.top)<10};});
      assert.deepEqual(wordHeaderGeometry,{right:true,aligned:true},'actions sit beside the word');
      const clickFloat=async label=>{
        const box=await frame.getByRole('button',{name:label,exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
        const host=await video.locator('#ytd-layout-dock iframe').boundingBox();
        await video.mouse.click(host.x+box.x,host.y+box.y);
      };
      await clickFloat('发音');
      await until(()=>frame.evaluate(()=>window.__spoken.includes('Consistency')),'pronunciation works before definition');
      await video.screenshot({path:path.join(out,'word-actions-loading.png')});
      await clickFloat('收藏单词');
      await until(async()=>await frame.getByRole('button',{name:'收藏中…',exact:true}).isDisabled(),'save accepts click during lookup');
      await until(()=>worker.evaluate(async()=>((await chrome.storage.local.get('ytd_vocabulary')).ytd_vocabulary||[]).length===1),'hover word saved');
      await worker.evaluate(()=>{__fixtureDelay=0;});
      await clickFloat('关闭');
      await video.mouse.move(offset.x+offset.width/2,offset.y+15);
      await until(async()=>!(await frame.evaluate(()=>CSS.highlights.has('ytd-hover-word'))),'leaving word clears transient highlight');
      const selected=await frame.evaluate(()=>{
        const roots=[...document.querySelectorAll('.transcript-original')];
        const first=document.createTreeWalker(roots[0],NodeFilter.SHOW_TEXT).nextNode();
        const walker=document.createTreeWalker(roots[1],NodeFilter.SHOW_TEXT);let last,n;while(n=walker.nextNode())last=n;
        const range=document.createRange();range.setStart(first,0);range.setEnd(last,last.length);
        const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
        document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
        return roots[0].textContent+'\n'+roots[1].textContent;
      });
      await video.screenshot({path:path.join(out,'sentence-selection.png')});
      await clickFloat('收藏句子');
      await until(()=>worker.evaluate(async()=>((await chrome.storage.local.get('ytd_sentences')).ytd_sentences||[]).length===1),'cross-line selection saved');
      const savedSelection=await worker.evaluate(async()=>(await chrome.storage.local.get('ytd_sentences')).ytd_sentences[0]);
      assert.equal(savedSelection.term,selected);assert.ok(!savedSelection.term.includes('中文测试译文'));
      await frame.locator('.learning-float').getByRole('button',{name:'关闭',exact:true}).click();
      await frame.evaluate(()=>getSelection().removeAllRanges());
      await frame.locator('.transcript-entry').first().hover();await frame.getByRole('button',{name:'收藏这句英文字幕',exact:true}).first().click();
      await until(()=>worker.evaluate(async()=>((await chrome.storage.local.get('ytd_sentences')).ytd_sentences||[]).length===2),'sentence saved');
      const entries=await worker.evaluate(async()=>await chrome.storage.local.get(['ytd_sentences','ytd_vocabulary']));assert.equal(entries.ytd_vocabulary.length,1);assert.ok(!entries.ytd_sentences[0].term.includes('中文测试译文'));
      await frame.locator('#contentArea').hover({position:{x:10,y:200}});await sleep(100);await video.mouse.wheel(0,500);await sleep(800);await video.screenshot({path:path.join(out,'after-wheel.png')});await until(()=>frame.locator('#contentArea').evaluate(e=>e.scrollTop>100),'wheel browses subtitles');
      await setTime(22);await frame.locator('#returnToPlaybackBtn').click();await until(async()=>await frame.locator('.active-playback').getAttribute('data-seconds')==='22','return to playing sentence');
      await video.getByRole('button',{name:'全屏',exact:true}).click();await until(()=>video.evaluate(()=>document.fullscreenElement===document.documentElement),'whole workspace fullscreen');await video.screenshot({path:path.join(out,'immersive-fullscreen.png')});await video.getByRole('button',{name:'全屏',exact:true}).click();
      await frame.locator('#returnToSidebar').click();await until(async()=>!await video.locator('#ytd-layout-dock').count(),'arrow returns to sidebar');assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('ytd_layout_preferences')).ytd_layout_preferences.mode),'horizontal');
      fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['two-layouts','transcript-only','default-bilingual','language-switch','immediate-word-highlight','hover-word-save','cross-line-selection-save','original-sentence-save','wheel-scroll','playback-return','height','fullscreen','sidebar-return']},null,2));panel=null;console.log('PASS: transcript-only immersion, hover collection, scroll and sidebar return');return;
    }

    if(process.env.YTD_TEST_STUDY==='1') {
      await worker.evaluate(async fixtureId=>{await chrome.storage.local.set({ytd_vocabulary:[buildVocabularyEntry({term:'Consistency',videoId:fixtureId,videoTitle:'Practice',timestamp:0},{meaningZh:'持续性',explanationZh:'强调持续练习。',phonetic:'/kənˈsɪstənsi/'},Date.now(),'w1')],ytd_sentences:[{id:'s1',term:'The book which she recommended changed my perspective.',videoId:fixtureId,videoTitle:'Practice',translationZh:'她推荐的书改变了我的看法。',mainClause:'The book changed my perspective.',breakdown:'which 引导定语从句',createdAt:Date.now(),timestampSeconds:22,analysisStatus:'ready',grammarTags:['定语从句'],expressionTags:['普通表达']}]});},fixtureId);
      await panel.evaluate(async()=>{await YTD_PANEL.refreshVocabulary();await YTD_LEARNING_UI.refreshLibrary();});
      await panel.click('[data-tab="study"]');
      await until(()=>panel.evaluate(()=>document.getElementById('studyPanel').textContent.includes('待开始')),'idle state');
      assert.equal(await panel.evaluate(()=>document.querySelectorAll('.study-day').length),0,'empty history has no zero rows');
      await panel.screenshot('study-01-empty.png');
      await panel.evaluate(()=>{for(const [key,value] of [['minutes',1],['wordGoal',1],['sentenceGoal',1]])document.querySelector(`input[name=${key}]`).value=value;});
      await panel.click('.learning-start-form button');
      const get=()=>worker.evaluate(async()=>{const d=(await chrome.storage.local.get('ytd_study')).ytd_study;return d.sessions.find(s=>s.id===d.currentId);});
      await until(async()=>(await get())?.status==='running','start task');
      assert.equal(await video.locator('.recommend-list-v1').evaluate(e=>getComputedStyle(e).display),'none');await panel.click('#studyPanel input[type=checkbox]');await until(()=>video.locator('.recommend-list-v1').evaluate(e=>getComputedStyle(e).display!=='none'),'distraction off restores recommendations');await panel.click('#studyPanel input[type=checkbox]');
      await video.evaluate(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const d=c.getContext('2d');window.fixtureAnimation=setInterval(()=>{d.fillStyle='#dde7dc';d.fillRect(0,0,320,180);},100);const v=document.querySelector('video');v.srcObject=c.captureStream(10);await v.play();});
      await until(async()=>(await get()).watchMs>=1000,'watching');
      await panel.click('#studyPanel button','暂停学习');const paused=await get();await sleep(2100);assert.equal((await get()).watchMs,paused.watchMs,'manual pause blocks active playback credit');
      await panel.click('#studyPanel button','继续学习');await until(async()=>(await get()).watchMs>paused.watchMs,'manual resume');
      await panel.click('#studyPanel button','练习剩余单词');await until(()=>panel.evaluate(()=>document.querySelector('#studyReview').textContent.includes('回忆后查看答案')),'word card');
      await panel.click('#studyReview button','回忆后查看答案');assert.equal((await get()).practicedWordIds.length,0,'reveal is not practice');await panel.click('#studyReview button','不熟');
      await until(async()=>(await get()).practicedWordIds.length===1,'self assessment');assert.equal((await get()).practiceResults.w1.result,'unsure');
      await panel.click('#studyPanel button','复习全部单词');await until(()=>panel.evaluate(()=>document.querySelector('#studyReview')?.textContent.includes('回忆后查看答案')),'repeat card ready');await panel.click('#studyReview button','回忆后查看答案');await panel.click('#studyReview button','记住了');await until(async()=>(await get()).practiceResults.w1.result==='known','repeat self assessment');assert.equal((await get()).practicedWordIds.length,1,'duplicate practice not double counted');
      await panel.click('#studyPanel button','练习剩余句子');await until(()=>panel.evaluate(()=>document.querySelector('#studyReview')?.textContent.includes('回忆后查看答案')),'sentence card ready');await panel.click('#studyReview button','回忆后查看答案');await panel.click('#studyReview button','没记住');await until(async()=>(await get()).practicedSentenceIds.length===1,'sentence assessment');
      // End early, resume the exact task, then simulate a real document refresh.
      await panel.click('#studyPanel button','结束并总结');await until(()=>panel.evaluate(()=>document.getElementById('studyStatus').textContent.includes('部分目标未达标')),'honest early summary');await panel.screenshot('study-02-summary.png');
      const before=await get();await panel.click('#studyPanel button','继续上次学习');await until(async()=>(await get()).status==='running','continue ended task');assert.equal((await get()).id,before.id);
      await video.reload();await until(async()=>(await get()).status==='paused','refresh requires explicit resume');assert.equal((await get()).practicedWordIds.length,1);assert.ok((await get()).position>=before.position && (await get()).position<before.position+2,'refresh retains playhead including final live frame');
      await video.locator('#ytd-digest-button').click();let reopened;await until(async()=>{reopened=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/sidepanel.html`);return !!reopened;},'reopened study panel');
      if(reopened.targetId!==target.targetId){const a=await cdp.send('Target.attachToTarget',{targetId:reopened.targetId,flatten:false});panel=attachClient(cdp,a.sessionId);await panel.send('Runtime.enable');await panel.send('Page.enable');}
      await panel.send('Emulation.setDeviceMetricsOverride',{width:320,height:700,deviceScaleFactor:1,mobile:false});
      await until(()=>panel.evaluate(()=>document.querySelectorAll('.transcript-text').length>=2),'reloaded captions');await panel.click('[data-tab="study"]');await until(()=>panel.evaluate(()=>document.getElementById('studyStatus').textContent.includes('已暂停')),'restored UI');
      await panel.screenshot('study-03-narrow-restore.png');assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at 320px');
      await panel.click('#studyPanel button','继续学习');await until(async()=>(await get()).status==='running','resumed after refresh');await worker.evaluate(async()=>{const {ytd_study:d}=await chrome.storage.local.get('ytd_study');d.sessions[0].targetMs=1;await chrome.storage.local.set({ytd_study:d});});
      await until(()=>panel.evaluate(()=>document.getElementById('studyProgressBrief').textContent.includes('目标已完成')),'all goals reached');
      await panel.click('#studyPanel button','结束并总结');await until(()=>panel.evaluate(()=>document.getElementById('studyStatus').textContent.includes('目标已完成')),'completed summary');
      await panel.click('#studyPanel button','继续并复习不熟内容');await until(()=>panel.evaluate(()=>document.querySelector('#studyReview')?.textContent.includes('回忆后查看答案')),'pending card ready');await panel.click('#studyReview button','回忆后查看答案');await panel.click('#studyReview button','记住了');await until(async()=>(await get()).practiceResults.s1.result==='known','pending review cleared');
      await panel.click('#studyPanel button','结束并总结');await panel.screenshot('study-04-complete.png');
      const downloadDir=path.join(out,'downloads');fs.mkdirSync(downloadDir,{recursive:true});await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
      await panel.click('#studyPanel button','导出学习记录');await until(()=>fs.readdirSync(downloadDir).some(f=>f.endsWith('.json')),'records export');
      const record=JSON.parse(fs.readFileSync(path.join(downloadDir,fs.readdirSync(downloadDir).find(f=>f.endsWith('.json'))),'utf8'));assert.equal(record.schemaVersion,2);assert.equal(record.sessions[0].practicedWordIds.length,1);assert.equal(record.sessions[0].runtimeBoot,undefined);
      // Accept only this explicit test confirmation; collection storage survives.
      const clear=panel.click('#studyPanel button','清空学习记录');await sleep(300);await panel.send('Page.handleJavaScriptDialog',{accept:true});await clear;
      await until(()=>panel.evaluate(()=>document.getElementById('studyPanel').textContent.includes('待开始')),'clear resets task');assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('ytd_vocabulary')).ytd_vocabulary.length),1);
      assert.deepEqual(panel.errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['empty','manual-pause-resume','self-assessment-only','distinct-practice','early-summary','resume-ended','refresh-restore','saved-position','320px','all-goals','pending-review','export-json','confirmed-clear-keeps-collections']},null,2));console.log('PASS: Study v2 task, practice, recovery, summary, narrow UI and records');return;
    }

    if(asr){
      let complete=false,starts=0,cancelled=false,partialCount=0;
      const result={videoId:fixtureId,language:'en',source:'local-asr',transcript:[{text:'An object at rest stays at rest. An object in motion stays in motion.',start:0,duration:12},{text:'The book which she recommended changed my perspective.',start:22,duration:12}]};
      if(process.env.YTD_TEST_PROGRESSIVE==='1')for(let i=0;i<20;i++)result.transcript.push({text:`This is original audio caption number ${i+3}.`,start:36+i*4,duration:3});
      asrServer=require('node:http').createServer((req,res)=>{
        res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin',`chrome-extension://${extensionId}`);res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Study-Extension');res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE');
        if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
        assert.equal(req.headers['x-study-extension'],extensionId);
        if(req.url==='/health'){res.end(JSON.stringify({ready:true,capabilities:['segments-v1']}));return;}
        let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
          if(req.method==='POST'){starts++;cancelled=false;assert.equal(JSON.parse(body).videoId,fixtureId);if((process.env.YTD_TEST_AUTO_ASR==='1'||noCaptions)&&starts===1){res.writeHead(503);res.end(JSON.stringify({error:'测试：本地转写服务暂不可用'}));return;}}
          if(process.env.YTD_TEST_SEGMENTS==='1'&&req.method==='POST'){result.range=JSON.parse(body).range;assert.ok(result.range);result.transcript=[{text:'English in this learning segment.',start:result.range.start+2,duration:3},{text:'Another sentence to collect.',start:result.range.start+8,duration:3}];complete=true;}
          if(req.method==='DELETE')cancelled=true;
          res.end(JSON.stringify({id:'a'.repeat(32),videoId:fixtureId,status:cancelled?'cancelled':complete?'completed':'transcribing',message:cancelled?'已取消':complete?'转写完成':'正在转写英文原声',progress:complete?100:30,...(result.range?{range:result.range}:{}),...(complete?{result}:partialCount?{result:{...result,partial:true,revision:partialCount,transcript:result.transcript.slice(0,partialCount)}}:{})}));
        });
      });await new Promise((resolve,reject)=>{asrServer.once('error',reject);asrServer.listen(Number(process.env.YTD_TEST_ASR_PORT)||8766,'127.0.0.1',resolve);});
      if(process.env.YTD_TEST_SEGMENTS==='1'){
        await panel.click('#enterImmersive');let frame;
        await until(async()=>{frame=video.frames().find(f=>f.url().includes('immersive=1'));return frame&&await frame.locator('.asr-chunks option').count()===25;},'long video has 25 chunks');
        await until(()=>frame.evaluate(()=>YTD_PANEL.context().source==='local-asr'),'first chunk applied');
        assert.equal(await frame.locator('.asr-chunks select').inputValue(),'12');
        assert.equal(await frame.evaluate(()=>YTD_PANEL.rawSegments()[0].start),14402);
        await until(async()=>!await frame.locator('#localAsrPanel').isVisible(),'completed ASR controls hidden after rendering');
        // Exercise the unchanged range controller, even while its immersive UI is hidden.
        await frame.evaluate(()=>{[...document.querySelectorAll('.asr-chunks button')].find(b=>b.textContent==='下一段').click();document.getElementById('localAsrStart').click();});
        await until(()=>frame.evaluate(()=>YTD_PANEL.rawSegments().length===4),'second chunk merged');
        assert.deepEqual(await frame.evaluate(()=>YTD_PANEL.rawSegments().map(s=>s.start)),[14402,14408,15602,15608]);
        assert.equal(await frame.evaluate(async()=>(await chrome.runtime.sendMessage({action:'relayToContent',payload:{action:'getCurrentTime'}})).response.currentTime),14500,'selecting a chunk never seeks playback');
        await frame.evaluate(()=>{[...document.querySelectorAll('.asr-chunks button')].find(b=>b.textContent==='上一段').click();document.getElementById('localAsrStart').click();});
        await until(()=>starts===3,'repeat chunk request');assert.equal(await frame.evaluate(()=>YTD_PANEL.rawSegments().length),4);
        await video.screenshot({path:path.join(out,'segment-picker.png')});
        await frame.goto(frame.url());await until(()=>frame.evaluate(()=>YTD_PANEL.rawSegments().length===4),'merged chunks survive refresh');
        assert.equal(await frame.locator('.asr-chunks').isVisible(),false,'picker stays hidden after refresh');
        fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['25-chunks','current-playback-chunk','absolute-timestamps','merge','retry-dedup','no-seek','refresh','picker-remains-visible']}));panel=null;console.log('PASS: long video chunks and merged subtitles');return;
      }
      if(noCaptions){
        result.transcript[1].start=6780;
        await panel.click('#enterImmersive');let frame;
        await until(async()=>{frame=video.frames().find(f=>f.url().includes('immersive=1'));return frame&&await frame.locator('#errorBtn').isVisible();},'immersive no-caption action');
        assert.equal(starts,0,'no job before the user starts');
        const bounds=await frame.locator('#errorBtn').evaluate(e=>e.getBoundingClientRect().toJSON());assert.ok(bounds.bottom<=270,'action fits shallow dock');
        await frame.locator('#errorBtn').click();
        await until(()=>frame.locator('#localAsrStatus').innerText().then(t=>t.includes('暂不可用')),'service failure visible');
        await sleep(2200);assert.equal(starts,1,'no automatic failure retry');
        await frame.locator('#localAsrStart').click();
        await until(()=>frame.locator('#localAsrCancel').isVisible(),'running job can cancel');
        await frame.locator('#localAsrCancel').click();await until(()=>frame.locator('#localAsrStatus').innerText().then(t=>t.includes('已取消')),'cancel reported');
        complete=true;await frame.locator('#localAsrStart').click();
        await until(()=>frame.locator('.transcript-original').count().then(n=>n>=2),'movie audio applied');
        await until(()=>frame.locator('.transcript-translation').first().innerText().then(t=>t.includes('中文测试译文')),'English to Chinese translation');
        assert.equal(await frame.evaluate(()=>YTD_PANEL.context().hasNativeBackup),false);
        assert.equal(await frame.evaluate(()=>YTD_PANEL.rawSegments()[1].start),6780);
        assert.equal(starts,3);await video.screenshot({path:path.join(out,'no-caption-movie-bilingual.png')});
        fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['no-caption-action','small-dock','service-failure','manual-retry','cancel','movie-past-90-minutes','bilingual','no-fabricated-native-backup']}));
        panel=null;console.log('PASS: no-caption movie audio fallback, failure/retry/cancel, three-hour timestamps and bilingual output');return;
      }
      if(process.env.YTD_TEST_AUTO_ASR==='1'){
        assert.equal(await panel.evaluate(async()=>(await chrome.runtime.sendMessage({action:'syncImmersiveToolbar'})).success),false);
      await panel.click('#enterImmersive');let frame;
        await until(async()=>{frame=video.frames().find(f=>f.url().includes('immersive=1'));return frame&&(await frame.locator('#localAsrStatus').innerText()).includes('暂不可用');},'automatic ASR failure visible');
        assert.equal(starts,1);await sleep(2500);assert.equal(starts,1,'failure does not automatically loop');
        await frame.locator('#contentArea').hover({position:{x:10,y:230}});await video.mouse.wheel(0,500);await sleep(500);
        assert.equal(await frame.locator('#localAsrStatus').isVisible(),true);const statusRect=await frame.locator('#localAsrStatus').evaluate(e=>e.getBoundingClientRect().toJSON());assert.ok(statusRect.top>=0&&statusRect.bottom<300,'ASR status remains on screen after scrolling');
        await frame.locator('[data-transcript-mode=zh]').click();assert.equal(await frame.locator('[data-transcript-mode=zh]').getAttribute('aria-pressed'),'true');
        await frame.locator('[data-transcript-mode=bilingual]').click();assert.equal(await frame.locator('[data-transcript-mode=bilingual]').getAttribute('aria-pressed'),'true');
        await until(async()=>await frame.getByRole('button',{name:'取消转写',exact:true}).isVisible(),'inline cancel');assert.equal(starts,2);
        await frame.getByRole('button',{name:'取消转写',exact:true}).click();await until(async()=>(await frame.locator('#localAsrStatus').innerText()).includes('已取消'),'inline cancelled');
        await sleep(2200);assert.equal(starts,2,'cancel does not restart');
        if(process.env.YTD_TEST_PROGRESSIVE==='1'){
          partialCount=19;
          await video.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=40;canvas.height=30;window.liveFixture=setInterval(()=>canvas.getContext('2d').fillRect(0,0,40,30),100);const v=document.querySelector('video');v.srcObject=canvas.captureStream(10);await v.play();});
          await frame.locator('[data-transcript-mode=bilingual]').click();
          await until(async()=>(await frame.locator('#localAsrStatus').innerText()).includes('19 / 20'),'nineteen captions visibly buffering');
          assert.equal(await frame.evaluate(()=>YTD_PANEL.context().language),'ai-zh','Chinese stays visible before first buffer');
          partialCount=20;await until(()=>frame.evaluate(()=>YTD_PANEL.context().partial&&YTD_PANEL.rawSegments().length===20),'twenty captions release first English buffer');
          assert.equal(await video.locator('video').evaluate(v=>v.paused),false,'ASR does not pause viewing');
          await frame.goto(frame.url());await until(()=>frame.evaluate(()=>YTD_PANEL.context().partial&&YTD_ASR_UI.state().running),'resume partial job after panel reload');assert.equal(starts,3);
          partialCount=21;await until(()=>frame.evaluate(()=>YTD_PANEL.rawSegments().length===21),'next segment appended before completion');
          complete=true;await until(()=>frame.evaluate(()=>!YTD_PANEL.context().partial),'completion clears partial marker');
        }else{complete=true;await frame.locator('[data-transcript-mode=bilingual]').click();}
        await until(async()=>(await frame.locator('#transcriptList').innerText()).includes('An object'),'English applied without leaving immersion');
        await until(async()=>(await frame.locator('.transcript-translation').first().innerText()).includes('中文测试译文'),'split ASR sentence translated separately');assert.equal(starts,3);assert.ok(await worker.evaluate(()=>__fixtureCalls.length>0));
        await video.screenshot({path:path.join(out,'auto-asr-bilingual.png')});
        assert.equal(starts,3);
        fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['automatic-start','failure-visible','no-retry-loop','inline-cancel','inline-retry','auto-bilingual','native-Chinese-retained','split-sentence-translation','sticky-progress-after-scroll','Chinese-button-selection','bilingual-click-retry',...(process.env.YTD_TEST_PROGRESSIVE==='1'?['buffer-19-waits','buffer-20-releases','video-keeps-playing','resume-partial','background-appends','completion-clears-marker']:[])]}));panel=null;console.log('PASS: automatic immersive ASR, failure, cancellation and bilingual completion');return;
      }
      await panel.click('[data-transcript-mode="bilingual"]');
      assert.equal(await worker.evaluate(()=>__fixtureCalls.length),0,'Chinese source never translates Chinese to Chinese');
      await until(()=>panel.evaluate(()=>document.getElementById('localAsrStatus').textContent.includes('转写英文原声')),'ASR progress received');
      await until(()=>panel.evaluate(()=>!document.getElementById('localAsrCancel').hidden),'bilingual click starts transcription');
      await panel.click('#localAsrCancel');await until(()=>panel.evaluate(()=>document.getElementById('localAsrStatus').textContent.includes('已取消')),'cancelled');
      assert.ok(await panel.evaluate(()=>document.querySelector('.transcript-text').textContent.includes('静止')),'cancel preserves Chinese');
      complete=true;await panel.click('#localAsrStart');
      await until(()=>panel.evaluate(()=>document.querySelector('.transcript-text')?.textContent.includes('An object at rest')),'English ASR applied');
      assert.equal(starts,2);
      const stored=await worker.evaluate(async fixtureId=>(await chrome.storage.local.get('digest_'+fixtureId))['digest_'+fixtureId],fixtureId);
      assert.equal(stored.transcriptSource,'local-asr');assert.equal(stored.nativeTranscriptBackup.language,'ai-zh');
      await panel.click('[data-transcript-mode="bilingual"]');
      assert.ok(await panel.evaluate(()=>document.querySelector('.transcript-original').textContent.includes('An object')));
      await until(()=>panel.evaluate(()=>document.querySelector('.transcript-translation').textContent.includes('中文测试译文')),'broad Chinese cue replaced with sentence translation');
      assert.ok(await worker.evaluate(()=>__fixtureCalls.length>0));
      assert.ok(await panel.evaluate(()=>[...document.querySelectorAll('.transcript-translation')].some(e=>e.textContent.includes('她推荐'))),'matching native Chinese still reused');
      await panel.screenshot('09-original-asr.png');
      await panel.click('#localAsrRestore');await until(()=>panel.evaluate(()=>document.querySelector('.transcript-text')?.textContent.includes('静止')),'restore native');
      const before=await panel.evaluate(()=>document.getElementById('transcriptList').textContent);
      assert.ok(await panel.evaluate(async result=>{try{await YTD_PANEL.applyASR({...result,videoId:'BV1xx411c7mD_p3'});return false;}catch{return true;}},result),'wrong video rejected');
      assert.equal(await panel.evaluate(()=>document.getElementById('transcriptList').textContent),before);
      assert.deepEqual(panel.errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['Chinese-no-retranslation','ASR-cancel','ASR-apply','native-backup','bilingual-original-alignment','native-restore','wrong-video-rejected'],errors:panel.errors},null,2));
      console.log('PASS: local original-audio ASR integration');return;
    }
    await sleep(400); // The panel's entry animation must settle before hit testing.
    // A real pointer dwell must not call the provider early or save automatically.
    const point=await panel.evaluate(()=>{const root=document.querySelector('.transcript-text'),r=document.createRange();r.setStart(root.firstChild,0);r.setEnd(root.firstChild,11);const b=r.getBoundingClientRect();return {x:b.left+15,y:b.top+b.height/2};});
    await worker.evaluate(()=>{__fixtureDelay=2000;});
    await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await sleep(250);
    assert.equal(await worker.evaluate(()=>__fixtureCalls.length),0);
    await until(()=>panel.evaluate(()=>document.querySelector('.learning-float')?.textContent.includes('正在查词')),'actions during loading');
    assert.deepEqual(await panel.evaluate(()=>[...document.querySelectorAll('.learning-word-actions button')].map(b=>b.textContent)),['发音','收藏单词','关闭']);
    assert.equal(await worker.evaluate(async()=>((await chrome.storage.local.get('ytd_vocabulary')).ytd_vocabulary||[]).length),0);
    await panel.screenshot('01-hover.png');
    await panel.click('.learning-float button','收藏单词');
    await until(()=>worker.evaluate(async()=>((await chrome.storage.local.get('ytd_vocabulary')).ytd_vocabulary||[]).length===1),'saved word');
    assert.equal(await worker.evaluate(()=>__fixtureCalls.length),1,'early save reuses pending hover enrichment');
    await worker.evaluate(()=>{__fixtureDelay=0;});
    await panel.click('.learning-float button','关闭');
    const wordPoint=term=>panel.evaluate(term=>{
      for(const root of document.querySelectorAll('.transcript-text')){
        const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
        while((node=walker.nextNode())){const at=node.textContent.search(new RegExp(`\\b${term}\\b`));if(at<0)continue;
          const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+term.length);const b=range.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};}
      }throw new Error(`Missing word ${term}`);
    },term);
    const important=await wordPoint('important'),replacement=await wordPoint('is');
    assert.equal(await panel.evaluate(p=>YTD_LEARNING_UI.wordAtPoint(p.x,p.y)?.meta.term,replacement),'is');
    await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',...important});await sleep(200);
    await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',...replacement});await sleep(200);
    await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:410,y:80});await sleep(650);
    assert.equal(await worker.evaluate(()=>__fixtureCalls.length),1,'quick movement cancels hover');
    await worker.evaluate(()=>{__fixtureDelay=1200;});
    await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',...important});
    await until(()=>worker.evaluate(()=>__fixtureCalls.length===2),'delayed word request');
    await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',...replacement});
    await until(()=>worker.evaluate(()=>__fixtureCalls.length===3),'replacement word request');
    await sleep(700);
    assert.equal(await panel.evaluate(()=>document.querySelector('.learning-float strong')?.textContent),'is','old response cannot replace the current word');
    assert.equal(await panel.evaluate(()=>document.querySelector('.learning-float')?.textContent.includes('正在查词')),true,'old meaning stays hidden');
    await until(()=>panel.evaluate(()=>document.querySelector('.learning-float')?.textContent.includes('持续性')),'replacement result');
    await panel.click('.learning-float button','关闭');await worker.evaluate(()=>{__fixtureDelay=0;});
    // Failure keeps the same controls usable; close during a retry must not resurrect the dialog.
    await worker.evaluate(()=>{__fixtureFailure=true;});
    const when=await wordPoint('when');await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',...when});
    await until(()=>panel.evaluate(()=>!![...document.querySelectorAll('.learning-word-definition button')].find(b=>b.textContent==='重试')),'lookup failure offers retry');
    assert.deepEqual(await panel.evaluate(()=>[...document.querySelectorAll('.learning-word-actions button')].map(b=>b.textContent)),['发音','收藏单词','关闭']);
    await panel.click('.learning-float button','收藏单词');
    await until(()=>panel.evaluate(()=>!!document.querySelector('#learningToast:not([hidden])')),'failed save reports error');
    assert.equal(await panel.evaluate(()=>document.querySelector('.learning-word-actions .primary').disabled),false);
    assert.equal(await worker.evaluate(async()=>((await chrome.storage.local.get('ytd_vocabulary')).ytd_vocabulary||[]).length),1,'failure never saves placeholder meaning');
    await worker.evaluate(()=>{__fixtureFailure=false;__fixtureDelay=1200;});
    await panel.click('.learning-float button','重试');
    await until(()=>panel.evaluate(()=>document.querySelector('.learning-word-definition')?.textContent.includes('正在查词')),'retry loads');
    await panel.click('.learning-float button','关闭');await sleep(1500);
    assert.equal(await panel.evaluate(()=>document.querySelectorAll('.learning-float').length),0,'late result cannot reopen closed dialog');
    await worker.evaluate(()=>{__fixtureDelay=0;});
    // Start a study session through the actual interface.
    await panel.click('[data-tab="study"]');await panel.click('.learning-start-form button');
    await until(()=>worker.evaluate(async()=>((await chrome.storage.local.get('ytd_study')).ytd_study?.sessions[0]?.status==='running')),'session start');
    assert.equal(await video.evaluate(()=>document.documentElement.hasAttribute('data-ytd-study-focus')),true);
    await panel.screenshot('02-study.png');
    // Actual HTMLVideoElement playback exercises the content script's heartbeat.
    await video.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const draw=canvas.getContext('2d');
      window.fixtureAnimation=setInterval(()=>{draw.fillStyle='#dde7dc';draw.fillRect(0,0,320,180);draw.fillStyle='#243b29';draw.fillText(`Study fixture ${Date.now()}`,12,80);},100);
      const v=document.querySelector('video');v.srcObject=canvas.captureStream(10);await v.play();
    });
    await until(()=>worker.evaluate(async()=>((await chrome.storage.local.get('ytd_study')).ytd_study.sessions[0].watchMs>=2000)),'real playback accounting');
    const countdowns=new Set();for(let i=0;i<9;i++){countdowns.add(await panel.evaluate(()=>document.querySelector('#studyClock')?.textContent));await sleep(400);}
    assert.ok(countdowns.size>=3,'countdown visibly advances every second');await panel.screenshot('07-countdown.png');
    const beforeBackground=await worker.evaluate(async()=>(await chrome.storage.local.get('ytd_study')).ytd_study.sessions[0].watchMs);
    const backgroundTab=await context.newPage();await backgroundTab.goto('about:blank');await sleep(3500);
    const afterBackground=await worker.evaluate(async()=>(await chrome.storage.local.get('ytd_study')).ytd_study.sessions[0].watchMs);
    assert.ok(afterBackground-beforeBackground<=2100,'background playback does not keep accumulating');
    await backgroundTab.close();await video.bringToFront();
    // Switching away may close the native side panel. Reopen and reattach it.
    await video.locator('#ytd-digest-button').click();
    let reopened;await until(async()=>{reopened=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/sidepanel.html`);return !!reopened;},'reopened panel');
    if(reopened.targetId!==target.targetId){const a=await cdp.send('Target.attachToTarget',{targetId:reopened.targetId,flatten:false});panel=attachClient(cdp,a.sessionId);await panel.send('Runtime.enable');await panel.send('Page.enable');await panel.send('Emulation.setDeviceMetricsOverride',{width:420,height:900,deviceScaleFactor:1,mobile:false});}
    await until(()=>panel.evaluate(()=>document.querySelectorAll('.transcript-text').length>=2),'reopened transcript');
    await panel.click('[data-tab="study"]');await until(()=>panel.evaluate(()=>document.querySelector('#studyStatus')),'reopened task');
    if(await panel.evaluate(()=>document.querySelector('#studyStatus').textContent.includes('已暂停')))await panel.click('#studyPanel button','继续学习');
    await until(()=>worker.evaluate(async()=>(await chrome.storage.local.get('ytd_study')).ytd_study.sessions[0].status==='running'),'resume reopened task');
    // A reached time goal prompts a decision without stopping playback or credit.
    await worker.evaluate(async()=>{const {ytd_study:d}=await chrome.storage.local.get('ytd_study');const session=d.sessions[0];session.targetMs=session.watchMs+session.activityMs+session.reviewMs+1500;await chrome.storage.local.set({ytd_study:d});});
    await until(()=>worker.evaluate(async()=>{const s=(await chrome.storage.local.get('ytd_study')).ytd_study.sessions[0];return s.watchMs+s.activityMs+s.reviewMs>=s.targetMs;}),'time target');
    assert.equal(await video.evaluate(()=>document.querySelector('video').paused),false,'time target does not force pause');
    await panel.click('[data-tab="study"]');await until(()=>panel.evaluate(()=>!document.querySelector('#studyDue')?.hidden),'time prompt');
    await panel.click('#studyDue button','继续学习');

    // Use the actual bilingual control and translation pipeline with fixture AI.
    await panel.click('[data-tab="transcript"]');
    await panel.click('[data-transcript-mode="bilingual"]');
    await until(()=>panel.evaluate(()=>document.querySelectorAll('.transcript-translation:not(.translation-pending)').length>=2),'bilingual translated rows');
    // Collect across rows; DOM Range extraction must omit Chinese, timestamps and buttons.
    await panel.evaluate(()=>{
      const roots=document.querySelectorAll('.transcript-original'),range=document.createRange();range.setStart(roots[0],0);const last=[...roots].find(e=>e.textContent.includes('The book'));range.setEnd(last,last.childNodes.length);const s=getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    });
    await panel.click('.learning-float button','收藏句子');
    await until(()=>worker.evaluate(async()=>((await chrome.storage.local.get('ytd_sentences')).ytd_sentences?.[0]?.analysisStatus==='ready')),'sentence analysis');
    const entry=await worker.evaluate(async()=>(await chrome.storage.local.get('ytd_sentences')).ytd_sentences[0]);assert.match(entry.term,/Consistency/);assert.match(entry.term,/The book/);assert.doesNotMatch(entry.term,/Explain|Save|解释|收藏|0:00|中文测试/);assert.equal(entry.timestampSeconds,0);
    await panel.click('.learning-float button','关闭');await panel.evaluate(()=>getSelection().removeAllRanges());
    // Return is an action: repeated clicks must recenter a paused, highlighted row.
    await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{document.querySelector('video').pause();Object.defineProperty(document.querySelector('video'),'currentTime',{configurable:true,get:()=>22});}});});
    await until(()=>panel.evaluate(()=>document.querySelector('.active-playback')?.dataset.seconds==='22'),'active playback subtitle');
    assert.equal(await panel.evaluate(()=>document.getElementById('returnToPlaybackBtn').hasAttribute('aria-pressed')),false);
    for (let attempt=0;attempt<2;attempt++) {
      await sleep(1100);
      await panel.evaluate(()=>{const area=document.getElementById('contentArea');area.scrollTop=area.scrollHeight;});
      await panel.click('#returnToPlaybackBtn');
      await until(()=>panel.evaluate(()=>{const r=document.querySelector('.active-playback').getBoundingClientRect();return r.top>=80&&r.bottom<innerHeight;}),'return button recenters paused row');
      assert.equal(await panel.evaluate(()=>document.getElementById('returnToPlaybackBtn').textContent),'回到播放位置');
      assert.equal(await video.locator('video').evaluate(v=>v.paused),true,'return must not start playback');
    }
    // A fresh time must win over the previous highlight, without seeking the video.
    await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>Object.defineProperty(document.querySelector('video'),'currentTime',{configurable:true,get:()=>65})});});
    await panel.click('#returnToPlaybackBtn');
    await until(()=>panel.evaluate(()=>document.querySelector('.active-playback')?.dataset.seconds==='65'),'return reads current playback time');
    await panel.screenshot('06-follow.png');
    // A disconnected player produces feedback and leaves the action retryable.
    await video.locator('video').evaluate(v=>v.remove());
    await panel.click('#returnToPlaybackBtn');
    await until(()=>panel.evaluate(()=>document.getElementById('playbackPositionStatus').textContent.includes('刷新视频')),'missing player feedback');
    assert.equal(await panel.evaluate(()=>document.getElementById('returnToPlaybackBtn').disabled),false);
    await video.evaluate(()=>{const v=document.createElement('video');v.muted=true;document.getElementById('movie_player').append(v);});
    await panel.click('[data-tab="library"]');await panel.click('#librarySentencesTab');
    await until(()=>panel.evaluate(()=>document.querySelectorAll('#sentencesList .learning-card').length===1),'sentence library');
    await panel.click('#sentencesList button','修改分类');
    await panel.evaluate(()=>{const labels=[...document.querySelectorAll('dialog label')];labels.find(l=>l.textContent==='俚语').querySelector('input').click();});
    await panel.click('dialog button','保存分类');
    await until(()=>worker.evaluate(async()=>(await chrome.storage.local.get('ytd_sentences')).ytd_sentences[0].expressionTags.includes('俚语')),'manual tag saved');
    await panel.screenshot('03-sentences.png');
    // Export through the actual download button and inspect the produced ZIP signature.
    const downloadDir=fs.mkdtempSync(path.join(out,'downloads-'));
    await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
    await panel.click('#learningLibraryToolbar button','下载 Word');await panel.screenshot('04-word-dialog.png');
    await panel.click('dialog button','生成并下载');
    await until(()=>fs.readdirSync(downloadDir).some(f=>f.endsWith('.docx')),'Word download');
    const downloaded=fs.readdirSync(downloadDir).find(f=>f.endsWith('.docx'));assert.equal(fs.readFileSync(path.join(downloadDir,downloaded)).subarray(0,2).toString(),'PK');
    await panel.click('dialog button','关闭');
    // Self-assessment updates separate review storage without asking an AI model.
    await panel.click('[data-tab="study"]');await panel.click('#studyPanel button','复习全部单词');
    await until(()=>panel.evaluate(()=>document.querySelector('#studyReview')?.textContent.includes('回忆后查看答案')),'review card');
    const callsBefore=await worker.evaluate(()=>__fixtureCalls.length);await panel.click('#studyReview button','回忆后查看答案');await panel.screenshot('05-review.png');await panel.click('#studyReview button','没记住');
    await until(()=>worker.evaluate(async()=>Object.keys((await chrome.storage.local.get('ytd_reviews')).ytd_reviews||{}).length===1),'review saved');assert.equal(await worker.evaluate(()=>__fixtureCalls.length),callsBefore);
    await panel.click('#studyPanel button','结束并总结');await until(()=>video.evaluate(()=>!document.documentElement.hasAttribute('data-ytd-study-focus')),'distraction cleanup');
    assert.deepEqual(panel.errors,[]);
    const settingsPage=await context.newPage();await settingsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await settingsPage.locator('#supadataApiKey').fill('');await settingsPage.locator('#aiApiKey').fill('fixture-key');
    await settingsPage.locator('button[type=submit]').click();await until(async()=>(await settingsPage.locator('#saveStatus').innerText()).includes('设置已保存'),'Chinese settings save without Supadata');
    await settingsPage.setViewportSize({width:1200,height:2100});await settingsPage.evaluate(()=>scrollTo(0,0));await sleep(500);
    await settingsPage.screenshot({path:path.join(out,'08-settings.png')});

    console.log('PASS: extension load, 600ms hover, quick movement, stale results, cached save, bilingual cross-row sentence, tags, real playback/background accounting, time target prompt, continued timing, DOCX download, review and cleanup');
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,platform:bili?'bilibili':'youtube',checks:['chinese-settings-no-supadata','chinese-ui','second-countdown','follow-playback','hover','quick-movement','stale-results','cache','bilingual-sentence-range','tags','real-playback','background-accounting','time-target-no-pause','continue','docx','review','cleanup'],errors:panel.errors},null,2));
  }catch(error){if(panel){console.error('PANEL',await panel.evaluate(()=>document.body.innerText).catch(()=>''));await panel.screenshot('failure.png').catch(()=>{});}throw error;}
  finally{if(asrServer)await new Promise(resolve=>asrServer.close(resolve));await context.close();fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
