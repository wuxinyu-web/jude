/**
 * SIDE PANEL LOGIC
 *
 * Handles the UI for YouTube Digest: video detection, transcript analysis,
 * rendering results, and export features.
 */

const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

// ============================================================
// STATE
// ============================================================

const embeddedPanel = /(?:^|[?&])embedded=1(?:&|$)/.test(globalThis.location?.search || "");
const mobileEmbeddedPanel = /(?:^|[?&])mobile=1(?:&|$)/.test(globalThis.location?.search || "");
document.documentElement?.toggleAttribute?.("data-mobile-embedded", mobileEmbeddedPanel);
let embeddedHostTabId = null;
if (embeddedPanel) chrome.tabs.getCurrent().then(tab=>{embeddedHostTabId=tab?.id;});

let currentVideoId = null;
let currentVideoUrl = null;
let currentAnalysis = null;
let currentTranscript = null;
let currentTranscriptText = null; // Plain text (for display/export)
let currentTranscriptTimestamped = null; // With timestamps for AI analysis
let currentTranscriptLanguage = null;
let currentTranscriptSource = "native";
let currentNativeTranscriptBackup = null;
let currentVideoTitle = "";
let currentChannelName = "";
let currentVideoDescription = "";
let currentVideoDuration = 0;
let isAnalysisLoading = false; // Track if analysis is in progress
let digestGeneration = 0;
let activeDigestVideoId = null;
let analysisGeneration = 0;
let youtubeTabId = null; // Store the YouTube tab ID for reliable messaging
let errorAction = null;
let explainSelectionAbortController = null;
let closeActiveExplanationModal = null;

// --- Translation state ---
// The public transcript control intentionally supports only the original
// subtitles, Chinese, and an aligned source + Chinese view.
let currentTranscriptMode = /[?&]immersive=1(?:&|$)/.test(globalThis.location?.search||"") ? "bilingual" : "original";
let currentTranscriptPartial = false;
let pendingOriginalAudioMode = currentTranscriptMode === "bilingual" ? "bilingual" : null;
let currentOverviewMode = "original";
let translationGeneration = 0; // Invalidates responses from older UI modes/videos.
let translationWorkCount = 0;
let overviewTranslationGeneration = 0;
let overviewTranslationWorkCount = 0;
let transcriptScrollObserver = null;
// Stable keys include the video, source mode, language, and semantic segment ID.
let transcriptParagraphCache = new Map();
let overviewTranslationErrors = new Map();
const TRANSLATION_MESSAGE_TIMEOUT_MS = 130_000;

// --- Library / vocabulary state ---
// Vocabulary is loaded globally because saved terms highlight every video,
// while the Library filter only changes which cards are visible.
let currentLibraryView = "vocabulary";
let showAllVocabulary = false;
let vocabularyEntries = [];
let vocabularyLoadGeneration = 0;
const vocabularySavePromises = new Map();
const VOCABULARY_MATCH_LIMITS = Object.freeze({
  maxEntries: 500,
  maxTermLength: 1_000,
  maxTextLength: 12_000,
});
const TRANSCRIPT_SEARCH_LIMITS = Object.freeze({
  maxQueryLength: 200,
  maxTextLength: 12_000,
  maxMatches: 1_000,
});
let transcriptSearchState = createTranscriptSearchState();

/**
 * Prevent a stopped service worker or dead message channel from leaving the
 * transcript queue stuck forever. The underlying Chrome message cannot be
 * cancelled, so settled guards deliberately ignore any late response.
 */
function sendTranslationMessage(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback(value);
    };

    timeoutId = setTimeout(() => {
      finish(
        reject,
        new Error(
          "翻译请求超时，请重试。",
        ),
      );
    }, TRANSLATION_MESSAGE_TIMEOUT_MS);

    let messagePromise;
    try {
      messagePromise = chrome.runtime.sendMessage(message);
    } catch (error) {
      finish(reject, error);
      return;
    }

    Promise.resolve(messagePromise).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

// --- Auto-scroll state (follow video playback in transcript) ---
let transcriptSeekRevision = 0;
let manualTranscriptScrollRevision = 0;
let autoScrollEnabled = true; // True = scroll transcript to follow video playback
let autoScrollInterval = null; // setInterval ID for polling video time
let lastAutoScrollTime = 0; // Timestamp of last programmatic scroll (ignores scroll events within 1s)

// --- Transcript reading-position state ---
// Session storage survives a side-panel close but clears when Chrome closes.
const TRANSCRIPT_VIEW_STATE_KEY = "ytd_transcript_view_state";
const TRANSCRIPT_VIEW_STATE_LIMIT = 20;
const TRANSCRIPT_VIEW_STATE_SAVE_DEBOUNCE_MS = 250;
let pendingTranscriptViewState = null;
let transcriptViewStateSaveTimer = null;
let isRestoringTranscriptView = false;
let lastTranscriptScrollTop = 0;
let transcriptViewStateMutationQueue = Promise.resolve();

/**
 * Reading position is intentionally session-only. Returning null instead of
 * falling back to local storage keeps the data-lifetime promise explicit.
 */
function getTranscriptViewStateStorage() {
  try {
    const storage = globalThis.chrome?.storage?.session;
    if (
      !storage ||
      typeof storage.get !== "function" ||
      typeof storage.set !== "function"
    ) {
      return null;
    }
    return storage;
  } catch (error) {
    return null;
  }
}

function isValidTranscriptViewStateVideoId(videoId) {
  return typeof videoId === "string" && videoId.trim().length > 0;
}

function normalizeTranscriptViewStateEntry(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const { scrollTop, updatedAt } = state;
  if (typeof scrollTop !== "number" || !Number.isFinite(scrollTop)) return null;
  if (scrollTop < 0) return null;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  if (updatedAt < 0) return null;
  return { scrollTop, updatedAt };
}

/**
 * Reads one video's last visible Transcript position without leaking another
 * video's state or allowing malformed session data into the UI lifecycle.
 */
async function loadTranscriptViewState(videoId) {
  if (!isValidTranscriptViewStateVideoId(videoId)) return null;
  const storage = getTranscriptViewStateStorage();
  if (!storage) return null;

  try {
    const result = await storage.get(TRANSCRIPT_VIEW_STATE_KEY);
    const states = result?.[TRANSCRIPT_VIEW_STATE_KEY];
    if (
      !states ||
      typeof states !== "object" ||
      Array.isArray(states) ||
      !Object.hasOwn(states, videoId)
    ) {
      return null;
    }
    const state = normalizeTranscriptViewStateEntry(states[videoId]);
    return state ? { videoId, scrollTop: state.scrollTop } : null;
  } catch (error) {
    return null;
  }
}

/**
 * Stores a newest-first, sanitized map for at most 20 videos. Rebuilding the
 * map also removes stale fields and malformed entries from prior writes.
 */
async function saveTranscriptViewState(videoId, scrollTop) {
  if (!isValidTranscriptViewStateVideoId(videoId)) return;
  if (typeof scrollTop !== "number" || !Number.isFinite(scrollTop)) return;
  if (scrollTop < 0) return;

  const storage = getTranscriptViewStateStorage();
  if (!storage) return;

  const mutation = transcriptViewStateMutationQueue.then(async () => {
    const result = await storage.get(TRANSCRIPT_VIEW_STATE_KEY);
    const storedStates = result?.[TRANSCRIPT_VIEW_STATE_KEY];
    const previousEntries =
      storedStates &&
      typeof storedStates === "object" &&
      !Array.isArray(storedStates)
        ? Object.entries(storedStates)
        : [];
    const now = Date.now();
    const entries = [
      [videoId, { scrollTop, updatedAt: now }],
      ...previousEntries
        .filter(([storedVideoId]) => storedVideoId !== videoId)
        .map(([storedVideoId, state]) => [
          storedVideoId,
          normalizeTranscriptViewStateEntry(state),
        ])
        .filter(
          ([storedVideoId, state]) =>
            isValidTranscriptViewStateVideoId(storedVideoId) && state,
        ),
    ];
    const recentStates = Object.fromEntries(
      entries
        .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
        .slice(0, TRANSCRIPT_VIEW_STATE_LIMIT),
    );
    await storage.set({ [TRANSCRIPT_VIEW_STATE_KEY]: recentStates });
  });

  // Always recover the internal chain so one unavailable/failed session write
  // cannot prevent a later reading-position save from running.
  transcriptViewStateMutationQueue = mutation.catch(() => {});
  try {
    await mutation;
  } catch (error) {
    // Session storage can disappear while Chrome tears down the panel. The
    // visible Transcript remains usable; only position persistence is skipped.
  }
}

function transcriptTabIsActive() {
  return Boolean(
    document.querySelector('.tab.active[data-tab="transcript"]'),
  );
}

function isCurrentTranscriptViewSnapshot(snapshot) {
  return Boolean(
    snapshot &&
      snapshot.videoId === currentVideoId &&
      snapshot.videoId === activeDigestVideoId &&
      snapshot.generation === digestGeneration,
  );
}

function clearTranscriptViewStateSaveTimer() {
  if (transcriptViewStateSaveTimer !== null) {
    clearTimeout(transcriptViewStateSaveTimer);
    transcriptViewStateSaveTimer = null;
  }
}

function scheduleTranscriptViewStateSave(snapshot, scrollTop) {
  clearTranscriptViewStateSaveTimer();
  transcriptViewStateSaveTimer = setTimeout(() => {
    transcriptViewStateSaveTimer = null;
    if (
      isRestoringTranscriptView ||
      !transcriptTabIsActive() ||
      !isCurrentTranscriptViewSnapshot(snapshot)
    ) {
      return;
    }
    void saveTranscriptViewState(snapshot.videoId, scrollTop);
  }, TRANSCRIPT_VIEW_STATE_SAVE_DEBOUNCE_MS);
}

function captureTranscriptViewPosition({ immediate = false } = {}) {
  if (isRestoringTranscriptView || !transcriptTabIsActive()) return false;
  if (!isValidTranscriptViewStateVideoId(currentVideoId)) return false;
  if (currentVideoId !== activeDigestVideoId) return false;

  const contentArea = document.getElementById("contentArea");
  const scrollTop = contentArea?.scrollTop;
  if (typeof scrollTop !== "number" || !Number.isFinite(scrollTop)) return false;
  if (scrollTop < 0) return false;

  const snapshot = {
    videoId: currentVideoId,
    generation: digestGeneration,
  };
  lastTranscriptScrollTop = scrollTop;
  pendingTranscriptViewState = {
    ...snapshot,
    scrollTop,
    hasSavedPosition: true,
  };

  if (immediate) {
    clearTranscriptViewStateSaveTimer();
    void saveTranscriptViewState(snapshot.videoId, scrollTop);
  } else {
    scheduleTranscriptViewStateSave(snapshot, scrollTop);
  }
  return true;
}

function captureTranscriptPositionBeforeVideoChange(nextVideoId) {
  if (nextVideoId === currentVideoId) return false;
  clearTranscriptViewStateSaveTimer();

  if (isValidTranscriptViewStateVideoId(currentVideoId)) {
    if (transcriptTabIsActive() && !isRestoringTranscriptView) {
      const contentArea = document.getElementById("contentArea");
      const scrollTop = contentArea?.scrollTop;
      if (
        typeof scrollTop === "number" &&
        Number.isFinite(scrollTop) &&
        scrollTop >= 0
      ) {
        lastTranscriptScrollTop = scrollTop;
      }
    }
    void saveTranscriptViewState(currentVideoId, lastTranscriptScrollTop);
  }

  pendingTranscriptViewState = null;
  lastTranscriptScrollTop = 0;
  return true;
}

async function loadPendingTranscriptViewState(snapshot) {
  const savedState = await loadTranscriptViewState(snapshot?.videoId);
  if (!isCurrentTranscriptViewSnapshot(snapshot)) return false;

  pendingTranscriptViewState = {
    videoId: snapshot.videoId,
    generation: snapshot.generation,
    scrollTop: savedState?.scrollTop ?? 0,
    hasSavedPosition: Boolean(savedState),
  };
  lastTranscriptScrollTop = 0;
  return true;
}

function restorePendingTranscriptViewState(snapshot) {
  if (!transcriptTabIsActive()) return false;
  if (!isCurrentTranscriptViewSnapshot(snapshot)) return false;
  if (
    !pendingTranscriptViewState ||
    pendingTranscriptViewState.videoId !== snapshot.videoId ||
    pendingTranscriptViewState.generation !== snapshot.generation
  ) {
    return false;
  }

  const contentArea = document.getElementById("contentArea");
  if (!contentArea) return false;
  const savedScrollTop = pendingTranscriptViewState.scrollTop;
  const scrollTop =
    typeof savedScrollTop === "number" &&
    Number.isFinite(savedScrollTop) &&
    savedScrollTop >= 0
      ? savedScrollTop
      : 0;
  const hasSavedPosition =
    pendingTranscriptViewState.hasSavedPosition === true;

  clearTranscriptViewStateSaveTimer();
  isRestoringTranscriptView = true;
  lastAutoScrollTime = Date.now();
  lastTranscriptScrollTop = scrollTop;
  contentArea.scrollTop = scrollTop;
  pendingTranscriptViewState = null;

  if (hasSavedPosition) {
    autoScrollEnabled = false;
    const followPlaybackButton = document.getElementById("followPlaybackBtn");
    if (followPlaybackButton) followPlaybackButton.style.display = "block";
  }

  setTimeout(() => {
    isRestoringTranscriptView = false;
  }, 0);
  return true;
}

function setupTranscriptViewStateListeners() {
  const contentArea = document.getElementById("contentArea");
  contentArea?.removeEventListener("scroll", onContentAreaScroll);
  contentArea?.addEventListener("scroll", onContentAreaScroll);
  for (const event of ["wheel", "touchmove", "keydown", "pointerdown"]) {
    contentArea?.removeEventListener(event, onTranscriptScrollIntent);
    contentArea?.addEventListener(event, onTranscriptScrollIntent, { passive: true });
  }
  window.addEventListener("pagehide", () => {
    captureTranscriptViewPosition({ immediate: true });
  });
}

// ============================================================
// TRANSCRIPT GROUPING
// ============================================================

const TRANSCRIPT_SEGMENT_LIMITS = Object.freeze({
  minChars: 1,
  idealChars: 120,
  maxChars: 180,
  maxSeconds: 8,
  preserveCues: true,
});

function normalizeCaptionText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, "$1$2")
    .replace(/([，。；：！？])\s+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
    .trim();
}

/**
 * Splits a single oversized thought at the strongest nearby punctuation.
 * Word boundaries are the final safety valve for captions with no punctuation.
 */
function splitOversizedThought(text, maxChars) {
  const parts = [];
  let rest = normalizeCaptionText(text);

  while (rest.length > maxChars) {
    const windowText = rest.slice(0, maxChars + 1);
    const lowerBound = Math.floor(maxChars * 0.55);
    let cut = -1;

    for (const pattern of [/[;:；：]\s*/g, /[,，]\s*/g, /\s/g]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(windowText))) {
        if (match.index >= lowerBound) cut = match.index + match[0].length;
      }
      if (cut > 0) break;
    }

    if (cut <= 0) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

/**
 * Reconstructs complete sentences across raw caption boundaries. Each segment
 * keeps the timestamp of the first caption that contributed text. Character
 * and time limits prevent a malformed Supadata entry from becoming one giant
 * row while punctuation remains the preferred boundary.
 */
function groupTranscriptEntries(entries, limits = TRANSCRIPT_SEGMENT_LIMITS) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const pieces = [];
  entries.forEach((entry, entryIndex) => {
    const text = normalizeCaptionText(entry?.text);
    if (!text) return;
    const start = Number.isFinite(Number(entry.start)) ? Number(entry.start) : 0;
    const duration = Math.max(0, Number(entry.duration) || (Number(entries[entryIndex+1]?.start)-start) || 0);
    const sentenceParts = limits.preserveCues && typeof Intl.Segmenter === "function"
      ? Array.from(new Intl.Segmenter("en",{granularity:"sentence"}).segment(text), item=>item.segment).reduce((parts,part)=>{
          if(parts.length && /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|[A-Z])\.$/.test(parts[parts.length-1].trim()))parts[parts.length-1]+=part;
          else parts.push(part);
          return parts;
        },[])
      : text.match(/[^.!?;:,。！？；：，]+(?:[.!?;:,。！？；：，]+["')\]”’）】」』]*|$)/g) ||
      [text];
    let consumedChars = 0;

    sentenceParts.forEach((sentencePart, sentenceIndex) => {
      const cleanPart = normalizeCaptionText(sentencePart);
      if (!cleanPart) return;
      const oversizedParts = splitOversizedThought(cleanPart, limits.maxChars);
      oversizedParts.forEach((part, partIndex) => {
        const ratio = text.length ? Math.min(1, consumedChars / text.length) : 0;
        pieces.push({
          text: part,
          start: start + duration * ratio,
          end: start + duration * Math.min(1,(consumedChars+part.length)/text.length),
          cueEnd: sentenceIndex===sentenceParts.length-1 && partIndex===oversizedParts.length-1,
          semanticEnd:
            /[.!?。！？]["')\]”’）】」』]*$/.test(part) ||
            oversizedParts.length > 1,
          clauseEnd: /[;:,；：，]["')\]”’）】」』]*$/.test(part),
          sourceOrder: `${entryIndex}:${partIndex}`,
        });
        consumedChars += part.length + 1;
      });
    });
  });

  const grouped = [];
  let current = null;

  const flush = () => {
    if (!current || !current.text.trim()) return;
    const index = grouped.length;
    const text = normalizeCaptionText(current.text);
    grouped.push({
      id: `segment-${index}-${Math.round(current.start * 1000)}`,
      start: current.start,
      duration: Math.max(0,current.end-current.start),
      text,
      texts: [text],
    });
    current = null;
  };

  pieces.forEach((piece) => {
    if (!current) current = { start: piece.start, text: "" };
    current.text = normalizeCaptionText(`${current.text} ${piece.text}`);
    current.end = piece.end;
    const elapsed = Math.max(0, piece.start - current.start);
    const comfortablySized = current.text.length >= limits.minChars;
    const reachedIdeal = current.text.length >= limits.idealChars;
    const atNaturalBoundary =
      piece.semanticEnd ||
      (piece.clauseEnd &&
        (reachedIdeal ||
          current.text.length >= limits.maxChars ||
          elapsed >= limits.maxSeconds));
    const reachedGuardrail =
      atNaturalBoundary &&
      (current.text.length >= limits.maxChars || elapsed >= limits.maxSeconds);
    const reachedHardGuardrail =
      current.text.length >= Math.round(limits.maxChars * 1.2) ||
      elapsed >= limits.maxSeconds + 5;

    if (
      (limits.preserveCues && (piece.semanticEnd || piece.cueEnd)) ||
      (atNaturalBoundary && (comfortablySized || elapsed >= 8)) ||
      (atNaturalBoundary && reachedIdeal) ||
      reachedGuardrail ||
      reachedHardGuardrail
    ) {
      flush();
    }
  });
  flush();

  return grouped;
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  await evictOldCacheEntries(20);

  const configStatus = await chrome.runtime.sendMessage({
    action: "checkConfig",
  });

  // Native Bilibili subtitles work without provider keys. AI requests validate
  // their own key only when used; YouTube validates Supadata on fetch.

  await checkCurrentTab();
});

// Listen for messages from the Digest button on YouTube page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startDigestFromButton") {
    // Load the digest for the current video. Served from cache when we've
    // seen this video before (no API calls); fetched fresh otherwise.
    // (This used to force-clear the cache on every click, which silently
    // burned a transcript credit + analysis tokens per click.)
    checkCurrentTab();
    sendResponse({ success: true });
  }
  if (message.action === "transcriptProgress") {
    // Background is telling us the transcript fetch status changed
    updateLoading(message.title, message.subtitle);
    sendResponse({ success: true });
  }
  if (message.action === "noteSaved") {
    // Refresh notes list when a new note is saved
    const filterAll = document
      .getElementById("notesFilterAll")
      ?.classList.contains("active");
    loadNotes(filterAll ? null : currentVideoId);
    sendResponse({ success: true });
  }
  if (message.action === "vocabularySaved") {
    refreshVocabularyEntries();
    sendResponse({ success: true });
  }
  return false;
});

