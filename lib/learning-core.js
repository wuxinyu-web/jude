/* Pure, shared learning models. No provider or browser dependencies. */
var YTD_LEARNING = (() => {
  const GRAMMAR = ["定语从句", "状语从句", "名词性从句", "非谓语", "并列结构", "倒装／强调", "其他"];
  const EXPRESSIONS = ["俚语", "习语／固定搭配", "普通表达"];
  const DEFAULTS = { minutes: 20, wordGoal: 5, sentenceGoal: 2, reduceDistractions: true };
  const text = (s, max = 4000) => String(s ?? "").normalize("NFKC").trim().slice(0, max);
  const normalize = s => text(s).toLocaleLowerCase("en").replace(/\s+/g, " ");
  const PLATFORM = typeof YTD_PLATFORM!=="undefined"?YTD_PLATFORM:typeof require!=="undefined"?require("./platform.js"):null;
  const videoIdFromUrl = value => {
    if(PLATFORM)return PLATFORM.videoIdFromUrl(value);
    try { const u = new URL(value); return u.origin === "https://www.youtube.com" && u.pathname === "/watch" ? u.searchParams.get("v") : null; }
    catch { return null; }
  };
  const tags = (value, allowed) => Array.isArray(value) ? [...new Set(value.filter(t => allowed.includes(t)))] : [];
  const plain = (s, max) => {
    if (typeof s !== "string" || !s.trim() || s.length > max || /<[^>]+>/.test(s)) throw new Error("AI 解析格式无效，请重试。");
    return text(s, max);
  };
  function validateAnalysis(value) {
    const v = typeof value === "string" ? JSON.parse(value) : value;
    if (!v || typeof v !== "object") throw new Error("AI 解析格式无效。");
    return { translationZh: plain(v.translationZh, 3000), mainClause: plain(v.mainClause, 3000),
      breakdown: plain(v.breakdown, 6000), grammarTags: tags(v.grammarTags, GRAMMAR),
      expressionTags: tags(v.expressionTags, EXPRESSIONS) };
  }
  function sourceMetadata(m) {
    const videoId = text(m.videoId, 100);
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new Error("无法确定来源视频，请重新打开字幕。");
    const n = Number(m.timestamp ?? m.timestampSeconds);
    if (!Number.isFinite(n) || n < 0 || n > 31536000) throw new Error("无效的视频时间点。");
    const seconds = Math.floor(n);
    return { videoId, videoTitle: text(m.videoTitle, 500), channelName: text(m.channelName, 300),
      timestampSeconds: seconds, timestamp: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,"0")}`,
      timestampedUrl: PLATFORM?.sourceUrl(videoId,seconds) || `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`,
      context: text(m.context, 12000), sourceExcerpt: text(m.sourceExcerpt, 3000) };
  }
  function makeSentence(m, now, id) {
    const original = text(m.term, 4000);
    if (!original || String(m.term).length > 4000 || !/[A-Za-z]/.test(original)) throw new Error("请选择不超过 4000 字符的英文原句。");
    return { id, term: original, normalizedTerm: normalize(original), ...sourceMetadata(m), createdAt: now,
      translationZh: "", mainClause: "", breakdown: "", grammarTags: [], expressionTags: [],
      analysisStatus: "pending", analysisError: "", analysisRevision: 0, tagsEdited: false };
  }
  function filterEntries(entries, options = {}, reviews = {}) {
    const { videoId, query = "", sort = "newest", grammar = "", expression = "", review = "" } = options;
    const needle = normalize(query);
    return entries.filter(e => (!videoId || e.videoId === videoId) &&
      (!needle || normalize([e.term, e.meaningZh, e.translationZh, e.videoTitle, e.channelName].join(" ")).includes(needle)) &&
      (!grammar || e.grammarTags?.includes(grammar)) && (!expression || e.expressionTags?.includes(expression)) &&
      (!review || (reviews[e.id]?.result || "unreviewed") === review))
      .slice().sort((a,b) => {
        const order = sort === "az" ? a.term.localeCompare(b.term,"en",{sensitivity:"base"}) :
          sort === "oldest" ? a.createdAt - b.createdAt : sort === "video" && videoId ? a.timestampSeconds - b.timestampSeconds : b.createdAt-a.createdAt;
        return order || a.id.localeCompare(b.id);
      });
  }
  function groupEntries(entries, mode) {
    if (!["grammar", "expression"].includes(mode)) return [["", entries]];
    const labels = mode === "grammar" ? GRAMMAR : EXPRESSIONS;
    const key = mode === "grammar" ? "grammarTags" : "expressionTags";
    return [...labels, "未分类"].map(label => [label, entries.filter(e => label === "未分类" ? !e[key]?.length : e[key]?.includes(label))]).filter(([,list]) => list.length);
  }
  function uniqueEntries(entries) { return [...new Map(entries.map(e => [e.id,e])).values()]; }
  function englishWordAt(value, offset) {
    // Keep dotted abbreviations, contractions and hyphenated words together.
    const matches = value.matchAll(/(?:[A-Za-z]\.)+[A-Za-z]\.?|[A-Za-z]+(?:[’'\-][A-Za-z]+)*/g);
    for (const m of matches) if (offset >= m.index && offset < m.index + m[0].length) return {term:m[0],start:m.index,end:m.index+m[0].length};
    return null;
  }
  function preferences(input = {}) {
    const number = (key, min, max) => Math.max(min, Math.min(max, Math.round(Number.isFinite(Number(input[key])) ? Number(input[key]) : DEFAULTS[key])));
    return {minutes:number("minutes",1,180), wordGoal:number("wordGoal",0,500), sentenceGoal:number("sentenceGoal",0,500), reduceDistractions: input.reduceDistractions !== false};
  }
  function makeSession(m, now, id) {
    const prefs = preferences(m);
    return { schemaVersion:2, id, ...sourceMetadata({...m,timestamp:0}), tabId:m.tabId, windowId:m.windowId,
      startedAt:now, endedAt:null, status:"running", targetMs:prefs.minutes*60000,
      wordGoal:prefs.wordGoal, sentenceGoal:prefs.sentenceGoal, reduceDistractions:prefs.reduceDistractions,
      watchMs:0, activityMs:0, reviewMs:0, wordIds:[], sentenceIds:[], practicedWordIds:[], practicedSentenceIds:[], practiceResults:{}, position:0, positionKnown:false, activityMode:"video", timerReason:"准备计时", daily:{}, lastSample:null };
  }
  function dayKey(now) { const d=new Date(now); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  const totalMs = s => (s?.watchMs||0)+(s?.activityMs||0)+(s?.reviewMs||0);
  function normalizeStudy(data={}, now=Date.now()) {
    const sessions=(Array.isArray(data.sessions)?data.sessions:[]).filter(s=>s && Number(s.startedAt)>=now-90*86400000).map(s=>({
      ...s, schemaVersion:2, status:["running","paused","ended"].includes(s.status)?s.status:"paused",
      activityMode:s.activityMode||"video", watchMs:Math.max(0,Number(s.watchMs)||0),activityMs:Math.max(0,Number(s.activityMs)||0),reviewMs:Math.max(0,Number(s.reviewMs)||0),
      wordIds:Array.isArray(s.wordIds)?s.wordIds:[],sentenceIds:Array.isArray(s.sentenceIds)?s.sentenceIds:[],
      practicedWordIds:s.schemaVersion===2?[...new Set(s.practicedWordIds||[])]:[],practicedSentenceIds:s.schemaVersion===2?[...new Set(s.practicedSentenceIds||[])]:[],
      practiceResults:s.schemaVersion===2?s.practiceResults||{}:{},position:Math.max(0,Number(s.position)||0),positionKnown:s.positionKnown===true,daily:s.daily||{},
    }));
    return {schemaVersion:2,sessions,currentId:sessions.some(s=>s.id===data.currentId)?data.currentId:null};
  }
  function progress(s) {
    const words=s?.practicedWordIds?.length||0,sentences=s?.practicedSentenceIds?.length||0;
    const time=totalMs(s),timeMet=time>=(s?.targetMs||0),wordsMet=words>=(s?.wordGoal||0),sentencesMet=sentences>=(s?.sentenceGoal||0);
    return {words,sentences,time,timeMet,wordsMet,sentencesMet,allMet:timeMet&&wordsMet&&sentencesMet,
      remaining:Math.max(0,(s?.targetMs||0)-time),pending:Object.values(s?.practiceResults||{}).filter(r=>r.result!=="known").length};
  }
  function tickSession(session, sample, now, boot) {
    if (!session || session.status === "ended") return session;
    const s = {...session,daily:{...session.daily}};
    const previous=s.lastSample;
    let kind=null,reason="等待播放或学习操作";
    if(s.status!=="running")reason=s.pauseReason==="restore"?"进度已恢复，请手动继续":"已手动暂停，请点击继续";
    else if(sample.videoId!==s.videoId)reason="已切换视频";
    else if(sample.online===false)reason="离线，暂不计时";
    else if(!sample.foreground)reason="后台或窗口失焦，暂不计时";
    else if(sample.reviewActive){kind="reviewMs";reason="正在计时：翻卡复习";}
    else if(sample.seeking)reason="正在拖动进度，暂不计时";
    else if(sample.activityActive && !sample.buffering){kind="activityMs";reason="正在计时：字幕与词句操作";}
    else if(sample.playing&&!sample.buffering){kind="watchMs";reason="正在计时：前台观看";}
    else if(sample.buffering)reason="视频缓冲，暂不计时";
    else reason="暂停播放；60 秒内无有效操作，暂不计时";
    const elapsed=previous && previous.boot===boot && previous.kind===kind && kind ? now-previous.at:0;
    if(elapsed>0 && elapsed<=6000){
      s[kind]+=elapsed;
      let cursor=now-elapsed;
      while(cursor<now){const d=new Date(cursor);d.setHours(24,0,0,0);const end=Math.min(now,d.getTime()),key=dayKey(cursor);
        const bucket={watchMs:0,activityMs:0,reviewMs:0,...s.daily[key]};bucket[kind]+=end-cursor;s.daily[key]=bucket;cursor=end;}
    }
    s.timerKind=kind;s.timerReason=reason;s.lastSample={at:now,kind,boot};
    if(s.status==="running" && Number.isFinite(sample.position)&&sample.position>=0){s.position=sample.position;s.positionKnown=true;}
    return s;
  }
  function summary(sessions, now) {
    return Array.from({length:7},(_,i)=>{ const d=new Date(now);d.setDate(d.getDate()-(6-i));const day=dayKey(d);
      return sessions.reduce((out,s)=>{ const b=s.daily?.[day];if(b) for(const key of ["watchMs","activityMs","reviewMs"])out[key]+=b[key]||0;return out; },{day,watchMs:0,activityMs:0,reviewMs:0}); });
  }
  return {GRAMMAR, EXPRESSIONS, DEFAULTS, text,normalize,tags,videoIdFromUrl,validateAnalysis,sourceMetadata,makeSentence,
    filterEntries,groupEntries,uniqueEntries,englishWordAt,preferences,makeSession,dayKey,tickSession,summary,normalizeStudy,totalMs,progress};
})();
if (typeof module !== "undefined" && module.exports) module.exports = YTD_LEARNING;
