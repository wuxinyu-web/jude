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
    /function seekFromTranscriptEntryClick\(event, seconds\)[\s\S]*?if \(hasNonCollapsedTextSelection\(\)\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?seekTo\(seconds\);/,
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
    /className = "[^"]*transcript-row-save"[\s\S]*?setAttribute\(\s*"aria-label",\s*"将这段字幕收藏为词条"/,
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