// ============================================================
// FOLLOW THE ACTIVE TAB
// ============================================================
// The panel watches which tab is in front of it and reacts:
//   - Front tab is NOT YouTube  -> the panel closes itself (window.close()).
//     We do this OURSELVES rather than relying only on the background
//     script's per-tab enable/disable, because Chrome doesn't reliably
//     apply per-tab panel state to tabs spawned in unusual ways (e.g. a
//     link opened from another app) — which let the panel linger on
//     non-YouTube pages.
//   - Front tab IS YouTube but on a different video -> refresh the digest.
//     YouTube is a single-page app (clicking a video swaps content without
//     a reload), so we track URL changes; startDigest() caches per video,
//     making re-checks instant and free for already-digested videos.
//
// Everything is scoped to the window this panel lives in: tab switches in
// OTHER browser windows must not close this panel or hijack its content.

let navigationRefreshTimer = null;
let panelWindowId = null;
chrome.windows.getCurrent().then((w) => {
  panelWindowId = w.id;
});

function scheduleDigestRefresh() {
  // Small delay lets YouTube finish rendering the new video's title and
  // description before we read them. Also collapses rapid-fire URL events
  // into a single refresh.
  clearTimeout(navigationRefreshTimer);
  navigationRefreshTimer = setTimeout(() => {
    checkCurrentTab();
  }, 600);
}

function panelIsShowingResults() {
  const results = document.getElementById("resultsState");
  return results && results.style.display !== "none";
}

/**
 * Reacts to the URL now in front of the panel: close on non-YouTube,
 * refresh the digest when the video changed.
 */
function handleFrontTabUrl(url) {
  if (!(globalThis.YTD_PLATFORM ? YTD_PLATFORM.supported(url) : (url || "").startsWith("https://www.youtube.com"))) {
    // Panel is a YouTube-only tool — remove itself from non-YouTube tabs.
    window.close();
    return;
  }

  const newVideoId = extractVideoId(url);
  // Refresh when the video changed, or when we're not currently showing
  // results (e.g. user went home, then clicked back into the same video).
  if (newVideoId !== currentVideoId || !panelIsShowingResults()) {
    scheduleDigestRefresh();
  }
}

// Fires when a tab's URL changes — including YouTube's no-reload navigation.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (embeddedPanel && tabId !== embeddedHostTabId) return;
  if (!changeInfo.url || !tab.active) return;
  if (panelWindowId !== null && tab.windowId !== panelWindowId) return;
  handleFrontTabUrl(changeInfo.url);
});

// Fires when a different tab comes to the front — switching tabs, or a new
// tab being opened (including ones opened by clicking links in other apps).
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (embeddedPanel && tabId !== embeddedHostTabId) return;
  if (panelWindowId !== null && windowId !== panelWindowId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    // Brand-new tabs may not have committed their URL yet — fall back to
    // the pending one so we judge where the tab is actually going.
    handleFrontTabUrl(tab.url || tab.pendingUrl || "");
  } catch (e) {
    // Tab closed before we could read it — nothing to do.
  }
});

function setupEventListeners() {
  setupTranscriptViewStateListeners();

  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Error retry
  document.getElementById("errorBtn").addEventListener("click", () => {
    if (errorAction) {
      errorAction();
      return;
    }
    if (currentVideoId) {
      startDigest(currentVideoId, currentVideoUrl);
    }
  });

  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "openOptions" });
  });

  // Transcript actions
  document
    .getElementById("copyTranscriptBtn")
    ?.addEventListener("click", copyTranscript);
  document
    .getElementById("exportTranscriptBtn")
    ?.addEventListener("click", exportTranscript);
  const transcriptSearchInput = document.getElementById("transcriptSearchInput");
  transcriptSearchInput?.addEventListener("input", () => {
    setTranscriptSearchQuery(transcriptSearchInput.value, { scroll: true });
  });
  transcriptSearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      navigateTranscriptSearch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      clearTranscriptSearch();
    }
  });
  document
    .getElementById("transcriptSearchClear")
    ?.addEventListener("click", clearTranscriptSearch);
  document
    .getElementById("transcriptSearchPrevious")
    ?.addEventListener("click", () => navigateTranscriptSearch(-1));
  document
    .getElementById("transcriptSearchNext")
    ?.addEventListener("click", () => navigateTranscriptSearch(1));
  document.querySelectorAll(".transcript-mode-btn").forEach((button) => {
    if (button.dataset.transcriptMode) {
      button.addEventListener("click", () => {
        handleTranscriptModeChange(button.dataset.transcriptMode);
      });
    }
    if (button.dataset.overviewMode) {
      button.addEventListener("click", () => {
        handleOverviewModeChange(button.dataset.overviewMode);
      });
    }
  });

  // Both entry points perform the same action, never toggle following off.
  document.getElementById("followPlaybackBtn")?.addEventListener("click", returnToPlaybackPosition);
  document.getElementById("returnToPlaybackBtn")?.addEventListener("click", returnToPlaybackPosition);

  // Notes filter buttons
  document.getElementById("notesFilterThis")?.addEventListener("click", () => {
    setNotesFilter(false);
    loadNotes(currentVideoId);
  });
  document.getElementById("notesFilterAll")?.addEventListener("click", () => {
    setNotesFilter(true);
    loadNotes(null); // Load all notes
  });

  document.getElementById("libraryNotesTab")?.addEventListener("click", () => {
    switchLibraryView("notes");
  });
  document
    .getElementById("libraryVocabularyTab")
    ?.addEventListener("click", () => {
      switchLibraryView("vocabulary");
    });
  document
    .getElementById("vocabularyFilterThis")
    ?.addEventListener("click", () => {
      setVocabularyFilter(false);
      renderVocabularyForCurrentFilter();
    });
  document
    .getElementById("vocabularyFilterAll")
    ?.addEventListener("click", () => {
      setVocabularyFilter(true);
      renderVocabularyForCurrentFilter();
    });

}

function setNotesFilter(showAll) {
  const thisVideoButton = document.getElementById("notesFilterThis");
  const allNotesButton = document.getElementById("notesFilterAll");
  thisVideoButton?.classList.toggle("active", !showAll);
  thisVideoButton?.setAttribute("aria-pressed", String(!showAll));
  allNotesButton?.classList.toggle("active", showAll);
  allNotesButton?.setAttribute("aria-pressed", String(showAll));
}

function switchLibraryView(view) {
  if (!["notes", "vocabulary", "sentences"].includes(view)) return;
  currentLibraryView = view;
  for (const key of ["notes", "vocabulary", "sentences"]) {
    const name = key[0].toUpperCase() + key.slice(1);
    const active = key === view;
    const button = document.getElementById(`library${name}Tab`);
    button?.classList.toggle("active", active);
    button?.setAttribute("aria-pressed", String(active));
    const pane = document.getElementById(`library${name}View`);
    if (pane) pane.hidden = !active;
  }
  if (view === "vocabulary") renderVocabularyForCurrentFilter();
  if (view === "sentences") globalThis.YTD_LEARNING_UI?.refreshLibrary();
}

function setVocabularyFilter(showAll) {
  showAllVocabulary = Boolean(showAll);
  const thisVideoButton = document.getElementById("vocabularyFilterThis");
  const allVocabularyButton = document.getElementById("vocabularyFilterAll");
  thisVideoButton?.classList.toggle("active", !showAllVocabulary);
  thisVideoButton?.setAttribute(
    "aria-pressed",
    String(!showAllVocabulary),
  );
  allVocabularyButton?.classList.toggle("active", showAllVocabulary);
  allVocabularyButton?.setAttribute(
    "aria-pressed",
    String(showAllVocabulary),
  );
}

// ============================================================
// VIDEO DETECTION
// ============================================================

async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });

    if (embeddedPanel) {
      const owner = await chrome.tabs.getCurrent();
      embeddedHostTabId = owner?.id;
      if (!owner || owner.id !== tab?.id) return;
    }

    debugLog("[YouTube Digest Panel] Found tab:", tab?.id, tab?.url);

    if (!tab?.url) {
      showState("welcome");
      return;
    }

    if (!(globalThis.YTD_PLATFORM ? YTD_PLATFORM.supported(tab.url) : tab.url.startsWith("https://www.youtube.com"))) {
      handleFrontTabUrl(tab.url);
      return;
    }

    // Store the tab ID for reliable messaging later
    youtubeTabId = tab.id;

    const videoId = extractVideoId(tab.url);

    if (videoId) {
      currentVideoUrl = tab.url;

      try {
        // Route through background script for reliable message passing
        const result = await chrome.runtime.sendMessage({
          action: "relayToContent",
          payload: { action: "getVideoInfo" },
        });
        debugLog("[YouTube Digest Panel] getVideoInfo result:", result);
        if (result.success && result.response) {
          currentVideoTitle = result.response.title || "";
          currentChannelName = result.response.channelName || "";
          currentVideoDescription = result.response.description || "";
          currentVideoDuration = result.response.duration || 0;
        }
      } catch (e) {
        console.error("[YouTube Digest Panel] getVideoInfo error:", e);
        currentVideoTitle = "";
        currentChannelName = "";
        currentVideoDescription = "";
        currentVideoDuration = 0;
      }

      startDigest(videoId, tab.url);
    } else {
      showState("welcome");
    }
  } catch (error) {
    console.error("Tab check error:", error);
    showState("welcome");
  }
}

function extractVideoId(url) {
  if(globalThis.YTD_PLATFORM)return YTD_PLATFORM.videoIdFromUrl(url);
  try {
    const urlObj = new URL(url);

    if (
      urlObj.hostname.includes("youtube.com") &&
      urlObj.searchParams.has("v")
    ) {
      return urlObj.searchParams.get("v");
    }

    if (urlObj.hostname === "youtu.be") {
      return urlObj.pathname.slice(1);
    }

    if (urlObj.pathname.startsWith("/embed/")) {
      return urlObj.pathname.split("/")[2];
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// DIGEST PIPELINE
// ============================================================

async function startDigest(videoId, videoUrl) {
  resetTranscriptSearchForVideo(videoId);


  // Check if we already have this video loaded in memory
  if (videoId === currentVideoId && currentAnalysis) {
    showState("results");
    return;
  }

  captureTranscriptPositionBeforeVideoChange(videoId);

  const requestSnapshot = {
    generation: ++digestGeneration,
    videoId,
  };
  activeDigestVideoId = videoId;
  analysisGeneration += 1;
  isAnalysisLoading = false;

  // Every video change invalidates observer work and in-flight translations.
  if (videoId !== currentVideoId) {
    closeActiveExplanationModal?.();
    translationGeneration += 1;
    overviewTranslationGeneration += 1;
    if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
    transcriptScrollObserver = null;
  }

  currentVideoId = videoId;
  globalThis.YTD_LEARNING_UI?.videoChanged();
  globalThis.YTD_ASR_UI?.videoChanged();
  currentVideoUrl = videoUrl;
  currentAnalysis = null;
  currentTranscript = null;
  currentTranscriptText = null;
  currentTranscriptTimestamped = null;
  currentTranscriptLanguage = null;
  currentTranscriptSource = "native";
  currentTranscriptPartial=false;
  currentNativeTranscriptBackup = null;

  await loadPendingTranscriptViewState(requestSnapshot);
  if (!isCurrentDigestRequest(requestSnapshot)) return;

  // Check cache for this video
  const cached = await loadFromCache(videoId, requestSnapshot);
  if (!isCurrentDigestRequest(requestSnapshot)) return;
  if (cached) {
    debugLog("Loading from cache:", videoId);
    currentAnalysis =
      typeof cached.analysis?.summary === "string" && cached.analysis.summary
        ? cached.analysis
        : null;
    if(globalThis.YTD_PLATFORM?.biliParts(videoId)){
      currentVideoTitle=cached.videoTitle||currentVideoTitle;
      currentChannelName=cached.channelName||currentChannelName;
    }
    currentTranscript = cached.transcript;
    currentTranscriptText = cached.transcriptText;
    currentTranscriptTimestamped = cached.transcriptTimestamped;
    currentTranscriptLanguage = cached.transcriptLanguage || null;
    currentTranscriptSource = cached.transcriptSource || "native";
    currentTranscriptPartial=Boolean(cached.transcriptPartial);
    currentNativeTranscriptBackup = cached.nativeTranscriptBackup || null;

    // Restore semantic-segment translations from persistent storage.
    if (cached.paragraphCache) {
      for (const [key, value] of Object.entries(cached.paragraphCache)) {
        transcriptParagraphCache.set(key, value);
      }
    }

    if (currentVideoTitle || currentChannelName) {
      const videoInfo = document.getElementById("videoInfo");
      document.getElementById("videoTitle").textContent = currentVideoTitle;
      document.getElementById("videoChannel").textContent = currentChannelName;
      videoInfo.style.display = "block";
    }

    // Always render transcript first
    renderTranscript();

    // Render analysis if we have it cached
    if (currentAnalysis) {
      renderAnalysisResults(currentAnalysis);
      highlightMomentsOnPage(currentAnalysis.keyMoments);
      if (currentOverviewMode !== "original") translateOverview();
    }

    showState("results");
    document.getElementById("tabsNav").style.display = "flex";
    restorePendingTranscriptViewState(requestSnapshot);

    // Load notes for this video
    loadNotes(videoId, requestSnapshot);
    refreshVocabularyEntries(requestSnapshot);

    // Setup explain feature
    setupExplainFeature();
    if (currentTranscriptMode !== "original") translateTranscript();
    return;
  }

  if (currentVideoTitle || currentChannelName) {
    const videoInfo = document.getElementById("videoInfo");
    document.getElementById("videoTitle").textContent = currentVideoTitle;
    document.getElementById("videoChannel").textContent = currentChannelName;
    videoInfo.style.display = "block";
  }

  showState("loading");
  updateLoading("正在获取字幕", "");

  const transcriptResult = await chrome.runtime.sendMessage({
    action: "fetchTranscript",
    videoId: videoId,
    mode: "native",
  });
  if (!isCurrentDigestRequest(requestSnapshot)) return;

  if (!transcriptResult.success) {
    if (transcriptResult.error === "NO_SUPADATA_KEY") {
      showError(
        "尚未配置密钥",
        "请在设置中填写 YouTube 字幕服务的 Supadata 密钥。",
      );
      return;
    }
    if (transcriptResult.error === "NO_TRANSCRIPT" || transcriptResult.error === "BILI_NO_SUBTITLE") {
      showMissingTranscriptError(
        transcriptResult.message ||
          "这个视频没有可读取的字幕轨。",
      );
      return;
    }
    showError(
      "没有找到字幕",
      transcriptResult.message || transcriptResult.error,
    );
    return;
  }

  await completeTranscriptLoad(videoId, transcriptResult, requestSnapshot);
}

function isCurrentDigestRequest(snapshot) {
  return Boolean(
    snapshot &&
      snapshot.generation === digestGeneration &&
      snapshot.videoId === activeDigestVideoId &&
      snapshot.videoId === currentVideoId,
  );
}

async function completeTranscriptLoad(videoId, transcriptResult, requestSnapshot) {
  if (
    videoId !== requestSnapshot?.videoId ||
    !isCurrentDigestRequest(requestSnapshot)
  ) {
    return false;
  }
  errorAction = null;
  currentTranscript = transcriptResult.transcript;
  currentTranscriptText = transcriptResult.transcriptText;
  currentTranscriptTimestamped = transcriptResult.transcriptTextTimestamped || transcriptResult.transcriptTimestamped;
  currentVideoTitle = transcriptResult.videoTitle || currentVideoTitle;
  currentChannelName = transcriptResult.channelName || currentChannelName;
  currentTranscriptLanguage = transcriptResult.language || null;
  currentTranscriptSource = transcriptResult.source || "native";

  // Render transcript immediately (no LLM needed)
  renderTranscript();
  showState("results");
  document.getElementById("tabsNav").style.display = "flex";
  restorePendingTranscriptViewState(requestSnapshot);

  // Load notes for this video
  loadNotes(videoId, requestSnapshot);
  refreshVocabularyEntries(requestSnapshot);

  // Setup explain feature for text selection
  setupExplainFeature();
  if (currentTranscriptMode !== "original") translateTranscript();

  // Save transcript to cache (without analysis)
  await saveToCache(videoId, requestSnapshot);
  if (!isCurrentDigestRequest(requestSnapshot)) return false;

  // DON'T run LLM analysis automatically - wait for user to click Overview tab
  // This saves tokens when user just wants to see the transcript
  return true;
}

// ============================================================
// RENDERING
// ============================================================

/**
 * Renders the analysis results into the Overview tab.
 * Shows the full-video summary, chapters, and key quotes.
 */
function renderAnalysisResults(analysis) {
  const summary = document.getElementById("overviewSummary");
  if (summary) {
    summary.innerHTML = renderOverviewField(
      analysis.summary || "摘要暂不可用。",
      "overview-summary",
    );
  }

  // Chapters
  const chapterList = document.getElementById("chapterList");
  chapterList.innerHTML = "";
  (analysis.chapters || []).forEach((chapter, index) => {
    const li = document.createElement("li");
    li.className = "chapter-item";
    li.dataset.seconds = chapter.timestampSeconds;
    li.innerHTML = `
      <span class="chapter-timestamp">${escapeHtml(chapter.timestamp)}</span>
      <div class="chapter-content">
        <span class="chapter-title">${renderOverviewField(chapter.title, `chapter-title-${index}`)}</span>
        <span class="chapter-summary">${renderOverviewField(chapter.summary || "", `chapter-summary-${index}`)}</span>
      </div>
    `;
    li.addEventListener("click", () => {
      debugLog(
        "[YouTube Digest Panel] Chapter clicked:",
        chapter.timestamp,
        chapter.timestampSeconds,
      );
      seekTo(chapter.timestampSeconds);
    });
    chapterList.appendChild(li);
  });

  // Quotes - sort by timestamp (chronological order)
  const quotesList = document.getElementById("quotesList");
  quotesList.innerHTML = "";
  const sortedQuotes = [...(analysis.keyQuotes || [])].sort(
    (a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0),
  );
  sortedQuotes.forEach((quote, index) => {
    const quoteFieldId = `quote-${index}`;
    const quoteTranslationReady =
      currentOverviewMode === "original" ||
      Boolean(getOverviewTranslation(quoteFieldId));
    const div = document.createElement("div");
    div.className = "quote-item";
    div.dataset.seconds = quote.timestampSeconds;
    div.innerHTML = `
      <div class="quote-text">${renderOverviewField(quote.quote, quoteFieldId)}</div>
      <div class="quote-meta">
        <span class="quote-timestamp">${escapeHtml(quote.timestamp)}</span>
        <div class="quote-actions">
          <button class="quote-save-note-btn" title="${quoteTranslationReady ? "将这句保存为笔记" : "请等待当前语言翻译完成"}" ${quoteTranslationReady ? "" : "disabled"}>${quoteTranslationReady ? "📝 记笔记" : "正在翻译…"}</button>
          <button class="quote-copy-btn" title="复制这句">⧉ 复制</button>
        </div>
      </div>
    `;
    div.addEventListener("click", () => {
      debugLog(
        "[YouTube Digest Panel] Quote clicked:",
        quote.timestamp,
        quote.timestampSeconds,
      );
      seekTo(quote.timestampSeconds);
    });

    const quoteCopyBtn = div.querySelector(".quote-copy-btn");
    quoteCopyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(
          getOverviewFieldDisplayText(quote.quote, `quote-${index}`),
        );
        quoteCopyBtn.textContent = "✓ 已复制";
        setTimeout(() => {
          quoteCopyBtn.textContent = "⧉ 复制";
        }, 1500);
      } catch (err) {
        console.error("Copy failed:", err);
      }
    });

    const quoteSaveNoteBtn = div.querySelector(".quote-save-note-btn");
    quoteSaveNoteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await saveQuoteAsNote(quote, quoteFieldId, quoteSaveNoteBtn);
    });

    quotesList.appendChild(div);
  });
}

