/**
 * BACKGROUND SERVICE WORKER
 *
 * This is the "brain" of the extension. It runs in the background and handles:
 * 1. Opening the side panel when the user clicks the extension icon
 * 2. Fetching YouTube transcripts via Supadata API
 * 3. Calling DeepSeek to analyze the transcript
 * 4. Sending results back to the side panel
 *
 * Think of it like a backend server — it does the heavy lifting
 * so the UI (side panel) can stay fast and responsive.
 */

// Import safe defaults and validation helpers. Secret keys live in
// chrome.storage.local and are never part of the extension source.
importScripts("lib/platform.js", "settings.js", "lib/wbi.js", "lib/bili-api.js", "lib/bilibili-transcript.js");

importScripts("lib/layout-worker.js");

const DEBUG = false;
const AI_PROVIDER_IDLE_TIMEOUT_MS = 50_000;
const AI_PROVIDER_HARD_TIMEOUT_MS = 120_000;
const AI_PROVIDER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SUPADATA_REQUEST_TIMEOUT_MS = 30_000;
const SUPADATA_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const VOCABULARY_STORAGE_KEY = "ytd_vocabulary";
const VOCABULARY_MAX_ENTRIES = 500;
const VOCABULARY_MAX_TERM_CHARS = 1_000;
const VOCABULARY_MAX_PHONETIC_TERM_CHARS = 80;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

// Prevent the YouTube content script from reading API keys or cached data.
// Side panel, options, and service-worker contexts remain trusted.
chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((error) =>
    console.warn("[YouTube Digest] Could not restrict storage access:", error),
  );

async function getSettings() {
  const stored = await chrome.storage.local.get(YTD_SETTINGS.STORAGE_KEY);
  return YTD_SETTINGS.normalize(stored[YTD_SETTINGS.STORAGE_KEY]);
}

const promptFileCache = new Map();

async function loadPromptSection(fileName, heading, variables = {}) {
  let markdown = promptFileCache.get(fileName);
  if (!markdown) {
    const response = await fetch(chrome.runtime.getURL(`prompts/${fileName}`));
    if (!response.ok) {
      throw new Error(`Could not load prompt file: ${fileName}`);
    }
    markdown = await response.text();
    promptFileCache.set(fileName, markdown);
  }

  const marker = `## ${heading}`;
  const markerIndex = markdown.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Prompt section not found: ${fileName}#${heading}`);
  }
  const sectionStart = markerIndex + marker.length;
  const nextSection = markdown.indexOf("\n## ", sectionStart);
  const section = markdown.slice(
    sectionStart,
    nextSection === -1 ? markdown.length : nextSection,
  );
  const fenceMatch = section.match(/```(?:[A-Za-z0-9_-]+)?\n([\s\S]*?)\n```/);
  if (!fenceMatch) {
    throw new Error(`Prompt section not found: ${fileName}#${heading}`);
  }

  let prompt = fenceMatch[1];
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.split(`{${key}}`).join(String(value ?? ""));
  }
  return prompt;
}

async function requestAiCompletion({
  messages,
  maxTokens,
  temperature,
  responseFormat,
}) {
  const settings = await getSettings();
  if (!settings.aiApiKey) {
    const error = new Error(
      "请在学习设置中填写 DeepSeek API 密钥。",
    );
    error.code = "NO_AI_KEY";
    throw error;
  }
  const body = {
    model: settings.aiModel,
    max_tokens: maxTokens,
    messages,
  };
  if (typeof temperature === "number") body.temperature = temperature;
  if (responseFormat) {
    body.response_format = responseFormat;
  }
  // Product features need bounded, predictable latency rather than reasoning traces.
  body.thinking = { type: "disabled" };

  const controller = new AbortController();
  let timeoutKind = "";
  let idleTimeoutId;
  let hardTimeoutId;
  const abortForTimeout = (kind) => {
    if (controller.signal.aborted) return;
    timeoutKind = kind;
    controller.abort();
  };
  const resetIdleTimeout = () => {
    clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(
      () => abortForTimeout("idle"),
      AI_PROVIDER_IDLE_TIMEOUT_MS,
    );
  };

  hardTimeoutId = setTimeout(
    () => abortForTimeout("hard"),
    AI_PROVIDER_HARD_TIMEOUT_MS,
  );
  resetIdleTimeout();
  try {
    const response = await fetch(
      YTD_SETTINGS.chatCompletionsUrl(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.aiApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    // Receiving headers proves DeepSeek is still making progress. DeepSeek
    // may then send blank-line body chunks while a non-streaming request queues.
    resetIdleTimeout();

    const data = await readBoundedAiResponse(response, resetIdleTimeout);
    if (!response.ok) {
      const errorData = data && typeof data === "object" ? data : {};
      const error = new Error(
        errorData.error?.message ||
          errorData.message ||
          `DeepSeek error: ${response.status}`,
      );
      error.status = response.status;
      throw error;
    }

    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      const error = new Error("DeepSeek 返回了空内容，请重试。");
      error.code = "EMPTY_AI_RESPONSE";
      throw error;
    }

    return { text, settings };
  } catch (error) {
    if (timeoutKind === "idle") {
      const timeoutError = new Error(
        "DeepSeek 已超过 50 秒没有响应，请重试。",
      );
      timeoutError.code = "AI_IDLE_TIMEOUT";
      throw timeoutError;
    }
    if (timeoutKind === "hard") {
      const timeoutError = new Error(
        "DeepSeek 请求超过 120 秒，请重试。",
      );
      timeoutError.code = "AI_HARD_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(idleTimeoutId);
    clearTimeout(hardTimeoutId);
  }
}

async function readBoundedAiResponse(response, onActivity) {
  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let responseText = "";
    let responseBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Every received chunk is activity, including DeepSeek's blank lines.
      onActivity();
      const byteLength = value?.byteLength ?? 0;
      responseBytes += byteLength;
      if (responseBytes > AI_PROVIDER_MAX_RESPONSE_BYTES) {
        await reader.cancel?.().catch(() => {});
        const error = new Error("DeepSeek response exceeded the 2 MiB limit.");
        error.code = "AI_RESPONSE_TOO_LARGE";
        throw error;
      }
      responseText += decoder.decode(value, { stream: true });
    }
    responseText += decoder.decode();
    return JSON.parse(responseText.trimStart());
  }

  // Some fetch implementations do not expose a readable stream. Preserve a
  // bounded body read for that case.
  if (typeof response.text === "function") {
    const responseText = await response.text();
    onActivity();
    const byteLength = new TextEncoder().encode(responseText).byteLength;
    if (byteLength > AI_PROVIDER_MAX_RESPONSE_BYTES) {
      const error = new Error("DeepSeek response exceeded the 2 MiB limit.");
      error.code = "AI_RESPONSE_TOO_LARGE";
      throw error;
    }
    return JSON.parse(responseText.trimStart());
  }

  // Legacy/test fetch shims may expose only json(). The hard and idle timers
  // still bound this fallback even though chunk-level activity is unavailable.
  const data = await response.json();
  onActivity();
  return data;
}

// ============================================================
// SIDE PANEL SETUP
// ============================================================

/**
 * When the user clicks the extension icon, open the side panel.
 * Chrome's Side Panel API lets us show a persistent panel alongside the page.
 */
chrome.action.onClicked.addListener((tab) => {
  if (globalThis.YTD_LAYOUT?.isVertical()) { YTD_LAYOUT.vertical(tab.id).catch(()=>{}); return; }
  // Re-enable + open without awaiting — preserves user gesture context
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: "sidepanel.html",
    enabled: true,
  });
  chrome.sidePanel.open({ tabId: tab.id });
});

/**
 * Allow the side panel to open on any page, but it's designed for YouTube.
 */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});

/**
 * Keep the side panel scoped to YouTube tabs only.
 *
 * Chrome side panels are "global" by default: once opened, the panel follows
 * you to every tab. To make YouTube Digest behave like a YouTube-only tool, we
 * enable the panel on YouTube tabs and disable it everywhere else. Disabling
 * on a tab makes Chrome hide/close the panel for that tab, so it never lingers
 * on a new tab or some other website.
 *
 * We have to react to BOTH things that can change "what tab you're looking at":
 *   - onUpdated: the current tab navigates to a new URL
 *   - onActivated: you switch to (or open) a different tab
 * The original code only handled onUpdated, which is why the panel stayed
 * visible when switching to an already-loaded non-YouTube tab.
 */
function isYouTubeTabUrl(url) {
  if(globalThis.YTD_PLATFORM)return YTD_PLATFORM.supported(url);
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && parsed.hostname === "www.youtube.com"
    );
  } catch (error) {
    return false;
  }
}

