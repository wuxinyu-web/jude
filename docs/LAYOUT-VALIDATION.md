# Layout validation · 1.7.0

Automated integration uses an isolated Chromium profile, synthetic videos/captions and stubbed providers. No live AI calls are made.

The layout branch of `scripts/browser-test.cjs` verifies vertical iframe loading (including recovery from an empty srcdoc inserted by a page integration), original player DOM preservation, non-overlapping stacked geometry, keyboard and drag resizing with persisted height, playback-position navigation, embedded Library access, owner-tab binding, and restoration of horizontal layout and original page attributes. Run with `YTD_TEST_LAYOUT=1` and `YTD_TEST_PLATFORM=bilibili` or `youtube`.

The regular Bilibili integration suite also passed after the layout change, covering collection, study accounting, review and Word download.

Manual verification on the user's captioned Bilibili video BV1bfLwz1Eu4 confirmed the top player and bottom extension page render together in Chrome, the cached original-audio transcript loads, and the return-to-playback-position button locates the current subtitle. This layout check did not run a new transcription or assess its accuracy.