/**
 * Saves a key quote as a timestamped note.
 */
async function saveQuoteAsNote(quote, fieldId, btn) {
  if (!currentVideoId) return;

  const translatedText = getOverviewTranslation(fieldId);
  if (currentOverviewMode !== "original" && !translatedText) return;
  const noteText = getOverviewFieldDisplayText(quote.quote, fieldId);

  const originalText = btn.textContent;
  btn.textContent = "正在保存…";
  btn.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveOverviewNote",
      videoId: currentVideoId,
      timestamp: quote.timestampSeconds,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      noteText,
      rawText: quote.quote,
      languageMode: currentOverviewMode,
    });

    if (result.success) {
      btn.textContent = "✓ 已保存";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
      // Refresh notes list if on Notes tab
      loadNotes(currentVideoId);
    } else {
      console.error("[YouTube Digest] Save quote as note failed:", result.error);
      btn.textContent = "出错了";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
    }
  } catch (error) {
    console.error("[YouTube Digest] Save quote as note error:", error);
    btn.textContent = "出错了";
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 1500);
  }
}

/**
 * Legacy function for backwards compatibility with cached data.
 * Renders both transcript and analysis.
 */
function renderResults(analysis) {
  renderAnalysisResults(analysis);

  renderTranscript();

  document.getElementById("tabsNav").style.display = "flex";

  // Setup explain feature for text selection
  setupExplainFeature();
}

/**
 * Returns true while the user has a range of text selected.
 * Transcript row clicks must not seek in that state: the click emitted after
 * selection mouseup belongs to the selection/explain interaction, not playback.
 */
function hasNonCollapsedTextSelection() {
  const selection = window.getSelection();
  return Boolean(
    selection && selection.rangeCount > 0 && !selection.isCollapsed,
  );
}

/**
 * Preserves normal row-click seeking while keeping text selection inert.
 */
async function seekFromTranscriptEntryClick(event, seconds) {
  if (hasNonCollapsedTextSelection()) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const clickedEntry = event.currentTarget?.matches?.(".transcript-entry") ? event.currentTarget : event.target?.closest?.(".transcript-entry");
  const status = document.getElementById("playbackPositionStatus");
  if (status) status.textContent = "";
  const snapshot = sentenceFollowSnapshot();
  const request = ++transcriptSeekRevision;
  // Dispatch playback before touching scroll geometry: a layout failure must
  // never swallow the actual video jump.
  const pendingSeek = seekTo(seconds, { play: true });
  try { if (clickedEntry?.matches?.(".transcript-entry")) scrollTranscriptEntry(clickedEntry, "instant"); } catch (_) {}
  const success = await pendingSeek;
  if (!success && status) status.textContent = "未能跳转播放，请刷新视频页面后重试。";
  if (!success || request !== transcriptSeekRevision ||
      snapshot.videoId !== currentVideoId || snapshot.generation !== digestGeneration ||
      snapshot.revision !== manualTranscriptScrollRevision || !transcriptTabIsActive()) return;
  autoScrollEnabled = true;
  const button = document.getElementById("followPlaybackBtn");
  if (button) button.style.display = "none";
  highlightActiveEntry(Number(seconds));
  // Reposition even if polling already highlighted this row while seeking.
  if (clickedEntry?.isConnected) scrollTranscriptEntry(clickedEntry, "instant");
  else scrollToActiveEntry("instant");
}

function getDisplayedTranscriptRowText(row) {
  const originalOnly = row.querySelector(".transcript-text");
  if (originalOnly) {
    return String(originalOnly.textContent || "").replace(/\s+/g, " ").trim();
  }

  const parts = [];
  const original = row.querySelector(".transcript-original");
  const translation = row.querySelector(".transcript-translation");
  if (original?.textContent?.trim()) {
    parts.push(original.textContent.replace(/\s+/g, " ").trim());
  }
  if (
    translation?.textContent?.trim() &&
    !translation.classList.contains("translation-pending") &&
    !translation.classList.contains("translation-error")
  ) {
    parts.push(translation.textContent.replace(/\s+/g, " ").trim());
  }
  return parts.join("\n");
}

function getTranscriptRowActionMetadata(row, segment) {
  const displayedText = getDisplayedTranscriptRowText(row);
  if (!displayedText) return null;
  const metadata = buildVocabularySelectionMetadata(
    displayedText,
    row,
    getActiveTranscriptSegments(),
    currentTranscriptText || "",
    {
      videoId: currentVideoId,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
    },
  );
  if (!metadata.sourceExcerpt && segment?.text) {
    metadata.sourceExcerpt = segment.text;
  }
  return metadata;
}

function bindTranscriptRowAction(button, row, segment, handler) {
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const metadata = getTranscriptRowActionMetadata(row, segment);
    if (!metadata?.term) return;
    await handler(metadata);
  });
}

function syncTranscriptRowActions(row) {
  const unavailable = !getDisplayedTranscriptRowText(row);
  row.querySelectorAll(".transcript-row-action").forEach((button) => {
    button.disabled = unavailable;
  });
}

function addTranscriptRowActions(row, segment) {
  const actions = document.createElement("div");
  actions.className = "transcript-row-actions";

  const explainButton = document.createElement("button");
  explainButton.className = "transcript-row-action transcript-row-explain";
  explainButton.type = "button";
  explainButton.textContent = "解释";
  explainButton.setAttribute("aria-label", "解释这段字幕");
  bindTranscriptRowAction(explainButton, row, segment, async (metadata) => {
    await showExplanation(metadata.term, metadata.context, metadata, explainButton);
  });

  const saveButton = document.createElement("button");
  saveButton.className = "transcript-row-action transcript-row-save";
  saveButton.type = "button";
  const immersive = /[?&]immersive=1(?:&|$)/.test(globalThis.location?.search||"");
  saveButton.textContent = immersive ? "收藏句子" : "收藏";
  saveButton.setAttribute(
    "aria-label",
    immersive ? "收藏这句英文字幕" : "将这段字幕收藏为词条",
  );
  bindTranscriptRowAction(saveButton, row, segment, async (metadata) => {
    if(!immersive){await saveVocabularySelection(metadata, saveButton);return;}
    const followSnapshot = sentenceFollowSnapshot();
    saveButton.disabled=true;
    try{
      const r=await chrome.runtime.sendMessage({action:'saveSentence',...metadata,term:segment.text,sourceExcerpt:segment.text,context:segment.text,timestamp:segment.start});
      if(!r?.success)throw new Error(r?.error||'收藏失败，请重试。');
      saveButton.textContent=r.alreadySaved?'已收藏':'已收藏 ✓';
      void followAfterSentenceSave(followSnapshot);
      void globalThis.YTD_LEARNING_UI?.refreshLibrary();
      if(!r.alreadySaved)void chrome.runtime.sendMessage({action:'analyzeSentence',id:r.entry.id}).then(result=>{if(!result?.success)saveButton.title='原句已收藏；解析可到收藏库重试。';}).catch(()=>{});
    }catch(e){saveButton.disabled=false;saveButton.textContent='重试收藏';saveButton.title=e.message;}
  });

  actions.append(explainButton, saveButton);
  row.appendChild(actions);
  syncTranscriptRowActions(row);
}

function renderTranscriptSourceBadge(languageLabel) {
  if(currentTranscriptSource === "local-asr") return `<span class="source-dot source-dot--ai"></span> 英文原声自动转写（本地 Whisper，可能有识别误差） · ${escapeHtml(languageLabel)}`;
  const generated = currentTranscriptSource === "generated";
  const sourceLabel = generated
    ? "由视频音频自动生成"
    : "来自视频字幕";
  const dotClass = generated ? "source-dot--ai" : "source-dot--subs";
  return `<span class="source-dot ${dotClass}"></span> ${sourceLabel} · ${escapeHtml(languageLabel)}`;
}

function renderTranscript() {
  globalThis.YTD_ASR_UI?.refresh();
  if (!currentTranscript) return;

  const transcriptList = document.getElementById("transcriptList");
  transcriptList.innerHTML = "";

  // Show whether text came from an existing subtitle track or opt-in audio
  // transcription, so users can judge the source before relying on it.
  const existingBadge = document.getElementById("transcriptSourceBadge");
  if (existingBadge) existingBadge.remove();

  const badge = document.createElement("div");
  badge.id = "transcriptSourceBadge";
  badge.className = "transcript-source-badge";
  badge.innerHTML = renderTranscriptSourceBadge(getOriginalTranscriptLabel());
  transcriptList.parentElement.insertBefore(badge, transcriptList);

  // Group entries using smart sentence-boundary + time-guardrail logic
  const grouped = groupTranscriptEntries(currentTranscript);

  grouped.forEach((group, index) => {
    const div = document.createElement("div");
    div.className = "transcript-entry";
    div.dataset.seconds = group.start;
    div.dataset.segmentId = group.id;
    div.dataset.segmentIndex = index;

    const minutes = Math.floor(group.start / 60);
    const seconds = Math.floor(group.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

    div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      <span class="transcript-text">${renderSubtitleInlineMarkup(group.text)}</span>
    `;

    addTranscriptRowActions(div, group);

    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, group.start),
    );
    transcriptList.appendChild(div);
  });

  refreshTranscriptHighlights(transcriptList);

  // Start tracking video playback for auto-scroll
  startPlaybackTracking();
}

function copyTranscript() {
  copyToClipboardWithFeedback(currentTranscriptText || "", "copyTranscriptBtn");
}

function exportTranscript() {
  const transcriptContent = currentTranscriptText || "";
  const videoUrl = globalThis.YTD_PLATFORM?.sourceUrl(currentVideoId) || `https://youtube.com/watch?v=${currentVideoId}`;

  let exportText = "";
  exportText += `视频字幕\n`;
  exportText += `${"=".repeat(60)}\n\n`;
  exportText += `标题：${currentVideoTitle || "未知"}\n`;
  exportText += `作者：${currentChannelName || "未知"}\n`;
  exportText += `来源：${videoUrl}\n`;
  exportText += `\n${"—".repeat(60)}\n\n`;

  if (currentVideoDescription) {
    exportText += `视频简介：\n${currentVideoDescription}\n`;
    exportText += `\n${"—".repeat(60)}\n\n`;
  }

  exportText += `字幕原文：\n\n${transcriptContent}\n`;
  exportText += `\n${"—".repeat(60)}\n`;
  exportText += `由视频英语学习导出\n`;

  const filename = `${sanitizeFilename(currentVideoTitle)}-transcript.txt`;
  downloadTextFile(exportText, filename);
}

// ============================================================
// UI STATE MANAGEMENT
// ============================================================

function showState(state) {
  document.getElementById("welcomeState").style.display =
    state === "welcome" ? "flex" : "none";
  document.getElementById("loadingState").style.display =
    state === "loading" ? "block" : "none";
  document.getElementById("errorState").style.display =
    state === "error" ? "block" : "none";
  const uploadEl = document.getElementById("uploadState");
  if (uploadEl) uploadEl.style.display = "none"; // Upload state removed — always hidden
  document.getElementById("resultsState").style.display =
    state === "results" ? "block" : "none";

  // The tab bar only belongs on the results view. We toggle it HERE, in one
  // place, so it tracks the view automatically. Previously each caller had to
  // remember to re-show it after showState("results"), and one path forgot —
  // which is why the tabs could vanish when re-opening an already-analyzed video.
  document.getElementById("tabsNav").style.display =
    state === "results" ? "flex" : "none";

  if (state !== "results") {
    closeActiveExplanationModal?.();
    stopPlaybackTracking();
  }
}

function updateLoading(title, subtitle) {
  document.getElementById("loadingText").textContent = title;
  document.getElementById("loadingSubtext").textContent = subtitle;
}

function showError(title, message) {
  errorAction = null;
  showState("error");
  document.getElementById("errorTitle").textContent = title;
  document.getElementById("errorMessage").textContent = message;
  document.getElementById("errorBtn").textContent = "重试";
}

function buildAudioTranscriptionConfirmation(durationSeconds) {
  const seconds = Number(durationSeconds) || 0;
  if (seconds <= 0) {
    return (
      "Supadata 将从视频音频生成字幕。" +
      "每分钟约使用 2 个额度，可能需要等待几分钟。是否继续？"
    );
  }

  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const estimatedCredits = minutes * 2;
  return (
    `视频约 ${minutes} 分钟，` +
    `音频转写预计使用约 ${estimatedCredits} 个 Supadata 额度，` +
    "可能需要等待几分钟。是否继续？"
  );
}

function showMissingTranscriptError(message) {
  if (YTD_PLATFORM.biliParts(currentVideoId)) {
    showError("没有可读取的字幕轨", "可以尝试识别英文原声，生成可点击、收藏的双语字幕。点击下方开始，前 20 句准备好后即可边看边加载；需本地转写服务运行。");
    document.getElementById("errorBtn").textContent="识别英文原声，生成双语字幕";
    errorAction=async()=>{
      document.documentElement.setAttribute('data-awaiting-english','');
      showState('results');switchTab('transcript');renderTranscript();
      await globalThis.YTD_ASR_UI?.start();
    };
    return;
  }
  showError("没有找到字幕", message);
  document.getElementById("errorBtn").textContent =
    "从音频生成字幕";
  errorAction = generateTranscriptFromAudio;
}

async function generateTranscriptFromAudio() {
  if (!currentVideoId) return;
  const confirmed = window.confirm(
    buildAudioTranscriptionConfirmation(currentVideoDuration),
  );
  if (!confirmed) return;

  const videoId = currentVideoId;
  const requestSnapshot = {
    generation: digestGeneration,
    videoId,
  };
  errorAction = null;
  showState("loading");
  updateLoading(
    "正在从音频生成字幕",
    "生成可能需要几分钟，请保持侧栏打开。",
  );

  try {
    const transcriptResult = await chrome.runtime.sendMessage({
      action: "fetchTranscript",
      videoId,
      mode: "generate",
    });
    if (!isCurrentDigestRequest(requestSnapshot)) return;

    if (!transcriptResult.success) {
      showError(
        "字幕生成失败",
        transcriptResult.message || transcriptResult.error,
      );
      document.getElementById("errorBtn").textContent = "重新生成";
      errorAction = generateTranscriptFromAudio;
      return;
    }

    await completeTranscriptLoad(videoId, transcriptResult, requestSnapshot);
  } catch (error) {
    if (!isCurrentDigestRequest(requestSnapshot)) return;
    showError("字幕生成失败", error.message || "请重试。");
    document.getElementById("errorBtn").textContent = "重新生成";
    errorAction = generateTranscriptFromAudio;
  }
}

function showConfigError(configStatus) {
  const missingKeys = [];
  if (!configStatus.hasSupadataKey) missingKeys.push("Supadata");
  if (!configStatus.hasAiKey) missingKeys.push("AI 服务");

  showState("error");
  document.getElementById("errorTitle").textContent = "尚未配置密钥";
  document.getElementById("errorMessage").textContent =
    `Add your ${missingKeys.join(" and ")} API key${missingKeys.length === 1 ? "" : "s"} in YouTube Digest Settings.`;
  document.getElementById("errorBtn").textContent = "打开设置";
  errorAction = () => chrome.runtime.sendMessage({ action: "openOptions" });
}

// ============================================================
// TAB SWITCHING
// ============================================================

function switchTab(tabName) {
  const contentArea = document.getElementById("contentArea");
  if (transcriptTabIsActive() && tabName !== "transcript") {
    captureTranscriptViewPosition({ immediate: true });
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });

  // Start/stop playback tracking based on which tab is active
  if (tabName === "transcript") {
    startPlaybackTracking();
    restorePendingTranscriptViewState({
      videoId: currentVideoId,
      generation: digestGeneration,
    });
  } else {
    stopPlaybackTracking();
  }

  // Lazy-load LLM analysis when user switches to Overview tab
  if (tabName === "overview" && !currentAnalysis && !isAnalysisLoading) {
    triggerAnalysis();
  }


  globalThis.YTD_LEARNING_UI?.tabChanged(tabName);
  if (tabName === "library") {
    if (currentLibraryView === "vocabulary") {
      renderVocabularyForCurrentFilter();
    } else if (currentLibraryView === "notes") {
      const showAll = document
        .getElementById("notesFilterAll")
        ?.classList.contains("active");
      loadNotes(showAll ? null : currentVideoId);
    }
  }
}

// ============================================================
// ANALYSIS
// ============================================================

async function triggerAnalysis() {
  if (!currentTranscriptTimestamped || isAnalysisLoading || currentAnalysis)
    return;

  const requestSnapshot = {
    analysisGeneration: ++analysisGeneration,
    digestGeneration,
    videoId: currentVideoId,
    transcriptTimestamped: currentTranscriptTimestamped,
  };
  isAnalysisLoading = true;

  // Show loading indicators in the Overview tab
  const chapterList = document.getElementById("chapterList");
  const quotesList = document.getElementById("quotesList");
  const summary = document.getElementById("overviewSummary");

  if (summary) summary.textContent = "正在生成摘要…";
  if (chapterList)
    chapterList.innerHTML =
      '<li class="chapter-item" style="color: var(--text-muted); border: none;">正在生成章节…</li>';
  if (quotesList)
    quotesList.innerHTML =
      '<div class="quote-item" style="color: var(--text-muted); border-left-color: var(--border);">正在提取重点语句…</div>';

  try {
    const analysisResult = await chrome.runtime.sendMessage({
      action: "analyzeTranscript",
      transcriptText: currentTranscriptTimestamped,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      videoDescription: currentVideoDescription,
      videoDuration: currentVideoDuration,
    });
    if (!isCurrentAnalysisRequest(requestSnapshot)) return;

    if (!analysisResult.success) {
      if (chapterList)
        chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">解析失败：${escapeHtml(analysisResult.error || "未知错误")}</li>`;
      return;
    }

    currentAnalysis = analysisResult.analysis;
    renderAnalysisResults(currentAnalysis);
    highlightMomentsOnPage(currentAnalysis.keyMoments);
    if (currentOverviewMode !== "original") await translateOverview();
    if (!isCurrentAnalysisRequest(requestSnapshot)) return;

    // Save to cache now that we have analysis
    await saveToCache(requestSnapshot.videoId, requestSnapshot);
  } catch (error) {
    if (!isCurrentAnalysisRequest(requestSnapshot)) return;
    console.error("[YouTube Digest Panel] Analysis error:", error);
    if (chapterList)
      chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">错误：${escapeHtml(error.message)}</li>`;
  } finally {
    if (isCurrentAnalysisRequest(requestSnapshot)) {
      isAnalysisLoading = false;
    }
  }
}

function isCurrentAnalysisRequest(snapshot) {
  return Boolean(
    snapshot &&
      snapshot.analysisGeneration === analysisGeneration &&
      snapshot.digestGeneration === digestGeneration &&
      snapshot.videoId === currentVideoId &&
      snapshot.transcriptTimestamped === currentTranscriptTimestamped,
  );
}

// ============================================================
// TIMESTAMP / SEEK
// ============================================================

async function seekTo(seconds, { play = false } = {}) {
  debugLog("[YouTube Digest Panel] seekTo called with:", seconds);
  if (seconds === undefined || seconds === null) {
    debugLog("[YouTube Digest Panel] seekTo aborted - no seconds value");
    return;
  }

  const payload = {
    action: "seekTo",
    seconds: Number(seconds),
    play,
  };

  try {
    // Try direct messaging to the stored YouTube tab first (fastest/reliable)
    if (youtubeTabId) {
      try {
        const response = await chrome.tabs.sendMessage(youtubeTabId, payload);
        if (response?.success) {
          debugLog("[YouTube Digest Panel] seekTo direct success");
          return true;
        }
        // A stale stored tab must not suppress the active-tab fallback.
      } catch (directErr) {
        debugLog(
          "[YouTube Digest Panel] Direct seekTo failed, falling back to relay:",
          directErr.message,
        );
      }
    }

    // Fallback: route through background script
    const result = await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload,
    });
    debugLog("[YouTube Digest Panel] seekTo relay result:", result);
    return Boolean(result?.success && result.response?.success);
  } catch (error) {
    console.error("[YouTube Digest Panel] seekTo error:", error);
    return false;
  }
}

