/* Separate challenge view; the existing free-study panel remains intact. */
(()=>{
 if(globalThis.YTD_CHALLENGE_UI)return;
 const P=YTD_PANEL,root=document.getElementById('challengePanel');if(!root)return;
 let parentDialogOpen=false,parentDialog=null,parent={enabled:false},setupPin=null,confirmingPin=false,session=null,history=[],busy=false,signature='',sourceSignature='',polling=false,autoExamId='',error='',draftTimer;
 const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const send=async(action,data={})=>{const c=P.context();const r=await chrome.runtime.sendMessage({action,tabId:c.tabId,videoId:c.videoId,videoTitle:c.videoTitle,...data});if(!r?.success)throw Error(r?.error||'操作失败，请重试。');return r;};
 function button(label,fn){const b=el('button',label,'learning-button');b.type='button';b.disabled=busy;b.onclick=()=>run(fn);return b;}
 async function run(fn){if(busy)return;busy=true;error='';render(true);try{await fn();await poll();}catch(e){error=e.message;}finally{busy=false;render(true);}}
 const cmd=(command,extra={})=>send('challengeCommand',{command,sessionId:session?.id,...extra});
 function link(label,s){const a=el('a',label,'learning-button');a.href=YTD_PLATFORM.sourceUrl(s.videoId,s.position||0);a.target='_blank';a.rel='noopener';return a;}
 async function poll(){if(polling)return;polling=true;try{const r=await send('challengeGet');parent=r.parent||{enabled:false};session=r.session;if(!parent.enabled&&session&&!session.parentMode&&!['passed','exited'].includes(session.status)){await cmd('exit');session=null;}history=r.history||[];render();await pushSource();if(parent.enabled&&session?.parentMode&&session.finished&&session.status==='watching'&&!session.error&&session.sourceCount>0&&autoExamId!==session.id){autoExamId=session.id;const ready=await send('challengeGenerate',{sessionId:session.id});if(ready.session)session=ready.session;render(true);}}catch(e){error=e.message;render();}finally{polling=false;}}
 async function pushSource(){const c=P.context(),segments=P.rawSegments();if(!session||session.videoId!==c.videoId||session.questions.length||['passed','exited'].includes(session.status))return;
  const key=`${session.id}:${c.videoId}:${segments.length}:${segments.at(-1)?.text}:${c.language}`;if(key===sourceSignature)return;
  await cmd('source',{cues:segments.map(s=>({start:s.start,duration:s.duration,text:s.text}))});sourceSignature=key;
 }
 function answers(){return Object.fromEntries([...root.querySelectorAll('[data-question]')].map(i=>[i.dataset.question,i.value]));}
 function render(force=false){
  const c=P.context(),s=session,key=JSON.stringify([s?.id,s?.status,s?.needsResume,s?.finished,s?.questions?.length,s?.attempts?.length,s?.error,s?.collection,s?.reviewed,parent,setupPin,confirmingPin,c.videoId,busy,error]);
  const live=root.querySelector('[data-watch]');if(live&&s)live.textContent=`已记录本次播放 ${Math.floor(s.watchedSeconds/60)} 分 ${Math.floor(s.watchedSeconds%60)} 秒`;
  if(!force&&signature===key)return;signature=key;
  // Keep typed answers across transient request/error renders.
  const typed=answers();if(s&&Object.keys(typed).length)s.draft={...s.draft,...typed};
  root.replaceChildren();renderParent();root.hidden=!parent.enabled;if(!parent.enabled)return;root.append(el('h2',s?.parentMode?'本集家长任务':'本集闯关学习'));
  if(!s?.parentMode)root.append(el('p','可选模式：每集目标 8 道单词默写、4 道短语中译英。单词与短语各答对至少 75% 后，在本学习模式中继续下一集。','learning-muted'));
  const free=el('a',parent.enabled?'查看学习计时与收藏练习':'使用原来的自由学习');free.href='#studyPanel';free.onclick=e=>{e.preventDefault();document.getElementById('studyPanel')?.scrollIntoView({block:'start',behavior:'smooth'});};root.append(free);
  if((error&&!parentDialogOpen)||s?.error){const note=el('p',(!parentDialogOpen&&error)||s.error,'challenge-error');note.setAttribute('role','alert');root.append(note);}
  if(!s||['passed','exited'].includes(s.status)){
   if(s){root.append(el('h3',s.status==='passed'?'本集已通关，可以继续下一集':'已退出，本次未通关'));if(s.score)summary(s);if(s.completion==='collection')root.append(el('p','本集收藏与观看要求已完成。收藏不等于掌握。'));}
   if(parent.enabled)root.append(el('p','家长模式继续生效。进入下一个未完成的视频时，会自动建立本集任务。'));
   if(!parent.enabled)root.append(el('p','从开始后实际播放过的英文字幕出题；收藏不足会自动补题。素材不足时减少题数。出题和必要判题调用你配置的 DeepSeek，产生 API 费用。随时可以退出。'));
   if(!parent.enabled)root.append(button('开始本集闯关',async()=>{if(!c.videoId)throw Error('请先打开视频并加载字幕。');await send('challengeCommand',{command:'start'});sourceSignature='';}));
  }else{
   root.append(el('h3',s.videoTitle||'本集视频'));root.append(el('p',({watching:'观看中',generating:'正在准备试题…',quiz:'待测试',grading:'正在核对答案…',retry:'复习与补测',review:'先复习错题，再重新考试'})[s.status]||s.status,'challenge-status'));
   if(s.videoId!==c.videoId){root.append(el('p','本次闯关属于另一个视频，请返回本集完成测试，或退出闯关。'),link('回到本集',s));}
   else if(s.needsResume){root.append(el('p','已恢复上次进度，离开期间不计入观看。'),button('继续本集闯关',()=>cmd('resume')));}
   const watch=el('p',`已记录本次播放 ${Math.floor(s.watchedSeconds/60)} 分 ${Math.floor(s.watchedSeconds%60)} 秒`,'learning-muted');watch.dataset.watch='';root.append(watch);
   if(s.parentMode&&s.status==='watching'){const counts=s.collection||{};root.append(el('p',`本集已收集：单词 ${counts.words||0}/10 · 句子 ${counts.sentences||0}/5。仅统计开始后收藏、来自已观看字幕的不同词句。收藏达标且实际观看至少 80% 可完成收集任务；否则完成测试。`));}
   if(s.status==='review'&&s.parentMode){
    summary(s);root.append(el('p','逐项学习参考答案与句式，再自评。所有错题确认记住后，重新完成整张试卷；本次需达到 8 分。'));
    for(const q of s.questions.filter(q=>!s.results?.[q.id]?.correct)){
     const card=el('section',undefined,'challenge-question');card.append(el('h4',q.prompt),el('p',q.answer),el('p',q.explanation||''),el('p',q.source||''));
     card.append(button('回看原句',async()=>{await cmd('reviewReplay',{questionId:q.id});await P.seek({videoId:s.videoId,timestampSeconds:q.start,timestampedUrl:YTD_PLATFORM.sourceUrl(s.videoId,q.start)});}));
     for(const [value,label] of [['known','记住了'],['unsure','不熟'],['again','没记住']])card.append(button((s.reviewed?.[q.id]?.result===value?'✓ ':'')+label,()=>cmd('reviewWrong',{questionId:q.id,result:value})));
     root.append(card);
    }
    root.append(button('复习完成，重新考试',()=>cmd('retest')));
   }
   if(s.status==='watching'){
    root.append(el('p',s.finished?'本集已结束，请开始测试。':'看完后或准备结束本次观看时，点击下方准备测试。'));
    root.append(button('结束观看，准备测试',async()=>{await pushSource();await send('challengeGenerate',{sessionId:s.id});}));
    if(s.finished)root.append(button('继续回看本集',()=>cmd('rewatch')));
   }
   if(['quiz','retry'].includes(s.status)){
    if(!s.parentMode&&s.questions.length<12)root.append(el('p',`已观看内容中可靠素材不足，本次 ${s.questions.filter(q=>q.kind==='word').length} 道单词题、${s.questions.filter(q=>q.kind==='phrase').length} 道短语题；各类仍按 75% 向上取整判定。`,'study-notice'));
    if(s.attempts.length&&!s.parentMode){summary(s);root.append(el('p','先查看错题解析并回顾原声，再点击补测。补测只处理未答对项目，不覆盖首次成绩。'));}
    const form=el('div',undefined,'challenge-questions');
    s.questions.forEach((q,index)=>{
     const r=s.results?.[q.id];if(s.status==='retry'&&r?.correct)return;
     const card=el('section',undefined,'challenge-question');const label=el('label',`${index+1}. ${q.kind==='word'?'单词':q.kind==='sentence'?'句子中译英':'短语'}：${q.prompt}`);label.htmlFor=`challenge-${q.id}`;card.append(label);
     if(s.status==='retry'){const details=el('details');details.append(el('summary','查看参考答案与原声出处'),el('p',`你的回答：${r?.answer||'未作答'}`),el('p',`参考：${q.answer}`),el('p',r?.feedback||''),el('p',q.explanation||''),el('p',q.source||''));details.append(link('回看这句',{...s,position:q.start}));card.append(details);}
     const input=el(q.kind==='sentence'?'textarea':'input');input.id=label.htmlFor;input.dataset.question=q.id;input.autocomplete='off';input.spellcheck=false;input.maxLength=500;input.placeholder='在这里填写英文';input.value=s.draft?.[q.id]||'';input.disabled=busy;
     input.oninput=()=>{s.draft={...s.draft,[q.id]:input.value};clearTimeout(draftTimer);const id=s.id;draftTimer=setTimeout(()=>send('challengeCommand',{command:'draft',sessionId:id,answers:s.draft}).catch(()=>{}),350);};card.append(input);form.append(card);
    });root.append(form,button(s.status==='retry'?'提交错题补测':'提交本集测试',async()=>{clearTimeout(draftTimer);await send('challengeSubmit',{sessionId:s.id,answers:s.draft||{}});}));
   }
   if(!parent.enabled)root.append(button('退出闯关，恢复自由观看',async()=>{if(confirm('退出后本次记为未通关，保留试卷与作答记录。确认退出？'))await cmd('exit');}));
  }
  const records=el('details',undefined,'challenge-history');records.append(el('summary','最近闯关记录'));
  history.forEach(h=>records.append(el('p',`${h.videoTitle||'视频'} · ${h.status==='passed'?'已通关':h.status==='exited'?'未完成':'进行中'} · ${h.attempts} 次提交`)));root.append(records);
  const needsAction=s&&(['quiz','retry','review','generating','grading'].includes(s.status)||(s.status==='watching'&&s.finished));
  root.classList.toggle('challenge-inline',!needsAction);
  if(!needsAction){
   const controls=[...root.querySelectorAll('button,a')];
   const find=label=>controls.find(b=>b.textContent===label);
   const alert=root.querySelector('[role="alert"]');
   const strip=el('div',undefined,'challenge-flow');
   const copy=el('div',undefined,'challenge-flow-copy');
   const active=s&&!['passed','exited'].includes(s.status);
   const title=s?.status==='passed'?'本集已通关，可以继续下一集':active?(s.needsResume?'上次的自测还在，继续就好':'观看中'):'边看边学，看完测一测';
   copy.append(el('strong',title));
   if(parent.enabled)copy.append(el('small',`家长模式 · 已收藏 ${s?.collection?.words||0} 个单词、${s?.collection?.sentences||0} 个句子`));
   strip.append(copy);
   let primary=active?(s.videoId!==c.videoId?find('回到本集'):s.needsResume?find('继续本集闯关'):find('结束观看，准备测试')):find('开始本集闯关');
   if(primary){const old=primary.textContent;primary.setAttribute('aria-label',old);primary.textContent=old==='继续本集闯关'?'继续':old==='结束观看，准备测试'?'开始测试':old==='开始本集闯关'?'开启随看自测':old;primary.classList.add('primary');strip.append(primary);}
   const more=button('记录与规则',()=>openChallengeInfo());more.classList.add('challenge-history-button','challenge-text-action');strip.append(more);
   const exit=find('退出闯关，恢复自由观看');if(exit){exit.textContent='退出自测';exit.classList.add('challenge-text-action');strip.append(exit);}
   root.replaceChildren(strip);if(alert)root.append(alert);
  }
 }
 function openChallengeInfo(){
  const dialog=el('dialog',undefined,'parent-modal');dialog.setAttribute('aria-label','自测记录与规则');
  const close=el('button','关闭','learning-button parent-modal-close');close.type='button';
  const dismiss=()=>{dialog.close();dialog.remove();root.querySelector('.challenge-history-button')?.focus();};close.onclick=dismiss;dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss();});
  dialog.append(close,el('h2','自测记录与规则'),el('p',parent.enabled?'家长模式用于防止孩子只追剧、不完成英语学习。每集需要边看边收藏 10 个单词和 5 个长难句；收藏或观看未达标时，必须通过本集测试才能继续下一集。':'自愿开启随看自测，从已观看字幕出 8 道单词、4 道短语题。各类答对至少 75% 后通过；素材不足时减少题数，可退出。'),el('p',parent.enabled?'测试包含 10 道单词默写和 5 道句子中译英，满分 10 分，达到 8 分通过。未通过时先复习错题，再重新完成整张试卷。':'出题和必要判题使用已配置的 AI 服务，可能产生费用。'));
  if(parent.enabled)dialog.append(el('p','出题和必要判题使用已配置的 AI 服务，可能产生费用。'));
  if(!history.length)dialog.append(el('p','还没有自测记录。'));
  for(const h of history)dialog.append(el('p',`${h.videoTitle||'视频'} · ${h.status==='passed'?'已通关':h.status==='exited'?'未完成':'进行中'} · ${h.attempts} 次提交`));
  document.body.append(dialog);dialog.showModal();
 }

 function closeParentDialog({completed=false}={}){parentDialogOpen=false;error='';setupPin=null;confirmingPin=completed?false:!!parent.pending;parentDialog?.close();parentDialog?.remove();parentDialog=null;document.getElementById('parentModeToggle')?.focus();}
 function renderParent(){
  const toggle=document.getElementById('parentModeToggle');
  if(toggle){toggle.setAttribute('aria-checked',String(parent.enabled));toggle.querySelector('span').textContent=parent.enabled?'开':'关';toggle.disabled=busy;}
  if(!parentDialogOpen){parentDialog?.close();parentDialog?.remove();parentDialog=null;return;}
  if(!parentDialog){parentDialog=el('dialog',undefined,'parent-modal');parentDialog.setAttribute('aria-label','家长模式设置');parentDialog.addEventListener('cancel',e=>{e.preventDefault();closeParentDialog();});document.body.append(parentDialog);}
  const focused=document.activeElement?.id;const drafts=!busy?[...parentDialog.querySelectorAll('input')].map(i=>({id:i.id,value:i.value})):[];
  parentDialog.replaceChildren();
  const close=el('button','关闭','learning-button parent-modal-close');close.type='button';close.onclick=closeParentDialog;parentDialog.append(close);
  if(error){const note=el('p',error,'challenge-error');note.setAttribute('role','alert');parentDialog.append(note);}
  const area=el('section',undefined,'parent-mode');area.append(el('h2',parent.enabled?'家长模式已开启':'家长模式'));
  area.append(el('p','防止孩子只追剧、不完成英语学习。开启后，每集需要边看边收藏 10 个单词和 5 个长难句；收藏或观看未达标时，必须通过本集测试才能继续下一集。','parent-mode-purpose'));
  area.append(el('p','家长密码只用于解除模式，请由家长保管；孩子完成收藏任务或通过测试不需要密码。','learning-muted'));
  const info=el('details');info.append(el('summary','查看任务与测试规则'));
  info.append(el('p','收藏达标还需要实际观看至少 80%。未达标时，测试包含 10 道单词默写（每题 0.5 分）和 5 道句子中译英（每题 1 分）；满分 10 分，达到 8 分过关。未通过时先复习错题，再重新完成整张试卷。','learning-muted'));
  info.append(el('p','试题优先选用本集常用动词、形容词和四级及以上难度词句。出题和必要判题使用已配置的 AI 服务，可能产生费用。','learning-muted'));
  if(parent.enabled){
   area.append(el('p','本模式会持续作用于后续视频；完成本集任务或通过测试后，才能继续下一集。'));
   const details=el('details');details.open=true;details.append(el('summary','家长解除模式'));
   const label=el('label','家长密码');label.htmlFor='parent-unlock';const input=el('input');input.id=label.htmlFor;input.type='password';input.maxLength=64;input.autocomplete='current-password';
   details.append(label,input,button('验证并解除',async()=>{const pin=input.value;input.value='';await send('parentCommand',{command:'unlock',pin});closeParentDialog({completed:true});}));area.append(details);
  }else{
   area.append(el('p','请设置家长密码。以后只有输入这个密码，才能关闭家长模式。','learning-muted'));
   const fields=[];
   for(const [id,title] of [['parent-password','设置密码'],['parent-confirm','确认密码']]){
    const label=el('label',title);label.htmlFor=id;const input=el('input');input.id=id;input.type='password';input.minLength=6;input.maxLength=64;input.autocomplete='new-password';input.placeholder='6–64 位字符';fields.push(input);area.append(label,input);
   }
   area.append(button('开启家长模式',async()=>{const pin=fields[0].value,confirmPin=fields[1].value;fields.forEach(f=>f.value='');await send('parentCommand',{command:'setPassword',pin,confirmPin});sourceSignature='';closeParentDialog({completed:true});}));
   info.append(el('p','开启后会结束当前普通闯关并保留已有记录。'));
  }
  const limits=el('div');limits.append(el('h3','适用范围与限制'),el('p','限制作用于此浏览器中扩展支持的视频页面，不限制其他浏览器或应用。关闭、卸载扩展或清除扩展数据仍可绕过；它不是系统级家长控制，也不能证明学生已掌握。记录仅存本机 90 天，密钥校验信息保留至家长解除，不进入学习记录导出。素材不足或服务失败时可重试、回看，或由家长解除。'));info.append(limits);area.append(info);parentDialog.append(area);if(!parentDialog.open)parentDialog.showModal();for(const draft of drafts){const input=parentDialog.querySelector(`#${draft.id}`);if(input)input.value=draft.value;}if(focused)parentDialog.querySelector(`#${focused}`)?.focus();
 }
 function summary(s){const p=s.score;if(!p)return;if(s.parentMode){root.append(el('p',`本次 ${p.points??0}/10 分 · 8 分过关。单词 ${p.word?.correct||0}/${p.word?.total||0} · 句子 ${p.sentence?.correct||0}/${p.sentence?.total||0}`));if(s.attempts?.length)root.append(el('p',`首次 ${s.attempts[0].score.points??0}/10 分；已提交 ${s.attempts.length} 次。`,'learning-muted'));return;}root.append(el('p',`单词 ${p.word.correct}/${p.word.total}（需 ${p.word.required}） · 短语 ${p.phrase.correct}/${p.phrase.total}（需 ${p.phrase.required}）`));const first=s.attempts?.[0]?.score;if(first)root.append(el('p',`首次成绩：单词 ${first.word.correct}/${first.word.total} · 短语 ${first.phrase.correct}/${first.phrase.total}；累计提交 ${s.attempts.length} 次。`,'learning-muted'));}
 const timer=setInterval(()=>{if(!document.hidden)void poll();},2000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
 chrome.runtime.onMessage.addListener(m=>{if(m.action==='challengeChanged')void poll();});
 document.getElementById('parentModeToggle')?.addEventListener('click',()=>{parentDialogOpen=true;error='';renderParent();});
 globalThis.YTD_CHALLENGE_UI={poll};void poll();
})();
