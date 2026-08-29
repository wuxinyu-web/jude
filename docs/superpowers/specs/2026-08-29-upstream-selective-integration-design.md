# Upstream Selective Integration Design

Date: 2026-08-29
Status: Implemented for v1.3.0; automated and independent integration review complete, manual Chrome runtime verification pending

## Goal

Port the useful parts of upstream YouTube Digest v1.2.0 into the fork without merging or cherry-picking the upstream feature commit. Preserve the fork's Ask, Tavily, Library, Vocabulary, user-confirmed audio transcription, independent language controls, and security/reliability hardening.

## Included scope

1. Add literal Transcript search with previous/next navigation.
2. Persist and restore each video's Transcript reading position for the current Chrome session.
3. Restrict side-panel and relay behavior to the active tab; never borrow a background YouTube tab.
4. Reconcile panel enable/close state on navigation URL, loading, and completion changes.
5. Update DeepSeek V4 Flash prices and translation estimates from the current official pricing contract.
6. Bump the fork release version to `1.3.0` in `manifest.json` and `package.json`.

## Explicit non-goals

- Do not merge or cherry-pick upstream commits.
- Do not replace the separate Transcript and Overview sticky language controls with one global selector.
- Do not add automatic Notes translation or change the saved-note language contract.
- Do not replace Vocabulary Save with upstream's selected-text Note action.
- Do not import upstream demo screenshots or the Bilibili demo link because they show a different UI.
- Do not remove Ask, Tavily, Library, Vocabulary, phonetics, Samantha preference, user-confirmed audio generation, provider bounds, or stale-response guards.

## Transcript search

Search lives inside the Transcript tab below its sticky language/action row. It contains a labelled search input, clear action, match count, and previous/next controls. Enter advances; Shift+Enter moves backward; Escape clears.

Search operates on the transcript text currently displayed. Original searches source text, Chinese searches translated text, and bilingual searches both. Search never seeks or changes video playback. Navigating to a result disables automatic transcript following and scrolls the current match into the middle of the Transcript viewport.

Matching is literal, Unicode-aware, and case-insensitive where casing exists. The input is trimmed and bounded to 200 characters. Saved text is never interpreted as a regular expression. Each result uses `<mark class="transcript-search-highlight">` created through DOM APIs.

Vocabulary highlighting runs first; search highlighting is reapplied afterward and visually takes priority. Clearing search unwraps only search marks and preserves Vocabulary marks. Transcript rerenders, completed translation batches, vocabulary refreshes, and language-mode changes reapply an active search without moving playback. Search resets when the active video changes.

## Reading-position state

Reading position uses `chrome.storage.session` under a dedicated key and keeps at most 20 recent video entries. It stores only `{ scrollTop, updatedAt }` per video.

The panel captures Transcript position when the user scrolls, leaves Transcript, switches video, or closes the panel. Writes are debounced. Overview, Library, and Ask scrolling must never overwrite Transcript position.

After a cached or fresh transcript renders, the saved position is restored only when the snapshot still belongs to the active video. Restoration pauses playback auto-follow, displays Follow playback, and ignores programmatic scroll events. Missing, invalid, or unavailable session storage falls back to the top without blocking Transcript.

## Active-tab and panel lifecycle

`checkCurrentTab()` queries only the active tab in the last-focused window. If it is not YouTube, the panel closes or shows no video; it never searches for another active or background YouTube tab.

Background relay uses only the active last-focused YouTube tab and fails closed when none exists. It does not fall back to arbitrary YouTube tabs.

Background panel reconciliation handles explicit URL changes and navigation `loading`/`complete` states. On non-YouTube tabs, it attempts the guarded Chrome side-panel close API when available, then disables the tab-specific panel. Older Chrome versions retain the existing disable-only compatibility path.

## Documentation and versioning

README English and Chinese pricing sections use the current DeepSeek V4 Flash off-peak/peak table and clearly date the snapshot. Pricing remains a documentation fact, not a runtime constant.

The fork version becomes `1.3.0`. Release checks must require manifest/package agreement and the package artifact becomes `dist/youtube-digest-v1.3.0.zip`.

README current-capabilities sections document Transcript search and reading-position restoration. Architecture and security documentation record active-tab isolation and session-only reading-position storage.

## Failure and security behavior

- Search and reading-position helpers are pure or bounded where practical.
- Search skips timestamps, buttons, links, row actions, pending/error labels, and non-transcript text.
- Search rerendering cannot create nested search marks or destroy Vocabulary marks.
- Late video or translation responses cannot restore/search the wrong video.
- Side-panel close failures are swallowed only after the tab is disabled; they do not redirect to another YouTube tab.
- No new host permission, API key, provider call, persistent cloud data, or paid request is introduced.

## Verification

Implementation follows TDD. Required coverage includes:

- literal English, punctuation, Chinese, blank, and 200-character search behavior;
- previous/next wraparound, keyboard controls, result count, and auto-follow pause;
- coexistence between search marks and Vocabulary marks;
- search reset and stale translation/video protection;
- Transcript-only session state, 20-entry bound, restore, close, and tab-switch behavior;
- active-tab-only detection/relay and navigation-commit panel reconciliation;
- updated DeepSeek pricing in both READMEs;
- synchronized `1.3.0` versions and release artifact name;
- all existing Ask, Vocabulary, translation, transcript-generation, security, and packaging tests.

Final gates are `npm test`, `npm run check`, `npm run package`, ZIP integrity, secret scan, and manual Chrome checks for search, scroll restore, active-tab isolation, and the existing no-transcript confirmation flow.