/**
 * Plays a saved note at its timestamp.
 * - If the note belongs to the video currently open, we seek the player in place.
 * - If it belongs to a DIFFERENT video (e.g. viewing "全部笔记"), seeking the
 *   current player would jump to the wrong content, so we open that video in a
 *   new tab at the right timestamp instead.
 */
function playNote(note) {
  if (note.videoId && note.videoId === currentVideoId) {
    seekTo(note.timestampSeconds);
  } else {
    // note.timestampedUrl already includes the &t=<seconds>s anchor
    chrome.tabs.create({ url: note.timestampedUrl });
  }
}

async function highlightMomentsOnPage(moments) {
  if (!moments || !moments.length) return;

  try {
    // Route through background script for reliable message passing
    await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload: {
        action: "highlightMoments",
        moments: moments,
        videoDuration: currentVideoDuration,
      },
    });
  } catch (error) {
    console.error("Highlight error:", error);
  }
}

// ============================================================
// UTILITY
// ============================================================

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

/**
 * Renders the small subset of inline formatting commonly present in subtitle
 * tracks and model translations. Everything is escaped first; only exact,
 * attribute-free allowlisted tags are restored as markup afterwards.
 */
function renderSubtitleInlineMarkup(text) {
  return escapeHtml(text).replace(
    /&lt;(\/?)(i|em|b|strong|u)&gt;|&lt;br(?:\s*\/)?&gt;/gi,
    (_match, closing, tagName) =>
      tagName ? `<${closing}${tagName.toLowerCase()}>` : "<br>",
  );
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("Copy failed:", error);
    return false;
  }
}

async function copyToClipboardWithFeedback(text, buttonId) {
  const btn = document.getElementById(buttonId);
  const original = btn.textContent;

  const success = await copyToClipboard(text);
  if (success) {
    btn.textContent = "✓ 已复制";
    setTimeout(() => {
      btn.textContent = original;
    }, 2000);
  }
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(str) {
  return (str || "untitled")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50)
    .toLowerCase();
}

// ============================================================
// TEXT SELECTION — EXPLAIN FEATURE
// ============================================================

/**
 * Sets up text selection handling in the transcript.
 * When user selects text, shows Explain and vocabulary Save actions.
 */
function setupExplainFeature() {
  globalThis.YTD_LEARNING_UI?.installCapture();
}

/**
 * Finds the semantic transcript row containing either end of the selection.
 */
function getSelectionTranscriptEntry(selection, transcriptList) {
  for (const node of [selection?.anchorNode, selection?.focusNode]) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const entry = element?.closest?.(".transcript-entry");
    if (entry && transcriptList.contains(entry)) return entry;
  }
  return null;
}

/**
 * Uses stable row metadata to recover original source context even when the
 * visible selection came from a Chinese translation. String lookup remains a
 * fallback for legacy rows or selections without semantic metadata.
 */
function buildExplainContextFromSelection(
  selectedText,
  transcriptEntry,
  sourceSegments,
  fullText,
) {
  const segments = Array.isArray(sourceSegments) ? sourceSegments : [];
  const segmentId = transcriptEntry?.dataset?.segmentId || "";
  let index = segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) {
    const datasetIndex = Number(transcriptEntry?.dataset?.segmentIndex);
    if (Number.isInteger(datasetIndex) && segments[datasetIndex]) {
      index = datasetIndex;
    }
  }

  if (index >= 0) {
    return segments
      .slice(Math.max(0, index - 1), Math.min(segments.length, index + 2))
      .map((segment) => segment.text)
      .filter(Boolean)
      .join(" ");
  }

  return getTranscriptContext(selectedText, fullText);
}

