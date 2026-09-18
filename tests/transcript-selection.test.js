const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "sidepanel.js"),
  "utf8",
);
const styles = fs.readFileSync(
  path.resolve(__dirname, "..", "sidepanel.css"),
  "utf8",
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadTranscriptViewStateHelpers({
  sessionStorage,
  now = 1_000,
  omitStorage = false,
} = {}) {
  const listeners = { addListener() {} };
  const NativeDate = Date;
  let currentNow = now;
  class TestDate extends NativeDate {
    static now() {
      const value = currentNow;
      currentNow += 1;
      return value;
    }
  }
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    Date: TestDate,
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval() {},
    clearInterval() {},
    IntersectionObserver: class {},
    CSS: { escape: (value) => value },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    window: { getSelection: () => null, close() {} },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => ({
        addEventListener() {},
        appendChild() {},
        classList: { add() {}, remove() {}, toggle() {} },
        style: {},
      }),
    },
    chrome: {
      runtime: {
        onMessage: listeners,
        sendMessage: async () => ({ success: true }),
      },
      windows: { getCurrent: async () => ({ id: 1 }) },
      tabs: { onUpdated: listeners, onActivated: listeners },
      storage: omitStorage ? {} : { session: sessionStorage },
    },
    YTD_SETTINGS: {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.__YTD_TRANSCRIPT_TESTING__;
}

function createSessionStorage(initialValue = {}) {
  const data = structuredClone(initialValue);
  const writes = [];
  return {
    data,
    writes,
    async get(key) {
      return Object.hasOwn(data, key) ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(value) {
      writes.push(structuredClone(value));
      Object.assign(data, structuredClone(value));
    },
  };
}

function loadTranscriptReadingPositionLifecycleHarness({
  initialSessionValue = {},
  now = 10_000,
} = {}) {
  const storage = createSessionStorage(initialSessionValue);
  const timers = [];
  const windowListeners = new Map();
  let activeTabName = "transcript";
  let currentNow = now;
  const contentArea = {
    scrollTop: 0,
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {},
  };
  const followPlaybackButton = { style: { display: "none" } };
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    Date: class extends Date {
      static now() {
        currentNow += 1;
        return currentNow;
      }
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay, active: true });
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].active = false;
    },
    setInterval: () => 1,
    clearInterval() {},
    IntersectionObserver: class {},
    CSS: { escape: (value) => value },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    window: {
      getSelection: () => null,
      close() {},
      addEventListener(type, listener) {
        windowListeners.set(type, listener);
      },
    },
    document: {
      addEventListener() {},
      querySelector(selector) {
        if (selector === '.tab.active[data-tab="transcript"]') {
          return activeTabName === "transcript" ? { dataset: { tab: "transcript" } } : null;
        }
        return null;
      },
      querySelectorAll: () => [],
      getElementById(id) {
        if (id === "contentArea") return contentArea;
        if (id === "followPlaybackBtn") return followPlaybackButton;
        return null;
      },
      createElement: () => ({
        addEventListener() {},
        appendChild() {},
        classList: { add() {}, remove() {}, toggle() {} },
        style: {},
      }),
    },
    chrome: {
      runtime: {
        onMessage: listeners,
        sendMessage: async () => ({ success: true }),
      },
      windows: { getCurrent: async () => ({ id: 1 }) },
      tabs: { onUpdated: listeners, onActivated: listeners },
      storage: { session: storage },
    },
    YTD_SETTINGS: {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);

  return {
    helpers: sandbox.__YTD_TRANSCRIPT_TESTING__,
    storage,
    contentArea,
    followPlaybackButton,
    setActiveTab(name) {
      activeTabName = name;
    },
    fireTimer(delay) {
      const timer = timers.find((candidate) => candidate.active && candidate.delay === delay);
      assert.ok(timer, `expected an active ${delay}ms timer`);
      timer.active = false;
      timer.callback();
    },
    activeTimers(delay) {
      return timers.filter((timer) => timer.active && timer.delay === delay).length;
    },
    dispatchWindow(type) {
      assert.equal(typeof windowListeners.get(type), "function");
      return windowListeners.get(type)();
    },
  };
}

test("Transcript reading positions round-trip per exact video in session storage", async () => {
  const storage = createSessionStorage();
  const helpers = loadTranscriptViewStateHelpers({ sessionStorage: storage });

  await helpers.saveTranscriptViewState("video-A", 321.5);
  await helpers.saveTranscriptViewState("video-B", 99);

  assert.deepEqual(
    plain(await helpers.loadTranscriptViewState("video-A")),
    { videoId: "video-A", scrollTop: 321.5 },
  );
  assert.deepEqual(
    plain(await helpers.loadTranscriptViewState("video-B")),
    { videoId: "video-B", scrollTop: 99 },
  );
  assert.equal(await helpers.loadTranscriptViewState("video-a"), null);
  const savedA = storage.data.ytd_transcript_view_state["video-A"];
  assert.deepEqual(Object.keys(savedA).sort(), ["scrollTop", "updatedAt"]);
  assert.equal(savedA.scrollTop, 321.5);
  assert.equal(Number.isFinite(savedA.updatedAt), true);
});