const panelReconciliations = new Map();

async function closePanelForTab(tabId, windowId, isCurrent = () => true) {
  // Chrome 116 does not expose sidePanel.close. Disabling the tab below is
  // the compatibility path on older supported versions.
  if (typeof chrome.sidePanel.close !== "function") return;

  try {
    await chrome.sidePanel.close({ tabId });
    return;
  } catch (error) {
    // Newer Chrome releases can reject tabId when the visible side panel is a
    // window-level instance. Fall back to that exact window only.
  }

  if (!isCurrent()) return;
  if (Number.isInteger(windowId)) {
    await chrome.sidePanel.close({ windowId }).catch(() => {});
  }
}

async function updatePanelForTab(tabId, url, windowId) {
  const snapshot = {};
  panelReconciliations.set(tabId, snapshot);
  const isCurrent = () => panelReconciliations.get(tabId) === snapshot;

  try {
    if (!isYouTubeTabUrl(url) || globalThis.YTD_LAYOUT?.isVertical()) {
      await closePanelForTab(tabId, windowId, isCurrent);
      if (!isCurrent()) return;
      await chrome.sidePanel
        .setOptions({ tabId, enabled: false })
        .catch(() => {});
      if (!isCurrent()) return;
      return;
    }

    if (!isCurrent()) return;
    // setOptions can reject if the tab just closed — ignore that harmlessly.
    await chrome.sidePanel
      .setOptions({ tabId, path: "sidepanel.html", enabled: true })
      .catch(() => {});
    if (!isCurrent()) return;
  } finally {
    if (isCurrent()) panelReconciliations.delete(tabId);
  }
}

function getNavigationUrl(changeInfo, tab) {
  if (changeInfo.url) return changeInfo.url;
  if (changeInfo.status !== "loading" && changeInfo.status !== "complete") {
    return "";
  }
  return tab?.pendingUrl || tab?.url || "";
}

// Reconcile at both navigation start and completion because Chrome can reset
// tab-specific side-panel state while a navigation commits.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = getNavigationUrl(changeInfo, tab);
  if (!url) return; // Ignore title and favicon-only updates.
  void updatePanelForTab(tabId, url, tab?.windowId);
});

// The user switched to a different tab (or opened a new one).
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    void updatePanelForTab(tabId, tab.url || tab.pendingUrl, windowId);
  } catch (e) {
    // Tab vanished before we could read it — nothing to do.
  }
});

// ============================================================
// MESSAGE HANDLING
// ============================================================

/**
 * Listen for messages from the side panel and content script.
 * This is like a switchboard — different "actions" trigger different handlers.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // We need to return true to indicate we'll respond asynchronously
  if (message.action === "fetchTranscript") {
    handleFetchTranscript(message.videoId, message.mode)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // Keep the message channel open for async response
  }

  if (message.action === "analyzeTranscript") {
    // Pass video duration to help the AI validate timestamps
    handleAnalyzeTranscript(
      message.transcriptText,
      message.videoTitle,
      message.channelName,
      message.videoDescription,
      message.videoDuration,
    )
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === "explainSelection") {
    // Explain selected text using DeepSeek.
    handleExplainSelection(
      message.selectedText,
      message.transcriptContext,
      message.videoTitle,
    )
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === "saveNote") {
    // Save a note at the current timestamp
    handleSaveNote(
      message.videoId,
      message.timestamp,
      message.videoTitle,
      message.channelName,
    )
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "saveOverviewNote") {
    handleSaveOverviewNote(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "getNotes") {
    // Get all saved notes
    handleGetNotes(message.videoId)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "deleteNote") {
    // Delete a specific note
    handleDeleteNote(message.noteId)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "saveVocabulary") {
    saveVocabulary(message)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          success: false,
          error: err.code || err.message,
          message: err.message,
        }),
      );
    return true;
  }

  if (message.action === "getVocabulary") {
    getVocabulary(message.videoId)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          success: false,
          error: err.code || err.message,
          message: err.message,
        }),
      );
    return true;
  }

  if (message.action === "deleteVocabulary") {
    deleteVocabulary(message.vocabularyId)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          success: false,
          error: err.code || err.message,
          message: err.message,
        }),
      );
    return true;
  }

  if (message.action === "getVideoInfo") {
    handleGetVideoInfo(message.tabId)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  // Translation: send content to DeepSeek.
  if (message.action === "translateContent") {
    handleTranslateContent(
      message.content,
      message.contentType,
      message.targetLanguage,
      message.videoTitle,
    )
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }



  if (message.action === "checkConfig") {
    getSettings()
      .then((settings) =>
        sendResponse({
          hasSupadataKey: !!settings.supadataApiKey,
          hasAiKey: !!settings.aiApiKey,
        }),
      )
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.action === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "openSidePanel") {
    if (globalThis.YTD_LAYOUT?.isVertical() && sender.tab?.id) {
      YTD_LAYOUT.vertical(sender.tab.id).then(sendResponse,e=>sendResponse({success:false,error:e.message}));return true;
    }
    const tabId = sender.tab?.id;
    debugLog("[YouTube Digest BG] openSidePanel requested from tab:", tabId);

    // Re-enable the panel (it may have been disabled by auto-close) and open it.
    // IMPORTANT: we call setOptions + open synchronously (no await between them)
    // to preserve the user gesture context. Chrome requires sidePanel.open()
    // to be called within a user gesture — awaiting anything first can expire it.
    if (tabId) {
      chrome.sidePanel.setOptions({
        tabId,
        path: "sidepanel.html",
        enabled: true,
      });
      chrome.sidePanel
        .open({ tabId })
        .then(() => {
          // Broadcast to side panel to start digest (in case it's already open)
          setTimeout(() => {
            chrome.runtime
              .sendMessage({ action: "startDigestFromButton" })
              .catch(() => {});
          }, 300);
        })
        .catch((err) => {
          console.error("[YouTube Digest BG] openSidePanel error:", err);
        });
    } else {
      // Fallback: find the active tab
      chrome.tabs
        .query({ active: true, lastFocusedWindow: true })
        .then((tabs) => {
          if (tabs[0]) {
            chrome.sidePanel.setOptions({
              tabId: tabs[0].id,
              path: "sidepanel.html",
              enabled: true,
            });
            chrome.sidePanel.open({ tabId: tabs[0].id }).catch((err) => {
              console.error(
                "[YouTube Digest BG] openSidePanel fallback error:",
                err,
              );
            });
          }
        });
    }

    sendResponse({ success: true });
    return false;
  }

  // Relay messages from side panel to content script
  if (message.action === "relayToContent") {
    debugLog("[YouTube Digest BG] Relay request:", message.payload?.action);
    (async () => {
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        debugLog(
          "[YouTube Digest BG] Active tab in last focused window:",
          tabs.length,
          tabs[0]?.url,
        );

        if (sender.tab && sender.url?.split("?")[0] === chrome.runtime.getURL("sidepanel.html") && sender.tab.id !== tabs[0]?.id) {sendResponse({success:false});return;}
        if (tabs[0] && isYouTubeTabUrl(tabs[0].url)) {
          debugLog(
            "[YouTube Digest BG] Sending to tab:",
            tabs[0].id,
            "URL:",
            tabs[0].url,
          );
          let response = await chrome.tabs.sendMessage(
            tabs[0].id,
            message.payload,
          );

          // For getVideoInfo, PREFER YouTube's own player data over the
          // DOM scrape. The player's videoDetails is canonical: its `author`
          // is always THIS video's channel and its `shortDescription` is the
          // full text. The DOM scrape is unreliable — e.g. on a playlist page
          // it grabbed the playlist owner's name ("Zara Zhang") instead of the
          // real channel ("Replit and Stripe"), and its description is
          // truncated while the box is collapsed. We fall back to the DOM
          // only for fields the player didn't provide.
          if (message.payload?.action === "getVideoInfo") {
            const playerInfo = await getPlayerVideoDetails(tabs[0].id);
            if (playerInfo) {
              response = {
                title: playerInfo.title || response?.title || "",
                channelName:
                  playerInfo.channelName || response?.channelName || "",
                duration: playerInfo.duration || response?.duration || 0,
                description:
                  playerInfo.description || response?.description || "",
              };
            }
          }

          debugLog("[YouTube Digest BG] Got response from content:", response);
          sendResponse({ success: true, response });
        } else {
          debugLog("[YouTube Digest BG] No active YouTube tab found");
          sendResponse({
            success: false,
            error: "请先切换到哔哩哔哩或 YouTube 视频页。",
          });
        }
      } catch (err) {
        console.error("[YouTube Digest BG] Relay error:", err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep channel open for async response
  }
});

/**
 * Reads the current video's full details straight from YouTube's player.
 *
 * Content scripts live in an isolated world and can't touch the page's own
 * JavaScript. But with the "scripting" permission we can run a tiny function
 * in the page's MAIN world, where YouTube's player object lives. Its
 * getPlayerResponse() carries videoDetails with the FULL description —
 * unlike the DOM, which truncates it until the user clicks "...more".
 *
 * Returns null on any failure so callers can fall back to DOM scraping.
 */