function renderExplanationText(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

function renderExplanationContent(mode, english, chinese, translationError) {
  const normalizedMode = ["english", "zh", "bilingual"].includes(mode)
    ? mode
    : "english";
  const source = `<section class="explain-text explain-source" lang="en">${renderExplanationText(english)}</section>`;
  const translation = chinese
    ? `<section class="explain-text explain-translation" lang="zh-CN">${renderExplanationText(chinese)}</section>`
    : translationError
      ? `<div class="explain-translation-error"><span>${escapeHtml(translationError)}</span><button class="explain-retry-btn" type="button">重试</button></div>`
      : `<div class="explain-loading explain-translation-loading"><div class="loading-bar"></div><span>正在翻译…</span></div>`;

  if (normalizedMode === "english") return source;
  if (normalizedMode === "zh" && chinese) return translation;
  if (normalizedMode === "zh" && translationError) {
    return `${source}${translation}`;
  }
  if (normalizedMode === "zh") return translation;
  return `${source}<div class="explain-bilingual-divider" role="separator"></div>${translation}`;
}

function createExplanationTranslationState(
  english = "",
  videoId = null,
  videoTitle = "",
) {
  return {
    mode: "english",
    english: String(english || ""),
    videoId,
    videoTitle: String(videoTitle || ""),
    chinese: "",
    translationError: "",
    translationPromise: null,
    translationGeneration: 0,
  };
}

/**
 * Lazily translates one English explanation. The state belongs to one modal,
 * so duplicate language switches share a request and late detached-modal
 * replies cannot mutate the current UI.
 */
function ensureExplanationTranslation(
  state,
  {
    sendMessage = sendTranslationMessage,
    videoTitle = state.videoTitle,
    isCurrent = () => true,
    retry = false,
  } = {},
) {
  if (state.chinese) return Promise.resolve(state.chinese);
  if (state.translationPromise) return state.translationPromise;
  if (state.translationError && !retry) return Promise.resolve("");
  if (!state.english) return Promise.resolve("");

  const generation = ++state.translationGeneration;
  state.translationError = "";
  let responsePromise;
  try {
    responsePromise = sendMessage({
      action: "translateContent",
      content: {
        segments: [{ id: "explain-0", text: state.english }],
      },
      contentType: "explainBatch",
      targetLanguage: "zh",
      videoTitle,
    });
  } catch (error) {
    responsePromise = Promise.reject(error);
  }
  state.translationPromise = Promise.resolve(responsePromise)
    .then((result) => {
      if (!isCurrent() || generation !== state.translationGeneration) return "";
      if (!result?.success) {
        throw new Error(result?.error || "翻译失败，请重试。");
      }
      const translated = result.translatedContent?.segments?.find(
        (segment) => segment.id === "explain-0",
      )?.text;
      if (!translated?.trim()) throw new Error("翻译没有返回内容，请重试。");
      state.chinese = translated.trim();
      return state.chinese;
    })
    .catch((error) => {
      if (isCurrent() && generation === state.translationGeneration) {
        state.translationError = error.message || "翻译失败，请重试。";
      }
      return "";
    })
    .finally(() => {
      if (generation === state.translationGeneration) {
        state.translationPromise = null;
      }
    });
  return state.translationPromise;
}

/**
 * Shows the explanation modal and fetches one concise English explanation.
 */
function getModalFocusableElements(modal) {
  return Array.from(
    modal.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hidden && element.getAttribute("aria-hidden") !== "true",
  );
}

async function showExplanation(
  selectedText,
  transcriptContext,
  vocabularySelection = null,
  invoker = null,
) {
  const modalVideoId = currentVideoId;
  const modalVideoTitle = currentVideoTitle;
  const modalInvoker = invoker || document.activeElement;
  const modalVocabularySelection = vocabularySelection || {
    term: selectedText,
    sourceExcerpt: selectedText,
    context: transcriptContext,
    videoId: modalVideoId,
    videoTitle: String(modalVideoTitle || ""),
    channelName: currentChannelName,
    timestamp: 0,
  };
  const previousModal = document.getElementById("explainModal");
  if (closeActiveExplanationModal) {
    closeActiveExplanationModal();
  } else if (previousModal) {
    previousModal.remove();
  }

  const modal = document.createElement("div");
  modal.id = "explainModal";
  modal.className = "explain-modal-overlay";
  modal.innerHTML = `
    <div class="explain-modal" role="dialog" aria-modal="true" aria-labelledby="explainModalTitle">
      <div class="explain-modal-header">
        <div class="explain-modal-title" id="explainModalTitle">解释</div>
        <button class="explain-modal-close" id="closeExplain" type="button" aria-label="关闭解释">✕</button>
      </div>
      <div class="explain-selected-text">"${escapeHtml(selectedText.substring(0, 200))}${selectedText.length > 200 ? "..." : ""}"</div>
      <div class="explain-language-controls" role="group" aria-label="解释语言">
        <button class="explain-language-btn" type="button" data-explain-mode="english" aria-pressed="false">英文</button>
        <button class="explain-language-btn active" type="button" data-explain-mode="zh" aria-pressed="true">中文</button>
        <button class="explain-language-btn" type="button" data-explain-mode="bilingual" aria-pressed="false">双语</button>
      </div>
      <div class="explain-modal-content" id="explanationContent">
        <div class="explain-loading">
          <div class="loading-bar"></div>
          <span>正在解析…</span>
        </div>
      </div>
      <div class="explain-modal-actions">
        <button class="explain-save-vocabulary" type="button">收藏为词条</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const state = createExplanationTranslationState(
    "",
    modalVideoId,
    modalVideoTitle,
  );
  const contentDiv = modal.querySelector("#explanationContent");
  state.mode = "zh";
  const modeButtons = modal.querySelectorAll("[data-explain-mode]");
  const closeButton = modal.querySelector("#closeExplain");
  const saveVocabularyButton = modal.querySelector(
    ".explain-save-vocabulary",
  );
  const isCurrent = () =>
    modal.isConnected &&
    currentVideoId === modalVideoId &&
    document.getElementById("explainModal") === modal;
  const render = () => {
    if (!isCurrent()) return;
    if (!state.english) return;
    contentDiv.innerHTML = renderExplanationContent(
      state.mode,
      state.english,
      state.chinese,
      state.translationError,
    );
  };
  const requestChinese = async () => {
    if (!state.english || state.mode === "english") return;
    render();
    await ensureExplanationTranslation(state, {
      videoTitle: modalVideoTitle,
      isCurrent,
    });
    render();
  };
  let closed = false;
  const closeModal = () => {
    if (closed) return;
    closed = true;
    state.translationGeneration += 1;
    modal.remove();
    if (closeActiveExplanationModal === closeModal) {
      closeActiveExplanationModal = null;
    }
    if (modalInvoker?.isConnected && typeof modalInvoker.focus === "function") {
      modalInvoker.focus({ preventScroll: true });
    }
  };
  closeActiveExplanationModal = closeModal;

  // Close handlers
  closeButton.addEventListener("click", closeModal);
  saveVocabularyButton.addEventListener("click", () =>
    saveVocabularySelection(modalVocabularySelection, saveVocabularyButton),
  );
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key === "Tab") {
      const focusable = getModalFocusableElements(modal);
      if (!focusable.length) {
        event.preventDefault();
        closeButton.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !modal.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !modal.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
  });
  closeButton.focus({ preventScroll: true });
  modeButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      state.mode = button.dataset.explainMode;
      modeButtons.forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      render();
      await requestChinese();
    });
  });
  contentDiv.addEventListener("click", async (event) => {
    if (!event.target.closest(".explain-retry-btn")) return;
    const retryPromise = ensureExplanationTranslation(state, {
      videoTitle: modalVideoTitle,
      isCurrent,
      retry: true,
    });
    render();
    await retryPromise;
    render();
  });

  // Fetch explanation
  try {
    const result = await chrome.runtime.sendMessage({
      action: "explainSelection",
      selectedText: selectedText,
      transcriptContext: transcriptContext,
      videoTitle: modalVideoTitle,
    });

    if (!isCurrent()) return;
    if (result.success) {
      state.english = String(result.explanation || "").trim();
      if (!state.english) {
        contentDiv.innerHTML = `<div class="explain-error">解释内容为空，请重试。</div>`;
        return;
      }
      render();
      await requestChinese();
    } else {
      contentDiv.innerHTML = `<div class="explain-error">获取解释失败：${escapeHtml(result.error)}</div>`;
    }
  } catch (error) {
    if (!isCurrent()) return;
    contentDiv.innerHTML = `<div class="explain-error">错误：${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Gets surrounding context from the transcript for the selected text.
 */
function getTranscriptContext(selectedText, transcriptText = currentTranscriptText || "") {
  const fullText = transcriptText || "";
  const index = fullText.indexOf(selectedText);

  if (index === -1) return "";

  // Get 200 chars before and after
  const start = Math.max(0, index - 200);
  const end = Math.min(fullText.length, index + selectedText.length + 200);

  return fullText.substring(start, end);
}

// ============================================================
// LIBRARY / VOCABULARY
// ============================================================

/**
 * Captures the displayed selection while recovering its original subtitle
 * excerpt and context from stable row metadata.
 */
function buildVocabularySelectionMetadata(
  selectedText,
  transcriptEntry,
  sourceSegments,
  fullText,
  videoMetadata = {},
) {
  const segments = Array.isArray(sourceSegments) ? sourceSegments : [];
  const segmentId = transcriptEntry?.dataset?.segmentId || "";
  let index = segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) {
    const datasetIndex = Number(transcriptEntry?.dataset?.segmentIndex);
    if (Number.isInteger(datasetIndex) && segments[datasetIndex]) {
      index = datasetIndex;
    }
  }

  const sourceExcerpt = index >= 0
    ? String(segments[index]?.text || "")
    : String(selectedText || "");
  const context = index >= 0
    ? segments
        .slice(Math.max(0, index - 1), Math.min(segments.length, index + 2))
        .map((segment) => segment.text)
        .filter(Boolean)
        .join(" ")
    : getTranscriptContext(selectedText, fullText);
  const rowSeconds = Number(transcriptEntry?.dataset?.seconds);
  const segmentSeconds = Number(segments[index]?.start);
  const timestamp = Number.isFinite(rowSeconds)
    ? rowSeconds
    : Number.isFinite(segmentSeconds)
      ? segmentSeconds
      : 0;

  return {
    term: String(selectedText || "").trim(),
    sourceExcerpt,
    context,
    videoId: String(videoMetadata.videoId || ""),
    videoTitle: String(videoMetadata.videoTitle || ""),
    channelName: String(videoMetadata.channelName || ""),
    timestamp,
  };
}

function buildVocabularySaveMessage(selection) {
  return {
    action: "saveVocabulary",
    term: String(selection?.term || ""),
    sourceExcerpt: String(selection?.sourceExcerpt || ""),
    context: String(selection?.context || ""),
    videoId: String(selection?.videoId || ""),
    videoTitle: String(selection?.videoTitle || ""),
    channelName: String(selection?.channelName || ""),
    timestamp: Number(selection?.timestamp) || 0,
  };
}

function vocabularySaveKey(selection) {
  const term = String(selection?.term || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
  return `${term}\u0000${selection?.videoId || ""}\u0000${Number(selection?.timestamp) || 0}`;
}

function setVocabularySaveFeedback(button, label, disabled) {
  if (!button) return;
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent || "收藏";
  }
  button.textContent = label;
  button.disabled = disabled;
}

async function saveVocabularySelection(selection, button) {
  const message = buildVocabularySaveMessage(selection);
  if (!message.term || !message.videoId) {
    setVocabularySaveFeedback(button, "收藏失败", false);
    return { success: false };
  }

  const key = vocabularySaveKey(selection);
  setVocabularySaveFeedback(button, "正在保存…", true);
  let request = vocabularySavePromises.get(key);
  if (!request) {
    try {
      request = Promise.resolve(chrome.runtime.sendMessage(message));
    } catch (error) {
      request = Promise.reject(error);
    }
    vocabularySavePromises.set(key, request);
    const clearRequest = () => {
      if (vocabularySavePromises.get(key) === request) {
        vocabularySavePromises.delete(key);
      }
    };
    request.then(clearRequest, clearRequest);
  }

  try {
    const result = await request;
    if (!result?.success) {
      throw new Error(result?.message || result?.error || "收藏失败");
    }
    setVocabularySaveFeedback(
      button,
      result.alreadySaved ? "已收藏" : "已收藏",
      true,
    );
    await refreshVocabularyEntries();
    setTimeout(() => {
      if (!button?.isConnected) return;
      setVocabularySaveFeedback(button, button.dataset.defaultLabel, false);
    }, 1800);
    return result;
  } catch (error) {
    console.error("[YouTube Digest Panel] Save vocabulary error:", error);
    setVocabularySaveFeedback(button, "收藏失败", false);
    return { success: false, error: error.message };
  }
}

async function refreshVocabularyEntries(requestSnapshot = null) {
  const generation = ++vocabularyLoadGeneration;
  try {
    const result = await chrome.runtime.sendMessage({ action: "getVocabulary" });
    if (
      generation !== vocabularyLoadGeneration ||
      (requestSnapshot && !isCurrentDigestRequest(requestSnapshot))
    ) {
      return;
    }
    vocabularyEntries = result?.success && Array.isArray(result.vocabulary)
      ? result.vocabulary
      : [];
    refreshTranscriptHighlights();
    if (currentLibraryView === "vocabulary") {
      renderVocabularyForCurrentFilter();
    }
  } catch (error) {
    if (generation !== vocabularyLoadGeneration) return;
    console.error("[YouTube Digest Panel] Load vocabulary error:", error);
  }
}

function renderVocabularyForCurrentFilter() {
  if (globalThis.YTD_LEARNING_UI) { globalThis.YTD_LEARNING_UI.renderLibrary(); return; }
  const entries = showAllVocabulary
    ? vocabularyEntries
    : vocabularyEntries.filter((entry) => entry.videoId === currentVideoId);
  renderVocabulary(entries, showAllVocabulary ? null : currentVideoId);
}

function getSafeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function resolveVocabularySpeechLanguage(term, sourceLanguage) {
  const spokenTerm = typeof term === "string" ? term.trim() : "";
  if (!spokenTerm) return "";

  if (sourceLanguage === "zh") return "zh-CN";
  if (sourceLanguage === "ja") return "ja-JP";
  if (sourceLanguage === "ko") return "ko-KR";
  if (/[\u3040-\u30ff]/u.test(spokenTerm)) return "ja-JP";
  if (/[\uac00-\ud7af]/u.test(spokenTerm)) return "ko-KR";
  if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(spokenTerm)) {
    return "zh-CN";
  }

  const letters = Array.from(spokenTerm).filter((character) =>
    /\p{L}/u.test(character),
  );
  const isLatin =
    letters.length > 0 &&
    letters.every((character) => /\p{Script=Latin}/u.test(character));
  return isLatin ? "en-US" : "";
}

function selectPreferredSpeechVoice(voices, targetLanguage) {
  const normalizeLanguage = (value) =>
    typeof value === "string"
      ? value.trim().replaceAll("_", "-").toLocaleLowerCase("en-US")
      : "";
  const target = normalizeLanguage(targetLanguage);
  if (!target || !Array.isArray(voices)) return null;
  const targetBase = target.split("-")[0];
  const candidates = voices.filter(
    (voice) => voice && normalizeLanguage(voice.lang),
  );
  const exact = (voice) => normalizeLanguage(voice.lang) === target;
  const baseMatch = (voice) =>
    normalizeLanguage(voice.lang).split("-")[0] === targetBase;
  if (targetBase === "en") {
    const samanthaVoice = candidates.find(
      (voice) =>
        voice.localService === true &&
        normalizeLanguage(voice.lang) === "en-us" &&
        String(voice.name || "").trim().toLocaleLowerCase("en-US") ===
          "samantha",
    );
    if (samanthaVoice) return samanthaVoice;
  }

  return (
    candidates.find(
      (voice) => voice.default && voice.localService && exact(voice),
    ) ||
    candidates.find((voice) => voice.localService && exact(voice)) ||
    candidates.find((voice) => voice.localService && baseMatch(voice)) ||
    candidates.find(
      (voice) => voice.default && (exact(voice) || baseMatch(voice)),
    ) ||
    candidates.find(exact) ||
    candidates.find(baseMatch) ||
    null
  );
}

function speakVocabularyTerm(
  term,
  sourceLanguage,
  speechSynthesis,
  UtteranceCtor,
) {
  const spokenTerm = typeof term === "string" ? term.trim() : "";
  const speechLanguage = resolveVocabularySpeechLanguage(
    spokenTerm,
    sourceLanguage,
  );
  if (
    !spokenTerm ||
    !speechLanguage ||
    !speechSynthesis ||
    typeof speechSynthesis.cancel !== "function" ||
    typeof speechSynthesis.speak !== "function" ||
    typeof UtteranceCtor !== "function"
  ) {
    return false;
  }

  try {
    const utterance = new UtteranceCtor(spokenTerm);
    let voices = [];
    if (typeof speechSynthesis.getVoices === "function") {
      try {
        voices = speechSynthesis.getVoices();
      } catch {
        voices = [];
      }
    }
    const preferredVoice = selectPreferredSpeechVoice(voices, speechLanguage);
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.lang = preferredVoice.lang;
    } else {
      utterance.lang = speechLanguage;
    }
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

function getVocabularySpeechServices() {
  const speechSynthesis =
    typeof window !== "undefined" ? window.speechSynthesis : null;
  const UtteranceCtor =
    typeof SpeechSynthesisUtterance === "function"
      ? SpeechSynthesisUtterance
      : typeof window !== "undefined" &&
          typeof window.SpeechSynthesisUtterance === "function"
        ? window.SpeechSynthesisUtterance
        : null;
  return {
    speechSynthesis,
    UtteranceCtor,
    available: Boolean(
      speechSynthesis &&
        typeof speechSynthesis.cancel === "function" &&
        typeof speechSynthesis.speak === "function" &&
        typeof UtteranceCtor === "function",
    ),
  };
}

function createVocabularySpeakerIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("vocabulary-speaker-icon");

  const speaker = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  speaker.setAttribute("d", "M11 5 6.5 9H3v6h3.5l4.5 4V5Z");
  const wave = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  wave.setAttribute("d", "M15.5 8.5a5 5 0 0 1 0 7");
  svg.append(speaker, wave);
  return svg;
}

function openVocabularyTimestamp(entry, safeUrl) {
  if (!safeUrl) return;
  if (entry.videoId === currentVideoId) {
    seekTo(Number(entry.timestampSeconds) || 0);
    return;
  }
  chrome.tabs.create({ url: safeUrl });
}

function renderVocabulary(entries, filteredVideoId) {
  const vocabularyList = document.getElementById("vocabularyList");
  const vocabularyIntro = document.getElementById("vocabularyIntro");
  if (!vocabularyList || !vocabularyIntro) return;
  vocabularyList.replaceChildren();

  if (!Array.isArray(entries) || entries.length === 0) {
    vocabularyIntro.hidden = false;
    vocabularyIntro.textContent = filteredVideoId
      ? "当前视频还没有单词。悬停或划选英文字幕后收藏。"
      : "还没有单词。悬停或划选英文字幕后收藏。";
    return;
  }

  vocabularyIntro.hidden = true;
  const speechServices = getVocabularySpeechServices();
  entries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "vocabulary-item";

    const header = document.createElement("div");
    header.className = "vocabulary-item-header";
    const termBlock = document.createElement("div");
    termBlock.className = "vocabulary-term-block";
    const term = document.createElement("div");
    term.className = "vocabulary-term";
    term.textContent = String(entry.term || "");
    termBlock.appendChild(term);
    const phoneticText = String(entry.phonetic || "").trim();
    if (phoneticText) {
      const phonetic = document.createElement("div");
      phonetic.className = "vocabulary-phonetic";
      phonetic.textContent = phoneticText;
      termBlock.appendChild(phonetic);
    }

    const headerActions = document.createElement("div");
    headerActions.className = "vocabulary-item-actions";
    const termLabel = String(entry.term || "vocabulary");
    const speechLanguage = resolveVocabularySpeechLanguage(
      termLabel,
      String(entry.sourceLanguage || ""),
    );
    let pronunciationControl;
    if (speechServices.available && speechLanguage) {
      const pronunciationButton = document.createElement("button");
      pronunciationButton.className = "vocabulary-pronunciation";
      pronunciationButton.type = "button";
      pronunciationButton.appendChild(createVocabularySpeakerIcon());
      pronunciationButton.title = `发音：${termLabel}`;
      pronunciationButton.setAttribute("aria-label", `发音：${termLabel}`);
      pronunciationButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        speakVocabularyTerm(
          termLabel,
          String(entry.sourceLanguage || ""),
          speechServices.speechSynthesis,
          speechServices.UtteranceCtor,
        );
      });
      pronunciationControl = pronunciationButton;
    } else {
      const unavailable = document.createElement("span");
      unavailable.className = "vocabulary-pronunciation-unavailable";
      unavailable.textContent = "暂无可用发音";
      unavailable.setAttribute("role", "note");
      unavailable.setAttribute(
        "aria-label",
        `暂无发音：${termLabel}`,
      );
      pronunciationControl = unavailable;
    }
    const deleteButton = document.createElement("button");
    deleteButton.className = "vocabulary-delete";
    deleteButton.type = "button";
    deleteButton.title = "删除词条";
    deleteButton.setAttribute("aria-label", `删除 ${String(entry.term || "词条")}`);
    deleteButton.textContent = "✕";
    deleteButton.addEventListener("click", () =>
      deleteVocabularyEntry(String(entry.id || "")),
    );
    headerActions.append(pronunciationControl, deleteButton);
    header.append(termBlock, headerActions);

    const meaning = document.createElement("div");
    meaning.className = "vocabulary-meaning";
    meaning.textContent = String(entry.meaningZh || "");
    const explanation = document.createElement("div");
    explanation.className = "vocabulary-explanation";
    explanation.textContent = String(entry.explanationZh || "");
    const excerpt = document.createElement("blockquote");
    excerpt.className = "vocabulary-excerpt";
    excerpt.textContent = String(entry.sourceExcerpt || "");

    const footer = document.createElement("div");
    footer.className = "vocabulary-item-footer";
    const safeUrl = getSafeHttpUrl(entry.timestampedUrl);
    const timestampButton = document.createElement("button");
    timestampButton.className = "vocabulary-timestamp";
    timestampButton.type = "button";
    timestampButton.textContent = String(entry.timestamp || "0:00");
    if (safeUrl) {
      timestampButton.addEventListener("click", () =>
        openVocabularyTimestamp(entry, safeUrl),
      );
    } else {
      timestampButton.disabled = true;
      timestampButton.title = "时间点不可用";
    }
    footer.appendChild(timestampButton);

    if (!filteredVideoId) {
      const videoTitle = document.createElement("span");
      videoTitle.className = "vocabulary-video-title";
      videoTitle.textContent = String(entry.videoTitle || "未命名视频");
      footer.appendChild(videoTitle);
    }

    card.append(header, meaning, explanation, excerpt, footer);
    vocabularyList.appendChild(card);
  });
}

async function deleteVocabularyEntry(entryId) {
  if (!entryId) return;
  try {
    const result = await chrome.runtime.sendMessage({
      action: "deleteVocabulary",
      vocabularyId: entryId,
    });
    if (!result?.success) {
      throw new Error(result?.message || result?.error || "删除失败");
    }
    await refreshVocabularyEntries();
  } catch (error) {
    console.error("[YouTube Digest Panel] Delete vocabulary error:", error);
  }
}

function buildNormalizedVocabularyText(value, maxLength) {
  const source = String(value || "").slice(0, maxLength);
  let text = "";
  const starts = [];
  const ends = [];
  let pendingWhitespace = null;

  for (let sourceIndex = 0; sourceIndex < source.length;) {
    const codePoint = source.codePointAt(sourceIndex);
    let sourceCluster = String.fromCodePoint(codePoint);
    let sourceEnd = sourceIndex + sourceCluster.length;
    while (sourceEnd < source.length) {
      const nextCodePoint = source.codePointAt(sourceEnd);
      const nextCharacter = String.fromCodePoint(nextCodePoint);
      if (!/^\p{M}$/u.test(nextCharacter)) break;
      sourceCluster += nextCharacter;
      sourceEnd += nextCharacter.length;
    }
    const normalizedPiece = sourceCluster.normalize("NFKC").toLocaleLowerCase();

    for (const character of normalizedPiece) {
      if (/\s/u.test(character)) {
        if (text && !pendingWhitespace) {
          pendingWhitespace = { start: sourceIndex, end: sourceEnd };
        } else if (pendingWhitespace) {
          pendingWhitespace.end = sourceEnd;
        }
        continue;
      }

      if (pendingWhitespace) {
        text += " ";
        starts.push(pendingWhitespace.start);
        ends.push(pendingWhitespace.end);
        pendingWhitespace = null;
      }
      for (let index = 0; index < character.length; index += 1) {
        text += character[index];
        starts.push(sourceIndex);
        ends.push(sourceEnd);
      }
    }
    sourceIndex = sourceEnd;
  }

  return { source, text, starts, ends };
}

function isLatinWordCharacter(character) {
  return Boolean(character && /[a-z0-9_]/i.test(character));
}

function createTranscriptSearchState(videoId = null) {
  return {
    videoId: videoId || null,
    query: "",
    matches: [],
    currentIndex: -1,
  };
}

function getNextTranscriptSearchIndex(currentIndex, matchCount, direction) {
  if (!Number.isInteger(matchCount) || matchCount <= 0) return -1;
  const step = direction < 0 ? -1 : 1;
  const start = Number.isInteger(currentIndex) ? currentIndex : -1;
  return (start + step + matchCount) % matchCount;
}

function isTranscriptSearchTextNodeEligible(node) {
  const parent = node?.parentElement;
  if (!parent || !String(node.nodeValue || "").trim()) return false;
  if (
    parent.closest(
      ".transcript-search-highlight, .transcript-time, button, a, .transcript-row-actions, .translation-pending, .translation-error",
    )
  ) {
    return false;
  }
  if (!parent.closest(".transcript-entry")) return false;
  return Boolean(
    parent.closest(
      ".transcript-text, .transcript-original, .transcript-translation",
    ),
  );
}

function replaceTranscriptSearchTextNode(textNode, matches) {
  if (!textNode || !Array.isArray(matches) || !matches.length) return [];
  const sourceText = String(textNode.nodeValue || "");
  const ownerDocument = textNode.ownerDocument || document;
  const fragment = ownerDocument.createDocumentFragment();
  const marks = [];
  let cursor = 0;

  matches.forEach((match) => {
    const start = Number(match?.start);
    const end = Number(match?.end);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < cursor ||
      end <= start ||
      end > sourceText.length
    ) {
      return;
    }
    if (start > cursor) {
      fragment.appendChild(ownerDocument.createTextNode(sourceText.slice(cursor, start)));
    }
    const mark = ownerDocument.createElement("mark");
    mark.className = "transcript-search-highlight";
    mark.textContent = sourceText.slice(start, end);
    fragment.appendChild(mark);
    marks.push(mark);
    cursor = end;
  });

  if (!marks.length) return [];
  if (cursor < sourceText.length) {
    fragment.appendChild(ownerDocument.createTextNode(sourceText.slice(cursor)));
  }
  textNode.replaceWith(fragment);
  return marks;
}