test("overlapping Transcript position saves cannot lose another video's entry", async () => {
  const data = {};
  const events = [];
  const storage = {
    async get(key) {
      events.push("get");
      const snapshot = Object.hasOwn(data, key)
        ? { [key]: structuredClone(data[key]) }
        : {};
      await Promise.resolve();
      return snapshot;
    },
    async set(value) {
      events.push("set");
      await Promise.resolve();
      Object.assign(data, structuredClone(value));
    },
  };
  const helpers = loadTranscriptViewStateHelpers({ sessionStorage: storage });

  await Promise.all([
    helpers.saveTranscriptViewState("video-A", 10),
    helpers.saveTranscriptViewState("video-B", 20),
  ]);

  assert.deepEqual(Object.keys(data.ytd_transcript_view_state).sort(), [
    "video-A",
    "video-B",
  ]);
  assert.deepEqual(events, ["get", "set", "get", "set"]);
});

test("Transcript reading-position helpers reject invalid input and stored values", async () => {
  const storage = createSessionStorage({
    ytd_transcript_view_state: {
      negative: { scrollTop: -1, updatedAt: 1 },
      nan: { scrollTop: Number.NaN, updatedAt: 2 },
      string: { scrollTop: "12", updatedAt: 3 },
      missing: { updatedAt: 4 },
    },
  });
  const helpers = loadTranscriptViewStateHelpers({ sessionStorage: storage });

  for (const videoId of ["negative", "nan", "string", "missing", "absent"]) {
    assert.equal(await helpers.loadTranscriptViewState(videoId), null);
  }
  assert.equal(await helpers.loadTranscriptViewState(""), null);

  await helpers.saveTranscriptViewState("", 10);
  await helpers.saveTranscriptViewState("negative", -1);
  await helpers.saveTranscriptViewState("nan", Number.NaN);
  await helpers.saveTranscriptViewState("string", "12");
  assert.equal(storage.writes.length, 0);
});

test("Transcript reading-position storage keeps the 20 newest sanitized entries", async () => {
  const storage = createSessionStorage({
    ytd_transcript_view_state: {
      stale: { scrollTop: 1, updatedAt: 1, extra: "remove me" },
      broken: { scrollTop: -10, updatedAt: 500 },
    },
  });
  const helpers = loadTranscriptViewStateHelpers({
    sessionStorage: storage,
    now: 10_000,
  });

  for (let index = 0; index < 21; index += 1) {
    await helpers.saveTranscriptViewState(`video-${index}`, index);
  }

  const saved = storage.data.ytd_transcript_view_state;
  assert.equal(Object.keys(saved).length, 20);
  assert.deepEqual(Object.keys(saved), [
    "video-20",
    "video-19",
    "video-18",
    "video-17",
    "video-16",
    "video-15",
    "video-14",
    "video-13",
    "video-12",
    "video-11",
    "video-10",
    "video-9",
    "video-8",
    "video-7",
    "video-6",
    "video-5",
    "video-4",
    "video-3",
    "video-2",
    "video-1",
  ]);
  assert.equal(Object.hasOwn(saved, "video-0"), false);
  assert.equal(Object.hasOwn(saved, "stale"), false);
  assert.equal(Object.hasOwn(saved, "broken"), false);
  for (const state of Object.values(saved)) {
    assert.deepEqual(Object.keys(state).sort(), ["scrollTop", "updatedAt"]);
  }
});

