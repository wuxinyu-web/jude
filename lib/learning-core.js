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
    return { id, ...sourceMetadata({...m,timestamp:0}), tabId:m.tabId, windowId:m.windowId,
      startedAt:now, endedAt:null, status:"running", targetMs:prefs.minutes*60000,
      wordGoal:prefs.wordGoal, sentenceGoal:prefs.sentenceGoal, reduceDistractions:prefs.reduceDistractions,
      watchMs:0, activityMs:0, reviewMs:0, wordIds:[], sentenceIds:[], daily:{}, lastSample:null };
  }
  function dayKey(now) { const d=new Date(now); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  function tickSession(session, sample, now, boot) {
    if (!session || session.status === "ended") return session;
    const s = {...session,daily:{...session.daily}};
    const previous = s.lastSample;
    const foreground = sample.foreground && sample.videoId === s.videoId;
    const kind = !foreground ? null : s.status === "review" ? (sample.reviewActive ? "reviewMs" : null) :
      s.status !== "running" ? null : sample.playing && !sample.buffering && !sample.seeking ? "watchMs" :
      !sample.playing && !sample.seeking && sample.activityActive ? "activityMs" : null;
    const elapsed = previous && previous.boot === boot && previous.kind === kind && kind ? now-previous.at : 0;
    // Never credit sleep, missing heartbeats, process restarts or clock rollback.
    if (elapsed > 0 && elapsed <= 6000) {
      const credit = kind === "reviewMs" ? elapsed : Math.min(elapsed, Math.max(0,s.targetMs-s.watchMs-s.activityMs));
      s[kind] += credit;
      // Split at local midnight so the daily summary stays accurate.
      let cursor = now-credit;
      while (cursor < now) {
        const d = new Date(cursor); d.setHours(24,0,0,0);
        const end=Math.min(now,d.getTime()), key=dayKey(cursor);
        const bucket={watchMs:0,activityMs:0,reviewMs:0,...s.daily[key]};
        bucket[kind]+=end-cursor; s.daily[key]=bucket; cursor=end;
      }
    }
    if (s.status === "running" && s.watchMs+s.activityMs >= s.targetMs) s.status="due";
    s.lastSample={at:now,kind,boot};
    return s;
  }
  function summary(sessions, now) {
    return Array.from({length:7},(_,i)=>{ const d=new Date(now);d.setDate(d.getDate()-(6-i));const day=dayKey(d);
      return sessions.reduce((out,s)=>{ const b=s.daily?.[day];if(b) for(const key of ["watchMs","activityMs","reviewMs"])out[key]+=b[key]||0;return out; },{day,watchMs:0,activityMs:0,reviewMs:0}); });
  }
  return {GRAMMAR, EXPRESSIONS, DEFAULTS, text,normalize,tags,videoIdFromUrl,validateAnalysis,sourceMetadata,makeSentence,
    filterEntries,groupEntries,uniqueEntries,englishWordAt,preferences,makeSession,dayKey,tickSession,summary};
})();
if (typeof module !== "undefined" && module.exports) module.exports = YTD_LEARNING;
