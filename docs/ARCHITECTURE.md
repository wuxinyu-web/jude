# Study extension architecture

## Existing pipeline

The extension keeps its plain JavaScript Manifest V3 architecture. background.js owns provider transport and existing transcript, Overview, translation, Notes and Vocabulary behavior. sidepanel.js retains reading, highlighting and video reconciliation. settings.js fixes the DeepSeek endpoint/model; keys remain local. Supadata native mode is always first and audio generation requires explicit confirmation.

## Learning modules and messages

lib/learning-core.js contains pure source validation, English lexical boundaries, sentence analysis validation, filtering/grouping, preferences and real-time accounting. lib/learning-worker.js owns serialized local mutations and limited provider concurrency. Its createServices factory accepts storage/AI/clock/environment adapters for deterministic tests.

Extension-page messages: lookupVocabulary, getLearningLibrary, saveSentence, analyzeSentence, editSentence, deleteSentence, markReview, setLearningPreferences, getStudy, studyCommand, studyPanelActivity, studyPanelOpened, exportStudy, clearStudy. Content scripts can only use the separately authenticated studyPulse action. Responses have success plus result fields or an error. Keys never travel to content scripts.

Vocabulary retains ytd_vocabulary and its 500-entry schema/cap. New ytd_sentences holds up to 500 source-first records with source context, translationZh, mainClause, breakdown, grammarTags, expressionTags, analysisStatus/revision and tagsEdited. ytd_reviews maps entry IDs to known/unsure/again and reviewedAt. ytd_learning_preferences stores library filters and session defaults. Existing longer vocabulary entries remain untouched. AI completion updates re-read the current record and honor its revision/manual-label flag.

Word lookup cache keys include normalized word, video and context; at most 200 entries / 30 minutes, two active requests, deduplicated in flight. Sentence analysis has a separate two-request cap. Neither collection silently evicts entries. Analysis begins explicitly after the durable source save; a lost worker leaves a recoverable pending source.

## Study accounting

ytd_study schemaVersion 2 holds currentId and sessions. Sessions preserve legacy collection IDs separately from practicedWordIds/practicedSentenceIds and per-item practiceResults (known/unsure/again). Missing legacy practice data becomes empty. Task status is running/paused/ended; activityMode and timerKind/timerReason are separate. Position, goals, daily buckets, document ID and worker boot support conservative recovery. On a new panel/document/boot or video change, accounting waits for explicit resume. Resume validates the foreground video and may rebind the tab. Ended tasks can continue with original progress.

lib/study-content.js is the sole playback sample producer (one second plus playback transitions); the worker serializes all storage mutations. The worker verifies active tab/focused window, content visibility/online state and owner document. Consecutive samples in the same category and boot credit real elapsed intervals of at most six seconds. Priority: active review, active operation, then eligible watching. Each operation category requires its own recent meaningful interaction and a live panel heartbeat. Passive heartbeats do not refresh interaction timestamps. Target duration never caps credit or pauses playback. Daily credit splits at local midnight. Reads normalize records and prune all entries older than 90 days, including expired current IDs.

markReview validates foreground/session/video/tab binding before counting session practice. IDs are unique by kind; repeated self-assessment updates the latest pending state. exportStudy excludes internal worker/document/tab fields; clearStudy only clears the session store and reverses active distraction controls. The library review map, Notes and Vocabulary remain separate.

## UI and Word

lib/learning-ui.js uses a narrow YTD_PANEL bridge, event delegation and generation checks for hover and selections. Original-language text is extracted from DOM ranges rather than including timestamp/translation/action text. Cards render provider data as text. Multi-label grouping may duplicate display cards; selected/exported IDs are deduplicated.

lib/word-export.js is shared by browser download and Node tests. vendor/docx.umd.js is the pinned 9.6.1 browser build; refresh with npm run vendor:docx. It writes A4 portrait OOXML with CJK font, safe source links, page fields, and separate self-test answers. Exports receive only selected content fields. npm run package includes all runtime modules, prompt contracts and vendor license through an explicit allowlist.

## Transcript search and reading position

Existing search stays literal, bounded and independent of Vocabulary highlighting. Reading positions for up to 20 videos live in chrome.storage.session and expire at browser-session end. Reading, metadata and analysis follow the active YouTube tab only, never a background fallback. Switching tabs away from Transcript captures its position without treating Library/Study scrolling as transcript reading.

## Validation

Node tests cover existing behavior, sentence/cache/storage races, mode transitions/time gaps, filtering, and DOCX XML. scripts/browser-test.cjs loads the real extension into an isolated browser profile with synthetic caption/provider fixtures. It makes no paid calls. Real YouTube/player/provider account checks remain a separate manual verification step. Never include test fixture profiles, screenshots or personal exports in the release ZIP.

