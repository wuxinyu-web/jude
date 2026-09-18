# Project guide

句得 is a plain HTML/CSS/JavaScript Manifest V3 extension. Runtime files and the pinned Word browser library are checked in; no application build step is needed to load it.

## Boundaries

- User-approved Study and sentence features replace Ask and web search. Do not restore retired request handlers, host permissions or keys.
- Bilibili uses native site subtitles first with explicit login/no-subtitle failures; local original-audio transcription is available through the paired loopback service. User-authorized automatic local ASR starts when entering immersion with Chinese-only Bilibili captions; retain visible progress/cancel/retry, reuse jobs, and never loop-retry failures. Never translate Chinese captions and label the result as original English audio. YouTube Supadata native mode is always first; audio generation requires an explicit user confirmation after no native transcript. Never call paid providers in automated tests.
- Keep original Notes and Vocabulary schema/IDs; keep the 500-entry vocabulary cap and separate 500-entry sentence cap. Never silently evict collections.
- Source sentences are durable before AI analysis; failures remain retryable. Deletion/manual tag edits must survive in-flight completions.
- All provider output is untrusted bounded plain text. Prompts treat transcript/metadata as quoted data, not instructions. Never put real secrets in source, fixtures, logs, exports or packages.
- New learning/data APIs are extension-page only. Study pulses use the sending tab and authoritative active-window checks. Do not credit background, buffering, offline, sleep or restart gaps.
- Overview quote notes preserve displayed language through saveOverviewNote, not transcript-note cleanup.
- Transcript search stays literal, bounded and compatible with Vocabulary highlights. It must not seek video playback.
- Transcript reading position remains in chrome.storage.session, up to 20 videos; never restore another video's state.
- Resolve content from the active supported video tab only. No background fallback.
- Pronunciation uses local system voices. No remote speech service.
- Keep README.md, README.zh-CN.md, PRIVACY.md, SECURITY.md, docs/ARCHITECTURE.md and prompt contracts consistent with behavior.

- Chinese interface text must not alter original English transcript or user-authored content.
- Platform identities and exported links must retain the Bilibili part number.

## Checks

Run npm test, npm run check and npm run package. Browser integration tests use an isolated profile and no live provider calls. Separately verify real captioned videos. Render generated DOCX samples and inspect every page before claiming print layout is verified.