test("Transcript reading positions fail safely when session storage is unavailable", async () => {
  const missingHelpers = loadTranscriptViewStateHelpers({ omitStorage: true });
  assert.equal(await missingHelpers.loadTranscriptViewState("video-A"), null);
  await assert.doesNotReject(
    missingHelpers.saveTranscriptViewState("video-A", 10),
  );

  const getFailure = new Error("session get failed");
  const throwingStorage = {
    get() {
      throw getFailure;
    },
    set() {
      throw new Error("session set failed");
    },
  };
  const throwingHelpers = loadTranscriptViewStateHelpers({
    sessionStorage: throwingStorage,
  });
  assert.equal(await throwingHelpers.loadTranscriptViewState("video-A"), null);
  await assert.doesNotReject(
    throwingHelpers.saveTranscriptViewState("video-A", 10),
  );

  let setAttempts = 0;
  const setFailureHelpers = loadTranscriptViewStateHelpers({
    sessionStorage: {
      async get() {
        return {};
      },
      set() {
        setAttempts += 1;
        throw new Error("session set failed");
      },
    },
  });
  await assert.doesNotReject(
    setFailureHelpers.saveTranscriptViewState("video-A", 10),
  );
  assert.equal(setAttempts, 1);

  const recoveringStorage = createSessionStorage();
  const originalSet = recoveringStorage.set.bind(recoveringStorage);
  let failFirstMutation = true;
  recoveringStorage.set = async (value) => {
    if (failFirstMutation) {
      failFirstMutation = false;
      throw new Error("first mutation failed");
    }
    await originalSet(value);
  };
  const recoveringHelpers = loadTranscriptViewStateHelpers({
    sessionStorage: recoveringStorage,
  });
  await Promise.all([
    recoveringHelpers.saveTranscriptViewState("video-failed", 10),
    recoveringHelpers.saveTranscriptViewState("video-recovered", 20),
  ]);
  assert.deepEqual(
    plain(await recoveringHelpers.loadTranscriptViewState("video-recovered")),
    { videoId: "video-recovered", scrollTop: 20 },
  );
});

test("manual Transcript scrolling is debounced and other tabs never overwrite it", async () => {
  const harness = loadTranscriptReadingPositionLifecycleHarness();
  const { helpers, contentArea, storage } = harness;
  assert.equal(typeof helpers.setTranscriptReadingPositionTestState, "function");
  helpers.setTranscriptReadingPositionTestState({
    videoId: "video-A",
    generation: 7,
    activeVideoId: "video-A",
  });

  contentArea.scrollTop = 245;
  helpers.onContentAreaScroll();
  assert.equal(harness.activeTimers(250), 1);
  harness.fireTimer(250);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(storage.data.ytd_transcript_view_state["video-A"].scrollTop, 245);

  harness.setActiveTab("overview");
  contentArea.scrollTop = 900;
  helpers.onContentAreaScroll();
  assert.equal(harness.activeTimers(250), 0);
  assert.equal(storage.data.ytd_transcript_view_state["video-A"].scrollTop, 245);
});