## Multi-platform interface (1.5.0)

`lib/platform.js` owns video parsing and canonical source URLs. Existing YouTube IDs remain unchanged; a Bilibili key uses BV plus `_pN` for a non-first part. `bilibili-content.js` reads the native player, mounts controls outside its framework-owned video container, and speaks the same relay protocol. `bilibili-transcript.js` adapts WBI-signed native subtitle metadata and bounded CDN captions to the existing transcript pipeline. API/WBI primitives are reused under the included MIT license.

Content playback heartbeats run each second; side-panel rendering polls every 500 ms so saved second changes are visible without inventing time. The toolbar follow toggle and periodic relay retain video/generation checks and explicitly recenter even if the active row did not change. UI strings are translated in source, leaving original subtitles, tags and user data untouched.


## 1.6 Local original-audio ASR

`lib/local-asr.js` owns the side-panel job controls and strict result validation. Its loopback HTTP requests communicate with the separately started `local-asr/server.py`. Only video identities cross that boundary. The local worker downloads public Bilibili audio and runs MLX Whisper with `task=transcribe, language=en`; it never receives source Chinese captions as model input. Processing progress is persistent, cancellation terminates the process group, and incomplete jobs are marked failed after restart. The panel stores job IDs to resume observation without requiring the side panel to stay open.

Applying ASR validates the current video, increments digest/translation/analysis generations, clears translations derived from the old source, and stores a native subtitle backup in the same digest cache. Chinese source captions are aligned by overlapping time windows for bilingual viewing; they are never sent through a Chinese-to-Chinese translation pass. Restoring the native source invalidates the ASR-derived UI context in the same way. Closed/changed panels do not apply a stale job to another video.

### 1.6.1 播放位置定位

工具栏提供固定动作「回到播放位置」，不使用开关语义。每次读取当前活动视频的时间，验证视频和请求代际后强制定位已高亮的字幕，暂停不影响定位。缺少播放器或连接失效时提供可重试提示。定位只滚动字幕，不跳转或启动视频；手动浏览后可再次定位并恢复既有自动跟随。

## 1.7.0 上下布局

layout-worker 管理布局偏好和原生侧栏开关；layout-content 用可撤销样式定位原站播放器并创建底部跨域 iframe，支持拖动及键盘调整高度；layout-ui 让侧栏与设置页共享选择。只公开 sidepanel.html 给两个站点，其他资源由扩展页自身加载。上下学习区绑定宿主标签，不跟随其他视频标签切换。进入网页全屏时原播放器仍使用原站能力。


## 沉浸模式（1.9.0）

`lib/immersive.js` consumes the existing sidepanel `ytdPlayback` event and raw timestamped segments. It adds no playback polling or study accumulator. `layout-content.js` retains the original player DOM and embeds the extension caption UI below it; document fullscreen includes both. Lookup and collection delegate to learning-ui / existing worker endpoints. Layout preferences retain independent vertical and immersive heights. Pure cue selection/token tests and isolated browser tests cover gestures, seeking, gaps, fullscreen and return to Library.


### 1.9.1 contextual layout and bilingual queue

The panel exposes direct immersive entry and context-dependent dock positioning; the Settings selector remains compatible with saved preferences. Immersive Chinese is enabled by default. Existing/native Chinese is preferred, otherwise `translateContent` translates the exact raw cue through the established worker. A bounded 150-entry in-page queue/cache serializes requests, retains only the latest pending cue, keys entries by video/generation/cue and keeps explicit failures until retry. Chinese-only sources are not translated into purported original English.


## 1.9.2 自动原声准备

Immersive Chinese-only detection calls local-asr ensureAutomatic once per video. It awaits saved-job restoration, reuses completed/running jobs, and stores a session attempt marker to prevent repeated failure starts across iframe recreation. Progress events reuse local-asr polling; inline cancel/retry use the same controller as the full panel. Auto-applied ASR retains the native Chinese backup and existing video/generation checks.


## 1.10.0 shared transcript immersion

Immersion now shows the existing transcript pane, with its shared rendering, bilingual translation queue, scroll tracking, hover/selection capture and collection messages. The parallel single-cue renderer/queue has been removed. It adds no timers. The narrow YTD_PANEL bridge exposes transcript mode switching after ASR application. Only the sidebar exposes other panels. Legacy vertical preferences normalize to immersive; the dock retains the player DOM and resize/fullscreen handling. Sentence-row actions in immersion save the original segment text only, while sidebar row behavior remains compatible.


1.10.1 tracks the requested caption mode while Chinese-only audio is being prepared. A bilingual click invokes ensureAutomatic({retry:true}), bypassing only the prior-attempt marker while retaining running-job reuse. The existing ASR panel moves inside the sticky transcript controls in immersion, preserving all handlers and status updates. Browser regression covers scrolled failure status, language selection, explicit retry, cancellation and automatic completion.


