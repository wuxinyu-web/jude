# Privacy

This development extension has no developer-operated server, accounts, analytics or telemetry.

## Network requests

Supadata receives a canonical YouTube watch URL for native subtitles. Audio transcription is requested only after the user explicitly confirms generation when native subtitles are unavailable. DeepSeek receives bounded transcript/context data for translation, Overview, explanations, note cleanup, hover vocabulary lookup and sentence analysis. Keys are sent only to their configured fixed provider endpoints. Hover lookup is automatic after 600 ms of dwell, but saving is explicit. Up to two word lookups and two sentence analyses can be in flight. Successful word/context results stay in worker memory for at most 30 minutes, at most 200 entries.

Ask and external web search are not available. Old search credentials and suggestion-cache fields are removed at startup. No learning records are uploaded for Study, self-assessment or Word generation.

## Local data

Chrome local extension storage holds settings and keys, existing Notes and Vocabulary, a separate sentence collection, grammar/expression labels, review self-assessments, UI preferences and study sessions. The daily-use extension and other Chrome profiles are independent. Existing Vocabulary is not automatically reclassified. Both vocabulary and sentences have a 500-entry cap without silent eviction. Storage failures are reported; a source sentence is written before an analysis request.

Study records a bound video/tab, target duration/goals, distinct new collection IDs, accumulated foreground viewing/activity/review time and daily buckets. Watching and activity are mutually exclusive. Hidden pages, unfocused windows, buffering, seeks, interrupted heartbeats, worker restarts and offline intervals do not earn offline credit. Recent interaction is an activity heuristic, not proof of attention or learning. History is retained for 90 days and shown for seven local calendar days. A selected current session is retained until replaced so its summary remains available.

Chrome `storage.session` stores Transcript reading positions for up to 20 videos; these are removed when the browser session ends. Transcript search is local, literal, bounded and does not seek the video. Recent digest/translation caching follows the existing 20-video and 30-day policy.

API keys and collections are restricted to trusted extension contexts. Content scripts receive only study-control state and cannot request collection APIs. Pronunciation uses local Chrome/system voices; no audio is uploaded. Reduce distractions changes the current page while enabled and removes its own styles on exit; it does not change YouTube account autoplay preferences.

## Exports and deletion

The bundled docx 9.6.1 library creates Word files entirely on-device, including chosen words/sentences, explanations, source video titles/timestamps/links and printable exercises. Export uses an explicit field allowlist and never includes settings or API keys. Word files are independent copies: removing an entry from the extension does not remove downloaded documents.

Delete individual vocabulary/sentences from Library. Settings offers cache deletion, note deletion and reset of all extension data, including keys and learning records. Uninstalling the extension removes its storage. No automatic cloud backup or multi-device synchronization is provided.
