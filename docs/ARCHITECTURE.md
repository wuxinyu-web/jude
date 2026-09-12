# Study extension architecture

## Existing pipeline

The extension keeps its plain JavaScript Manifest V3 architecture. background.js owns provider transport and existing transcript, Overview, translation, Notes and Vocabulary behavior. sidepanel.js retains reading, highlighting and video reconciliation. settings.js fixes the DeepSeek endpoint/model; keys remain local. Supadata native mode is always first and audio generation requires explicit confirmation.

## Learning modules and messages

lib/learning-core.js contains pure source validation, English lexical boundaries, sentence analysis validation, filtering/grouping, preferences and real-time accounting. lib/learning-worker.js owns serialized local mutations and limited provider concurrency. Its createServices factory accepts storage/AI/clock/environment adapters for deterministic tests.

Extension-page messages: lookupVocabulary, getLearningLibrary, saveSentence, analyzeSentence, editSentence, deleteSentence, markReview, setLearningPreferences, getStudy, studyCommand, studyPanelActivity. Content scripts can only use the separately authenticated studyPulse action. Responses have success plus result fields or an error. Keys never travel to content scripts.

Vocabulary retains ytd_vocabulary and its 500-entry schema/cap. New ytd_sentences holds up to 500 source-first records with source context, translationZh, mainClause, breakdown, grammarTags, expressionTags, analysisStatus/revision and tagsEdited. ytd_reviews maps entry IDs to known/again and reviewedAt. ytd_learning_preferences stores library filters and session defaults. Existing longer vocabulary entries remain untouched. AI completion updates re-read the current record and honor its revision/manual-label flag.

Word lookup cache keys include normalized word, video and context; at most 200 entries / 30 minutes, two active requests, deduplicated in flight. Sentence analysis has a separate two-request cap. Neither collection silently evicts entries. Analysis begins explicitly after the durable source save; a lost worker leaves a recoverable pending source.

## Study accounting

ytd_study holds currentId and sessions. A session binds videoId/tabId/windowId, targetMs, goals, state, accumulated watchMs/activityMs/reviewMs, collection IDs, daily buckets and lastSample. States: running, paused, due, review, ended. Only explicit resume/extend starts accounting again; playback itself is not automatically resumed. A changed video or video end pauses a running session.

lib/study-content.js samples every two seconds and on playback/visibility transitions. The worker verifies the tab and focused window using Chrome APIs. Samples must be consecutive, at most six seconds apart, in the same accounting mode and worker boot. Missing/restarted intervals are discarded. Watching requires a visible, playing, ready video without seeking. Operation/review credit additionally requires a live panel heartbeat and interaction within 60 seconds. Categories never overlap; watching/activity stop exactly at the target. Cross-midnight credit is split by local date. Seven-day totals are calculated from daily buckets; noncurrent sessions older than 90 days are pruned when starting/updating sessions.

A reversible html attribute activates distraction CSS. Play/ended listeners interrupt automatic continuation while the mode is active, without persisting YouTube autoplay preferences. The control UI always permits exiting. This measures behavior, not attention or attainment.

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
