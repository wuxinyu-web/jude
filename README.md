点击字幕立即按该行英文顶部定位，中文紧跟在下方，不等待播放高亮刷新。

点击字幕快进成功后，自动滚动到该句并恢复播放跟随；跳转期间手动滚动则保留浏览位置。

沉浸模式跟随播放时，当前台词在工具栏下方顶部对齐，避免露出上一句译文。

收藏句子后自动回到当前播放台词；手动滚动字幕时保留浏览位置，点击“回到播放位置”恢复跟随。

1.12.1：沉浸模式隐藏片段选择器，英文字幕就绪后收起整个转写控制和完成提示区；分段控制保留在左右布局侧栏。

1.12.0：超过 3 小时的长分 P 自动划分为每段 20 分钟的学习片段（原视频不变，最多 24 小时）。从当前播放位置选择片段，只读取该段音频；可选前后片段并点击「转写本段」。已完成片段复用，字幕以原视频绝对时间合并、缓存，不覆盖其他片段。

1.11.8：本机原声下载优先常规 CDN，连接失败时尝试 B 站提供的备用地址；时长超限、音轨不可读和下载失败分别提示。超过 3 小时的合集需选择单集或较短的分 P，不会通过重试绕过限制。

1.11.7：查词浮卡右上角常驻「发音、收藏单词、关闭」，加载和失败时仍可操作。可立即发音或发起收藏；收藏中显示进度，释义成功后保存，失败可重试。

1.11.6：字幕按句子分行，短句不再拼接；缺少标点时保留原字幕段，过长的单段按短语／词边界拆开。每段英文下方配对应中文，无法精确对齐的原站中文改用现有 AI 逐段翻译。沉浸英文最大字号由 24px 缩至 20px。

1.11.5：无字幕轨的 B 站视频可点击「从英文原声生成字幕」，本机转写后自动显示中英双语；单次支持 3 小时、300 MB 以内音频。需要本地服务运行及可公开读取的英文音轨。

1.11.4：英文单词鼠标悬停立即高亮，停留 600 毫秒显示释义与收藏。拖选句子（包括跨行长难句）后，可收藏句子、解释或收藏词／短语。浮卡沿用原有定位，移入浮卡不会立即消失，点击后保留收藏成功状态。

1.11.3：沉浸区支持更自由的上下拖动（字幕约占屏幕 10%–80%，保留最小可读高度）。可拖中间手柄或视频与字幕之间的分界线，拖动跨过字幕时不会丢失；松手记住比例，双击恢复默认。仍是一行工具栏。

1.11.2：修复更新后外层旧工具栏与新版字幕区混用导致仍有两行的问题。沉浸字幕区打开时同步外层为单行，不重建播放器、不丢失字幕阅读位置。

1.11.1：沉浸工具栏合并为一行（约 40px），全屏、语言切换、拖动柄、返回侧栏、播放定位与关闭共享同一行。窄窗口缩短定位文案并保留可访问名称。

## 1.11.0：边看边转写

本地原声转写按约 30 秒音频分批发布结果，扩展先缓冲 20 句（按字幕条目计），达到后显示英文与中文对照，后续收到新结果持续补充，不再等待整集结束。不足 20 句的短视频在完成时直接显示。视频保持播放，进度说明已处理的位置；未生成部分不会伪造英文。暂停／取消后已生成字幕保留，刷新学习区可恢复任务。首次仍需下载和解码音频，识别速度取决于本机性能，不保证逐句实时。

扩展重新加载后生效；新启动的本地转写任务使用更新后的分段输出。旧的运行中任务仍按启动时的代码处理，不会被自动中断。

## 1.10.1：修复中文字幕下的语言按钮

只有中文字幕时，「中文」保持正确选中；点击「双语」直接准备或重试英文原声，不再无提示切回原文。沉浸区的原声转写状态、进度、取消与重试固定在字幕工具栏内，滚动后依然可见。完成后仍显示真实英文与原站中文，不把反译结果当作原声。

## 1.10.0：只有左右布局和字幕沉浸

右侧保留完整功能，点击顶部 ↙ 箭头把字幕放到视频下方；下方点击 ↗ 返回右侧。移除独立的复杂上下学习区，旧上下布局偏好自动转为字幕沉浸。

下方直接复用右侧字幕列表，默认双语，可切换原文／中文／双语、滚轮浏览前后字幕、定位当前播放句。鼠标悬停单词 600 毫秒可查义并收藏；悬停字幕行显示「收藏句子」，保存英文原文至句子库；划选仍可收藏词、短语或长难句。其他功能只在左右布局展示。

拖动视频与字幕的分隔线调节高度（键盘方向键也可用）。「全屏」让视频与字幕一起全屏。只有中文的 B 站视频继续自动准备真实英文原声，过程中可取消／重试，完成后自动双语。

## 1.9.2：沉浸模式自动准备英文原声

进入沉浸模式后，B 站视频若只有中文字幕，会自动连接本机转写服务，优先恢复已有任务或使用完成结果；没有任务时才开始转写。台词区显示进度，可直接取消或重试，完成后自动切换英文与原站中文对照。服务不可用会明确提示；失败或取消后当前浏览器会话不自动反复重试。不把中文反译成英文原声，不自动调用云端转写。需安装并启动本地服务，说明见 local-asr/README.md。

## 1.9.1: Direct controls and automatic bilingual immersion

Click 专心看 to enlarge the player and show synchronized English / Chinese captions. 展开字幕 returns to the full workspace; contextual 放到下方 / 收至右侧 buttons move it without a three-mode picker. Settings retain the default layout preference. Resize and fullscreen still include the captions.

Chinese appears by default, preferring native captions or prepared translations. Missing Chinese is translated through the configured DeepSeek service, one current-cue request at a time; only the latest queued cue is retained after seeking. Failures offer retry. The 双语 / 英文 button temporarily hides or reveals Chinese. Chinese-only sources still require explicit original-audio transcription and are never back-translated as original dialogue.

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
