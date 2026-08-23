# YouTube Digest

[English](README.md) | [简体中文](README.zh-CN.md)

Turn every YouTube video into a resource for deep learning. YouTube Digest brings transcripts, bilingual translation, AI overviews, explanations, video-grounded questions, timestamped notes, and vocabulary study into one Chrome side panel, so you can study ideas and language without losing your place.

- Turn captions into a readable, searchable learning resource.
- Learn languages with the original transcript, a Simplified Chinese translation, or an aligned bilingual view.
- Build understanding with a full-video summary, AI chapters, key quotes, and selected-text explanations.
- Navigate long videos by clicking timestamps in the transcript, overview, or notes.
- Ask follow-up questions about the current video, with optional web search when you choose it.
- Save polished timestamped notes and a reusable vocabulary notebook for later study.
- Keep control of your data with your own API keys, local Chrome storage, and no analytics or telemetry.

YouTube Digest is a bring-your-own-key project installed locally from GitHub. It is not available through the Chrome Web Store, does not include API credits, and does not run a developer-operated server.

## Install with your coding agent

You do not need to understand the code or use the command line. Send this message to your coding agent:

> Download or clone this project into a permanent folder I choose, tell me its exact full path, and use that same folder for Chrome's Load unpacked step. If I need a suggestion during this first installation, offer `~/Documents/youtube-digest` on macOS or Linux, or `%USERPROFILE%\Documents\youtube-digest` on Windows, but do not assume either path. Walk me through installation and setup in simple terms. https://github.com/JackChen1220/youtube-digest

Your agent should:

1. Ask where you want to keep the project, download or clone it there, and tell you the exact full path. If you want a suggestion, it can offer `~/Documents/youtube-digest` on macOS or Linux, or `%USERPROFILE%\Documents\youtube-digest` on Windows.
2. Open the official Supadata and DeepSeek pages below and help you create your own accounts. Tavily is optional and is needed only for Ask web search.
3. Walk you through selecting the exact project folder you chose in Chrome with **Load unpacked**.
4. Show you where to enter your API keys in the extension's **Settings** page.
5. Open a YouTube video with captions and confirm the transcript and translation work.

Keep this folder in the same place after installation. If you move or delete it, Chrome's unpacked extension stops working until you load the extension again from its new permanent folder.

Never paste an API key into an AI chat, source file, screenshot, or public message. Enter keys yourself, directly in the YouTube Digest Settings page. Your coding agent can point to the correct field without seeing the key.

## Install manually

If you prefer to do it yourself:

