/* Real extension integration test. Synthetic page, captions and AI only. */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(process.env.YTD_EXTENSION_DIR||path.join(__dirname,'..')),out=path.resolve(process.env.YTD_TEST_OUTPUT||path.join(root,'test-results'));
const asr=process.env.YTD_TEST_ASR==='1';
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
  const click=async(selector,text)=>{const point=await evaluate(async({selector,text})=>{const e=[...document.querySelectorAll(selector)].find(e=>!text||e.textContent.trim()===text);if(!e)throw new Error(`Missing ${selector} ${text||''}`);const initial=e.getBoundingClientRect();if(initial.top<125||initial.bottom>innerHeight-100)e.scrollIntoView({block:'center',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};},{selector,text});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});};
  const screenshot=async name=>{await sleep(350);const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name),Buffer.from(r.data,'base64'));};
  return {send,evaluate,click,screenshot,errors};
}
(async()=>{
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1200,height:900},acceptDownloads:true,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
  let panel, asrServer;
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const extensionId=new URL(worker.url()).host;
    await worker.evaluate(async({bili,fixtureId,asr})=>{
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
          else if(String(url).includes('/player/'))payload={code:0,data:{subtitle:{subtitles:[{lan:asr?'ai-zh':'en',lan_doc:asr?'中文':'英语',subtitle_url:'https://aisubtitle.hdslb.com/fixture.json'}]}}};
          else payload={body:transcript.map(s=>({from:s.start,to:s.start+s.duration,content:s.text}))};
          return new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}});
        }
        if(String(url).startsWith('https://api.deepseek.com/')){
          const req=JSON.parse(options.body);__fixtureCalls.push(req);if(__fixtureDelay)await new Promise(r=>setTimeout(r,__fixtureDelay));
          let payload;try{payload=JSON.parse(req.messages[1].content);}catch{}
          if(payload?.segments){return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({segments:payload.segments.map(s=>({id:s.id,text:'中文测试译文：持续练习能够培养学习习惯。'}))})}}]}),{headers:{'Content-Type':'application/json'}});}
          const isSentence=req.messages[0].content.includes('translationZh');
          const data=isSentence?{translationZh:'这本她推荐的书改变了我的看法。',mainClause:'The book changed my perspective. 主干是主语、谓语和宾语。',breakdown:'which she recommended 是定语从句，说明是哪一本书。although 引导让步状语从句。',grammarTags:['定语从句','状语从句'],expressionTags:['普通表达']}:{meaningZh:'持续性；前后一致',explanationZh:'这里强调持续练习的习惯。',phonetic:'/kənˈsɪstənsi/'};
          return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(data)}}]}),{headers:{'Content-Type':'application/json'}});
        }
        if(String(url).startsWith('https://'))throw new Error('LIVE PROVIDER DISABLED IN FIXTURE TEST');return original(url,options);
      };
    },{bili,fixtureId,asr});
    for(const p of context.pages())if(p.url().includes('options.html'))await p.close();
    await context.route(bili?'https://www.bilibili.com/**':'https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="UTF-8"><title>English practice fixture</title><style>video{width:600px;height:300px;background:#ddd}ytd-watch-metadata{display:block}</style></head><body><h1 class="video-title">英语学习测试视频</h1><div class="video-toolbar-left"></div><div class="recommend-list-v1">推荐</div><div id="movie_player" class="html5-video-player"><video muted></video></div><ytd-watch-metadata><div id="actions-inner" style="width:400px;height:40px"><div id="top-level-buttons-computed" style="width:400px;height:40px">Share</div></div></ytd-watch-metadata><div id="comments">Comments</div><ytd-watch-next-secondary-results-renderer>Recommendations</ytd-watch-next-secondary-results-renderer></body></html>`}));
    const video=await context.newPage();await video.goto(bili?'https://www.bilibili.com/video/BV1xx411c7mD/?p=2':'https://www.youtube.com/watch?v=abcDEF12345');
    await video.locator('#ytd-digest-button').click({timeout:12000});
    const cdp=await context.newCDPSession(video);let target;
    await until(async()=>{target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/sidepanel.html`);return !!target;},'side panel target');
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});panel=attachClient(cdp,sessionId);
    await panel.send('Runtime.enable');await panel.send('Page.enable');await panel.send('Emulation.setDeviceMetricsOverride',{width:420,height:900,deviceScaleFactor:1,mobile:false});
    await until(()=>panel.evaluate(()=>document.querySelectorAll('.transcript-original,.transcript-text').length>=2),'rendered transcript');
    assert.equal(await panel.evaluate(()=>document.querySelector('[data-tab="ask"]')),null);
    assert.deepEqual(await panel.evaluate(()=>[...document.querySelectorAll('.tab')].map(e=>e.textContent.trim())),['字幕','概览','收藏库','学习']);
    if(bili){assert.equal(await worker.evaluate(()=>__nativeCalls.length),4);assert.ok(await worker.evaluate(()=>__nativeCalls.some(u=>u.includes('cid=20'))));}

    if(asr){
      let complete=false,starts=0,cancelled=false;
      const result={videoId:fixtureId,language:'en',source:'local-asr',transcript:[{text:'An object at rest stays at rest. An object in motion stays in motion.',start:0,duration:12},{text:'The book which she recommended changed my perspective.',start:22,duration:12}]};
      asrServer=require('node:http').createServer((req,res)=>{
        res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin',`chrome-extension://${extensionId}`);res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Study-Extension');res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE');
        if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
        assert.equal(req.headers['x-study-extension'],extensionId);
        let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
          if(req.method==='POST'){starts++;cancelled=false;assert.equal(JSON.parse(body).videoId,fixtureId);}
          if(req.method==='DELETE')cancelled=true;
          res.end(JSON.stringify({id:'a'.repeat(32),videoId:fixtureId,status:cancelled?'cancelled':complete?'completed':'transcribing',message:cancelled?'已取消':complete?'转写完成':'正在转写英文原声',progress:complete?100:30,...(complete?{result}:{})}));
        });
      });await new Promise((resolve,reject)=>{asrServer.once('error',reject);asrServer.listen(8766,'127.0.0.1',resolve);});
      await panel.click('[data-transcript-mode="bilingual"]');
      assert.equal(await worker.evaluate(()=>__fixtureCalls.length),0,'Chinese source never translates Chinese to Chinese');
      assert.ok(await panel.evaluate(()=>document.getElementById('localAsrStatus').textContent.includes('转写英文原声')));
      await panel.click('#localAsrStart');await until(()=>panel.evaluate(()=>!document.getElementById('localAsrCancel').hidden),'cancel available');
      await panel.click('#localAsrCancel');await until(()=>panel.evaluate(()=>document.getElementById('localAsrStatus').textContent.includes('已取消')),'cancelled');
      assert.ok(await panel.evaluate(()=>document.querySelector('.transcript-text').textContent.includes('静止')),'cancel preserves Chinese');
      complete=true;await panel.click('#localAsrStart');
      await until(()=>panel.evaluate(()=>document.querySelector('.transcript-text')?.textContent.includes('An object at rest')),'English ASR applied');
      assert.equal(starts,2);
      const stored=await worker.evaluate(async fixtureId=>(await chrome.storage.local.get('digest_'+fixtureId))['digest_'+fixtureId],fixtureId);
      assert.equal(stored.transcriptSource,'local-asr');assert.equal(stored.nativeTranscriptBackup.language,'ai-zh');
      await panel.click('[data-transcript-mode="bilingual"]');
      assert.ok(await panel.evaluate(()=>document.querySelector('.transcript-original').textContent.includes('An object')));
      assert.ok(await panel.evaluate(()=>document.querySelector('.transcript-translation').textContent.includes('静止')));
      assert.equal(await worker.evaluate(()=>__fixtureCalls.length),0,'Chinese alignment uses original track, not AI rewrite');
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
    await panel.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await sleep(250);
    assert.equal(await worker.evaluate(()=>__fixtureCalls.length),0);
    await until(()=>panel.evaluate(()=>document.querySelector('.learning-float')?.textContent.includes('持续性')),'hover meaning');
    assert.equal(await worker.evaluate(async()=>((await chrome.storage.local.get('ytd_vocabulary')).ytd_vocabulary||[]).length),0);
    await panel.screenshot('01-hover.png');
    await panel.click('.learning-float button','收藏单词');
    await until(()=>worker.evaluate(async()=>((await chrome.storage.local.get('ytd_vocabulary')).ytd_vocabulary||[]).length===1),'saved word');
    assert.equal(await worker.evaluate(()=>__fixtureCalls.length),1,'save reuses hover enrichment');
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
    const countdowns=new Set();for(let i=0;i<9;i++){countdowns.add(await panel.evaluate(()=>document.querySelector('#studyStats>p')?.textContent));await sleep(400);}
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
    // Shorten only the fixture's remaining budget to check a real deadline pause.
    await worker.evaluate(async()=>{const {ytd_study:d}=await chrome.storage.local.get('ytd_study');const session=d.sessions[0];session.targetMs=session.watchMs+session.activityMs+1500;await chrome.storage.local.set({ytd_study:d});});
    await until(()=>worker.evaluate(async()=>(await chrome.storage.local.get('ytd_study')).ytd_study.sessions[0].status==='due'),'deadline state');
    await until(()=>video.evaluate(()=>document.querySelector('video').paused),'video pauses at deadline');
    await panel.click('[data-tab="study"]');await until(()=>panel.evaluate(()=>document.querySelector('#studyPanel')?.textContent.includes('加时 5 分钟')),'extension control');
    await panel.click('#studyPanel button','加时 5 分钟');

    // Use the actual bilingual control and translation pipeline with fixture AI.
    await panel.click('[data-tab="transcript"]');
    await panel.click('[data-transcript-mode="bilingual"]');
    await until(()=>panel.evaluate(()=>document.querySelectorAll('.transcript-translation:not(.translation-pending)').length>=2),'bilingual translated rows');
    // Collect across rows; DOM Range extraction must omit Chinese, timestamps and buttons.
    await panel.evaluate(()=>{
      const roots=document.querySelectorAll('.transcript-original'),range=document.createRange();range.setStart(roots[0],0);range.setEnd(roots[1],roots[1].childNodes.length);const s=getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    });
    await panel.click('.learning-float button','收藏长难句');
    await until(()=>worker.evaluate(async()=>((await chrome.storage.local.get('ytd_sentences')).ytd_sentences?.[0]?.analysisStatus==='ready')),'sentence analysis');
    const entry=await worker.evaluate(async()=>(await chrome.storage.local.get('ytd_sentences')).ytd_sentences[0]);assert.match(entry.term,/Consistency/);assert.match(entry.term,/The book/);assert.doesNotMatch(entry.term,/Explain|Save|解释|收藏|0:00|中文测试/);assert.equal(entry.timestampSeconds,0);
    await panel.click('.learning-float button','关闭');await panel.evaluate(()=>getSelection().removeAllRanges());
    // Restore following while the same subtitle is already highlighted.
    await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>Object.defineProperty(document.querySelector('video'),'currentTime',{configurable:true,get:()=>22})});});
    await until(()=>panel.evaluate(()=>document.querySelector('.active-playback')?.dataset.seconds==='22'),'active playback subtitle');
    await sleep(1200);
    await panel.evaluate(()=>{const area=document.getElementById('contentArea');area.scrollTop=area.scrollHeight;});
    await until(()=>panel.evaluate(()=>document.getElementById('followPlaybackToggle').getAttribute('aria-pressed')==='false'),'manual scroll turns following off');
    await panel.click('#followPlaybackToggle');await sleep(700);
    assert.equal(await panel.evaluate(()=>document.getElementById('followPlaybackToggle').getAttribute('aria-pressed')),'true');
    assert.ok(await panel.evaluate(()=>{const r=document.querySelector('.active-playback').getBoundingClientRect();return r.top>=80&&r.bottom<innerHeight;}),'follow button recenters the existing active row');
    await panel.screenshot('06-follow.png');await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>delete document.querySelector('video').currentTime});});
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
    await panel.click('[data-tab="study"]');await panel.click('#studyPanel button','开始复习');
    await until(()=>panel.evaluate(()=>document.querySelector('#studyReview')?.textContent.includes('回忆后查看答案')),'review card');
    const callsBefore=await worker.evaluate(()=>__fixtureCalls.length);await panel.click('#studyReview button','回忆后查看答案');await panel.screenshot('05-review.png');await panel.click('#studyReview button','还要复习');
    await until(()=>worker.evaluate(async()=>Object.keys((await chrome.storage.local.get('ytd_reviews')).ytd_reviews||{}).length===1),'review saved');assert.equal(await worker.evaluate(()=>__fixtureCalls.length),callsBefore);
    await panel.click('#studyPanel button','结束学习');await until(()=>video.evaluate(()=>!document.documentElement.hasAttribute('data-ytd-study-focus')),'distraction cleanup');
    assert.deepEqual(panel.errors,[]);
    const settingsPage=await context.newPage();await settingsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await settingsPage.locator('#supadataApiKey').fill('');await settingsPage.locator('#aiApiKey').fill('fixture-key');
    await settingsPage.locator('button[type=submit]').click();await until(async()=>(await settingsPage.locator('#saveStatus').innerText()).includes('设置已保存'),'Chinese settings save without Supadata');
    await settingsPage.setViewportSize({width:1200,height:2100});await settingsPage.evaluate(()=>scrollTo(0,0));await sleep(500);
    await settingsPage.screenshot({path:path.join(out,'08-settings.png')});

    console.log('PASS: extension load, 600ms hover, quick movement, stale results, cached save, bilingual cross-row sentence, tags, real playback/background accounting, deadline pause, extension, DOCX download, review and cleanup');
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,platform:bili?'bilibili':'youtube',checks:['chinese-settings-no-supadata','chinese-ui','second-countdown','follow-playback','hover','quick-movement','stale-results','cache','bilingual-sentence-range','tags','real-playback','background-accounting','deadline-pause','extend','docx','review','cleanup'],errors:panel.errors},null,2));
  }catch(error){if(panel){console.error('PANEL',await panel.evaluate(()=>document.body.innerText).catch(()=>''));await panel.screenshot('failure.png').catch(()=>{});}throw error;}
  finally{if(asrServer)await new Promise(resolve=>asrServer.close(resolve));await context.close();fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