function updateTranscriptSearchControls() {
  const matchCount = transcriptSearchState.matches.length;
  const currentNumber = matchCount ? transcriptSearchState.currentIndex + 1 : 0;
  const count = document.getElementById("transcriptSearchCount");
  const clear = document.getElementById("transcriptSearchClear");
  const previous = document.getElementById("transcriptSearchPrevious");
  const next = document.getElementById("transcriptSearchNext");
  if (count) count.textContent = `${currentNumber} / ${matchCount}`;
  if (clear) clear.disabled = !transcriptSearchState.query.trim();
  if (previous) previous.disabled = matchCount === 0;
  if (next) next.disabled = matchCount === 0;
}

function pauseTranscriptAutoFollowForSearch() {
  autoScrollEnabled = false;
  const followPlaybackBtn = document.getElementById("followPlaybackBtn");
  if (followPlaybackBtn) followPlaybackBtn.style.display = "block";
}

function selectTranscriptSearchResult(index, { scroll = false } = {}) {
  const matches = transcriptSearchState.matches;
  if (!matches.length) {
    transcriptSearchState.currentIndex = -1;
    updateTranscriptSearchControls();
    return false;
  }

  const boundedIndex = Math.min(Math.max(Number(index) || 0, 0), matches.length - 1);
  transcriptSearchState.currentIndex = boundedIndex;
  matches.forEach((mark, markIndex) => {
    const current = markIndex === boundedIndex;
    mark.classList?.toggle("current-search-result", current);
    if (current) mark.setAttribute?.("aria-current", "true");
    else mark.removeAttribute?.("aria-current");
  });
  updateTranscriptSearchControls();

  const currentMark = matches[boundedIndex];
  if (scroll && currentMark?.scrollIntoView) {
    pauseTranscriptAutoFollowForSearch();
    lastAutoScrollTime = Date.now();
    currentMark.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  return true;
}

function applyTranscriptSearchHighlights(
  root = document.getElementById("transcriptList"),
  { scrollCurrent = false } = {},
) {
  if (!root) return [];
  const previousIndex = transcriptSearchState.currentIndex;
  clearTranscriptSearchHighlights(root);
  transcriptSearchState.matches = [];

  if (
    transcriptSearchState.videoId !== currentVideoId ||
    !transcriptSearchState.query.trim()
  ) {
    transcriptSearchState.currentIndex = -1;
    updateTranscriptSearchControls();
    return [];
  }

  const ownerDocument = root.ownerDocument || document;
  const walker = ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return isTranscriptSearchTextNodeEligible(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const textNode of textNodes) {
    const remaining =
      TRANSCRIPT_SEARCH_LIMITS.maxMatches - transcriptSearchState.matches.length;
    if (remaining <= 0) break;
    const matches = findLiteralTranscriptMatches(
      textNode.nodeValue || "",
      transcriptSearchState.query,
    ).slice(0, remaining);
    transcriptSearchState.matches.push(
      ...replaceTranscriptSearchTextNode(textNode, matches),
    );
  }

  transcriptSearchState.currentIndex = transcriptSearchState.matches.length
    ? Math.min(Math.max(previousIndex, 0), transcriptSearchState.matches.length - 1)
    : -1;
  selectTranscriptSearchResult(transcriptSearchState.currentIndex, {
    scroll: scrollCurrent,
  });
  return transcriptSearchState.matches;
}

function refreshTranscriptHighlights(
  root = document.getElementById("transcriptList"),
) {
  if (!root) return;
  clearTranscriptSearchHighlights(root);
  applyVocabularyHighlights(root);
  applyTranscriptSearchHighlights(root);
}

function setTranscriptSearchQuery(value, { scroll = false } = {}) {
  const query = String(value || "").slice(
    0,
    TRANSCRIPT_SEARCH_LIMITS.maxQueryLength,
  );
  transcriptSearchState.query = query;
  transcriptSearchState.currentIndex = query.trim() ? 0 : -1;
  applyTranscriptSearchHighlights(document.getElementById("transcriptList"), {
    scrollCurrent: scroll && Boolean(query.trim()),
  });
}

function navigateTranscriptSearch(direction) {
  const nextIndex = getNextTranscriptSearchIndex(
    transcriptSearchState.currentIndex,
    transcriptSearchState.matches.length,
    direction,
  );
  return selectTranscriptSearchResult(nextIndex, { scroll: true });
}

function clearTranscriptSearch() {
  clearTranscriptSearchHighlights();
  transcriptSearchState = createTranscriptSearchState(currentVideoId);
  const input = document.getElementById("transcriptSearchInput");
  if (input) input.value = "";
  updateTranscriptSearchControls();
}

function resetTranscriptSearchForVideo(videoId) {
  if (transcriptSearchState.videoId === (videoId || null)) return;
  clearTranscriptSearchHighlights();
  transcriptSearchState = createTranscriptSearchState(videoId);
  const input = document.getElementById("transcriptSearchInput");
  if (input) input.value = "";
  updateTranscriptSearchControls();
}

/**
 * Finds bounded, non-overlapping literal matches in one rendered Transcript
 * segment. Normalization keeps source offsets while indexOf avoids treating
 * user input as a regular expression.
 */
function findLiteralTranscriptMatches(text, query) {
  const trimmedQuery = String(query || "").trim();
  if (
    !trimmedQuery ||
    trimmedQuery.length > TRANSCRIPT_SEARCH_LIMITS.maxQueryLength
  ) {
    return [];
  }

  const normalizedText = buildNormalizedVocabularyText(
    text,
    TRANSCRIPT_SEARCH_LIMITS.maxTextLength,
  );
  const normalizedQuery = buildNormalizedVocabularyText(
    trimmedQuery,
    TRANSCRIPT_SEARCH_LIMITS.maxQueryLength,
  ).text;
  if (!normalizedText.text || !normalizedQuery) return [];

  const matches = [];
  let fromIndex = 0;
  while (
    fromIndex <= normalizedText.text.length - normalizedQuery.length &&
    matches.length < TRANSCRIPT_SEARCH_LIMITS.maxMatches
  ) {
    const matchIndex = normalizedText.text.indexOf(normalizedQuery, fromIndex);
    if (matchIndex < 0) break;
    const normalizedEnd = matchIndex + normalizedQuery.length;
    const start = normalizedText.starts[matchIndex];
    const end = normalizedText.ends[normalizedEnd - 1];
    if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
      matches.push({ start, end });
    }
    fromIndex = normalizedEnd;
  }
  return matches;
}

function clearTranscriptSearchHighlights(
  root = document.getElementById("transcriptList"),
) {
  if (!root) return;
  const ownerDocument = root.ownerDocument || document;
  root
    .querySelectorAll("mark.transcript-search-highlight")
    .forEach((mark) => {
      const textNode = ownerDocument.createTextNode(mark.textContent || "");
      const parent = mark.parentNode;
      mark.replaceWith(textNode);
      parent?.normalize();
    });
}

/**
 * Plans literal text matches without constructing a RegExp from saved input.
 * Longer terms claim overlaps first; all work is bounded by fixed limits.
 */
function planVocabularyMatches(text, entries) {
  const normalizedText = buildNormalizedVocabularyText(
    text,
    VOCABULARY_MATCH_LIMITS.maxTextLength,
  );
  if (!normalizedText.text || !Array.isArray(entries)) return [];

  const seenTerms = new Set();
  const terms = entries
    .slice(0, VOCABULARY_MATCH_LIMITS.maxEntries)
    .map((entry, order) => ({
      entry,
      order,
      term: buildNormalizedVocabularyText(
        entry?.normalizedTerm || entry?.term,
        VOCABULARY_MATCH_LIMITS.maxTermLength,
      ).text,
    }))
    .filter((candidate) => {
      if (!candidate.term || seenTerms.has(candidate.term)) return false;
      seenTerms.add(candidate.term);
      return true;
    })
    .sort((left, right) =>
      right.term.length - left.term.length || left.order - right.order,
    );

  const accepted = [];
  let candidateCount = 0;
  for (const candidate of terms) {
    let fromIndex = 0;
    let occurrenceCount = 0;
    const hasLatinWord = /[a-z0-9]/i.test(candidate.term);
    while (
      fromIndex <= normalizedText.text.length - candidate.term.length &&
      candidateCount < 2_000 &&
      occurrenceCount < 1_000
    ) {
      const matchIndex = normalizedText.text.indexOf(candidate.term, fromIndex);
      if (matchIndex < 0) break;
      const normalizedEnd = matchIndex + candidate.term.length;
      fromIndex = matchIndex + Math.max(1, candidate.term.length);
      occurrenceCount += 1;
      candidateCount += 1;

      if (
        hasLatinWord &&
        (isLatinWordCharacter(normalizedText.text[matchIndex - 1]) ||
          isLatinWordCharacter(normalizedText.text[normalizedEnd]))
      ) {
        continue;
      }

      const start = normalizedText.starts[matchIndex];
      const end = normalizedText.ends[normalizedEnd - 1];
      if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
        continue;
      }
      const overlaps = accepted.some(
        (match) => start < match.end && end > match.start,
      );
      if (overlaps) continue;
      accepted.push({
        start,
        end,
        entryId: String(candidate.entry?.id || ""),
        term: String(candidate.entry?.term || candidate.term),
        text: normalizedText.source.slice(start, end),
      });
    }
    if (candidateCount >= 2_000) break;
  }

  return accepted.sort((left, right) => left.start - right.start);
}

function clearVocabularyHighlights(root = document.getElementById("transcriptList")) {
  if (!root) return;
  root.querySelectorAll("mark.vocabulary-highlight").forEach((mark) => {
    const textNode = document.createTextNode(mark.textContent || "");
    const parent = mark.parentNode;
    mark.replaceWith(textNode);
    parent?.normalize();
  });
}

function applyVocabularyHighlights(root = document.getElementById("transcriptList")) {
  if (!root) return;
  clearVocabularyHighlights(root);
  if (!vocabularyEntries.length) return;

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
        if (parent.closest(".vocabulary-highlight, .transcript-time, button, a")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest(".translation-pending, .translation-error")) {
          return NodeFilter.FILTER_REJECT;
        }
        return parent.closest(".transcript-entry")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach((textNode) => {
    const sourceText = textNode.nodeValue || "";
    const matches = planVocabularyMatches(sourceText, vocabularyEntries);
    if (!matches.length) return;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    matches.forEach((match) => {
      if (match.start > cursor) {
        fragment.appendChild(
          document.createTextNode(sourceText.slice(cursor, match.start)),
        );
      }
      const mark = document.createElement("mark");
      mark.className = "vocabulary-highlight";
      mark.dataset.vocabularyId = match.entryId;
      mark.textContent = sourceText.slice(match.start, match.end);
      fragment.appendChild(mark);
      cursor = match.end;
    });
    if (cursor < sourceText.length) {
      fragment.appendChild(document.createTextNode(sourceText.slice(cursor)));
    }
    textNode.replaceWith(fragment);
  });
}

// ============================================================
// CACHING
// ============================================================

/**
 * Saves the current digest results to persistent local storage.
 * Results survive browser restarts — reopening the same video loads from cache
 * without consuming API tokens or Supadata calls.
 * Cache expires after 30 days. Oldest entries evicted when > 20 videos cached.
 */
function isCurrentCacheRequest(requestSnapshot) {
  if (!requestSnapshot) return true;
  return "analysisGeneration" in requestSnapshot
    ? isCurrentAnalysisRequest(requestSnapshot)
    : isCurrentDigestRequest(requestSnapshot);
}

async function saveToCache(videoId, requestSnapshot = null) {
  if (
    !videoId ||
    videoId !== currentVideoId ||
    !currentTranscript ||
    !isCurrentCacheRequest(requestSnapshot)
  ) {
    return;
  }

  try {
    // Persist semantic-segment translations for this video.
    const paragraphCacheForVideo = {};
    for (const [key, value] of transcriptParagraphCache.entries()) {
      if (key.startsWith(`${videoId}:`)) {
        paragraphCacheForVideo[key] = value;
      }
    }

    const cacheData = {
      analysis: currentAnalysis, // May be null if not yet analyzed
      transcript: currentTranscript,
      transcriptText: currentTranscriptText,
      transcriptTimestamped: currentTranscriptTimestamped,
      transcriptLanguage: currentTranscriptLanguage,
      transcriptSource: currentTranscriptSource,
      transcriptPartial: currentTranscriptPartial,
      nativeTranscriptBackup: currentNativeTranscriptBackup,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      paragraphCache: paragraphCacheForVideo,
      timestamp: Date.now(),
    };

    if (!isCurrentCacheRequest(requestSnapshot)) return;
    await chrome.storage.local.set({ [`digest_${videoId}`]: cacheData });
    if (!isCurrentCacheRequest(requestSnapshot)) return;
    debugLog(
      "Saved to cache:",
      videoId,
      currentAnalysis ? "(with analysis)" : "(transcript only)",
    );

    // Evict old entries if we have more than 20 videos cached
    await evictOldCacheEntries(20);
  } catch (error) {
    console.error("Cache save error:", error);
  }
}

/**
 * Keeps the cache from growing unbounded.
 * Removes the oldest entries when we exceed maxEntries videos.
 *
 * @param {number} maxEntries - Maximum number of cached videos to keep
 */
async function evictOldCacheEntries(maxEntries) {
  try {
    const allData = await chrome.storage.local.get(null);
    let digestKeys = Object.keys(allData).filter((k) =>
      k.startsWith("digest_"),
    );
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const expired = digestKeys.filter((key) => {
      const timestamp = Number(allData[key]?.timestamp) || 0;
      return Date.now() - timestamp > THIRTY_DAYS;
    });
    if (expired.length) {
      await chrome.storage.local.remove(expired);
      const expiredSet = new Set(expired);
      digestKeys = digestKeys.filter((key) => !expiredSet.has(key));
    }

    if (digestKeys.length <= maxEntries) return;

    // Sort by timestamp (oldest first) and remove excess
    const sorted = digestKeys
      .map((k) => ({ key: k, ts: allData[k]?.timestamp || 0 }))
      .sort((a, b) => a.ts - b.ts);

    const toRemove = sorted
      .slice(0, sorted.length - maxEntries)
      .map((e) => e.key);
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
      debugLog(`[YouTube Digest] Evicted ${toRemove.length} old cache entries`);
    }
  } catch (error) {
    console.error("Cache eviction error:", error);
  }
}

/**
 * Loads digest results from persistent local storage.
 * Returns null if not cached or expired (30-day expiry).
 */
async function loadFromCache(videoId, requestSnapshot = null) {
  if (!videoId) return null;

  try {
    const result = await chrome.storage.local.get(`digest_${videoId}`);
    if (requestSnapshot && !isCurrentDigestRequest(requestSnapshot)) return null;
    const cached = result[`digest_${videoId}`];

    if (!cached) return null;

    // Cache expires after 30 days
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - cached.timestamp > THIRTY_DAYS) {
      await chrome.storage.local.remove(`digest_${videoId}`);
      return null;
    }

    return cached;
  } catch (error) {
    console.error("Cache load error:", error);
    return null;
  }
}

/**
 * Updates the cache after enhance or translation operations.
 */
async function updateCache() {
  if (currentVideoId) {
    await saveToCache(currentVideoId);
  }
}

// ============================================================
// NOTES
// ============================================================

/**
 * Loads and renders notes from storage.
 * @param {string|null} videoId - Filter by video ID, or null for all notes
 */
async function loadNotes(videoId, requestSnapshot = null) {
  try {
    const result = await chrome.runtime.sendMessage({
      action: "getNotes",
      videoId: videoId,
    });

    if (requestSnapshot && !isCurrentDigestRequest(requestSnapshot)) return;

    if (result.success) {
      renderNotes(result.notes, videoId);
    }
  } catch (error) {
    console.error("[YouTube Digest Panel] Load notes error:", error);
  }
}

/**
 * Renders the notes list in the Notes tab.
 */
function renderNotes(notes, filteredVideoId) {
  const notesList = document.getElementById("notesList");
  const notesIntro = document.getElementById("notesIntro");

  if (!notesList) return;

  notesList.innerHTML = "";

  if (!notes || notes.length === 0) {
    notesIntro.style.display = "block";
    notesIntro.textContent = filteredVideoId
      ? "当前视频还没有笔记。点击视频旁的「记笔记」，或从概览保存重点语句。"
      : "还没有笔记。点击视频旁的「记笔记」，或从概览保存重点语句。";
    return;
  }

  notesIntro.style.display = "none";

  notes.forEach((note) => {
    const noteEl = document.createElement("div");
    noteEl.className = "note-item";
    noteEl.innerHTML = `
      <div class="note-header">
        <span class="note-timestamp" data-url="${escapeHtml(note.timestampedUrl)}" data-seconds="${Number(note.timestampSeconds) || 0}">${escapeHtml(note.timestamp)}</span>
        ${!filteredVideoId ? `<span class="note-video-title">${escapeHtml(note.videoTitle)}</span>` : ""}
        <button class="note-delete" data-id="${escapeHtml(note.id)}" title="删除笔记">✕</button>
      </div>
      <div class="note-text">"${escapeHtml(note.text)}"</div>
      <div class="note-actions">
        <button class="note-action-btn note-copy-text">⧉ 复制原文</button>
        <button class="note-action-btn note-copy-link" data-url="${escapeHtml(note.timestampedUrl)}">🔗 复制时间链接</button>
        <button class="note-action-btn note-play" data-seconds="${Number(note.timestampSeconds) || 0}">▶ 播放</button>
      </div>
    `;

    // Timestamp click - play from this point (in this tab or a new one)
    noteEl.querySelector(".note-timestamp").addEventListener("click", () => {
      playNote(note);
    });

    // Delete button
    noteEl
      .querySelector(".note-delete")
      .addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteNote(note.id);
        loadNotes(filteredVideoId);
      });

    // Copy text button — copies just the note's text
    noteEl
      .querySelector(".note-copy-text")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(note.text);
          const btn = noteEl.querySelector(".note-copy-text");
          btn.textContent = "✓ 已复制";
          setTimeout(() => {
            btn.textContent = "⧉ 复制原文";
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });

    // Copy timestamp button — copies the timestamped YouTube link
    noteEl
      .querySelector(".note-copy-link")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(note.timestampedUrl);
          const btn = noteEl.querySelector(".note-copy-link");
          btn.textContent = "✓ 已复制";
          setTimeout(() => {
            btn.textContent = "🔗 复制时间链接";
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });

    // Play button (in this tab if it's the current video, else a new tab)
    noteEl.querySelector(".note-play").addEventListener("click", () => {
      playNote(note);
    });

    notesList.appendChild(noteEl);
  });
}