async function getPlayerVideoDetails(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        try {
          const player = document.getElementById("movie_player");
          const details = player?.getPlayerResponse?.()?.videoDetails;
          if (!details) return null;
          return {
            title: details.title || "",
            channelName: details.author || "",
            description: details.shortDescription || "",
            duration: Number(details.lengthSeconds) || 0,
          };
        } catch (e) {
          return null;
        }
      },
    });
    return results?.[0]?.result || null;
  } catch (e) {
    console.warn("[YouTube Digest BG] Player details unavailable:", e.message);
    return null;
  }
}

// ============================================================
// TRANSCRIPT FETCHING VIA SUPADATA API
// ============================================================

/**
 * Fetches the transcript for a YouTube video using Supadata API.
 *
 * Supadata is a specialized service that reliably extracts transcripts
 * from YouTube videos. It handles all the complexity of parsing YouTube's
 * internal data structures, dealing with different caption formats, etc.
 *
 * API Docs: https://docs.supadata.ai
 *
 * @param {string} videoId - The YouTube video ID (e.g., "dQw4w9WgXcQ")
 * @param {string} mode - 'native' by default, or explicit opt-in 'generate'
 * @returns {Object} - { success, transcript, transcriptText, language } or { success: false, error }
 */
function normalizeTranscriptMode(mode) {
  return mode === "generate" ? "generate" : "native";
}

async function readSupadataJson(response) {
  let text = "";
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let receivedBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkBytes = value?.byteLength || 0;
        receivedBytes += chunkBytes;
        if (receivedBytes > SUPADATA_MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error("Supadata 返回内容过大");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      if (receivedBytes <= SUPADATA_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
      }
      throw error;
    }
  } else if (typeof response.text === "function") {
    text = await response.text();
    if (new TextEncoder().encode(text).byteLength > SUPADATA_MAX_RESPONSE_BYTES) {
      throw new Error("Supadata 返回内容过大");
    }
  } else if (typeof response.json === "function") {
    const value = await response.json();
    text = JSON.stringify(value);
    if (new TextEncoder().encode(text).byteLength > SUPADATA_MAX_RESPONSE_BYTES) {
      throw new Error("Supadata 返回内容过大");
    }
  }

  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!response.ok) return {};
    throw new Error("Supadata 返回格式无效");
  }
}

async function fetchSupadataJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    SUPADATA_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const data = await readSupadataJson(response);
    return { response, data };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Supadata 请求超过 30 秒，请重试");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleFetchTranscript(videoId, mode = "native") {
  if(globalThis.YTD_PLATFORM?.biliParts(videoId))return YTD_BILIBILI.fetchTranscript(videoId,{mode});
  try {
    const settings = await getSettings();
    if (!settings.supadataApiKey) {
      return {
        success: false,
        error: "NO_SUPADATA_KEY",
        message: "请在学习设置中填写 Supadata 密钥。B 站字幕无需此密钥。",
      };
    }

    // Share only the canonical watch URL. This strips playlist, referral,
    // timestamp, and other browsing parameters from the active tab URL.
    const canonicalVideoUrl = YTD_SETTINGS.canonicalYouTubeUrl(videoId);
    const transcriptMode = normalizeTranscriptMode(mode);
    // Using the universal transcript endpoint with text=false to get timestamped chunks
    const apiUrl = new URL("https://api.supadata.ai/v1/transcript");
    apiUrl.searchParams.set("url", canonicalVideoUrl);
    apiUrl.searchParams.set("text", "false"); // Get timestamped chunks, not plain text
    apiUrl.searchParams.set("lang", "en"); // Prefer English
    // Native remains the default. Paid AI transcription is sent only after an
    // explicit user confirmation in the side panel.
    apiUrl.searchParams.set("mode", transcriptMode);

    // Make the API request
    const { response, data } = await fetchSupadataJson(apiUrl.toString(), {
      method: "GET",
      headers: {
        "x-api-key": settings.supadataApiKey,
      },
    });

    // Handle async jobs (for videos > 20 minutes, Supadata returns a job ID)
    if (response.status === 202) {
      // Poll for the result
      return await pollTranscriptJob(
        data.jobId,
        settings.supadataApiKey,
        transcriptMode,
      );
    }

    if (response.status === 206) {
      return {
        success: false,
        error: "NO_TRANSCRIPT",
        message: "这个视频没有可读取的字幕轨。",
      };
    }

    if (!response.ok) {
      if (response.status === 401) {
        return {
          success: false,
          error: "INVALID_SUPADATA_KEY",
          message: "Supadata 密钥无效，请检查学习设置。",
        };
      }
      if (response.status === 404) {
        return {
          success: false,
          error: "NO_TRANSCRIPT",
          message: "这个视频没有可用字幕。",
        };
      }
      if (response.status === 429) {
        return {
          success: false,
          error: "RATE_LIMITED",
          message:
            "Supadata 请求过于频繁，请稍后重试。",
        };
      }
      throw new Error(
        data.message || `Supadata API error: ${response.status}`,
      );
    }

    // Parse the response into our internal format
    // Supadata returns: { content: [{ text, offset, duration, lang }], lang, availableLangs }
    const transcript = [];
    let transcriptTextPlain = ""; // Plain text for display/export
    let transcriptTextTimestamped = ""; // Timestamped text for AI analysis

    if (data.content && Array.isArray(data.content)) {
      for (const chunk of data.content) {
        if (chunk.text) {
          // Clean up caption artifacts:
          // ">>" = speaker change marker from YouTube auto-captions
          const cleanText = chunk.text.replace(/>> ?/g, "").trim();
          if (!cleanText) continue; // Skip if nothing left after cleanup

          // offset is in milliseconds, convert to seconds
          const startSeconds = Math.floor((chunk.offset || 0) / 1000);
          const minutes = Math.floor(startSeconds / 60);
          const seconds = startSeconds % 60;
          const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

          transcript.push({
            text: cleanText,
            start: startSeconds,
            duration: Math.floor((chunk.duration || 0) / 1000),
            language: chunk.lang || data.lang || null,
          });

          // Plain text without timestamps (for display/export)
          transcriptTextPlain += cleanText + " ";

          // Timestamped text for DeepSeek (format: [MM:SS] text)
          // This allows the model to reference actual transcript positions.
          transcriptTextTimestamped += `[${timestamp}] ${cleanText}\n`;
        }
      }
    }

    if (transcript.length === 0) {
      return {
        success: false,
        error: "EMPTY_TRANSCRIPT",
        message:
          transcriptMode === "generate"
            ? "AI transcription completed, but no speech was detected in this video."
            : "Supadata 返回的字幕为空。",
      };
    }

    return {
      success: true,
      transcript: transcript,
      transcriptText: transcriptTextPlain.trim(), // For display
      transcriptTextTimestamped: transcriptTextTimestamped.trim(), // For AI
      language: typeof data.lang === "string" ? data.lang : null,
      source: transcriptMode === "generate" ? "generated" : "native",
    };
  } catch (error) {
    console.error("Transcript fetch error:", error);
    return {
      success: false,
      error: error.message || "字幕获取失败",
    };
  }
}

/**
 * Polls for transcript job completion (for long videos).
 * Supadata processes videos > 20 minutes asynchronously.
 *
 * @param {string} jobId - The job ID returned by the initial request
 * @returns {Object} - Same format as handleFetchTranscript
 */