## 1.11.0 progressive original-audio transcription

The local worker publishes atomic partial snapshots after each 30-second chunk, with revision and processedUntil metadata. Result snapshots also appear in status.json for compatibility with an already-running old server. The extension deduplicates by job/status/revision/count, validates each snapshot and keeps transcriptPartial in the existing digest cache. First application preserves native Chinese; later updates reuse the renderer without seeking/pausing the video, preserve scroll position and do not recreate study timers. Reopening a partial transcript resumes the job; completion clears the marker. Cancelled/failed jobs retain generated captions. The last unfinished segment is not highlighted beyond its timestamp range.

The first English snapshot is buffered until 20 subtitle entries are available; completed short transcripts bypass this threshold. Existing English receives later progressive updates immediately. The status exposes the initial buffer count. Tests cover 19 waiting, 20 releasing, background appends and continued actual HTMLVideoElement playback.

1.11.1 host controls overlay the same 40px toolbar row as iframe transcript controls. Only host buttons accept pointer events; the remaining header surface passes through to the iframe. Reserved inline space and narrow-screen rules prevent control overlap. No new messaging or timing paths.

1.11.2 shares host toolbar styles between content scripts and the worker. The embedded immersive extension frame requests an idempotent host-only style sync on startup, scoped to its sender tab and exact iframe URL. This repairs mixed-version hosts after reload without replacing the player or subtitle iframe. No collection or transcript data is sent.

1.11.3 extends immersive height to 10–80vh (96px minimum). Handle and thin boundary share pointer capture with relative movement, preventing initial jumps. The iframe ignores hit testing only while dragging; pointerup/cancel/lost capture clears the state and persists the ratio. Double-click or Home restores 30vh.

1.11.4 paints transient word hover with CSS Custom Highlight ranges, preserving the transcript DOM and native cross-line selection. Pointer movement paints immediately; lookup retains its 600ms debounce and generation guards. A 250ms leave grace allows movement into the floating actions, while keeping the existing bounded card placement. Drag, cancel, scroll and context changes clear the transient range. Saved confirmation stays pinned until dismissed; focus changes within the embedded iframe do not swallow action clicks.

1.11.5 routes BILI_NO_SUBTITLE to the shared local-ASR workflow through an explicit action; login/network failures retain their own errors. No native caption backup is fabricated. The first original-audio result enables bilingual mode; Chinese is generated with the configured translation service when no Chinese track exists. Worker and result validation both support up to 180 minutes; audio download is bounded to 300 MB, and decoded overlong audio is rejected rather than silently truncated.

1.11.6 preserves native cue boundaries and flushes every sentence in the default transcript segmentation. Intl.Segmenter handles sentence punctuation and abbreviations; unpunctuated oversized cues retain bounded word/clause splits without invented punctuation. Split cue timing is estimated by character offsets (not word-level audio alignment). Source captions and collections are unchanged. Translation keys use sentence-v2 plus original text to avoid reusing old paragraph translations. Native Chinese is reused only when its overlapping cues fit inside the English segment (0.5s tolerance); otherwise the existing lazy translation queue translates that English segment.

1.11.7 keeps word pronunciation, save and close actions in a persistent popup header. Lookup updates only the scrollable definition body. Early save reuses the worker’s in-flight enrichment request and shows a pending state until validated data is stored; failure re-enables save. Closing or changing words prevents stale lookup results from repainting the popup.

1.11.8 isolates bounded public audio retrieval in local-asr/audio_download.py. A local BiliBiliIE subclass preserves provider backup URLs without editing the installed dependency. Metadata is validated before download; explicit ?p= selects the part without playlist filtering. Candidate audio URLs prefer regular CDNs; at most six attempts share the same video, and partial bytes are removed between candidates. Controlled failure codes distinguish duration, size, media access and download failure without exposing signed URLs to the extension.

1.12.0: /jobs accepts an optional validated range of up to 1,200 seconds within 24 hours. Whole-video jobs retain their three-hour cap. Long-video UI creates twenty-minute ranges from the content script's actual player duration. The server validates against extractor metadata, seeks the remote audio using FFmpeg input-side seeking and decodes only the selected window. It reuses completed range jobs and permits only one active worker. Results carry absolute timestamps and a range; incremental merging replaces that range's covered portion and retains other ranges, with the existing transcript cache persisting the combined result. Selecting a range never seeks playback; untranscribed gaps never highlight unrelated captions. The ranges are study windows, not episode/chapter detection or changes to Bilibili uploads.

1.12.1 hides segment controls in immersion and restores the existing awaiting-English visibility rule for the ASR panel. Once English is available, the complete panel is hidden; range controls remain available in the sidebar. Processing and storage are unchanged.