/**
 * Deletes a note by ID.
 */
async function deleteNote(noteId) {
  try {
    await chrome.runtime.sendMessage({
      action: "deleteNote",
      noteId: noteId,
    });
  } catch (error) {
    console.error("[YouTube Digest Panel] Delete note error:", error);
  }
}

// ============================================================
// AUTO-SCROLL — Follow video playback in transcript
// ============================================================
// While a video plays, the transcript automatically scrolls to show which
// 30-second chunk is currently being spoken. If the user manually scrolls
// (e.g., to read ahead), auto-scroll pauses and a "跟随播放" button
// appears so they can resume it. Highlight always stays active regardless.

/**
 * Starts polling the video's current time and highlighting/scrolling
 * to the matching transcript entry.
 */

async function returnToPlaybackPosition() {
  // Explicit return ends lookup/selection, including pinned cards after saving.
  globalThis.YTD_LEARNING_UI?.immersiveClose?.();
  closeActiveExplanationModal?.();
  window.getSelection()?.removeAllRanges();
  const button = document.getElementById("returnToPlaybackBtn");
  const status = document.getElementById("playbackPositionStatus");
  const videoId = currentVideoId, generation = digestGeneration;
  if (status) status.textContent = "";
  if (button) button.disabled = true;
  try {
    const positioned = await playbackTrackingTick({ returnToPosition: true });
    if (!positioned && videoId === currentVideoId && generation === digestGeneration && status) {
      status.textContent = "未能定位字幕，请刷新视频页面后重试。";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function startPlaybackTracking() {
  if (!currentTranscript || !currentTranscript.length) return;

  // Don't restart if already tracking (preserves user's auto-scroll state)
  if (autoScrollInterval) return;

  const followPlaybackBtn = document.getElementById("followPlaybackBtn");
  if (transcriptSearchState.query.trim()) {
    autoScrollEnabled = false;
    if (followPlaybackBtn) followPlaybackBtn.style.display = "block";
  } else {
    autoScrollEnabled = true;
    if (followPlaybackBtn) followPlaybackBtn.style.display = "none";
  }

  // Poll video time every 500ms
  autoScrollInterval = setInterval(() => playbackTrackingTick(), 500);

  // Listen for manual scrolls on the content area
  const contentArea = document.getElementById("contentArea");
  contentArea.removeEventListener("scroll", onContentAreaScroll);
  contentArea.addEventListener("scroll", onContentAreaScroll);
}

/**
 * Stops playback tracking entirely. Called when leaving transcript tab,
 * starting a new digest, or leaving results state.
 */
function stopPlaybackTracking() {
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
  autoScrollEnabled = true; // Reset for next time
  lastAutoScrollTime = 0;
  document.getElementById("followPlaybackBtn").style.display = "none";

  // Remove active highlights
  document
    .querySelectorAll(".transcript-entry.active-playback")
    .forEach((el) => {
      el.classList.remove("active-playback");
    });
}

/**
 * One tick of the playback tracker. Gets current video time from the
 * YouTube tab and highlights + scrolls to the matching transcript entry.
 */
async function playbackTrackingTick({ returnToPosition = false, followSnapshot = null } = {}) {
  if (embeddedPanel && document.hidden) return false;
  const snapshotVideoId=currentVideoId, snapshotGeneration=digestGeneration;
  let timeout;
  try {
    const result = await Promise.race([chrome.runtime.sendMessage({
      action: "relayToContent",
      payload: { action: "getCurrentTime" },
    }), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("播放位置读取超时")), 5000); })]);

    if (!result.success || !result.response || result.response.hasVideo === false) return false;

    if(snapshotVideoId!==currentVideoId || snapshotGeneration!==digestGeneration)return;
    if(result.response.videoId && result.response.videoId!==currentVideoId)return;
    const currentTime = result.response.currentTime;
    if (!Number.isFinite(currentTime) || currentTime < 0) return false;
    if (followSnapshot && !canFollowAfterSentenceSave(followSnapshot)) return false;
    if (returnToPosition) autoScrollEnabled = true;
    document.dispatchEvent(new CustomEvent("ytdPlayback",{detail:{currentTime,videoId:currentVideoId,generation:digestGeneration}}));
    highlightActiveEntry(currentTime, { allowImmersiveScroll: returnToPosition || result.response.paused === false });
    if (returnToPosition) {
      document.getElementById("followPlaybackBtn").style.display = "none";
      // Always recenter, even when paused on the already highlighted row.
      if (scrollToActiveEntry("instant")) return true;
      // Silence between ASR cues has no active highlight. Still navigate to
      // the nearest available cue without claiming it is currently spoken.
      const entries = [...document.querySelectorAll("#transcriptList .transcript-entry")];
      const nearest = entries.reduce((best, entry) => {
        const seconds = Number(entry.dataset.seconds);
        if (!Number.isFinite(seconds)) return best;
        return !best || Math.abs(seconds - currentTime) < Math.abs(Number(best.dataset.seconds) - currentTime) ? entry : best;
      }, null);
      return nearest ? scrollTranscriptEntry(nearest, "instant") : false;
    }
    return true;
  } catch (error) {
    // Polling stays quiet; the explicit action reports a retryable failure.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Scrolls the transcript to the entry currently being spoken (the one
 * carrying the active-playback highlight). Returns false if nothing is
 * highlighted yet. Stamps lastAutoScrollTime BEFORE scrolling so the scroll
 * events from our own smooth animation aren't mistaken for the user
 * scrolling away (which would re-disable auto-scroll immediately).
 */
function scrollToActiveEntry(behavior = "smooth") {
  const activeEntry = document.querySelector(
    "#transcriptList .transcript-entry.active-playback",
  );
  if (!activeEntry) return false;

  return scrollTranscriptEntry(activeEntry, behavior);
}

function scrollTranscriptEntry(activeEntry, behavior = "instant") {
  lastAutoScrollTime = Date.now();
  if (document.documentElement.classList.contains("immersive")) {
    const area = document.getElementById("contentArea");
    const toolbar = document.querySelector("#transcriptContent .sticky-control-row") || document.querySelector(".sticky-control-row");
    const english = activeEntry.querySelector(".transcript-original, .transcript-text") || activeEntry;
    const top = area.scrollTop + english.getBoundingClientRect().top - area.getBoundingClientRect().top - (toolbar?.getBoundingClientRect().height || 0) - 4;
    if (Math.abs(area.scrollTop - Math.max(0, top)) > 1) area.scrollTo({ top: Math.max(0, top), behavior });
  } else {
    activeEntry.scrollIntoView({ behavior, block: "center" });
  }
  return true;
}

/**
 * Finds the transcript entry matching the current playback time,
 * highlights it, and scrolls to it (if auto-scroll is enabled).
 *
 * @param {number} currentSeconds - Current video playback time in seconds
 */
function highlightActiveEntry(currentSeconds, { allowImmersiveScroll = true } = {}) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return;

  const entries = transcriptList.querySelectorAll(".transcript-entry");
  if (entries.length === 0) return;

  // Find the entry whose time range contains the current playback time
  let activeEntry = currentSeconds < Number(entries[0].dataset.seconds) ? entries[0] : null;
  entries.forEach((entry, index) => {
    const entrySeconds = Number(entry.dataset.seconds);
    const nextEntry = entries[index + 1];
    const nextSeconds = nextEntry
      ? Number(nextEntry.dataset.seconds)
      : Infinity;

    if (currentSeconds >= entrySeconds && currentSeconds < nextSeconds) {
      activeEntry = entry;
    }
  });

  if(currentTranscriptSource==='local-asr'&&!currentTranscript?.some(s=>currentSeconds>=s.start&&currentSeconds<s.start+s.duration)){entries.forEach(e=>e.classList.remove('active-playback'));return;}
  if(currentTranscriptPartial && currentTranscript?.length){const last=currentTranscript[currentTranscript.length-1];if(currentSeconds>=last.start+last.duration){entries.forEach(e=>e.classList.remove('active-playback'));return;}}
  if (!activeEntry) return;

  // Immersion stays anchored even within the same cue (translation reflow,
  // resizing or a prior manual scroll can otherwise leave it below the top).
  if (document.documentElement.classList.contains("immersive")) {
    if (!activeEntry.classList.contains("active-playback")) {
      entries.forEach((e) => e.classList.remove("active-playback"));
      activeEntry.classList.add("active-playback");
    }
    if (autoScrollEnabled && allowImmersiveScroll && !hasNonCollapsedTextSelection() && !globalThis.YTD_LEARNING_UI?.isTranscriptInteracting?.() && !document.getElementById("explainModal")) {
      autoScrollEnabled = true;
      const button = document.getElementById("followPlaybackBtn");
      if (button) button.style.display = "none";
      scrollTranscriptEntry(activeEntry, "instant");
    }
    return;
  }
  if (activeEntry.classList.contains("active-playback")) return;

  // Remove old highlight, add new one
  entries.forEach((e) => e.classList.remove("active-playback"));
  activeEntry.classList.add("active-playback");

  // Only scroll if auto-scroll is enabled
  if (autoScrollEnabled && !hasNonCollapsedTextSelection()) {
    scrollToActiveEntry(document.documentElement.classList.contains("immersive") ? "instant" : "smooth");
  }
}

/**
 * Scroll event handler for the content area.
 * Detects manual scrolling and disables auto-scroll so the user
 * can read at their own pace without being yanked back.
 */
function onTranscriptScrollIntent(event) {
  if (!transcriptTabIsActive()) return;
  if (event.type === "pointerdown") {
    const area = document.getElementById("contentArea"), rect = area.getBoundingClientRect();
    if (event.target !== area || event.clientX < rect.right - 16) return;
  }
  if (event.type === "keydown" && (!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key) || /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target?.tagName || ''))) return;
  manualTranscriptScrollRevision += 1;
  autoScrollEnabled = false;
  const button = document.getElementById("followPlaybackBtn");
  if (button) button.style.display = "block";
}

function sentenceFollowSnapshot() {
  return { videoId: currentVideoId, generation: digestGeneration,
    revision: manualTranscriptScrollRevision, following: autoScrollEnabled };
}
function canFollowAfterSentenceSave(snapshot) {
  return Boolean(snapshot?.following && autoScrollEnabled &&
    snapshot.videoId === currentVideoId && snapshot.generation === digestGeneration &&
    snapshot.revision === manualTranscriptScrollRevision && transcriptTabIsActive());
}
async function followAfterSentenceSave(snapshot) {
  if (!canFollowAfterSentenceSave(snapshot)) return false;
  window.getSelection()?.removeAllRanges();
  return playbackTrackingTick({ returnToPosition: true, followSnapshot: snapshot });
}

function onContentAreaScroll() {
  if (!transcriptTabIsActive()) return;
  if (isRestoringTranscriptView) return;

  // Ignore scroll events within 1 second of a programmatic scroll
  // (smooth scroll animations can last longer than a simple boolean flag)
  if (Date.now() - lastAutoScrollTime < 1000) return;

  // Only explicit wheel/touch/key/scrollbar input pauses following. Layout
  // changes and browser scroll anchoring are not a request to stop following.
  captureTranscriptViewPosition();
}

// ============================================================
// OVERVIEW MODE UI — Original / Chinese / aligned bilingual
// ============================================================

function overviewTranslationCacheKey(fieldId) {
  return `${currentVideoId}:zh:overview:${fieldId}`;
}

function getOverviewTranslation(fieldId) {
  return transcriptParagraphCache.get(overviewTranslationCacheKey(fieldId)) || "";
}

function getOverviewFieldDisplayText(sourceText, fieldId) {
  const source = String(sourceText || "").trim();
  const translated = getOverviewTranslation(fieldId);
  if (currentOverviewMode === "zh") return translated || source;
  if (currentOverviewMode === "bilingual" && translated) {
    return `${source}\n\n${translated}`;
  }
  return source;
}

function renderOverviewField(sourceText, fieldId) {
  const source = String(sourceText || "").trim();
  if (currentOverviewMode === "original") return escapeHtml(source);

  const translated = getOverviewTranslation(fieldId);
  const error = overviewTranslationErrors.get(overviewTranslationCacheKey(fieldId));
  const translatedText = translated || error || "等待翻译…";
  const stateClass = translated
    ? ""
    : error
      ? "translation-error"
      : "translation-pending";
  const translationHtml = `<span class="overview-translation ${stateClass}">${escapeHtml(translatedText)}</span>`;

  if (currentOverviewMode === "bilingual") {
    return `<span class="overview-original">${escapeHtml(source)}</span>${translationHtml}`;
  }
  return translationHtml;
}

function getOverviewTranslationSegments(analysis) {
  const segments = [];
  const add = (id, text) => {
    const normalized = String(text || "").trim();
    if (normalized) segments.push({ id, text: normalized });
  };

  add("overview-summary", analysis?.summary);
  (analysis?.chapters || []).forEach((chapter, index) => {
    add(`chapter-title-${index}`, chapter.title);
    add(`chapter-summary-${index}`, chapter.summary);
  });
  (analysis?.keyQuotes || []).forEach((quote, index) => {
    add(`quote-${index}`, quote.quote);
  });
  return segments;
}

