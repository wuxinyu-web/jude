## 1.9.0: Immersive captions

Choose 沉浸模式 in Layout for a large player and a compact, synchronized caption strip. Click a word for lookup, hold for 600 ms to save it, or click ☆ to save the sentence. Moving more than 8 px cancels a hold. Interactions keep the current cue visible; 跟上播放 resumes synchronization. Fullscreen includes both the player and captions; Escape exits. Resize the separator or return to 完整字幕 / 收藏库 at any time.

This reuses the existing transcript, lookup, collection and study services. The Chinese toggle only shows prepared translations; no new provider request occurs merely by entering this mode. Timing accuracy follows the source timestamps.

1.8.0 adds practice-based study goals, mutually exclusive timing, explicit continuation, summaries and local record management.

> 1.7.0：新增「布局」选择，支持左右侧栏或上下学习区。上下布局保持视频在上，学习区在下，拖动分隔线可调整高度；布局和高度保存在本机，关闭学习区恢复原网页。

> 1.6.1：字幕工具栏改为「回到播放位置」，每次点击读取当前视频时间并定位，暂停时也可用；定位失败会提示刷新视频页面。

## 1.6.0: Local original-audio ASR

Bilibili now offers explicit local Whisper transcription of English audio. Chinese source captions are never back-translated and presented as original dialogue. A paired Apple Silicon companion service is required; see [local-asr/README.md](local-asr/README.md). English ASR retains original Chinese captions for time-aligned comparison and can be reverted. Audio stays on the Mac; recognition can still make mistakes.

# Video English Study — Bilibili and YouTube (1.5.0)

The entire interface and settings are Simplified Chinese. Bilibili native captions require no Supadata key; English tracks are preferred, and missing captions or login requirements are explicit. Part numbers remain distinct in caches, collections, sessions and DOCX links. YouTube support and existing stored data remain compatible.

The return-to-playback-position button immediately recenters the current caption after manual scrolling. Study time displays minutes and seconds with one-second updates, without counting background or paused-study time.

## Install and update

Use Chrome 116 or newer. At `chrome://extensions`, enable Developer mode and choose **Load unpacked**. Select this exact directory containing `manifest.json`, or unzip the release package into a permanent folder and select that folder. Do not select its parent or the ZIP file. Keep that folder in place.

Use a separate Chrome profile for the development build. The daily-use extension and its data remain untouched. A separate extension/profile has separate storage: enter your own keys directly in its Settings page. No keys or personal data are copied automatically. Existing Notes and Vocabulary records in this extension's own storage retain their schema and IDs.

After changes, reload the extension and refresh open YouTube watch pages. The active YouTube tab only supplies video context. A background YouTube tab cannot replace it.

## Provider setup

Enter Supadata and DeepSeek API keys in Settings. Supadata retrieves native captions first; audio transcription is requested only after an explicit confirmation when native captions are unavailable. DeepSeek V4 Flash handles translation, overviews, explanations, notes, word lookup and sentence analysis. No developer server or analytics is used.

Create/manage keys at [Supadata](https://dash.supadata.ai/) and [DeepSeek](https://platform.deepseek.com/api_keys). Provider usage can incur charges; see [Supadata pricing](https://supadata.ai/pricing) and [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing). Hover lookup calls DeepSeek after the dwell delay; successful lookups are cached by word and context in worker memory for up to 30 minutes. Exporting Word and flipping review cards do not call an AI service. Never put keys in chat, source files or screenshots.

## Collect and organize

- In Transcript, hover over an English word for 600 ms to see its contextual meaning and IPA. Click **收藏单词** to save. Moving across words does not automatically collect them. Pronunciation uses local system voices.
- Select English text, including adjacent subtitle rows, and choose **收藏长难句**. The exact source is saved first; Chinese translation, main clause, breakdown and tags are generated afterward. A failure keeps the source and offers retry. **解释** and saving a word/phrase remain available.
- Collection works on the English original in Original and bilingual mode, not the Chinese translation or YouTube's overlaid captions.
- Library contains Vocabulary, Sentences and Notes. Search words/sentences, filter this video/all videos and review state, sort by collection time or English A–Z. Video order is available within one video. Sentence tags support grammar and expression categories independently; edit them when AI classification is inaccurate.
- Grouping may show a sentence in multiple groups. Word export deduplicates IDs. Vocabulary and Sentences each allow 500 entries; capacity errors never silently evict your collection. Old longer Vocabulary entries are not automatically reclassified.

## Study and review (1.8.0)

Study tasks default to 20 effective minutes, five distinct practiced words and two distinct practiced sentences. Word/sentence goals can be zero. Scope is the current video; this project has no segment selector. Sticky controls show task state separately from the current accounting reason, cumulative/remaining time, progress and pause/resume/end actions.

Collection is not practice. Only a submitted self-assessment (known, unsure, again) advances distinct-item goals. Opening a card or revealing its answer does not. Existing cards for this video can be reused, and repeated assessments update the pending-review state without duplicating progress. A single assessment never implies mastery.

Effective time sums mutually exclusive active review, subtitle/word operation and foreground watching, in that priority order. Operation/review expire after 60 seconds without meaningful interaction. Ordinary pointer movement is excluded. Watching requires visible, focused, playing, nonbuffering playback. Playback rate does not multiply time; seeks, offline, background, manual pause and missing heartbeats do not add credit. Reaching the time goal prompts a choice without pausing playback or capping subsequent time. All three goals must be reached before the task claims success.

Panel reopening, refresh, changed video and worker restart preserve progress but require explicit resume, without offline credit. Resume may rebind to the foreground tab showing the same video and restore saved playback position without autoplay. Ended tasks can also be continued. Summary shows real timing distribution, practiced counts, pending review and each target result. Seven-day bars have daily details; empty history shows guidance.

Records are local, versioned and retained for 90 days. Learning and Settings provide JSON export and confirmed record clearing; collections, notes and library self-assessments remain intact. Legacy records retain their timing and collection fields but gain no invented practice results.

## Print Word

Library's **下载 Word** exports current filtered results or checked items, optionally combining vocabulary and sentences. Each type retains its applicable filters and ordering. The dialog shows the final item count before generation.

Choose a teaching handout with meanings/analysis, or a self-test worksheet with writing space and a separate answer section. Both are real `.docx` files, A4 portrait, black and white, with source titles/timestamps/links and page numbers. Unfinished analysis is labeled. The bundled docx 9.6.1 library generates the file on-device; no upload or remote script is involved.

## Existing reading behavior

Transcript search remains literal with previous/next match navigation, not regular expressions. Reading position for the current video is kept in session storage for up to 20 videos and disappears when the browser session ends. Overview and original Notes remain available. Ask and its optional web-search provider have been removed; obsolete provider credentials and suggestion cache fields are cleared on startup.

## Development and checks

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run package
```

The extension has no application build step. Runtime modules and the browser Word library are included. `npm run vendor:docx` refreshes the vendored UMD from the exact locked docx dependency. `npm run test:browser` runs the isolated Chrome extension integration fixture; first install its browser with `npx playwright install chromium --no-shell`. Set `PLAYWRIGHT_BROWSERS_PATH` if using a custom browser cache. Test fixtures never call paid providers.

Automated tests do not prove Supadata/DeepSeek account availability. Separately test a public captioned video with your own keys after loading the extension. Model output and grammar tags may be imperfect. Screenshots, browser fixtures and sample exports belong in ignored work directories, not release packages.

MIT; original project copyright and license retained. See `PRIVACY.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, and the bundled library's `vendor/docx.LICENSE`.