1. Open [github.com/JackChen1220/youtube-digest](https://github.com/JackChen1220/youtube-digest).
2. Choose **Code**, then **Download ZIP**.
3. Choose a permanent folder and unzip the project there. Optional suggestions are `~/Documents/youtube-digest` on macOS or Linux, or `%USERPROFILE%\Documents\youtube-digest` on Windows. You may use a different folder.
4. In Chrome, open `chrome://extensions`.
5. Turn on **Developer mode**.
6. Click **Load unpacked**.
7. Select the exact project folder you chose, which must contain `manifest.json`.
8. Pin YouTube Digest from Chrome's Extensions menu if you want quick access.

Because this is an unpacked extension, it does not update automatically. After downloading an update or changing local files, click **Reload** on the YouTube Digest card at `chrome://extensions`, then refresh open YouTube tabs. Moving or deleting the source folder breaks the unpacked extension until you load it again from the new location.

## Set up your API keys

YouTube Digest needs two keys under your own provider accounts, plus one optional key:

1. A **Supadata API key** to retrieve YouTube transcripts.
2. A **DeepSeek API key** for overviews, explanations, Ask, translation, vocabulary enrichment, and automatic note polishing.
3. An optional **Tavily API key** for Ask web search. Video-only Ask does not require Tavily.

### Get a Supadata API key

1. Open the official [Supadata sign-up page](https://dash.supadata.ai/auth/sign-up).
2. Create an account and complete the short onboarding flow.
3. Supadata generates an API key automatically during onboarding.
4. Open the [Supadata dashboard](https://dash.supadata.ai/) whenever you need to find or manage the key.
5. Copy the key and paste it into **Supadata API key** in YouTube Digest Settings.

See the [official Supadata documentation](https://docs.supadata.ai/) if the dashboard flow changes.

### Get a DeepSeek API key

1. Open the official [DeepSeek API Keys page](https://platform.deepseek.com/api_keys).
2. Sign in or create a DeepSeek Platform account when prompted.
3. Choose **Create new API key**, give it a recognizable name such as `YouTube Digest`, and create it.
4. Copy the key immediately. The full key may only be shown once.
5. Paste it into **DeepSeek API key** in YouTube Digest Settings.
6. If DeepSeek reports insufficient balance, add credit in your DeepSeek Platform account and try again.

See the [official DeepSeek API documentation](https://api-docs.deepseek.com/) for current account and API details.

### Get an optional Tavily API key

1. Open the official [Tavily dashboard](https://app.tavily.com/home).
2. Create an account and copy an API key from your Tavily account.
3. Paste it into **Tavily API key** in YouTube Digest Settings.

Tavily remains bring-your-own-key and optional. Leave this field empty if you only want questions grounded in the current video. See the [Tavily API introduction](https://docs.tavily.com/documentation/api-reference/introduction), [credit documentation](https://docs.tavily.com/documentation/api-credits), and [privacy policy](https://tavily.com/privacy) before enabling web search.

Open **Settings** from the side panel. You can also open the YouTube Digest **Options** page from its card at `chrome://extensions` or by right-clicking its toolbar icon. Paste keys only into these Settings fields. Never paste a key into an AI chat, repository file, screenshot, or public message.

The published version supports DeepSeek V4 Flash as its only AI provider:

```text
Base URL: https://api.deepseek.com
Model: deepseek-v4-flash
```

YouTube Digest sends every DeepSeek request in non-thinking mode for responsive, predictable interactions. The endpoint and model are fixed in Settings, so the only AI credential you enter is your DeepSeek API key. To use another provider or model, copy the safe customization prompt in Settings and give it to a coding agent for your local copy. Never add an API key to that prompt or chat.

Keys and settings are stored in Chrome's local extension storage on your device. Release builds do not include or use `config.js`.

## Use YouTube Digest

1. Open a standard YouTube watch page.
2. Click the YouTube Digest extension icon to open the side panel.
3. Use the four top tabs: **Transcript**, **Overview**, **Library**, and **Ask**.
4. Read the timestamped transcript, or choose **Original**, **中文**, or **双语**.
5. Open **Overview** for a full-video summary, chapters, and key quotes in **Original**, **中文**, or **双语**.
6. Select transcript text and choose **Explain**. Its explanation can be shown in **English**, **中文**, or **双语** without changing the selected source text.
7. Open **Library** and switch between **Notes** and **Vocabulary**. Overview quote notes preserve the language displayed when you save them.
8. Open **Ask** for current-video questions, suggested prompts, summaries, recommendations, or a quiz.

## Current capabilities

- Google Chrome 116 or newer, using the Side Panel API.
- Standard `youtube.com/watch` video pages.
- Native subtitle tracks returned by Supadata. YouTube Digest prefers English when available, but may show another native language.
- User-confirmed AI transcription from video audio when no native subtitle track exists.
- Original, Simplified Chinese, and aligned bilingual transcript views.
- AI overviews with full-video summaries, selected-text explanations in English, Chinese, or bilingual form, translation, Ask, vocabulary enrichment, and automatic transcript-note polishing.
- A Library with local Notes and Vocabulary views, plus a local cache for recent transcript and digest results.
- Current-video multi-turn Ask with three video-specific suggestions and optional user-controlled Tavily web search.
- DeepSeek V4 Flash for all published AI features. Other providers require a local code adaptation and are not supported by this published version.

Shorts, live streams, private or access-restricted videos may not work. Firefox, Safari, mobile browsers, and other Chromium browsers are not currently tested or supported.

YouTube Digest always tries Supadata's `mode=native` first. If no native subtitle track exists, it offers **Generate transcript from audio**. The paid `mode=generate` request is sent only after you click the button and confirm the estimated credit use. Canceling the confirmation sends no generation request. YouTube Digest does not perform local audio transcription.

### Library and Vocabulary behavior

Library contains separate **Notes** and **Vocabulary** views. A vocabulary entry stores the selected text, a Chinese meaning and contextual explanation, source context, video title, and timestamp. For a short English word or phrase, DeepSeek may also generate IPA; for a short Chinese entry, it may generate pinyin. AI-generated phonetic text may be imperfect, and longer selections intentionally omit it. The local vocabulary collection is limited to up to 500 entries.

Saved vocabulary is highlighted on matching transcript text across all videos, including the current and future videos. Highlight matching is deliberately exact and bounded so saved text cannot become executable markup or an unsafe pattern. The pronunciation button uses a local Chrome or system voice. For English, it prefers the installed local Samantha voice (`en-US`); if Samantha is unavailable, it uses the normal automatic voice ranking. Speech playback does not send or store audio, but the installed voice and pronunciation quality vary by device.

### Ask behavior

Ask is multi-turn only for the current video. The recent conversation is held in panel memory, is not persisted, and clears when you switch videos or close the panel. Exactly three generated suggested questions are cached locally for the video. The answer language follows the latest question.

The **Web** toggle is off by default. Normal questions do not contact Tavily while Web is off. Choosing **Recommend related content** turns Web on for that request. If Tavily is unavailable, its key is missing, or search fails, Ask degrades to a video-only answer instead of blocking the conversation.

## Supadata free tier and request costs

Current as of August 9, 2026, the [Supadata pricing page](https://supadata.ai/pricing) lists a free tier with **100 credits per month**, no credit card required. Unused credits do not roll over. Supadata pricing can change, so check the current page before relying on these numbers.

The [Supadata transcript documentation](https://docs.supadata.ai/get-transcript) describes the transcript request modes and credit behavior:

- A native transcript request uses **1 credit**, regardless of video duration.
- A generated transcript costs **2 credits per video minute**. YouTube Digest uses this path only after explicit user confirmation.
- An unavailable native lookup returned as HTTP `206` still uses **1 credit**.

Native lookups can cover roughly 100 transcript requests per month when each request succeeds once. Retries, unavailable-caption lookups, and optional generated transcripts consume credits, so actual successful-video coverage can be lower.

DeepSeek usage is separate from Supadata. DeepSeek may apply its own free quota, rate limits, or charges. YouTube Digest does not collect payments or resell access. Set spending limits and monitor both accounts. The estimate below explains the current DeepSeek translation cost.

## Optional Tavily web search and costs

When you explicitly turn on Ask **Web**, the extension derives a search query from the current video title, your question, and available overview, then sends that query directly to `https://api.tavily.com` with your Tavily API key. It uses basic search with a maximum 5 results and requests no Tavily answer and no raw content. Only validated source URLs are passed to the answer flow and shown as links. Web material supplements the video transcript; it does not replace it.

Current as of August 23, 2026, Tavily's official [credit documentation](https://docs.tavily.com/documentation/api-credits) lists **1,000 credits per month** for the free account. Basic search uses **1 credit**, while Advanced search uses **2 credits**. YouTube Digest uses Basic search, so one enabled search normally uses one Tavily credit. Pricing can change; confirm the current [API documentation](https://docs.tavily.com/documentation/api-reference/introduction) before relying on these numbers. Tavily is optional, uses your own key from the [Tavily dashboard](https://app.tavily.com/home), and processes searches under the [Tavily privacy policy](https://tavily.com/privacy).

## DeepSeek V4 Flash translation cost estimate

Current as of August 10, 2026, DeepSeek lists the following prices per 1 million tokens on its official [pricing page](https://api-docs.deepseek.com/quick_start/pricing/):

- Cache-hit input: **$0.0028 USD**.
- Cache-miss input: **$0.14 USD**.
- Output: **$0.28 USD**.

DeepSeek says these prices may increase soon, so check the current pricing page before relying on this estimate. Its official [token usage guide](https://api-docs.deepseek.com/quick_start/token_usage/) estimates about 0.3 token per English character and about 0.6 token per Chinese character. Its [context caching guide](https://api-docs.deepseek.com/guides/kv_cache/) explains the automatic best-effort disk cache used for repeated prefixes.

A measured 20-minute English talk contained **2,935 spoken English words** and 15,433 transcript characters. With YouTube Digest's current grouping, it became 128 semantic segments and 43 requests of three segments each. Repeated prompts and JSON brought the rendered input to about 108,528 English characters, or **about 32,600 input tokens** using DeepSeek's 0.3 token per English character heuristic. The translated Chinese JSON output is estimated at about 3,500 to 4,500 tokens using the 0.6 token per Chinese character heuristic, plus JSON and ID overhead.

If all input is billed as cache miss, input costs about $0.0046 and output costs about $0.0010 to $0.0013, for a total of about $0.0056 to $0.0059. When much of the repeated system prompt hits DeepSeek's automatic best-effort cache, a realistic lower end is about $0.002 to $0.003. A practical estimate for fully translating this talk is therefore **$0.002 to $0.006 USD, about ¥0.02 to ¥0.04**.

Translation is lazy and progressive. Cached segments are reused, and only rows you request by scrolling into them incur calls. Retries, provider behavior, and pricing changes can increase the final cost.

## Remix it with your coding agent

This is a personal remix project. Upstream issues and pull requests are not accepted. If something breaks or you want a new feature, download or fork your own copy and ask your coding agent to fix, remix, or personalize it for you.

YouTube Digest uses plain HTML, CSS, and JavaScript with no build step, so it is a friendly starting point for agent-assisted projects. Ideas to try:

- Add more translation languages and let each person choose a learning language.
- Create customized summary templates for lectures, interviews, tutorials, reviews, or research talks.
- Add spaced repetition, tags, or custom review schedules to the vocabulary notebook.
- Export notes and vocabulary to Markdown, CSV, Anki, or another study tool.
- Add personal topic filters that highlight the chapters most relevant to a goal.
- Add optional local-model support for a different privacy and cost tradeoff.
- Improve accessibility with keyboard navigation, font controls, and higher-contrast themes.

Ask your agent to preserve the bring-your-own-key model, keep secrets out of source files, run the checks below, and test the remix on real videos.

If you want another AI provider or model, first open the exact YouTube Digest project folder that Chrome loaded through **Load unpacked** in your coding agent. Then open YouTube Digest Settings and use **Copy customization prompt**. Replace the `[PROVIDER]` and `[MODEL]` placeholders before sending it. Do not include any API key in the prompt or chat. After the agent updates your local copy, enter the key yourself in the Settings field it identifies.

## Privacy and data flow

YouTube Digest makes provider requests directly from the extension:

1. It sends a canonical YouTube watch URL to Supadata to request the native transcript. If none exists, Supadata processes the video's audio only after you choose **Generate transcript from audio** and confirm the estimated credit use.
2. It sends transcript and metadata to DeepSeek for Overview and Ask. Ask includes only bounded recent conversation history. Explain and Vocabulary send selected text and nearby context; translation sends the requested content.
3. When Ask Web is on, it sends a query derived from the title, question, and available overview directly to Tavily. Web is off by default and no Tavily request occurs while it stays off.
4. It stores keys, settings, notes, vocabulary, exactly three cached suggested questions per video, and recent cache entries locally in Chrome. Ask conversation history is not persisted.
5. Vocabulary speech uses local Chrome or system voices and does not send or store audio.

There is no YouTube Digest account system, advertising, analytics, or telemetry. Supadata, DeepSeek, and optional Tavily requests are made under each provider's terms and privacy policy. See [PRIVACY.md](PRIVACY.md) for details.

## Troubleshooting

### The Digest button is missing on a YouTube video

- At `chrome://extensions`, find YouTube Digest and click **Reload**, then refresh the YouTube tab.
- Confirm that you are on a standard `https://www.youtube.com/watch?...` page, not a Short, embed, or live page.
- The current version automatically follows YouTube when its responsive action bar changes. Wait a moment after the page finishes loading.
- If you have an older downloaded copy, resizing the YouTube window horizontally once may reveal the button. Then download the latest version so resizing is no longer required.
- If it is still missing, ask your coding agent to inspect the content script on that exact video page.

### The side panel does not open

- Confirm that you are on a standard `https://www.youtube.com/watch?...` page.
- At `chrome://extensions`, confirm YouTube Digest is enabled and click **Reload**.
- Refresh the YouTube tab after reloading the extension.
- Ask your coding agent to inspect the extension if the problem continues.

### YouTube Digest asks for setup

- Open **Settings** and save both a Supadata key and a DeepSeek key. Add a Tavily key only if you want Ask web search.
- This published version uses the fixed DeepSeek V4 Flash endpoint and model. There are no Base URL or Model fields to configure.
- If Settings says a legacy custom provider was removed, enter a DeepSeek key. The old AI key was cleared so it could not be reused with the wrong service.

### No transcript is found

- Confirm the video is public and accessible to Supadata.
- Check your Supadata key, remaining credits, rate limit, and account status.
- Remember that unavailable native lookups and manual retries may still consume credits.
- If the video has no native captions, choose **Generate transcript from audio** and review the estimated cost. The request is sent only after you confirm, and the generated result is cached locally for reuse.

YouTube Digest never starts paid audio transcription automatically.

### AI requests fail

- A `401` or `403` usually means the DeepSeek key or account access is invalid.
- A `429` usually means a DeepSeek rate or spending limit was reached.
- Confirm the key was created in the DeepSeek Platform account linked above and that the account has available credit.
- If you adapted a local copy for another model, use the Settings customization prompt again and ask your coding agent to inspect that local implementation.
- If only Web search fails, check the optional Tavily key and credits. Ask should continue with a video-only answer.

Never share API keys, private transcripts, or personal notes in chats, screenshots, or logs.

## Checks for coding agents

Ask your coding agent to run these commands after changing the project:

```bash
npm test
npm run check
npm run package
```

The agent should also reload the unpacked extension in Chrome and test several real YouTube videos. Automated checks do not prove that live provider requests and YouTube interactions work.

## License

MIT. See [LICENSE](LICENSE).
