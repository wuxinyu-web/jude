/* Pure episode challenge rules; no provider calls or browser state. */
var YTD_CHALLENGE_CORE=(()=>{
  const KEY='ytd_challenges',VERSION=1,DAY=86400000;
  const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[^a-z0-9' -]/g,' ').replace(/\s+/g,' ').trim();
  const text=(s,n=2000)=>typeof s==='string'?s.trim().slice(0,n):'';
  // Conservative classroom filter, applied to source context as well as answers.
  function classroomSafe(value){
    const s=String(value||'').normalize('NFKC');
    return !/\b(?:fuck\w*|shit\w*|bullshit|bitch\w*|asshole\w*|bastard\w*|damn\w*|goddamn\w*|cunt\w*|dick\w*|cock|pussy|ass|crap|porn\w*|sex\w*|nude\w*|naked|orgasm\w*|masturbat\w*|blowjob\w*|erection|penis|vagina|whore\w*|slut\w*)\b|f\*+k|sh\*+t|色情|淫秽|下流|性交|做爱|性爱|裸体|裸照|手淫|自慰|口交|阴茎|阴道|操你|他妈|傻逼|婊子|贱人|狗屎|混蛋/i.test(s);
  }
  function clean(raw,now){return {schemaVersion:VERSION,currentId:raw?.currentId||null,sessions:(Array.isArray(raw?.sessions)?raw.sessions:[]).filter(s=>s?.schemaVersion===VERSION && Number(s.createdAt)>now-90*DAY)};}
  function merge(ranges,a,b){if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return ranges;const out=[];for(const r of [...ranges,[a,b]].sort((x,y)=>x[0]-y[0])){const last=out.at(-1);if(last&&r[0]<=last[1]+0.15)last[1]=Math.max(last[1],r[1]);else out.push([...r]);}return out.slice(-4000);}
  function viewed(cue,ranges){const end=cue.start+Math.max(0.1,cue.duration);return ranges.reduce((n,r)=>n+Math.max(0,Math.min(end,r[1])-Math.max(cue.start,r[0])),0)>=Math.min(1,(end-cue.start)*0.5);}
  function cues(input){return (Array.isArray(input)?input:[]).slice(0,20000).filter(c=>Number.isFinite(c.start)&&c.start>=0&&Number.isFinite(c.duration)&&c.duration>0&&typeof c.text==='string'&&classroomSafe(c.text)&&/[a-z]{2}/i.test(c.text)&&!/[\u3400-\u9fff]/.test(c.text)).map(c=>({start:c.start,duration:Math.min(c.duration,120),text:text(c.text,2000)}));}
  function validateQuestions(raw,source,{parentMode=false}={}){
    const obj=typeof raw==='string'?JSON.parse(raw):raw;if(!Array.isArray(obj?.questions))throw Error('题目格式不正确，请重试。');
    const seen=new Set(),counts={word:0,phrase:0,sentence:0},out=[];
    for(const q of obj.questions.slice(0,30)){
      if(!(parentMode?['word','sentence']:['word','phrase']).includes(q.kind)||counts[q.kind]>=(parentMode?(q.kind==='word'?10:5):(q.kind==='word'?8:4)))continue;
      const answer=text(q.answer,parentMode?500:100),key=norm(answer),prompt=text(q.prompt,500),cue=source.find(c=>Math.abs(c.start-Number(q.start))<0.05);
      if(!classroomSafe([answer,prompt,cue?.text,q.explanation,...(Array.isArray(q.accepted)?q.accepted:[])].join(' ')))continue;
      if(!key||seen.has(key)||!cue||!(` ${norm(cue.text)} `).includes(` ${key} `)||!/[\u3400-\u9fff]/.test(prompt)||/[a-z]{2}/i.test(prompt)||!/[a-z]/i.test(answer)||(q.kind==='sentence'?/[^a-zA-Z0-9'’ ,.!?;:"()-]/:/[^a-zA-Z'’ -]/).test(answer))continue;
      if(q.kind==='word'&&key.split(' ').length!==1||q.kind!=='word'&&key.split(' ').length<(q.kind==='sentence'?4:2))continue;
      const accepted=[answer,...(Array.isArray(q.accepted)?q.accepted:[])].filter(a=>typeof a==='string'&&a.length<=(parentMode?500:100)&&/^[a-zA-Z0-9'’ ,.!?;:"()-]+$/.test(a)).slice(0,8);
      out.push({id:`q${out.length+1}`,kind:q.kind,answer,prompt,accepted,start:cue.start,duration:cue.duration,source:cue.text,explanation:text(q.explanation,700)});seen.add(key);counts[q.kind]++;
    }
    if(parentMode&&(counts.word!==10||counts.sentence!==5))throw Error('适合课堂的已观看素材不足 10 道单词题和 5 道句子题，请继续回看、补充英文字幕或请家长解除。');
    if(!out.length)throw Error('已观看的英文字幕不足以生成可靠题目。可以继续观看、重试或退出闯关。');return out;
  }
  function score(questions,results,{parentMode=false}={}){
    if(parentMode){const word=questions.filter(q=>q.kind==='word'),sentence=questions.filter(q=>q.kind==='sentence');const correct=items=>items.filter(q=>results[q.id]?.correct===true).length;
      const points=correct(word)*0.5+correct(sentence);return {word:{total:word.length,correct:correct(word)},sentence:{total:sentence.length,correct:correct(sentence)},points,maxPoints:10,requiredPoints:8,passed:word.length===10&&sentence.length===5&&points>=8};}
    const categories={};for(const kind of ['word','phrase']){const items=questions.filter(q=>q.kind===kind);const correct=items.filter(q=>results[q.id]?.correct===true).length;categories[kind]={total:items.length,correct,required:Math.ceil(items.length*0.75)};}return {...categories,passed:questions.length>0&&Object.values(categories).every(c=>c.correct>=c.required)};}
  function publicSession(s){if(!s)return null;const {cues,lastSample,results,...v}=s;const done=Boolean(s.attempts?.length)&&!s.retesting;return {...v,sourceCount:(cues||[]).length,attempts:s.parentMode&&s.retesting?(s.attempts||[]).map(a=>({at:a.at,score:a.score})):s.attempts,results:done?results:{},questions:(s.questions||[]).map(q=>done?q:({id:q.id,kind:q.kind,prompt:q.prompt})),watchedSeconds:(s.ranges||[]).reduce((n,r)=>n+r[1]-r[0],0)};}
  return {KEY,VERSION,norm,text,classroomSafe,clean,merge,viewed,cues,validateQuestions,score,publicSession};
})();
if(typeof module!=='undefined')module.exports=YTD_CHALLENGE_CORE;