async function pollTranscriptJob(jobId, supadataApiKey, mode = "native") {
  const transcriptMode = normalizeTranscriptMode(mode);
  const maxAttempts = transcriptMode === "generate" ? 300 : 60;
  const pollInterval = 1000; // Poll every 1 second

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Wait before polling
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const { response, data } = await fetchSupadataJson(
      `https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`,
      {
        headers: { "x-api-key": supadataApiKey },
      },
    );

    if (!response.ok) {
      throw new Error(`Job polling failed: ${response.status}`);
    }

    if (data.status === "completed") {
      // Parse the completed transcript
      const transcript = [];
      let transcriptTextPlain = "";
      let transcriptTextTimestamped = "";

      if (data.content && Array.isArray(data.content)) {
        for (const chunk of data.content) {
          if (chunk.text) {
            // Clean up caption artifacts (">>" = speaker change marker)
            const cleanText = chunk.text.replace(/>> ?/g, "").trim();
            if (!cleanText) continue;

            const startSeconds = Math.floor((chunk.offset || 0) / 1000);
            const minutes = Math.floor(startSeconds / 60);
            const seconds = startSeconds % 60;
            const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

            transcript.push({
              text: cleanText,
              start: startSeconds,
              duration: Math.floor((chunk.duration || 0) / 1000),
              language: chunk.lang || data.lang || null,
            });
            transcriptTextPlain += cleanText + " ";
            transcriptTextTimestamped += `[${timestamp}] ${chunk.text}\n`;
          }
        }
      }

      if (transcript.length === 0) {
        return {
          success: false,
          error: "EMPTY_TRANSCRIPT",
          message:
            "AI transcription completed, but no speech was detected in this video.",
        };
      }

      return {
        success: true,
        transcript: transcript,
        transcriptText: transcriptTextPlain.trim(),
        transcriptTextTimestamped: transcriptTextTimestamped.trim(),
        language: typeof data.lang === "string" ? data.lang : null,
        source: transcriptMode === "generate" ? "generated" : "native",
      };
    }

    if (data.status === "failed") {
      throw new Error("字幕处理失败。");
    }

    // Status is 'queued' or 'active' — keep polling
  }

  throw new Error("字幕处理超时，请重试。");
}

// ============================================================
// JSON HELPER
// ============================================================

/**
 * Parses JSON returned by an LLM, tolerating the small mistakes they sometimes
 * make. Some models occasionally emit a trailing
 * comma before a ] or }, or wraps the JSON in prose / code fences. Plain
 * JSON.parse throws on those, which is what caused the "Unexpected token ']'"
 * error on the Overview tab. This function strips fences, isolates the outer
 * JSON object, removes trailing commas, and only then parses.
 *
 * @param {string} text - The raw text from the model
 * @returns {Object} - The parsed object (throws if still unparseable)
 */
function parseLooseJson(text) {
  let cleaned = (text || "").trim();

  // Strip ```json ... ``` style code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }

  // Isolate the outermost { ... } in case the model added a sentence around it
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    // Most common LLM slip: a trailing comma right before a } or ].
    // e.g. ["a", "b", ]  ->  ["a", "b" ]
    const repaired = cleaned.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(repaired);
  }
}

// ============================================================
// DEEPSEEK ANALYSIS
// ============================================================

/**
 * Sends the transcript to DeepSeek for analysis.
 *
 * The prompt asks the model to produce chapters covering the whole video
 * and 3-5 key quotes with timestamps.
 *
 * @param {string} transcriptText - The full transcript as plain text
 * @param {string} videoTitle - The video title
 * @param {string} channelName - The channel name
 * @returns {Object} - { success, analysis } or { success: false, error }
 */
