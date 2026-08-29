# Upstream Selective Integration Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Selectively port Transcript search, reading-position restoration, active-tab isolation, current DeepSeek pricing, and release version `1.3.0` without regressing the fork's Ask, Vocabulary, generated-transcript, language, or security behavior.

**Architecture:** Treat upstream commit `5462cae` as reference data, not a patch source. Extend the fork's existing generation-guarded side-panel state and bounded DOM helpers. Keep search and reading-position state independent from provider/cache state, then update release documentation and versioning only after behavior is green.

**Tech Stack:** Manifest V3, plain HTML/CSS/JavaScript, Chrome `storage.session`, Node `node:test`, existing release/package shell scripts.

**Design:** `docs/superpowers/specs/2026-08-29-upstream-selective-integration-design.md`

---

### Task 1: Restrict the background panel lifecycle to the active tab

**Objective:** Close/disable the panel reliably outside YouTube and never relay to a background YouTube tab.

**Files:**
- Modify: `background.js:270-306, 530-620`
- Test: `tests/digest-button.test.js`
- Test: `tests/final-security-regressions.test.js`

**Step 1: Write failing tests**

Add executable tests for:

```js
getNavigationUrl({ status: "loading" }, tab)
updatePanelForTab(nonYouTubeTab)
relayToContent(activeNonYouTubeTab)
```

Require loading/complete reconciliation, guarded `sidePanel.close({tabId})` with window fallback, tab disable after close failure, and no broad `chrome.tabs.query({url: ...})` fallback.

**Step 2: Verify RED**

Run: `node --test tests/digest-button.test.js tests/final-security-regressions.test.js`

Expected: FAIL because close/window reconciliation and active-only relay do not exist.

**Step 3: Implement minimal lifecycle helpers**

Add:

```js
async function closePanelForTab(tabId, windowId) { /* guarded Chrome API */ }
function getNavigationUrl(changeInfo, tab) { /* url or loading/complete pendingUrl */ }
async function updatePanelForTab(tabId, url, windowId) { /* close + disable */ }
```

Change relay lookup to one `{active:true,lastFocusedWindow:true}` query and fail closed unless that exact tab is YouTube.

**Step 4: Verify GREEN and commit**

Run focused tests, `node --check background.js`, and `npm test`.

Commit: `fix: scope side panel to the active YouTube tab`

---

### Task 2: Restrict side-panel video detection to the active tab

**Objective:** Prevent `checkCurrentTab()` from borrowing any background YouTube tab.

**Files:**
- Modify: `sidepanel.js:603-676`
- Test: `tests/transcript-selection.test.js`
- Test: `tests/final-security-regressions.test.js`

**Step 1: Write failing tests**

Require exactly one active-last-focused query, direct non-YouTube close handling, no `url`-filtered fallback query, and no arbitrary YouTube-tab query.

**Step 2: Verify RED**

Run: `node --test tests/transcript-selection.test.js tests/final-security-regressions.test.js`

Expected: FAIL because Strategy 2/3 fallbacks remain.

**Step 3: Implement and verify**

Use only the active tab. Preserve `youtubeTabId`, video metadata relay, no-video welcome state, and digest generation snapshots.

Run focused tests, `node --check sidepanel.js`, full tests, then commit:

`fix: prevent background tab digest selection`

---

### Task 3: Add bounded Transcript reading-position storage helpers

**Objective:** Persist a small per-video Transcript scroll map in `chrome.storage.session`.

**Files:**
- Modify: `sidepanel.js` state and test exports
- Test: `tests/transcript-selection.test.js`

**Step 1: Write failing pure/helper tests**

Cover valid load/save, invalid values, 20-entry newest-first eviction, missing `storage.session`, and no writes for missing video/negative scroll.

Target contracts:

```js
loadTranscriptViewState(videoId) -> {videoId, scrollTop} | null
saveTranscriptViewState(videoId, scrollTop) -> Promise<void>
```

**Step 2: Verify RED, implement, and verify GREEN**

Use one storage adapter that falls back safely when session storage is unavailable. Store only `scrollTop` and `updatedAt`.

Run focused tests and commit:

`feat: persist transcript reading positions`

---

### Task 4: Integrate Transcript reading-position lifecycle

**Objective:** Capture and restore Transcript scroll without affecting Overview, Library, or Ask.

**Files:**
- Modify: `sidepanel.js` event setup, `startDigest`, `completeTranscriptLoad`, `switchTab`, scroll handling
- Modify: `sidepanel.css` restoration state if required
- Test: `tests/transcript-selection.test.js`
- Test: `tests/final-security-regressions.test.js`