function setOverviewModeButtons(mode) {
  document.querySelectorAll("[data-overview-mode]").forEach((button) => {
    const active = button.dataset.overviewMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setOverviewTranslatingSpinner(show) {
  if (show) overviewTranslationWorkCount += 1;
  else overviewTranslationWorkCount = Math.max(0, overviewTranslationWorkCount - 1);
  document
    .getElementById("overviewLangSpinner")
    ?.classList.toggle("visible", overviewTranslationWorkCount > 0);
}

async function handleOverviewModeChange(mode) {
  if (!["original", "zh", "bilingual"].includes(mode)) return;
  if (mode === currentOverviewMode) return;

  currentOverviewMode = mode;
  overviewTranslationGeneration += 1;
  overviewTranslationWorkCount = 0;
  setOverviewTranslatingSpinner(false);
  setOverviewModeButtons(mode);
  if (currentAnalysis) renderAnalysisResults(currentAnalysis);
  if (mode !== "original") await translateOverview();
}

async function translateOverview() {
  if (!currentAnalysis || currentOverviewMode === "original") return;

  overviewTranslationGeneration += 1;
  const generation = overviewTranslationGeneration;
  const videoId = currentVideoId;
  const segments = getOverviewTranslationSegments(currentAnalysis).filter(
    (segment) => !getOverviewTranslation(segment.id),
  );
  if (!segments.length) {
    renderAnalysisResults(currentAnalysis);
    return;
  }

  setOverviewTranslatingSpinner(true);
  try {
    for (let index = 0; index < segments.length; index += 4) {
      const batch = segments.slice(index, index + 4);
      const result = await sendTranslationMessage({
        action: "translateContent",
        content: { segments: batch },
        contentType: "overviewBatch",
        targetLanguage: "zh",
        videoTitle: currentVideoTitle,
      });
      if (
        generation !== overviewTranslationGeneration ||
        videoId !== currentVideoId ||
        currentOverviewMode === "original"
      ) {
        return;
      }

      const aligned = alignTranslatedSegmentBatch(
        batch,
        result?.success ? result.translatedContent?.segments : [],
      );
      aligned.forEach((item) => {
        const key = overviewTranslationCacheKey(item.id);
        if (item.text) {
          transcriptParagraphCache.set(key, item.text);
          overviewTranslationErrors.delete(key);
        } else {
          overviewTranslationErrors.set(
            key,
            result?.error || item.error || "这段翻译暂不可用。",
          );
        }
      });
      renderAnalysisResults(currentAnalysis);
    }
    await updateCache();
  } catch (error) {
    if (generation !== overviewTranslationGeneration) return;
    segments.forEach((segment) => {
      overviewTranslationErrors.set(
        overviewTranslationCacheKey(segment.id),
        error.message || "翻译失败，请重试。",
      );
    });
    renderAnalysisResults(currentAnalysis);
  } finally {
    setOverviewTranslatingSpinner(false);
  }
}

// ============================================================
// TRANSCRIPT MODE UI — Original / Chinese / aligned bilingual
// ============================================================

function getOriginalTranscriptLabel() {
  const language = String(currentTranscriptLanguage || "").trim();
  return /^[A-Za-z0-9-]{1,20}$/.test(language)
    ? `原文（${language}）`
    : "原文";
}

function getActiveTranscriptSegments() {
  return groupTranscriptEntries(currentTranscript || []);
}

function transcriptTranslationCacheKey(segment) {
  return `${currentVideoId}:zh:sentence-v2:${segment.id}:${segment.text}`;
}

function setTranscriptModeButtons(mode) {
  document.querySelectorAll("[data-transcript-mode]").forEach((button) => {
    const active = button.dataset.transcriptMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function handleTranscriptModeChange(mode) {
  if (!["original", "zh", "bilingual"].includes(mode)) return;
  if(mode !== "original" && /^(ai-)?zh(?:-|$)/i.test(currentTranscriptLanguage||"")) {
    currentTranscriptMode="original";pendingOriginalAudioMode=mode;renderTranscript();setTranscriptModeButtons(mode);
    if(mode==='bilingual'){
      globalThis.YTD_ASR_UI?.notice('正在准备英文原声，完成后显示双语…');
      await globalThis.YTD_ASR_UI?.ensureAutomatic({retry:true});
    }else globalThis.YTD_ASR_UI?.refresh();
    return;
  }
  pendingOriginalAudioMode=null;
  if (mode === currentTranscriptMode) {setTranscriptModeButtons(mode);return;}

  currentTranscriptMode = mode;
  translationGeneration += 1;
  translationWorkCount = 0;
  setTranslatingSpinner(false);
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
  transcriptScrollObserver = null;
  setTranscriptModeButtons(mode);

  if (mode === "original") {
    renderTranscript();
    return;
  }

  await translateTranscript();
}

function renderTranscriptSegmentContent(segment, mode, translated, error) {
  const original = renderSubtitleInlineMarkup(segment.text);
  let translationHtml = "";
  if (translated) {
    translationHtml = renderSubtitleInlineMarkup(translated);
  } else if (error) {
    translationHtml = `${escapeHtml(error)}<button class="translation-retry-btn" type="button">重试</button>`;
  } else {
    translationHtml = "等待翻译…";
  }

  if (mode === "bilingual") {
    return `<span class="transcript-copy"><span class="transcript-original">${original}</span><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
  }

  return `<span class="transcript-copy"><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
}

function renderTranscriptModeRows(segments, mode) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return [];
  transcriptList.innerHTML = "";

  const existingBadge = document.getElementById("transcriptSourceBadge");
  if (existingBadge) existingBadge.remove();
  const badge = document.createElement("div");
  badge.id = "transcriptSourceBadge";
  badge.className = "transcript-source-badge";
  const originalLabel = getOriginalTranscriptLabel();
  const modeLabel =
    mode === "bilingual"
      ? `${originalLabel} + ${currentTranscriptSource==="local-asr"&&currentNativeTranscriptBackup?"中文逐句对照":"简体中文"}`
      : `简体中文 · 对照${originalLabel}`;
  badge.innerHTML = renderTranscriptSourceBadge(modeLabel);
  transcriptList.parentElement.insertBefore(badge, transcriptList);

  const rows = [];
  segments.forEach((segment, index) => {
    const div = document.createElement("div");
    const cached = transcriptParagraphCache.get(
      transcriptTranslationCacheKey(segment),
    );
    div.className = `transcript-entry ${cached ? "translated" : "translating"}`;
    div.dataset.seconds = segment.start;
    div.dataset.segmentId = segment.id;
    div.dataset.segmentIndex = index;

    const minutes = Math.floor(segment.start / 60);
    const seconds = Math.floor(segment.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;
    div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      ${renderTranscriptSegmentContent(segment, mode, cached, "")}
    `;
    addTranscriptRowActions(div, segment);
    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, segment.start),
    );
    transcriptList.appendChild(div);
    rows.push(div);
  });

  refreshTranscriptHighlights(transcriptList);
  startPlaybackTracking();
  return rows;
}

/**
 * Rebuilds a provider response in source order. Unknown IDs are ignored and
 * missing IDs remain explicit errors, never positional guesses.
 */
function alignTranslatedSegmentBatch(sourceSegments, responseSegments) {
  const translatedById = new Map();
  if (Array.isArray(responseSegments)) {
    responseSegments.forEach((item) => {
      if (!item || typeof item.id !== "string" || typeof item.text !== "string")
        return;
      const text = item.text.trim();
      if (text && !translatedById.has(item.id)) {
        translatedById.set(item.id, text);
      }
    });
  }

  return sourceSegments.map((segment) => ({
    id: segment.id,
    text: translatedById.get(segment.id) || "",
    error: translatedById.has(segment.id) ? "" : "这段翻译暂不可用。",
  }));
}

function updateTranslatedRow(segment, index, alignedItem, generation) {
  if (generation !== translationGeneration) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-id="${CSS.escape(segment.id)}"]`,
  );
  if (!row) return;

  if (alignedItem.text) {
    transcriptParagraphCache.set(
      transcriptTranslationCacheKey(segment),
      alignedItem.text,
    );
  }

  const copy = row.querySelector(".transcript-copy");
  if (copy) {
    copy.outerHTML = renderTranscriptSegmentContent(
      segment,
      currentTranscriptMode,
      alignedItem.text,
      alignedItem.error,
    );
  }
  row.classList.toggle("translated", !!alignedItem.text);
  row.classList.toggle("translating", false);
  row.classList.toggle("translation-failed", !alignedItem.text);

  const retry = row.querySelector(".translation-retry-btn");
  if (retry) {
    ["mousedown", "mouseup"].forEach((eventName) => {
      retry.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    retry.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      retryTranslationSegment(index, generation);
    });
  }

  const transcriptList = document.getElementById("transcriptList");
  refreshTranscriptHighlights(transcriptList);
  syncTranscriptRowActions(row);
}

let activeTranslationQueue = null;

async function requestTranscriptTranslationBatch(
  indices,
  segments,
  generation,
  videoId,
  mode,
) {
  const sourceBatch = indices.map((index) => segments[index]);
  setTranslatingSpinner(true);
  try {
    const result = await sendTranslationMessage({
      action: "translateContent",
      content: {
        segments: sourceBatch.map(({ id, text }) => ({ id, text })),
      },
      contentType: "transcriptBatch",
      targetLanguage: "zh",
      videoTitle: currentVideoTitle,
    });

    const isStale =
      generation !== translationGeneration ||
      videoId !== currentVideoId ||
      mode !== currentTranscriptMode;
    if (isStale) return;

    const responseSegments = result?.success
      ? result.translatedContent?.segments
      : [];
    const aligned = alignTranslatedSegmentBatch(sourceBatch, responseSegments);
    aligned.forEach((item, batchIndex) => {
      if (!result?.success) {
        item.error = result?.error || "翻译失败，请重试。";
      }
      updateTranslatedRow(
        sourceBatch[batchIndex],
        indices[batchIndex],
        item,
        generation,
      );
    });
    await updateCache();
  } catch (error) {
    if (generation !== translationGeneration) return;
    sourceBatch.forEach((segment, batchIndex) => {
      updateTranslatedRow(
        segment,
        indices[batchIndex],
        { id: segment.id, text: "", error: error.message || "翻译失败，请重试。" },
        generation,
      );
    });
  } finally {
    setTranslatingSpinner(false);
  }
}

function retryTranslationSegment(index, generation) {
  if (generation !== translationGeneration || !activeTranslationQueue) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-index="${index}"]`,
  );
  if (row) {
    row.classList.add("translating");
    row.classList.remove("translation-failed");
    const translation = row.querySelector(".transcript-translation");
    if (translation) {
      translation.className = "transcript-translation translation-pending";
      translation.textContent = "正在重试…";
    }
    syncTranscriptRowActions(row);
  }
  activeTranslationQueue.enqueue(index, true);
}

/**
 * Renders immediately, translates the first small batch, then observes the
 * remaining rows. Batches are sequential so the provider is never flooded.
 */
async function translateTranscript() {
  setTranscriptModeButtons(currentTranscriptMode);
  if(/^(ai-)?zh(?:-|$)/i.test(currentTranscriptLanguage||"")) {currentTranscriptMode="original";renderTranscript();setTranscriptModeButtons(pendingOriginalAudioMode||"original");return;}
  const segments = getActiveTranscriptSegments();
  if(currentTranscriptSource==="local-asr" && /^(ai-)?zh(?:-|$)/i.test(currentNativeTranscriptBackup?.language||"")){
    for(const segment of segments){
      const aligned=YTD_ASR_CORE.alignChineseSentence(segment,currentNativeTranscriptBackup.transcript);
      if(aligned)transcriptParagraphCache.set(transcriptTranslationCacheKey(segment),aligned);
    }
  }
  if (!segments.length || currentTranscriptMode === "original") return;

  translationGeneration += 1;
  const generation = translationGeneration;
  const videoId = currentVideoId;
  const mode = currentTranscriptMode;
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();

  const rows = renderTranscriptModeRows(segments, mode);
  const queue = [];
  const queued = new Set();
  let processing = false;

  const processNext = async () => {
    if (processing || queue.length === 0 || generation !== translationGeneration)
      return;
    processing = true;
    const indices = queue.splice(0, 3);
    indices.forEach((index) => queued.delete(index));
    try {
      await requestTranscriptTranslationBatch(
        indices,
        segments,
        generation,
        videoId,
        mode,
      );
    } finally {
      processing = false;
      if (queue.length && generation === translationGeneration) processNext();
    }
  };

  const enqueue = (index, force = false) => {
    if (!Number.isInteger(index) || !segments[index]) return;
    const cached = transcriptParagraphCache.has(
      transcriptTranslationCacheKey(segments[index]),
    );
    if ((!force && cached) || queued.has(index)) return;
    queue.push(index);
    queued.add(index);
    // Let all entries reported in the same viewport turn collect before the
    // worker starts, producing one small contextual multi-segment request.
    Promise.resolve().then(processNext);
  };
  activeTranslationQueue = { enqueue };

  transcriptScrollObserver = new IntersectionObserver(
    (observerEntries) => {
      observerEntries
        .filter((entry) => entry.isIntersecting)
        .sort(
          (a, b) =>
            Number(a.target.dataset.segmentIndex) -
            Number(b.target.dataset.segmentIndex),
        )
        .forEach((entry) => enqueue(Number(entry.target.dataset.segmentIndex)));
    },
    {
      root: document.getElementById("contentArea"),
      rootMargin: "320px 0px",
      threshold: 0,
    },
  );

  rows.forEach((row, index) => {
    if (!row.classList.contains("translated")) transcriptScrollObserver.observe(row);
    if (index < 3) enqueue(index);
  });
}

function setTranslatingSpinner(show) {
  if (show) translationWorkCount += 1;
  else translationWorkCount = Math.max(0, translationWorkCount - 1);
  const isTranslating = translationWorkCount > 0;
  const spinner = document.getElementById("langSpinner");
  if (spinner) spinner.classList.toggle("visible", isTranslating);
}

// Pure helpers are exposed for the repository's Node tests. The extension does
// not read this object at runtime.
globalThis.__YTD_TRANSCRIPT_TESTING__ = {
  sentenceFollowSnapshot, canFollowAfterSentenceSave, onTranscriptScrollIntent,
  loadTranscriptViewState,
  saveTranscriptViewState,
  transcriptTabIsActive,
  setupTranscriptViewStateListeners,
  captureTranscriptViewPosition,
  loadPendingTranscriptViewState,
  restorePendingTranscriptViewState,
  onContentAreaScroll,
  setTranscriptReadingPositionTestState(state = {}) {
    if (Object.hasOwn(state, "videoId")) currentVideoId = state.videoId;
    if (Object.hasOwn(state, "activeVideoId")) {
      activeDigestVideoId = state.activeVideoId;
    }
    if (Object.hasOwn(state, "generation")) {
      digestGeneration = state.generation;
    }
    if (Object.hasOwn(state, "pending")) {
      pendingTranscriptViewState = state.pending;
    }
    if (Object.hasOwn(state, "autoScrollEnabled")) {
      autoScrollEnabled = state.autoScrollEnabled;
    }
  },
  getTranscriptReadingPositionTestState: () => ({
    pending: pendingTranscriptViewState,
    lastTranscriptScrollTop,
    isRestoringTranscriptView,
    autoScrollEnabled,
    lastAutoScrollTime,
  }),
  sendTranslationMessage,
  createExplanationTranslationState,
  ensureExplanationTranslation,
  renderExplanationContent,
  buildExplainContextFromSelection,
  groupTranscriptEntries,
  splitOversizedThought,
  alignTranslatedSegmentBatch,
  renderSubtitleInlineMarkup,
  renderTranscriptSegmentContent,
  createTranscriptSearchState,
  getNextTranscriptSearchIndex,
  isTranscriptSearchTextNodeEligible,
  replaceTranscriptSearchTextNode,
  findLiteralTranscriptMatches,
  clearTranscriptSearchHighlights,
  getOverviewTranslationSegments,
  buildAudioTranscriptionConfirmation,
};


globalThis.__YTD_VOCABULARY_UI_TESTING__ = {
  buildVocabularySelectionMetadata,
  buildVocabularySaveMessage,
  planVocabularyMatches,
  getSafeHttpUrl,
  resolveVocabularySpeechLanguage,
  selectPreferredSpeechVoice,
  speakVocabularyTerm,
};

globalThis.__YTD_RACE_TESTING__ = {
  checkCurrentTab,
  startDigest,
  triggerAnalysis,
  getRaceState: () => ({
    currentVideoId,
    currentVideoUrl,
    currentVideoTitle,
    currentTranscriptText,
    currentAnalysis,
    isAnalysisLoading,
    digestGeneration,
    analysisGeneration,
    youtubeTabId,
  }),
};

// Narrow bridge for modular learning UI; keys and provider transport stay in the worker.
globalThis.YTD_PANEL = {
  sentenceFollowSnapshot, followAfterSentenceSave,
  context: () => ({ videoId: currentVideoId, videoTitle: currentVideoTitle,
    channelName: currentChannelName, tabId: youtubeTabId, generation: digestGeneration,
    segments: getActiveTranscriptSegments(), libraryView: currentLibraryView, source:currentTranscriptSource, language:currentTranscriptLanguage, hasNativeBackup:Boolean(currentNativeTranscriptBackup), partial:currentTranscriptPartial }),
  setTranscriptMode:handleTranscriptModeChange,
  rawSegments:()=>currentTranscript||[],
  captionTranslation:segment=>{
    if(currentNativeTranscriptBackup && /^(ai-)?zh/i.test(currentNativeTranscriptBackup.language||""))return YTD_ASR_CORE.alignChinese(segment,currentNativeTranscriptBackup.transcript);
    const group=getActiveTranscriptSegments().find(g=>g.start<=segment.start&&g.start+g.duration>segment.start);
    return group?transcriptParagraphCache.get(transcriptTranslationCacheKey(group))||"":"";
  },
  applyASR: applyOriginalAudioTranscript, applyASRProgress:applyOriginalAudioProgress, restoreNativeTranscript,
  vocabulary: () => vocabularyEntries,
  refreshVocabulary: refreshVocabularyEntries,
  switchLibraryView, switchTab,
  explain: (m) => showExplanation(m.term, m.context, m),
  speak: (text) => speakVocabularyTerm(text, "en", window.speechSynthesis, window.SpeechSynthesisUtterance),
  seek: (entry) => openVocabularyTimestamp(entry, getSafeHttpUrl(entry.timestampedUrl)),
};


async function applyOriginalAudioTranscript(input) {
  const result=YTD_ASR_CORE.validateResult(input,currentVideoId);
  const snapshot={generation:digestGeneration,videoId:currentVideoId};
  if(!isCurrentDigestRequest(snapshot))return;
  if(result.range&&currentTranscriptSource==='local-asr')return applyOriginalAudioProgress(result);
  if(currentTranscriptSource!=="local-asr" && currentTranscript?.length)currentNativeTranscriptBackup={transcript:currentTranscript,language:currentTranscriptLanguage,source:currentTranscriptSource};
  await replaceTranscriptSource(result,snapshot);
}
async function applyOriginalAudioProgress(input){
  const result=YTD_ASR_CORE.validateResult(input,currentVideoId);
  if(currentTranscriptSource!=='local-asr')return applyOriginalAudioTranscript(result);
  // A re-transcription must not replace a previously complete transcript with a fragment.
  if(!result.range && !currentTranscriptPartial && result.partial)return;
  if(!result.range&&result.partial&&currentTranscript?.length&&result.transcript.length<currentTranscript.length)return;
  const snapshot={generation:digestGeneration,videoId:currentVideoId},area=document.getElementById('contentArea'),top=area.scrollTop,mode=currentTranscriptMode;
  currentTranscript=result.range?YTD_ASR_CORE.mergeSegment(currentTranscript||[],result):result.transcript;currentTranscriptPartial=Boolean(result.partial);
  currentTranscriptText=currentTranscript.map(s=>s.text).join(' ');
  currentTranscriptTimestamped=currentTranscript.map(s=>`[${Math.floor(s.start/60)}:${String(Math.floor(s.start%60)).padStart(2,'0')}] ${s.text}`).join('\n');
  // Reuse the renderer and preserve the reading position; never seek or pause the player.
  renderTranscript();if(mode!=='original')await translateTranscript();area.scrollTop=top;
  await saveToCache(currentVideoId,snapshot);globalThis.YTD_ASR_UI?.refresh();
}
async function restoreNativeTranscript(){
  if(!currentNativeTranscriptBackup)return;
  const backup=currentNativeTranscriptBackup;currentNativeTranscriptBackup=null;
  await replaceTranscriptSource(backup,{generation:digestGeneration,videoId:currentVideoId});
}
async function replaceTranscriptSource(result,snapshot){
  if(!isCurrentDigestRequest(snapshot))return;
  const hadNoCaptions=!currentTranscript?.length;
  snapshot={...snapshot,generation:++digestGeneration};
  globalThis.YTD_LEARNING_UI?.videoChanged();
  // Invalidate work based on the previous language, including explanation context.
  translationGeneration++;overviewTranslationGeneration++;analysisGeneration++;
  closeActiveExplanationModal?.();transcriptScrollObserver?.disconnect();transcriptScrollObserver=null;
  currentAnalysis=null;isAnalysisLoading=false;currentTranscriptMode="original";setTranscriptModeButtons("original");
  transcriptParagraphCache=new Map([...transcriptParagraphCache].filter(([key])=>!key.startsWith(`${currentVideoId}:`)));
  currentTranscript=result.transcript;currentTranscriptPartial=Boolean(result.partial);currentTranscriptLanguage=result.language;currentTranscriptSource=result.source;
  currentTranscriptText=currentTranscript.map(item=>item.text).join(" ");
  currentTranscriptTimestamped=currentTranscript.map(item=>`[${Math.floor(item.start/60)}:${String(Math.floor(item.start%60)).padStart(2,"0")}] ${item.text}`).join("\n");
  resetTranscriptSearchForVideo(currentVideoId);stopPlaybackTracking();renderTranscript();showState("results");
  document.getElementById("tabsNav").style.display="flex";switchTab("transcript");
  setupExplainFeature();await saveToCache(currentVideoId,snapshot);globalThis.YTD_ASR_UI?.refresh();
  if(hadNoCaptions && isCurrentDigestRequest(snapshot))void handleTranscriptModeChange("bilingual");
}