test("Transcript position capture flushes on pagehide and tab exit", async () => {
  const harness = loadTranscriptReadingPositionLifecycleHarness();
  const { helpers, contentArea, storage } = harness;
  helpers.setTranscriptReadingPositionTestState({
    videoId: "video-A",
    generation: 3,
    activeVideoId: "video-A",
  });
  helpers.setupTranscriptViewStateListeners();

  contentArea.scrollTop = 111;
  helpers.captureTranscriptViewPosition({ immediate: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(storage.data.ytd_transcript_view_state["video-A"].scrollTop, 111);

  contentArea.scrollTop = 222;
  harness.dispatchWindow("pagehide");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(storage.data.ytd_transcript_view_state["video-A"].scrollTop, 222);
});

test("saved Transcript position loads and restores only for its video generation", async () => {
  const harness = loadTranscriptReadingPositionLifecycleHarness({
    initialSessionValue: {
      ytd_transcript_view_state: {
        "video-A": { scrollTop: 321, updatedAt: 1 },
      },
    },
  });
  const { helpers, contentArea, followPlaybackButton, storage } = harness;
  helpers.setTranscriptReadingPositionTestState({
    videoId: "video-A",
    generation: 9,
    activeVideoId: "video-A",
    autoScrollEnabled: true,
  });
  const snapshot = { videoId: "video-A", generation: 9 };

  assert.equal(await helpers.loadPendingTranscriptViewState(snapshot), true);
  assert.equal(helpers.restorePendingTranscriptViewState(snapshot), true);
  assert.equal(contentArea.scrollTop, 321);
  assert.equal(followPlaybackButton.style.display, "block");
  const restored = plain(helpers.getTranscriptReadingPositionTestState());
  assert.equal(restored.autoScrollEnabled, false);
  assert.equal(restored.lastTranscriptScrollTop, 321);
  assert.equal(restored.lastAutoScrollTime > 0, true);

  helpers.onContentAreaScroll();
  assert.equal(harness.activeTimers(250), 0, "restore scroll must not self-save");
  assert.equal(storage.writes.length, 0);

  helpers.setTranscriptReadingPositionTestState({
    pending: { videoId: "video-A", generation: 9, scrollTop: 555, hasSavedPosition: true },
    videoId: "video-B",
    generation: 10,
    activeVideoId: "video-B",
  });
  contentArea.scrollTop = 17;
  assert.equal(
    helpers.restorePendingTranscriptViewState({ videoId: "video-A", generation: 9 }),
    false,
  );
  assert.equal(contentArea.scrollTop, 17, "stale video state must be ignored");
});

test("a saved Transcript position at the top still pauses playback following", async () => {
  const harness = loadTranscriptReadingPositionLifecycleHarness({
    initialSessionValue: {
      ytd_transcript_view_state: {
        "video-A": { scrollTop: 0, updatedAt: 1 },
      },
    },
  });
  const { helpers, contentArea, followPlaybackButton } = harness;
  helpers.setTranscriptReadingPositionTestState({
    videoId: "video-A",
    generation: 5,
    activeVideoId: "video-A",
    autoScrollEnabled: true,
  });
  const snapshot = { videoId: "video-A", generation: 5 };

  contentArea.scrollTop = 73;
  assert.equal(await helpers.loadPendingTranscriptViewState(snapshot), true);
  assert.equal(helpers.restorePendingTranscriptViewState(snapshot), true);
  assert.equal(contentArea.scrollTop, 0);
  assert.equal(
    helpers.getTranscriptReadingPositionTestState().autoScrollEnabled,
    false,
  );
  assert.equal(followPlaybackButton.style.display, "block");
});

test("missing or invalid Transcript state falls back safely to the top", () => {
  const harness = loadTranscriptReadingPositionLifecycleHarness();
  const { helpers, contentArea } = harness;
  helpers.setTranscriptReadingPositionTestState({
    pending: { videoId: "video-A", generation: 4, scrollTop: "bad", hasSavedPosition: false },
    videoId: "video-A",
    generation: 4,
    activeVideoId: "video-A",
  });
  contentArea.scrollTop = 88;

  assert.equal(
    helpers.restorePendingTranscriptViewState({ videoId: "video-A", generation: 4 }),
    true,
  );
  assert.equal(contentArea.scrollTop, 0);
  assert.equal(helpers.getTranscriptReadingPositionTestState().pending, null);
});

test("Transcript lifecycle is wired around tab, video, cached, and fresh render boundaries", () => {
  const switchStart = source.indexOf("function switchTab(tabName)");
  const switchEnd = source.indexOf("// ASK", switchStart);
  const switchSource = source.slice(switchStart, switchEnd);
  assert.match(
    switchSource,
    /if \(transcriptTabIsActive\(\) && tabName !== "transcript"\)[\s\S]*?captureTranscriptViewPosition\(\{ immediate: true \}\)/,
  );
  assert.match(switchSource, /if \(tabName === "transcript"\)[\s\S]*?restorePendingTranscriptViewState/);

  const digestStart = source.indexOf("async function startDigest");
  const digestEnd = source.indexOf("function isCurrentDigestRequest", digestStart);
  const digestSource = source.slice(digestStart, digestEnd);
  assert.match(digestSource, /captureTranscriptPositionBeforeVideoChange/);
  assert.match(digestSource, /loadPendingTranscriptViewState\(requestSnapshot\)/);
  assert.equal(
    (digestSource.match(/restorePendingTranscriptViewState\(requestSnapshot\)/g) || []).length,
    1,
    "cached rendering must restore once",
  );

  const completeStart = source.indexOf("async function completeTranscriptLoad");
  const completeEnd = source.indexOf("// RENDERING", completeStart);
  assert.match(
    source.slice(completeStart, completeEnd),
    /renderTranscript\(\);[\s\S]*?restorePendingTranscriptViewState\(requestSnapshot\)/,
    "fresh rendering must restore after Transcript DOM exists",
  );
  assert.match(source, /window\.addEventListener\("pagehide"/);
});

test("the panel reconciles against only the active tab in the last-focused window", () => {
  const start = source.indexOf("async function checkCurrentTab()");
  const end = source.indexOf("function extractVideoId", start);
  assert.ok(start >= 0 && end > start, "checkCurrentTab must be present");
  const checkCurrentTabSource = source.slice(start, end);

  assert.equal(
    (checkCurrentTabSource.match(/chrome\.tabs\.query\(/g) || []).length,
    1,
    "checkCurrentTab must perform exactly one tab query",
  );
  assert.match(
    checkCurrentTabSource,
    /chrome\.tabs\.query\(\{\s*active:\s*true,\s*lastFocusedWindow:\s*true,?\s*\}\)/,
  );
  assert.match(
    checkCurrentTabSource,
    /if \(!tab\?\.url\) \{[\s\S]*?showState\("welcome"\);[\s\S]*?return;[\s\S]*?\}/,
  );
  assert.match(
    checkCurrentTabSource,
    /YTD_PLATFORM\.supported\(tab\.url\)/,
  );
  assert.doesNotMatch(checkCurrentTabSource, /tabs\.query\(\{\s*url:/);
  assert.doesNotMatch(
    checkCurrentTabSource,
    /url:\s*"https:\/\/www\.youtube\.com\/\*"/,
  );
});

test("all timestamped transcript row clicks use the selection-aware seek helper", () => {
  assert.match(
    source,
    /function hasNonCollapsedTextSelection\(\)[\s\S]*?selection\.rangeCount > 0 && !selection\.isCollapsed/,
  );
  assert.match(
    source,
    /function seekFromTranscriptEntryClick\(event, seconds\)[\s\S]*?if \(hasNonCollapsedTextSelection\(\)\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?seekTo\(seconds, \{ play: true \}\);/,
  );

  const guardedRowHandlers = source.match(
    /div\.addEventListener\("click", \(event\) =>\s+seekFromTranscriptEntryClick\(event, group\.start\),\s+\);/g,
  );
  assert.equal(
    guardedRowHandlers?.length,
    1,
    "raw transcript rows must use the guard",
  );
  assert.match(
    source,
    /div\.addEventListener\("click", \(event\) =>\s+seekFromTranscriptEntryClick\(event, segment\.start\),\s+\);/,
    "translated-only and bilingual rows must use the guard",
  );
  assert.doesNotMatch(
    source,
    /div\.addEventListener\("click", \(\) => seekTo\(group\.start\)\);/,
  );
});

test("the Explain modal snapshots video identity and exposes an accessible dialog", () => {
  const start = source.indexOf("async function showExplanation");
  const end = source.indexOf("// CACHING", start);
  assert.ok(start >= 0 && end > start);
  const showExplanationSource = source.slice(start, end);

  assert.match(showExplanationSource, /const modalVideoId = currentVideoId/);
  assert.match(showExplanationSource, /const modalVideoTitle = currentVideoTitle/);
  assert.match(showExplanationSource, /currentVideoId === modalVideoId/);
  assert.equal(
    (showExplanationSource.match(/videoTitle: modalVideoTitle/g) || []).length,
    3,
    "English, translation, and Retry requests must use the opening title",
  );
  assert.doesNotMatch(showExplanationSource, /videoTitle: currentVideoTitle/);

  assert.match(
    showExplanationSource,
    /class="explain-modal" role="dialog" aria-modal="true" aria-labelledby="explainModalTitle"/,
  );
  assert.match(showExplanationSource, /id="explainModalTitle"[^>]*>解释</);
  assert.match(
    showExplanationSource,
    /id="closeExplain"[^>]*aria-label="关闭解释"/,
  );
  assert.match(
    showExplanationSource,
    /modal\.addEventListener\("keydown", \(event\) => \{[\s\S]*?event\.key === "Escape"[\s\S]*?closeModal\(\)/,
  );
  assert.match(
    showExplanationSource,
    /closeButton\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(
    showExplanationSource,
    /class="explain-save-vocabulary"[^>]*>收藏为词条<\/button>/,
  );
  assert.match(
    showExplanationSource,
    /saveVocabularySelection\(modalVocabularySelection, saveVocabularyButton\)/,
  );
  assert.doesNotMatch(styles, /--accent-soft/);
  assert.match(
    styles,
    /\.explain-language-btn\.active\s*\{[^}]*border-color:\s*var\(--accent-dim\)/,
  );
});

test("every semantic transcript row exposes keyboard Explain and Save actions", () => {
  assert.match(
    source,
    /function addTranscriptRowActions\(row, segment\)[\s\S]*?className = "transcript-row-actions"/,
  );
  assert.match(
    source,
    /className = "[^"]*transcript-row-explain"[\s\S]*?setAttribute\(\s*"aria-label",\s*"解释这段字幕"/,
  );
  assert.match(
    source,
    /className = "[^"]*transcript-row-save"[\s\S]*?setAttribute\(\s*"aria-label",[\s\S]*?"将这段字幕收藏为词条"/,
  );
  assert.match(
    source,
    /function getDisplayedTranscriptRowText\(row\)[\s\S]*?transcript-original[\s\S]*?transcript-translation/,
  );
  assert.match(
    source,
    /buildVocabularySelectionMetadata\([\s\S]*?displayedText[\s\S]*?row[\s\S]*?getActiveTranscriptSegments\(\)/,
  );
  assert.match(
    source,
    /showExplanation\(metadata\.term, metadata\.context, metadata, explainButton\)/,
  );
  assert.match(
    source,
    /saveVocabularySelection\(metadata, saveButton\)/,
  );
  assert.match(
    source,
    /button\.addEventListener\("click", async \(event\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/,
  );
  assert.equal(
    (source.match(/addTranscriptRowActions\(div, (?:group|segment)\);/g) || [])
      .length,
    2,
    "original and translated semantic rows both need actions",
  );
  assert.match(
    styles,
    /\.transcript-row-actions\s*\{[^}]*opacity:\s*0;/,
  );
  assert.match(
    styles,
    /\.transcript-entry:hover \.transcript-row-actions,[\s\S]*?\.transcript-entry:focus-within \.transcript-row-actions\s*\{[^}]*opacity:\s*1;/,
  );
  assert.match(
    styles,
    /\.transcript-row-(?:explain|save):focus-visible[\s\S]*?outline:/,
  );
});

test("Explain modal traps keyboard focus and restores its invoker on every close", () => {
  const start = source.indexOf("async function showExplanation");
  const end = source.indexOf("// CACHING", start);
  const modalSource = source.slice(start, end);

  assert.match(
    modalSource,
    /const modalInvoker = invoker \|\| document\.activeElement/,
  );
  assert.match(
    modalSource,
    /event\.key === "Tab"[\s\S]*?getModalFocusableElements\(modal\)[\s\S]*?event\.shiftKey[\s\S]*?last\.focus\([\s\S]*?first\.focus\(/,
  );
  assert.match(
    modalSource,
    /const closeModal = \(\) => \{[\s\S]*?modal\.remove\(\);[\s\S]*?modalInvoker\?\.isConnected[\s\S]*?modalInvoker\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(
    modalSource,
    /if \(event\.key === "Escape"\)[\s\S]*?closeModal\(\)/,
  );
  const setupStart = source.indexOf("function setupExplainFeature()");
  const setupEnd = source.indexOf("function getSelectionTranscriptEntry", setupStart);
  assert.doesNotMatch(
    source.slice(setupStart, setupEnd),
    /tooltip\.style\.display = "none";\s*await showExplanation\(/,
  );
});


test("capture setup delegates to one idempotent learning listener installation", () => {
  const learning = fs.readFileSync(path.join(__dirname, "../lib/learning-ui.js"), "utf8");
  assert.match(source, /YTD_LEARNING_UI\?\.installCapture\(\)/);
  assert.match(learning, /if\(captureInstalled\)return;captureInstalled=true/);
  assert.match(learning, /box\.addEventListener\("pointerdown".*preventDefault\(\).*stopPropagation\(\)/);
});


test("sentence save follows only while reading intent and video remain unchanged", () => {
  const {helpers:h,setActiveTab} = loadTranscriptReadingPositionLifecycleHarness();
  h.setTranscriptReadingPositionTestState({videoId:'video-a',generation:1,autoScrollEnabled:true});
  const snapshot=h.sentenceFollowSnapshot();
  assert.equal(h.canFollowAfterSentenceSave(snapshot),true);
  h.onTranscriptScrollIntent({type:'wheel'});
  assert.equal(h.canFollowAfterSentenceSave(snapshot),false);
  h.setTranscriptReadingPositionTestState({autoScrollEnabled:true});
  assert.equal(h.canFollowAfterSentenceSave(snapshot),false, 'in-flight save cannot undo later scrolling');
  const next=h.sentenceFollowSnapshot();
  h.setTranscriptReadingPositionTestState({videoId:'video-b'});
  assert.equal(h.canFollowAfterSentenceSave(next),false);
  h.setTranscriptReadingPositionTestState({videoId:'video-a'});
  setActiveTab('library');
  assert.equal(h.canFollowAfterSentenceSave(next),false);
});

test('click-to-seek restores scrolling, but not after manual scroll, failed seek, or selection', async () => {
  const functionSource=source.slice(source.indexOf('async function seekFromTranscriptEntryClick('),source.indexOf('\nfunction getDisplayedTranscriptRowText'));
  const make=()=>{
    let resolve;
    const calls=[];
    const sandbox={currentVideoId:'a',digestGeneration:1,manualTranscriptScrollRevision:0,transcriptSeekRevision:0,autoScrollEnabled:false,
      hasNonCollapsedTextSelection:()=>false,sentenceFollowSnapshot:()=>({videoId:'a',generation:1,revision:0}),
      transcriptTabIsActive:()=>true,seekTo:()=>new Promise(r=>{resolve=r;}),
      document:{getElementById:()=>({style:{}})},highlightActiveEntry:t=>calls.push(t),scrollToActiveEntry:b=>calls.push(b)};
    vm.runInNewContext(functionSource,sandbox);
    return {sandbox,calls,finish:value=>resolve(value)};
  };
  for (const outcome of ['success','scroll','failure','video']) {
    const h=make();const task=h.sandbox.seekFromTranscriptEntryClick({},125);
    if(outcome==='scroll')h.sandbox.manualTranscriptScrollRevision++;
    if(outcome==='video')h.sandbox.currentVideoId='b';
    h.finish(outcome!=='failure');await task;
    assert.deepEqual(h.calls,outcome==='success'?[125,'instant']:[]);
    assert.equal(h.sandbox.autoScrollEnabled,outcome==='success');
  }
  const h=make();h.sandbox.hasNonCollapsedTextSelection=()=>true;
  let prevented=0;
  await h.sandbox.seekFromTranscriptEntryClick({preventDefault:()=>prevented++,stopPropagation:()=>prevented++},125);
  assert.equal(prevented,2);assert.deepEqual(h.calls,[]);
});

test('immersive positioning aligns English below toolbar, independent of preceding Chinese height', () => {
  const fn=source.slice(source.indexOf('function scrollTranscriptEntry('),source.indexOf('\n/**\n * Finds the transcript entry matching'));
  const calls=[];
  const area={scrollTop:400,getBoundingClientRect:()=>({top:10}),scrollTo:o=>calls.push(o)};
  const sandbox={Date,lastAutoScrollTime:0,document:{documentElement:{classList:{contains:()=>true}},getElementById:()=>area,querySelector:()=>({getBoundingClientRect:()=>({height:40})})}};
  vm.runInNewContext(fn,sandbox);
  sandbox.scrollTranscriptEntry({querySelector:()=>({getBoundingClientRect:()=>({top:214})})},'instant');
  assert.equal(calls[0].top,560);
  assert.equal(calls[0].behavior,'instant');
});

test('clicked row scrolls immediately before the player seek finishes', async () => {
  const fn=source.slice(source.indexOf('async function seekFromTranscriptEntryClick('),source.indexOf('\nfunction getDisplayedTranscriptRowText'));
  const row={matches:()=>true,isConnected:true};const calls=[];let finish;
  const sandbox={hasNonCollapsedTextSelection:()=>false,sentenceFollowSnapshot:()=>({videoId:'a',generation:1,revision:0}),
    currentVideoId:'a',digestGeneration:1,manualTranscriptScrollRevision:0,transcriptSeekRevision:0,autoScrollEnabled:false,
    seekTo:()=>new Promise(r=>{finish=r;}),transcriptTabIsActive:()=>true,
    document:{getElementById:()=>null},highlightActiveEntry:()=>{},scrollTranscriptEntry:(entry,behavior)=>calls.push([entry,behavior])};
  vm.runInNewContext(fn,sandbox);
  const promise=sandbox.seekFromTranscriptEntryClick({currentTarget:row},125);
  assert.equal(calls.length,1);assert.equal(calls[0][0],row);assert.equal(calls[0][1],'instant');
  finish(true);await promise;assert.equal(calls.length,2);assert.equal(sandbox.autoScrollEnabled,true);
});

test('Bilibili subtitle seeks start playback from paused or playing state', async () => {
  const script=fs.readFileSync(path.resolve(__dirname,'../lib/bilibili-content.js'),'utf8');
  for(const paused of [true,false]){
    let listener,plays=0,response;
    const video={paused,currentTime:0,play:async()=>{plays++;video.paused=false;}};
    const sandbox={chrome:{runtime:{onMessage:{addListener:f=>listener=f}}},
      document:{querySelector:()=>video,getElementById:()=>({}),addEventListener(){}},
      YTD_PLATFORM:{videoIdFromUrl:()=>null},location:{href:''},setInterval(){},setTimeout(){},
      MutationObserver:class{observe(){}},window:{addEventListener(){}}};
    vm.runInNewContext(script,sandbox);
    assert.equal(listener({action:'seekTo',seconds:134,play:true},{},r=>response=r),true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(video.currentTime,134);assert.equal(plays,1);assert.equal(video.paused,false);assert.equal(response.success,true);
  }
});

test('immersion follows enabled cues but respects manual scrolling, interaction and pause',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../sidepanel.js'),'utf8');
 const fn=src.slice(src.indexOf('function highlightActiveEntry('),src.indexOf('\n/**',src.indexOf('function highlightActiveEntry(')));
 let selection=false;const calls=[];const row={dataset:{seconds:'0'},classList:{contains:()=>true,add:()=>{},remove:()=>{}}};
 const sandbox={document:{documentElement:{classList:{contains:()=>true}},getElementById:id=>id==='transcriptList'?{querySelectorAll:()=>[row]}:id==='explainModal'?null:{style:{}}},currentTranscriptSource:'native',currentTranscriptPartial:false,autoScrollEnabled:false,hasNonCollapsedTextSelection:()=>selection,scrollTranscriptEntry:(...args)=>calls.push(args)};
 vm.createContext(sandbox);vm.runInContext(fn,sandbox);sandbox.highlightActiveEntry(1);assert.equal(calls.length,0);assert.equal(sandbox.autoScrollEnabled,false);sandbox.autoScrollEnabled=true;sandbox.highlightActiveEntry(1);sandbox.highlightActiveEntry(2);assert.equal(calls.length,2);assert.equal(sandbox.autoScrollEnabled,true);
 selection=true;sandbox.highlightActiveEntry(3);assert.equal(calls.length,2);
 selection=false;sandbox.highlightActiveEntry(4);assert.equal(calls.length,3);
 sandbox.YTD_LEARNING_UI={isTranscriptInteracting:()=>true};sandbox.highlightActiveEntry(5);assert.equal(calls.length,3);
 sandbox.YTD_LEARNING_UI.isTranscriptInteracting=()=>false;sandbox.highlightActiveEntry(6);assert.equal(calls.length,4);
 sandbox.highlightActiveEntry(6,{allowImmersiveScroll:false});assert.equal(calls.length,4);
 sandbox.highlightActiveEntry(7,{allowImmersiveScroll:true});assert.equal(calls.length,5);
});

test('layout failure cannot prevent subtitle playback and failed seek is visible',async()=>{
 const fn=source.slice(source.indexOf('async function seekFromTranscriptEntryClick('),source.indexOf('\nfunction getDisplayedTranscriptRowText'));
 const status={textContent:''},calls=[];
 const sandbox={hasNonCollapsedTextSelection:()=>false,sentenceFollowSnapshot:()=>({}),transcriptSeekRevision:0,
 document:{getElementById:()=>status},seekTo:async(s,o)=>{calls.push([s,o.play]);return false;},scrollTranscriptEntry:()=>{throw Error('layout');}};
 vm.runInNewContext(fn,sandbox);await sandbox.seekFromTranscriptEntryClick({currentTarget:{matches:()=>true}},125);
 assert.deepEqual(calls,[[125,true]]);assert.match(status.textContent,/未能跳转播放/);
});


test('explicit playback return closes saved-word interaction and selection before reading paused playback',async()=>{
 const fn=source.slice(source.indexOf('async function returnToPlaybackPosition()'),source.indexOf('function startPlaybackTracking()'));
 const calls=[],button={disabled:false},status={textContent:''};
 const sandbox={currentVideoId:'v',digestGeneration:1,
 document:{getElementById:id=>id==='returnToPlaybackBtn'?button:status},
 YTD_LEARNING_UI:{immersiveClose:()=>calls.push('close lookup')},closeActiveExplanationModal:()=>calls.push('close explanation'),
 window:{getSelection:()=>({removeAllRanges:()=>calls.push('clear selection')})},
 playbackTrackingTick:async options=>{assert.equal(options.returnToPosition,true);calls.push('read position');return true;}};
 vm.runInNewContext(fn,sandbox);await sandbox.returnToPlaybackPosition();
 assert.deepEqual(calls,['close lookup','close explanation','clear selection','read position']);
 assert.equal(button.disabled,false);assert.equal(status.textContent,'');
});

test('explicit return scrolls nearest ASR cue during silence without adding false highlight',async()=>{
 const start=source.indexOf('async function playbackTrackingTick(');
 const fn=source.slice(start,source.indexOf('\n/**',start));
 const rows=[{dataset:{seconds:'720'}},{dataset:{seconds:'746'}}],calls=[];
 const sandbox={embeddedPanel:false,currentVideoId:'v',digestGeneration:1,autoScrollEnabled:false,
 chrome:{runtime:{sendMessage:async()=>({success:true,response:{hasVideo:true,currentTime:744,paused:true,videoId:'v'}})}},
 document:{getElementById:()=>({style:{}}),dispatchEvent(){},querySelectorAll:()=>rows},
 CustomEvent:class{},setTimeout,clearTimeout,highlightActiveEntry:(t,o)=>{assert.equal(o.allowImmersiveScroll,true);},
 scrollToActiveEntry:()=>false,scrollTranscriptEntry:(row)=>{calls.push(row);return true;}};
 vm.runInNewContext(fn,sandbox);assert.equal(await sandbox.playbackTrackingTick({returnToPosition:true}),true);
 assert.equal(calls[0],rows[1]);assert.equal(sandbox.autoScrollEnabled,true);
});


test('study countdown explicitly displays seconds, rounds remaining upward and stops at zero',()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../lib/learning-ui.js'),'utf8');
 const fn=ui.slice(ui.indexOf('  function formatStudyClock('),ui.indexOf('  function formatTime('));
 const sandbox={};vm.runInNewContext(fn,sandbox);
 assert.equal(sandbox.formatStudyClock(1200000,{remaining:true}),'0h 20m 00s');
 assert.equal(sandbox.formatStudyClock(1199000,{remaining:true}),'0h 19m 59s');
 assert.equal(sandbox.formatStudyClock(1,{remaining:true}),'0h 00m 01s');
 assert.equal(sandbox.formatStudyClock(-1000,{remaining:true}),'0h 00m 00s');
 assert.equal(sandbox.formatStudyClock(3661000),'1h 01m 01s');
 assert.equal(sandbox.formatStudyClock(1999),'0h 00m 01s');
});