**Step 1: Write failing lifecycle tests**

Assert position capture on debounced Transcript scroll, tab exit, video change, and `pagehide`; restore after cached/fresh render; no capture from other tabs; stale video snapshots ignored; restoration disables auto-follow and shows Follow playback.

**Step 2: Verify RED and implement**

Add bounded state:

```js
let lastTranscriptScrollTop = 0;
let pendingTranscriptViewState = null;
let transcriptViewStateSaveTimer = null;
let isRestoringTranscriptView = false;
```

Coordinate with `digestGeneration`, `.content.ask-mode`, and existing programmatic-scroll suppression.

**Step 3: Verify and commit**

Run focused tests, full tests, and commit:

`feat: restore transcript reading position`

---

### Task 5: Add pure literal Transcript search helpers

**Objective:** Find bounded literal matches and preserve Vocabulary marks when clearing search.

**Files:**
- Modify: `sidepanel.js` pure helpers and test exports
- Create: `tests/transcript-search.test.js`

**Step 1: Write failing tests**

Cover case-insensitive Latin, punctuation literals, Chinese, blank input, 200-character bound, overlapping policy, and mark clearing that removes only `.transcript-search-highlight`.

Core contract:

```js
findLiteralTranscriptMatches(text, query) -> [{start, end}]
```

Implement with normalized `indexOf`, not a dynamic regular expression.

**Step 2: Verify RED/GREEN and commit**

Run: `node --test tests/transcript-search.test.js`

Commit: `feat: add literal transcript search helpers`

---

### Task 6: Build Transcript search UI and integrate rerenders

**Objective:** Add accessible search/navigation UI that coexists with translation, auto-follow, and Vocabulary highlighting.

**Files:**
- Modify: `sidepanel.html` Transcript panel
- Modify: `sidepanel.css` search controls and marks
- Modify: `sidepanel.js` state, event wiring, DOM marking, rerender hooks
- Modify: `tests/transcript-search.test.js`
- Modify: `tests/vocabulary.test.js`
- Modify: `tests/release.test.js`

**Step 1: Write failing UI/integration tests**

Require labelled search, clear/count/previous/next controls, Enter/Shift+Enter/Escape behavior, wraparound navigation, centered scroll, auto-follow pause, displayed-language search, reset on video change, and safe DOM creation.

Add coexistence tests proving:

- search wraps text after Vocabulary highlighting;
- clearing search preserves `.vocabulary-highlight`;
- vocabulary refresh reapplies active search;
- translation row updates preserve active query and stable current index;
- timestamps, buttons, links, row actions, and pending/error labels are skipped.

**Step 2: Verify RED and implement**

Keep the search state local to the current Transcript/video. Reapply without seeking and without creating nested search marks.

**Step 3: Verify and commit**

Run search, vocabulary, translation, selection, and release tests; then full tests.

Commit: `feat: add transcript search navigation`

---

### Task 7: Update pricing, release version, and durable docs

**Objective:** Publish the integrated fork as `1.3.0` with current pricing and accurate documentation.

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `PRIVACY.md` if session-state wording needs clarification
- Modify: `SECURITY.md` active-tab/search boundary
- Modify: `AGENTS.md` regression boundaries
- Modify: `docs/ARCHITECTURE.md`
- Modify: `tests/release.test.js`

**Step 1: Write failing release assertions**

Require version `1.3.0`, current DeepSeek off-peak/peak prices, peak UTC windows, search/reading-position documentation, session-only storage, and no global-language/Notes-translation claims.

**Step 2: Verify RED and update docs/version**

Port only the verified DeepSeek pricing table from upstream commit `cfa3569`; keep Ask/Tavily/audio-generation sections intact. Document the fork's own UI, not upstream demos.

**Step 3: Run final gates and commit**

Run:

```bash
npm test
npm run check
npm run package
unzip -t dist/youtube-digest-v1.3.0.zip
```

Run the refined package secret scan and `git diff --check`.

Commit: `release: publish YouTube Digest 1.3.0`

---

### Task 8: Final integration review and push

**Objective:** Confirm the selective port preserved every non-goal and publish it to the fork.

**Files:** Read-only review of all changed files.

**Step 1: Independent spec review**

Verify the implementation against the design, including explicit non-goals.

**Step 2: Independent quality/security review**

Focus on DOM mark coexistence, stale video/translation state, tab targeting, session storage, provider-call invariants, and missing tests.

**Step 3: Fresh verification and push**

Confirm a clean working tree after commit, push `main` to `origin`, and verify the remote SHA. Do not push `upstream`.
