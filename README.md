# Video English Study — Bilibili and YouTube (1.5.0)

The entire interface and settings are Simplified Chinese. Bilibili native captions require no Supadata key; English tracks are preferred, and missing captions or login requirements are explicit. Part numbers remain distinct in caches, collections, sessions and DOCX links. YouTube support and existing stored data remain compatible.

A persistent follow-playback toggle immediately recenters the current caption after manual scrolling. Study time displays minutes and seconds with one-second updates, without counting background or paused-study time.

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

## Study and review

Start Study manually with a duration (default 20 minutes), word goal (5) and sentence goal (2). Goals can be zero. Each session belongs to one video and tab. Switching videos pauses it; resume on its original video or end it and start another session.

Reduce distractions is on by default: recommendation/comment/end-screen surfaces are hidden and automatic continuation is interrupted. Exiting restores the extension's page changes. This is voluntary assistance, not a parental lock or proof of attention.

Foreground watching uses elapsed real time, not media progress. Playback speed and seeks do not multiply time; buffering, background tabs, unfocused windows, missing heartbeats and offline intervals do not count. Paused transcript/library activity counts only with a live panel and interaction in the last 60 seconds. Watching and activity do not overlap. At the target duration, video pauses and you may review, finish or add five minutes. Paused/finished sessions do not resume playback automatically.

Review reveals the English first, then the answer. Mark **记住了** or **还要复习**; these are self-assessments, not grades. New collection IDs from the current session come first; if none exist, the app explicitly offers the current video's existing collection. No collection means no fabricated exercise. Today's totals and seven local calendar days are shown; session history is retained locally for 90 days. Service-worker restarts conservatively discard the unconfirmed interval rather than adding offline time. Review time is separate from the learning duration.

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