async function handleAnalyzeTranscript(
  transcriptText,
  videoTitle,
  channelName,
  videoDescription,
  videoDuration,
) {
  try {
    const settings = await getSettings();
    if (!settings.aiApiKey) {
      return {
        success: false,
        error: "NO_AI_KEY",
        message: "请在学习设置中填写 DeepSeek API 密钥。",
      };
    }

    // Convert duration to MM:SS format for context
    // The transcript text is already prefixed with [M:SS] markers. Its LAST
    // marker is the most reliable signal of where the content actually ends —
    // more trustworthy than the duration metadata, which is sometimes missing
    // or wrong. We use the larger of (metadata duration, last transcript stamp).
    let lastTranscriptSeconds = 0;
    const stampMatches = transcriptText.match(/\[(\d+):(\d{2})\]/g) || [];
    if (stampMatches.length) {
      const last =
        stampMatches[stampMatches.length - 1].match(/\[(\d+):(\d{2})\]/);
      lastTranscriptSeconds = parseInt(last[1]) * 60 + parseInt(last[2]);
    }

    const effectiveSeconds = Math.max(
      Math.floor(videoDuration || 0),
      lastTranscriptSeconds,
    );
    const durationMinutes = Math.floor(effectiveSeconds / 60);
    const durationSeconds = Math.floor(effectiveSeconds % 60);
    const durationFormatted = `${durationMinutes}:${String(durationSeconds).padStart(2, "0")}`;
    const maxTimestampSeconds = effectiveSeconds;

    // The "last chapter must be after" threshold (75% in) forces the model to
    // cover the WHOLE video instead of front-loading chapters near the start.
    // We do NOT prescribe a chapter count — the model picks the natural splits.
    const lateThresholdSeconds = Math.floor(effectiveSeconds * 0.75);
    const lateThreshold = `${Math.floor(lateThresholdSeconds / 60)}:${String(
      lateThresholdSeconds % 60,
    ).padStart(2, "0")}`;

    const promptVariables = {
      durationFormatted,
      lateThreshold,
      maxTimestampSeconds,
      videoTitle: videoTitle || "未知",
      channelName: channelName || "未知",
      videoDescription: videoDescription || "No description available",
      transcriptText,
    };
    const systemPrompt = await loadPromptSection(
      "analysis.md",
      "System prompt",
      promptVariables,
    );
    const userPrompt = await loadPromptSection(
      "analysis.md",
      "User prompt",
      promptVariables,
    );

    debugLog("[YouTube Digest] Requesting video analysis", settings.aiModel);
    const { text: responseText } = await requestAiCompletion({
      maxTokens: 8192,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    // Parse the JSON, tolerating trailing commas / stray prose
    let analysis = parseLooseJson(responseText);

    // Treat every model response as untrusted data. Rebuild the supported
    // schema and derive display timestamps from validated numeric seconds.
    analysis = validateAndFixTimestamps(analysis, maxTimestampSeconds);

    return {
      success: true,
      analysis: analysis,
    };
  } catch (error) {
    console.error("Analysis error:", error);
    if (error.status === 401) {
      return {
        success: false,
        error: "INVALID_AI_KEY",
        message: "DeepSeek 密钥无效，请检查设置。",
      };
    }
    if (error.status === 429) {
      return {
        success: false,
        error: "RATE_LIMITED",
        message: "DeepSeek 请求过于频繁，请稍后重试。",
      };
    }
    return {
      success: false,
      error: error.message || "概览解析失败",
    };
  }
}

/**
 * Validates all timestamps in the analysis and fixes any that exceed video duration.
 * This is a safety net to prevent hallucinated timestamps from reaching the UI.
 *
 * @param {Object} analysis - The parsed analysis from DeepSeek
 * @param {number} maxSeconds - Maximum valid timestamp in seconds
 * @returns {Object} - Analysis with validated timestamps
 */
function validateAndFixTimestamps(analysis, maxSeconds) {
  const safeMax =
    Number.isFinite(Number(maxSeconds)) && Number(maxSeconds) > 0
      ? Number(maxSeconds)
      : Number.MAX_SAFE_INTEGER;

  // Helper to format seconds as MM:SS
  const formatTimestamp = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  const safeString = (value, maxLength) =>
    typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  const safeSeconds = (value) => {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > safeMax) {
      return null;
    }
    return Math.floor(seconds);
  };

  const summary = safeString(analysis?.summary, 3000);
  const chapters = (Array.isArray(analysis?.chapters) ? analysis.chapters : [])
    .slice(0, 100)
    .map((chapter) => {
      const seconds = safeSeconds(chapter?.timestampSeconds);
      const title = safeString(chapter?.title, 300);
      if (seconds === null || !title) return null;
      return {
        title,
        summary: safeString(chapter?.summary, 1500),
        timestampSeconds: seconds,
        timestamp: formatTimestamp(seconds),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  const keyQuotes = (
    Array.isArray(analysis?.keyQuotes) ? analysis.keyQuotes : []
  )
    .slice(0, 50)
    .map((quote) => {
      const seconds = safeSeconds(quote?.timestampSeconds);
      const text = safeString(quote?.quote, 3000);
      if (seconds === null || !text) return null;
      return {
        quote: text,
        timestampSeconds: seconds,
        timestamp: formatTimestamp(seconds),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  const keyMoments = (
    Array.isArray(analysis?.keyMoments) ? analysis.keyMoments : []
  )
    .map(safeSeconds)
    .filter((seconds) => seconds !== null)
    .slice(0, 100);

  return { summary, chapters, keyQuotes, keyMoments };
}

// ============================================================
// VIDEO INFO EXTRACTION
// ============================================================

/**
 * Gets video info (title, channel, description) from the active YouTube tab.
 * We do this by asking the content script to read the page.
 */
async function handleGetVideoInfo(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: "getVideoInfo",
    });
    return response;
  } catch (error) {
    return { title: "", channelName: "", description: "" };
  }
}

// ============================================================
// EXPLAIN SELECTION
// ============================================================

/**
 * Explains selected text using DeepSeek.
 * Provides context, definitions, and clarification for complex terms.
 *
 * @param {string} selectedText - The text the user selected
 * @param {string} transcriptContext - Surrounding transcript for context
 * @param {string} videoTitle - Video title for additional context
 * @returns {Object} - { success, explanation } or { success: false, error }
 */
// ============================================================
// NOTE MANAGEMENT
// ============================================================

function buildOverviewQuoteNote(message, timestampedUrl, now = Date.now()) {
  const noteText =
    typeof message?.noteText === "string"
      ? message.noteText.trim().slice(0, 6000)
      : "";
  if (!noteText) throw new Error("笔记内容不能为空");

  const safeTimestamp = Math.max(
    0,
    Math.floor(Number(message?.timestamp) || 0),
  );
  const minutes = Math.floor(safeTimestamp / 60);
  const seconds = safeTimestamp % 60;
  const languageMode = ["original", "zh", "bilingual"].includes(
    message?.languageMode,
  )
    ? message.languageMode
    : "original";

  return {
    id: `note_${now}`,
    videoId: String(message?.videoId || "").slice(0, 100),
    videoTitle:
      typeof message?.videoTitle === "string"
        ? message.videoTitle.slice(0, 500)
        : "未命名视频",
    channelName:
      typeof message?.channelName === "string"
        ? message.channelName.slice(0, 300)
        : "",
    timestamp: `${minutes}:${String(seconds).padStart(2, "0")}`,
    timestampSeconds: safeTimestamp,
    timestampedUrl,
    text: noteText,
    rawText:
      typeof message?.rawText === "string"
        ? message.rawText.trim().slice(0, 3000)
        : "",
    languageMode,
    createdAt: now,
  };
}

/** Saves an Overview quote exactly as it is displayed to the user. */
async function handleSaveOverviewNote(message) {
  try {
    const videoId = String(message?.videoId || "").trim();
    const safeTimestamp = Math.max(
      0,
      Math.floor(Number(message?.timestamp) || 0),
    );
    const timestampedUrl = (globalThis.YTD_PLATFORM?.sourceUrl(videoId,safeTimestamp) || `${YTD_SETTINGS.canonicalYouTubeUrl(videoId)}&t=${safeTimestamp}s`);
    const note = buildOverviewQuoteNote(message, timestampedUrl);
    await saveNoteToStorage(note);
    chrome.runtime.sendMessage({ action: "noteSaved", note }).catch(() => {});
    return { success: true, note };
  } catch (error) {
    console.error("[YouTube Digest] Save Overview note error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Saves a note at the current timestamp.
 * Fetches the transcript if needed, finds the relevant line, and cleans it up.
 */
async function handleSaveNote(
  videoId,
  timestamp,
  videoTitle,
  channelName,
) {
  try {
    const canonicalVideoUrl = YTD_SETTINGS.canonicalYouTubeUrl(videoId);
    const safeTimestamp = Math.max(0, Math.floor(Number(timestamp) || 0));

    // First, try to get the transcript from the digest cache. The side panel
    // saves digests to chrome.storage.LOCAL — this used to look in
    // storage.session (the wrong store), so it missed every time and
    // refetched the transcript from Supadata on every saved note.
    let transcript = null;
    try {
      const cached = await chrome.storage.local.get(`digest_${videoId}`);
      if (cached[`digest_${videoId}`]?.transcript) {
        transcript = cached[`digest_${videoId}`].transcript;
        debugLog("[YouTube Digest] Using cached transcript for note");
      }
    } catch (e) {
      debugLog("[YouTube Digest] No cached transcript, fetching...");
    }

    // If no cached transcript, fetch it
    if (!transcript) {
      const transcriptResult = await handleFetchTranscript(videoId);
      if (!transcriptResult.success) {
        return { success: false, error: "字幕获取失败。" };
      }
      transcript = transcriptResult.transcript;
    }

    // Find the transcript line at the current timestamp
    // Look for the line that contains this timestamp (or the closest one before)
    let matchedLine = null;
    let matchedIndex = 0;
    let contextLines = [];
    let beforeLine = null; // a few sentences before
    let afterLine = null; // a few sentences after

    for (let i = 0; i < transcript.length; i++) {
      const line = transcript[i];
      if (
        line.start <= safeTimestamp &&
        (!transcript[i + 1] || transcript[i + 1].start > safeTimestamp)
      ) {
        matchedLine = line;
        matchedIndex = i;

        // Build a buffer of 2 lines before and 4 lines after the target.
        // This gives the model enough text to find a natural sentence boundary
        // and complete a thought that spans multiple short caption chunks.
        const beforeLines = [];
        for (let j = 1; j <= 2 && i - j >= 0; j++) {
          beforeLines.unshift(transcript[i - j].text);
        }
        if (beforeLines.length > 0) {
          beforeLine = beforeLines.join(" ");
        }

        const afterLines = [];
        for (let j = 1; j <= 4 && i + j < transcript.length; j++) {
          afterLines.push(transcript[i + j].text);
        }
        if (afterLines.length > 0) {
          afterLine = afterLines.join(" ");
        }

        // Get broader context (8 lines before and 12 lines after) for understanding
        const startIdx = Math.max(0, i - 8);
        const endIdx = Math.min(transcript.length - 1, i + 12);
        for (let j = startIdx; j <= endIdx; j++) {
          contextLines.push(transcript[j].text);
        }
        break;
      }
    }

    if (!matchedLine) {
      // Fallback: use the last line if timestamp is beyond transcript
      matchedLine = transcript[transcript.length - 1];
      matchedIndex = transcript.length - 1;

      // Get buffer sentence (only before, since we're at the end)
      const beforeLines = [];
      for (let j = 1; j <= 2 && matchedIndex - j >= 0; j++) {
        beforeLines.unshift(transcript[matchedIndex - j].text);
      }
      if (beforeLines.length > 0) {
        beforeLine = beforeLines.join(" ");
      }

      const startIdx = Math.max(0, matchedIndex - 8);
      for (let j = startIdx; j <= matchedIndex; j++) {
        contextLines.push(transcript[j].text);
      }
    }

    // Clean up the text with DeepSeek.
    const cleanedText = await cleanupNoteText(
      matchedLine.text,
      beforeLine,
      afterLine,
      contextLines.join(" "),
      videoTitle,
    );

    // Format timestamp as MM:SS
    const minutes = Math.floor(safeTimestamp / 60);
    const seconds = safeTimestamp % 60;
    const formattedTimestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

    // Create timestamped URL
    const timestampedUrl = globalThis.YTD_PLATFORM?.sourceUrl(videoId,safeTimestamp) || `${canonicalVideoUrl}&t=${safeTimestamp}s`;

    // Create the note object
    const note = {
      id: `note_${Date.now()}`,
      videoId: videoId,
      videoTitle:
        typeof videoTitle === "string"
          ? videoTitle.slice(0, 500)
          : "未命名视频",
      channelName:
        typeof channelName === "string" ? channelName.slice(0, 300) : "",
      timestamp: formattedTimestamp,
      timestampSeconds: safeTimestamp,
      timestampedUrl: timestampedUrl,
      text: cleanedText,
      rawText: matchedLine.text,
      languageMode: "original",
      createdAt: Date.now(),
    };

    // Save to storage
    await saveNoteToStorage(note);

    // Notify side panel to refresh notes list
    chrome.runtime.sendMessage({ action: "noteSaved", note }).catch(() => {});

    return { success: true, note };
  } catch (error) {
    console.error("[YouTube Digest] Save note error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Cleans up transcript lines using DeepSeek.
 * Takes the target line plus buffer sentences (1 before, 1 after).
 * Uses JSON output to prevent any preambles from appearing.
 */
async function cleanupNoteText(
  targetText,
  beforeText,
  afterText,
  fullContext,
  videoTitle,
) {
  const settings = await getSettings();
  if (!settings.aiApiKey) {
    return [beforeText, targetText, afterText].filter(Boolean).join(" ");
  }

  try {
    debugLog("[YouTube Digest] Requesting note cleanup");
    const variables = {
      videoTitle: videoTitle || "未知",
      fullContext,
      beforeText: beforeText || "(none)",
      targetText,
      afterText: afterText || "(none)",
    };
    const systemPrompt = await loadPromptSection(
      "note-cleanup.md",
      "System prompt",
      variables,
    );
    const userPrompt = await loadPromptSection(
      "note-cleanup.md",
      "User prompt",
      variables,
    );
    const { text: resultText } = await requestAiCompletion({
      maxTokens: 512,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    let result = resultText.trim() || targetText;

    // Parse the JSON response (tolerating trailing commas / fences).
    try {
      const parsed = parseLooseJson(result);
      if (typeof parsed.quote === "string" && parsed.quote.trim()) {
        return parsed.quote.trim().slice(0, 3000);
      }
    } catch (parseError) {
      console.warn(
        "[YouTube Digest] JSON parse failed for note, stripping preambles:",
        parseError,
      );
      result = result.replace(
        /^(Here'?s?( the)?( cleaned)?( version)?:?\s*)/i,
        "",
      );
      result = result.replace(
        /^(The cleaned (quote|text|version)( is)?:?\s*)/i,
        "",
      );
      result = result.replace(/^(I will.*?:?\s*)/i, "");
      result = result.replace(/^(Cleaned:?\s*)/i, "");
      result = result.replace(/^["']|["']$/g, "");
    }

    return result.slice(0, 3000);
  } catch (e) {
    console.error("[YouTube Digest] Cleanup error:", e);
  }

  // Return combined raw text if cleanup fails
  return [beforeText, targetText, afterText].filter(Boolean).join(" ");
}

/**
 * Saves a note to chrome.storage.local
 */
async function saveNoteToStorage(note) {
  const result = await chrome.storage.local.get("ytd_notes");
  const notes = result.ytd_notes || [];
  notes.unshift(note); // Add to beginning (newest first)

  // Keep only last 100 notes to prevent storage bloat
  if (notes.length > 100) {
    notes.splice(100);
  }

  await chrome.storage.local.set({ ytd_notes: notes });
}

/**
 * Gets notes from storage, optionally filtered by video ID
 */
async function handleGetNotes(videoId) {
  try {
    const result = await chrome.storage.local.get("ytd_notes");
    let notes = result.ytd_notes || [];

    if (videoId) {
      notes = notes.filter((n) => n.videoId === videoId);
    }

    return { success: true, notes };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Deletes a note by ID
 */
async function handleDeleteNote(noteId) {
  try {
    const result = await chrome.storage.local.get("ytd_notes");
    let notes = result.ytd_notes || [];
    notes = notes.filter((n) => n.id !== noteId);
    await chrome.storage.local.set({ ytd_notes: notes });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// VOCABULARY MANAGEMENT
// ============================================================

function vocabularyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function detectVocabularySourceLanguage(term) {
  const hasJapanese = /[\u3040-\u30ff]/u.test(term);
  const hasKorean = /[\uac00-\ud7af]/u.test(term);
  const hasHan = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(term);
  if (hasJapanese) return "ja";
  if (hasKorean) return "ko";
  if (hasHan) return "zh";

  const letters = Array.from(term).filter((character) => /\p{L}/u.test(character));
  const hasLatin = letters.some((character) =>
    /\p{Script=Latin}/u.test(character),
  );
  const hasUnsupportedLetter = letters.some(
    (character) => !/\p{Script=Latin}/u.test(character),
  );
  return hasLatin && !hasUnsupportedLetter ? "en" : "other";
}

function normalizeVocabularyTerm(value) {
  if (typeof value !== "string") {
    throw vocabularyError(
      "VOCABULARY_INVALID_TERM",
      "请先选择要收藏的词句。",
    );
  }
  const term = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!term) {
    throw vocabularyError(
      "VOCABULARY_INVALID_TERM",
      "请先选择要收藏的词句。",
    );
  }
  if (term.length > VOCABULARY_MAX_TERM_CHARS) {
    throw vocabularyError(
      "VOCABULARY_INVALID_TERM",
      "词条不能超过 1,000 个字符。",
    );
  }

  const sourceLanguage = detectVocabularySourceLanguage(term);
  // CJK terms are exact after Unicode/whitespace normalization. Latin-only
  // terms use a case-insensitive key so repeated capitalization is free.
  const normalizedTerm = ["zh", "ja", "ko"].includes(sourceLanguage)
    ? term
    : term.toLocaleLowerCase("en-US");

  return { term, normalizedTerm, sourceLanguage };
}

function validateVocabularyEnrichment(value, selectedTerm = "") {
  let parsed = value;
  if (typeof value === "string") {
    if (value.length > 10_000) {
      throw vocabularyError(
        "VOCABULARY_INVALID_RESPONSE",
        "词义解析内容过长，请重试。",
      );
    }
    try {
      parsed = parseLooseJson(value);
    } catch (error) {
      throw vocabularyError(
        "VOCABULARY_INVALID_RESPONSE",
        `词义解析格式错误：${error.message}`,
      );
    }
  }

  const boundedField = (fieldName, maxLength) => {
    const fieldValue =
      typeof parsed?.[fieldName] === "string"
        ? parsed[fieldName].normalize("NFKC").trim()
        : "";
    if (!fieldValue) {
      throw vocabularyError(
        "VOCABULARY_INVALID_RESPONSE",
        `词义解析缺少 ${fieldName}。`,
      );
    }
    if (fieldValue.length > maxLength) {
      throw vocabularyError(
        "VOCABULARY_INVALID_RESPONSE",
        `词义解析 ${fieldName} 不能超过 ${maxLength.toLocaleString("en-US")} 个字符。`,
      );
    }
    if (/<\/?[a-z][^>]*>/iu.test(fieldValue)) {
      throw vocabularyError(
        "VOCABULARY_INVALID_RESPONSE",
        `词义解析 ${fieldName} 必须是纯文本，不能包含 HTML。`,
      );
    }
    return fieldValue;
  };

  let phonetic = "";
  if (parsed?.phonetic !== undefined && parsed?.phonetic !== null) {
    if (typeof parsed.phonetic !== "string") {
      throw vocabularyError(
        "VOCABULARY_INVALID_RESPONSE",
        "音标必须是纯文本。",
      );
    }
    phonetic = parsed.phonetic.normalize("NFKC").trim();
    if (phonetic.length > 160) {
      throw vocabularyError(
        "VOCABULARY_INVALID_RESPONSE",
        "音标不能超过 160 个字符。",
      );
    }
    if (/[<>]/u.test(phonetic)) {
      throw vocabularyError(
        "VOCABULARY_INVALID_RESPONSE",
        "音标不能包含标记代码。",
      );
    }
  }

  const normalizedSelectedTerm =
    typeof selectedTerm === "string"
      ? selectedTerm.normalize("NFKC").replace(/\s+/gu, " ").trim()
      : "";
  const selectedLanguage = normalizedSelectedTerm
    ? detectVocabularySourceLanguage(normalizedSelectedTerm)
    : "";
  if (
    normalizedSelectedTerm.length > VOCABULARY_MAX_PHONETIC_TERM_CHARS ||
    (selectedLanguage && !["en", "zh"].includes(selectedLanguage))
  ) {
    phonetic = "";
  }

  return {
    meaningZh: boundedField("meaningZh", 500),
    explanationZh: boundedField("explanationZh", 2_000),
    phonetic,
  };
}

function buildVocabularyEntry(
  message,
  enrichment,
  now = Date.now(),
  requestedId,
) {
  const normalized = normalizeVocabularyTerm(message?.term);
  const validatedEnrichment = validateVocabularyEnrichment(
    enrichment,
    normalized.term,
  );
  const videoId =
    typeof message?.videoId === "string" ? message.videoId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(videoId)) {
    throw vocabularyError(
      "VOCABULARY_INVALID_VIDEO",
      "无法识别来源视频，请重新打开视频页。",
    );
  }

  const timestampNumber = Number(message?.timestamp);
  if (
    !Number.isFinite(timestampNumber) ||
    timestampNumber < 0 ||
    timestampNumber > 31_536_000
  ) {
    throw vocabularyError(
      "VOCABULARY_INVALID_TIMESTAMP",
      "收藏时间点无效。",
    );
  }
  const timestampSeconds = Math.floor(timestampNumber);
  const minutes = Math.floor(timestampSeconds / 60);
  const seconds = timestampSeconds % 60;

  const safeText = (value, maxLength, fallback = "") =>
    typeof value === "string"
      ? value.normalize("NFKC").trim().slice(0, maxLength)
      : fallback;
  const createdAtNumber = Number(now);
  if (!Number.isFinite(createdAtNumber) || createdAtNumber < 0) {
    throw vocabularyError(
      "VOCABULARY_INVALID_ENTRY",
      "收藏创建时间无效。",
    );
  }
  const createdAt = Math.floor(createdAtNumber);
  const generatedId = `vocab_${createdAt}_${Math.random().toString(36).slice(2, 10)}`;
  const id = typeof requestedId === "string" ? requestedId : generatedId;
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
    throw vocabularyError(
      "VOCABULARY_INVALID_ENTRY",
      "词条编号无效。",
    );
  }

  return {
    id,
    term: normalized.term,
    normalizedTerm: normalized.normalizedTerm,
    sourceLanguage: normalized.sourceLanguage,
    meaningZh: validatedEnrichment.meaningZh,
    explanationZh: validatedEnrichment.explanationZh,
    phonetic: validatedEnrichment.phonetic,
    sourceExcerpt: safeText(message?.sourceExcerpt, 3_000, normalized.term),
    context: safeText(message?.context, 12_000),
    videoId,
    videoTitle: safeText(message?.videoTitle, 500, "未命名视频"),
    channelName: safeText(message?.channelName, 300),
    timestamp: `${minutes}:${String(seconds).padStart(2, "0")}`,
    timestampSeconds,
    timestampedUrl: globalThis.YTD_PLATFORM?.sourceUrl(videoId,timestampSeconds) || `https://www.youtube.com/watch?v=${videoId}&t=${timestampSeconds}s`,
    createdAt,
  };
}

function validateStoredVocabularyEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const entry = buildVocabularyEntry(
      { ...value, timestamp: value.timestampSeconds },
      {
        meaningZh: value.meaningZh,
        explanationZh: value.explanationZh,
        phonetic: value.phonetic,
      },
      value.createdAt,
      value.id,
    );
    // A stored normalization mismatch is rejected instead of silently changing
    // duplicate identity during reads.
    const legacyLanguageMatch =
      (value.sourceLanguage === "und" && entry.sourceLanguage === "other") ||
      (value.sourceLanguage === "zh" && entry.sourceLanguage === "ja") ||
      (value.sourceLanguage === "en" && entry.sourceLanguage === "other");
    if (
      value.normalizedTerm !== entry.normalizedTerm ||
      (value.sourceLanguage !== entry.sourceLanguage && !legacyLanguageMatch)
    ) {
      return null;
    }
    return entry;
  } catch (error) {
    return null;
  }
}

async function readValidVocabulary() {
  const snapshot = await readVocabularySnapshot();
  return snapshot.validEntries;
}

async function readVocabularySnapshot() {
  const stored = await chrome.storage.local.get(VOCABULARY_STORAGE_KEY);
  const rawEntries = Array.isArray(stored[VOCABULARY_STORAGE_KEY])
    ? stored[VOCABULARY_STORAGE_KEY]
    : [];
  return {
    rawEntries,
    validEntries: rawEntries.map(validateStoredVocabularyEntry).filter(Boolean),
  };
}

async function saveVocabularyMutation(message) {
  try {
    const normalized = normalizeVocabularyTerm(message?.term);
    let snapshot = await readVocabularySnapshot();
    const existing = snapshot.validEntries.find(
      (entry) => entry.normalizedTerm === normalized.normalizedTerm,
    );
    if (existing) {
      return {
        success: true,
        alreadySaved: true,
        entry: existing,
      };
    }
    if (snapshot.rawEntries.length >= VOCABULARY_MAX_ENTRIES) {
      return {
        success: false,
        error: "VOCABULARY_CAPACITY",
        message: "单词库已满（500 条），请先删除部分词条。",
      };
    }

    let enrichment;
    if (globalThis.YTD_LEARNING_SERVICES) {
      enrichment = await globalThis.YTD_LEARNING_SERVICES.lookupVocabulary(message);
    } else {
    const promptVariables = {
      selectedTextJson: JSON.stringify(normalized.term),
      sourceExcerptJson: JSON.stringify(
        typeof message?.sourceExcerpt === "string"
          ? message.sourceExcerpt.slice(0, 3_000)
          : "",
      ),
      transcriptContextJson: JSON.stringify(
        typeof message?.context === "string"
          ? message.context.slice(0, 12_000)
          : "",
      ),
      videoTitleJson: JSON.stringify(
        typeof message?.videoTitle === "string"
          ? message.videoTitle.slice(0, 500)
          : "未命名视频",
      ),
    };
    const systemPrompt = await loadPromptSection(
      "vocabulary.md",
      "System prompt",
      promptVariables,
    );
    const userPrompt = await loadPromptSection(
      "vocabulary.md",
      "User prompt",
      promptVariables,
    );
    const { text } = await requestAiCompletion({
      maxTokens: 768,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    enrichment = validateVocabularyEnrichment(text, normalized.term);
    }
    const entry = buildVocabularyEntry(message, enrichment);

    // Re-read immediately before the single storage write. This protects
    // against changes from another extension view while the provider ran.
    snapshot = await readVocabularySnapshot();
    const lateExisting = snapshot.validEntries.find(
      (candidate) => candidate.normalizedTerm === entry.normalizedTerm,
    );
    if (lateExisting) {
      return {
        success: true,
        alreadySaved: true,
        entry: lateExisting,
      };
    }
    if (snapshot.rawEntries.length >= VOCABULARY_MAX_ENTRIES) {
      return {
        success: false,
        error: "VOCABULARY_CAPACITY",
        message: "单词库已满（500 条），请先删除部分词条。",
      };
    }

    await chrome.storage.local.set({
      [VOCABULARY_STORAGE_KEY]: [entry, ...snapshot.rawEntries],
    });
    await globalThis.YTD_LEARNING_SERVICES?.addCollection("word", entry.id, entry.videoId);
    chrome.runtime
      .sendMessage({ action: "vocabularySaved", entry })
      .catch(() => {});
    return { success: true, alreadySaved: false, entry };
  } catch (error) {
    return {
      success: false,
      error: error.code || error.message || "VOCABULARY_SAVE_FAILED",
      message: error.message || "Could not save vocabulary.",
    };
  }
}

let vocabularyMutationQueue = Promise.resolve();
function enqueueVocabularyMutation(mutation) {
  const operation = vocabularyMutationQueue.then(
    mutation,
    mutation,
  );
  vocabularyMutationQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

function saveVocabulary(message) {
  return enqueueVocabularyMutation(() => saveVocabularyMutation(message));
}

async function getVocabulary(videoId) {
  try {
    const requestedVideoId =
      typeof videoId === "string" && videoId.trim() ? videoId.trim() : "";
    if (requestedVideoId && !/^[A-Za-z0-9_-]{1,100}$/.test(requestedVideoId)) {
      throw vocabularyError(
        "VOCABULARY_INVALID_VIDEO",
        "视频筛选条件无效。",
      );
    }
    let vocabulary = await readValidVocabulary();
    if (requestedVideoId) {
      vocabulary = vocabulary.filter(
        (entry) => entry.videoId === requestedVideoId,
      );
    }
    vocabulary.sort((left, right) => right.createdAt - left.createdAt);
    return { success: true, vocabulary };
  } catch (error) {
    return {
      success: false,
      error: error.code || error.message,
      message: error.message,
      vocabulary: [],
    };
  }
}

async function deleteVocabularyMutation(vocabularyId) {
  try {
    if (
      typeof vocabularyId !== "string" ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(vocabularyId)
    ) {
      throw vocabularyError(
        "VOCABULARY_INVALID_ID",
        "词条编号无效。",
      );
    }
    const stored = await chrome.storage.local.get(VOCABULARY_STORAGE_KEY);
    const vocabulary = Array.isArray(stored[VOCABULARY_STORAGE_KEY])
      ? stored[VOCABULARY_STORAGE_KEY]
      : [];
    const remaining = vocabulary.filter(
      (entry) => entry?.id !== vocabularyId,
    );
    const deleted = remaining.length !== vocabulary.length;
    if (deleted) {
      await chrome.storage.local.set({
        [VOCABULARY_STORAGE_KEY]: remaining,
      });
    }
    return { success: true, deleted };
  } catch (error) {
    return {
      success: false,
      deleted: false,
      error: error.code || error.message,
      message: error.message,
    };
  }
}

function deleteVocabulary(vocabularyId) {
  return enqueueVocabularyMutation(() =>
    deleteVocabularyMutation(vocabularyId),
  );
}

async function handleExplainSelection(
  selectedText,
  transcriptContext,
  videoTitle,
) {
  try {
    const settings = await getSettings();
    if (!settings.aiApiKey) {
      return {
        success: false,
        error: "NO_AI_KEY",
        message: "请先在设置中填写 DeepSeek API 密钥。",
      };
    }

    const variables = {
      explainPayload: JSON.stringify({
        videoTitle: videoTitle || "未知",
        selectedText,
        transcriptContext: transcriptContext || "None",
      }),
    };
    const systemPrompt = await loadPromptSection(
      "explain.md",
      "System prompt",
      variables,
    );
    const userPrompt = await loadPromptSection(
      "explain.md",
      "User prompt",
      variables,
    );

    debugLog("[YouTube Digest] Requesting selection explanation");
    const { text: explanation } = await requestAiCompletion({
      maxTokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    return {
      success: true,
      explanation: explanation.trim(),
    };
  } catch (error) {
    console.error("Explain selection error:", error);
    return {
      success: false,
      error: error.message || "词句解释失败",
    };
  }
}

// ============================================================
// TRANSLATION — Contextual Chinese translations
// ============================================================

async function getTranslationBaseRules(targetLanguage) {
  if (targetLanguage !== "zh") {
    throw new Error(`Unsupported translation target: ${targetLanguage}`);
  }
  const langName = "Simplified Chinese";
  const langSpecific = await loadPromptSection(
    "translation.md",
    "Chinese rules",
  );
  return loadPromptSection("translation.md", "Shared base rules", {
    langName,
    langSpecific,
  });
}

function validateTranscriptBatchRequest(content) {
  const segments = content?.segments;
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 4) {
    throw new Error("每次翻译需要 1 至 4 段字幕");
  }

  const seenIds = new Set();
  let totalCharacters = 0;
  const normalized = segments.map((segment) => {
    const id = typeof segment?.id === "string" ? segment.id.trim() : "";
    const text = typeof segment?.text === "string" ? segment.text.trim() : "";
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(id) || seenIds.has(id)) {
      throw new Error("字幕段落编号重复或无效");
    }
    if (!text || text.length > 4000) {
      throw new Error("字幕内容无效或过长");
    }
    seenIds.add(id);
    totalCharacters += text.length;
    return { id, text };
  });
  if (totalCharacters > 12000) {
    throw new Error("本次翻译内容过多");
  }
  return normalized;
}

function looksLikeChineseTranslation(text, sourceText) {
  const latinLetters = (sourceText.match(/[A-Za-z]/g) || []).length;
  if (latinLetters < 20) return true;
  return /[\u3400-\u9fff]/.test(text);
}

/**
 * Aligns untrusted model output by exact stable ID. Missing, duplicated,
 * unknown, empty, or clearly non-Chinese values become explicit row errors.
 */
function normalizeTranslatedSegmentBatch(parsed, sourceSegments) {
  const candidates = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const sourceById = new Map(sourceSegments.map((segment) => [segment.id, segment]));
  const translatedById = new Map();

  candidates.forEach((candidate) => {
    if (
      typeof candidate?.id !== "string" ||
      typeof candidate?.text !== "string" ||
      !sourceById.has(candidate.id) ||
      translatedById.has(candidate.id)
    ) {
      return;
    }
    const text = candidate.text.trim();
    const source = sourceById.get(candidate.id);
    if (text && looksLikeChineseTranslation(text, source.text)) {
      translatedById.set(candidate.id, text);
    }
  });

  return {
    segments: sourceSegments.map((source) => ({
      id: source.id,
      text: translatedById.get(source.id) || "",
      error: translatedById.has(source.id)
        ? ""
        : "中文翻译缺失或无效",
    })),
  };
}

/**
 * Translates content using DeepSeek.
 * @param {Object} content - JSON object containing semantic transcript segments
 * @param {string} contentType - 'transcriptBatch', 'overviewBatch', or 'explainBatch'
 * @param {string} targetLanguage - 'zh' for Simplified Chinese
 * @param {string} videoTitle - The video title (for context)
 * @returns {Object} - { success, translatedContent } or { success: false, error }
 */
async function handleTranslateContent(
  content,
  contentType,
  targetLanguage,
  videoTitle,
) {
  try {
    if (targetLanguage !== "zh") {
      return {
        success: false,
        error: `Unsupported translation target: ${String(targetLanguage)}`,
      };
    }
    if (
      !["transcriptBatch", "overviewBatch", "explainBatch"].includes(
        contentType,
      )
    ) {
      return {
        success: false,
        error: `Unsupported translation content type: ${String(contentType)}`,
      };
    }

    const settings = await getSettings();
    if (!settings.aiApiKey) {
      return { success: false, error: "请先在设置中填写 DeepSeek API 密钥。" };
    }

    const sourceSegments = validateTranscriptBatchRequest(content);
    if (contentType === "explainBatch" && sourceSegments.length !== 1) {
      return {
        success: false,
        error: "解释翻译需要一段文本",
      };
    }
    const langName = "Simplified Chinese";
    const baseRules = await getTranslationBaseRules(targetLanguage);
    const promptSection =
      contentType === "overviewBatch"
        ? "Overview batch translation"
        : contentType === "explainBatch"
          ? "Explanation translation"
          : "Transcript batch translation";
    const systemPrompt = await loadPromptSection(
      "translation.md",
      promptSection,
      {
        langName,
        videoTitle: videoTitle || "未知",
        baseRules,
      },
    );
    const userContent = JSON.stringify({ segments: sourceSegments });
    const translationOptions = {
      temperature: 0.2,
      maxTokens: 1536,
      responseFormat: { type: "json_object" },
    };
    let result = await callAiTranslation(
      systemPrompt,
      userContent,
      translationOptions,
    );

    // DeepSeek JSON mode can rarely return an empty content string. The prompt
    // already requires JSON, so retry once without response_format.
    if (!result.success && result.code === "EMPTY_AI_RESPONSE") {
      result = await callAiTranslation(systemPrompt, userContent, {
        temperature: translationOptions.temperature,
        maxTokens: translationOptions.maxTokens,
      });
    }
    if (!result.success) return result;

    const parsed = parseLooseJson(result.text);
    const aligned = normalizeTranslatedSegmentBatch(parsed, sourceSegments);
    if (!aligned.segments.some((segment) => segment.text)) {
      return {
        success: false,
        error: "未返回有效的中文翻译",
      };
    }
    return { success: true, translatedContent: aligned };
  } catch (error) {
    console.error("[YouTube Digest] Translation error:", error);
    return { success: false, error: error.message || "翻译失败，请重试。" };
  }
}

/**
 * Makes a single DeepSeek call for translation.
 * Uses temperature 0.3 for consistent, predictable translations.
 *
 * @param {string} systemPrompt - The system-level instructions
 * @param {string} userContent - The user message (content to translate)
 * @returns {Object} - { success, text } or { success: false, error }
 */
async function callAiTranslation(
  systemPrompt,
  userContent,
  { temperature = 0.3, maxTokens = 8192, responseFormat } = {},
) {
  try {
    const { text } = await requestAiCompletion({
      temperature,
      maxTokens,
      responseFormat,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    return { success: true, text };
  } catch (error) {
    if (error.status === 429) {
      return {
        success: false,
        error: "请求过于频繁，请稍后重试。",
        code: "RATE_LIMITED",
      };
    }
    return { success: false, error: error.message, code: error.code };
  }
}

// Pure validators are exposed for the repository's Node tests only.
globalThis.__YTD_TRANSLATION_TESTING__ = {
  requestAiCompletion,
  callAiTranslation,
  validateTranscriptBatchRequest,
  normalizeTranslatedSegmentBatch,
  handleTranslateContent,
  validateAndFixTimestamps,
  buildOverviewQuoteNote,
  normalizeTranscriptMode,
  handleFetchTranscript,
  pollTranscriptJob,
  handleExplainSelection,
};

globalThis.__YTD_BACKGROUND_TESTING__ = {
  closePanelForTab,
  getPanelReconciliationCount: () => panelReconciliations.size,
  getNavigationUrl,
  isYouTubeTabUrl,
  updatePanelForTab,
};


globalThis.__YTD_VOCABULARY_TESTING__ = {
  normalizeVocabularyTerm,
  validateVocabularyEnrichment,
  buildVocabularyEntry,
  validateStoredVocabularyEntry,
  saveVocabulary,
  getVocabulary,
  deleteVocabulary,
};

// Learning features use separate modules and storage keys.
importScripts("lib/learning-core.js", "lib/learning-worker.js");
