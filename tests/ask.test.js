const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadAskHelpers({
  settings = {
    provider: "deepseek",
    aiApiKey: "test-ai-key",
    aiBaseUrl: "https://api.deepseek.com",
    aiModel: "deepseek-v4-flash",
    tavilyApiKey: "",
  },
  fetchImpl = async () => {
    throw new Error("Unexpected network request");
  },
  setTimeoutImpl = () => 0,
  clearTimeoutImpl = () => {},
} = {}) {
  const listeners = { addListener() {} };
  const storage = { ytd_settings: settings };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    AbortController,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    fetch: fetchImpl,
    importScripts() {},
    chrome: {
      storage: {
        local: {
          setAccessLevel: () => Promise.resolve(),
          get: async (key) => {
            if (key === null) return { ...storage };
            if (typeof key === "string") return { [key]: storage[key] };
            return {};
          },
          set: async (value) => Object.assign(storage, value),
        },
      },
      action: { onClicked: listeners },
      sidePanel: {
        setPanelBehavior() {},
        setOptions: () => Promise.resolve(),
      },
      runtime: {
        onInstalled: listeners,
        onMessage: listeners,
        openOptionsPage() {},
        getURL: (resourcePath) => `chrome-extension://test/${resourcePath}`,
      },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
    YTD_SETTINGS: {
      STORAGE_KEY: "ytd_settings",
      normalize: (value) => value,
      chatCompletionsUrl: () => "https://api.deepseek.com/chat/completions",
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("background.js"), sandbox);
  return sandbox.__YTD_ASK_TESTING__;
}

function loadAskUiHelpers() {
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval() {},
    clearInterval() {},
    IntersectionObserver: class {},
    CSS: { escape: (value) => value },
    window: { getSelection: () => null, close() {} },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => {
        let value = "";
        return {
          set textContent(text) {
            value = String(text);
          },
          get innerHTML() {
            return value
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll('"', "&quot;");
          },
        };
      },
    },
    chrome: {
      runtime: {
        onMessage: listeners,
        sendMessage: async () => ({ success: true }),
      },
      windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
    YTD_SETTINGS: {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("sidepanel.js"), sandbox);
  return sandbox.__YTD_ASK_UI_TESTING__;
}

function jsonResponse(value, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(value),
    json: async () => value,
  };
}

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay, active: true, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (!timer) return;
      timer.active = false;
      timer.cleared = true;
    },
    fireActive(delay) {
      const match = [...timers.entries()].find(
        ([, timer]) => timer.active && timer.delay === delay,
      );
      assert.ok(match, `Expected an active ${delay}ms timer`);
      match[1].active = false;
      match[1].callback();
    },
    activeCount(delay) {
      return [...timers.values()].filter(
        (timer) => timer.active && timer.delay === delay,
      ).length;
    },
    clearedCount(delay) {
      return [...timers.values()].filter(
        (timer) => timer.cleared && timer.delay === delay,
      ).length;
    },
  };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("normalizeAskQuestion trims valid questions and rejects empty or oversized input", () => {
  const { normalizeAskQuestion } = loadAskHelpers();

  assert.equal(normalizeAskQuestion("  What is the main claim?  "), "What is the main claim?");
  assert.throws(() => normalizeAskQuestion("   "), /question/i);
  assert.throws(() => normalizeAskQuestion(42), /question/i);
  assert.equal(normalizeAskQuestion("x".repeat(2000)).length, 2000);
  assert.throws(() => normalizeAskQuestion("x".repeat(2001)), /2,000/);
});

test("normalizeAskHistory validates role order and retains only bounded recent rounds", () => {
  const { normalizeAskHistory } = loadAskHelpers();
  const history = [];
  for (let round = 1; round <= 7; round += 1) {
    history.push({ role: "user", content: `question-${round}` });
    history.push({ role: "assistant", content: `answer-${round}` });
  }

  const normalized = normalizeAskHistory(history);
  assert.equal(normalized.length, 12);
  assert.equal(normalized[0].content, "question-2");
  assert.equal(normalized.at(-1).content, "answer-7");
  assert.ok(
    normalized.reduce((total, message) => total + message.content.length, 0) <=
      12000,
  );

  const oversized = normalizeAskHistory([
    { role: "user", content: "u".repeat(5000) },
    { role: "assistant", content: "a".repeat(15000) },
  ]);
  assert.equal(oversized[0].content.length, 2000);
  assert.equal(oversized[1].content.length, 10000);
  assert.equal(
    oversized.reduce((total, message) => total + message.content.length, 0),
    12000,
  );

  assert.throws(
    () =>
      normalizeAskHistory([
        { role: "user", content: "one" },
        { role: "user", content: "two" },
      ]),
    /alternate/i,
  );
  assert.throws(
    () => normalizeAskHistory([{ role: "assistant", content: "orphan" }]),
    /alternate/i,
  );
  assert.throws(
    () => normalizeAskHistory([{ role: "user", content: "unfinished" }]),
    /complete.*round/i,
  );
});

test("normalizeAskSuggestions accepts exactly three unique bounded model questions", () => {
  const { normalizeAskSuggestions } = loadAskHelpers();

  assert.deepEqual(
    Array.from(
      normalizeAskSuggestions({
        questions: ["  Why now?  ", "What changed?", "What should I try?"],
      }),
    ),
    ["Why now?", "What changed?", "What should I try?"],
  );
  assert.throws(
    () => normalizeAskSuggestions({ questions: ["Same?", " same? ", "Third?"] }),
    /three unique/i,
  );
  assert.throws(
    () => normalizeAskSuggestions({ questions: ["One?", "Two?"] }),
    /three unique/i,
  );
  assert.throws(
    () =>
      normalizeAskSuggestions({
        questions: ["One?", "Two?", "x".repeat(201)],
      }),
    /three unique/i,
  );
});

test("normalizeTavilyResults discards unsafe URLs and bounds untrusted fields", () => {
  const { normalizeTavilyResults } = loadAskHelpers();
  const payload = {
    results: [
      { title: "JavaScript", url: "javascript:alert(1)", content: "bad", score: 1 },
      { title: "Data", url: "data:text/html,bad", content: "bad", score: 1 },
      { title: "Credential", url: "https://user:pass@example.com/", content: "bad", score: 1 },
      { title: "Token", url: "https://example.com/?access_token=secret", content: "bad", score: 1 },
      { title: "Malformed", url: "not a url", content: "bad", score: 1 },
      { title: "Infinite", url: "https://example.com/infinite", content: "bad", score: Infinity },
      ...Array.from({ length: 7 }, (_, index) => ({
        title: `  Result ${index} ${"t".repeat(400)}  `,
        url: `https://example.com/${index}`,
        content: `  ${"c".repeat(3000)}  `,
        score: 1 - index / 10,
      })),
    ],
  };

  const normalized = normalizeTavilyResults(payload);
  assert.equal(normalized.length, 5);
  assert.ok(normalized.every((result) => result.url.startsWith("https://")));
  assert.ok(normalized.every((result) => result.title.length <= 300));
  assert.ok(normalized.every((result) => result.content.length <= 2000));
  assert.ok(normalized.every((result) => Number.isFinite(result.score)));
  assert.deepEqual(
    Array.from(normalized, (result) => result.url),
    Array.from({ length: 5 }, (_, index) => `https://example.com/${index}`),
  );
});

test("buildAskTranscriptContext keeps full transcripts through 120,000 characters", () => {
  const { buildAskTranscriptContext } = loadAskHelpers();
  const transcriptText = `[0:00] ${"a".repeat(119980)}`;
  const result = buildAskTranscriptContext({
    transcriptText,
    question: "What happened?",
    overview: { summary: "Summary" },
  });

  assert.equal(result.reduced, false);
  assert.equal(result.text, transcriptText);
  assert.ok(result.text.length <= 120000);
});

test("buildAskTranscriptContext reduces long transcripts with overview, relevance, and timeline coverage", () => {
  const { buildAskTranscriptContext } = loadAskHelpers();
  const lines = Array.from({ length: 220 }, (_, index) => {
    const marker =
      index === 0
        ? "BEGINNING_SENTINEL"
        : index === 110
          ? "MIDDLE_SENTINEL"
          : index === 219
            ? "ENDING_SENTINEL"
            : index === 73
              ? "QUASAR_RELEVANT_SENTINEL"
              : "ordinary";
    return `[${index}:00] ${marker} ${"x".repeat(650)}`;
  });
  const result = buildAskTranscriptContext({
    transcriptText: lines.join("\n"),
    question: "What does the quasar example prove?",
    overview: {
      summary: "OVERVIEW_SENTINEL",
      chapters: [{ title: "Space evidence", summary: "A chapter summary" }],
    },
  });

  assert.equal(result.reduced, true);
  assert.ok(result.text.length <= 120000);
  assert.match(result.text, /OVERVIEW_SENTINEL/);
  assert.match(result.text, /QUASAR_RELEVANT_SENTINEL/);
  assert.match(result.text, /BEGINNING_SENTINEL/);
  assert.match(result.text, /MIDDLE_SENTINEL/);
  assert.match(result.text, /ENDING_SENTINEL/);
});

test("buildTavilyQuery creates a non-empty search query below 400 characters", () => {
  const { buildTavilyQuery } = loadAskHelpers();
  const query = buildTavilyQuery({
    videoTitle: "A very detailed video ".repeat(30),
    question: "Recommend authoritative related material ".repeat(30),
    overview: { summary: "Themes and supporting evidence ".repeat(30) },
  });

  assert.ok(query.length > 0);
  assert.ok(query.length < 400);
});

test("askVideo with Web off never calls Tavily", async () => {
  const requests = [];
  const helpers = loadAskHelpers({
    settings: {
      aiApiKey: "test-ai-key",
      aiModel: "deepseek-v4-flash",
      tavilyApiKey: "test-tavily-key",
    },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).startsWith("chrome-extension://")) {
        return { ok: true, text: async () => read("prompts/ask.md") };
      }
      if (String(url).includes("api.deepseek.com")) {
        return jsonResponse({
          choices: [{ message: { content: "Video-grounded answer [0:00]." } }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const result = await helpers.handleAskVideo({
    question: "Summarize the claim",
    history: [],
    transcriptText: "[0:00] The claim is grounded in evidence.",
    videoTitle: "Evidence",
    webEnabled: false,
  });

  assert.equal(result.success, true);
  assert.equal(result.answer, "Video-grounded answer [0:00].");
  assert.deepEqual(Array.from(result.sources), []);
  assert.equal(result.webWarning, "");
  assert.equal(
    requests.some((request) => request.url === "https://api.tavily.com/search"),
    false,
  );
});

test("askVideo Web search uses Tavily basic request and returns only validated sources", async () => {
  const requests = [];
  const helpers = loadAskHelpers({
    settings: {
      aiApiKey: "test-ai-key",
      aiModel: "deepseek-v4-flash",
      tavilyApiKey: "test-tavily-key",
    },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).startsWith("chrome-extension://")) {
        return { ok: true, text: async () => read("prompts/ask.md") };
      }
      if (String(url) === "https://api.tavily.com/search") {
        return jsonResponse({
          results: [
            {
              title: "Related source",
              url: "https://example.com/related",
              content: "A useful related source.",
              score: 0.9,
            },
            {
              title: "Unsafe source",
              url: "javascript:alert(1)",
              content: "Do not render me.",
              score: 1,
            },
          ],
        });
      }
      if (String(url).includes("api.deepseek.com")) {
        return jsonResponse({
          choices: [{ message: { content: "Combined answer." } }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const result = await helpers.handleAskVideo({
    question: "Recommend related content",
    history: [],
    transcriptText: "[0:00] This video discusses evidence.",
    videoTitle: "Evidence",
    overview: { summary: "Evidence and reasoning" },
    webEnabled: true,
  });

  const tavilyRequest = requests.find(
    (request) => request.url === "https://api.tavily.com/search",
  );
  assert.ok(tavilyRequest);
  assert.equal(tavilyRequest.options.method, "POST");
  assert.equal(
    tavilyRequest.options.headers.Authorization,
    "Bearer test-tavily-key",
  );
  const body = JSON.parse(tavilyRequest.options.body);
  assert.equal(body.search_depth, "basic");
  assert.equal(body.max_results, 5);
  assert.equal(body.include_answer, false);
  assert.equal(body.include_raw_content, false);
  assert.ok(body.query.length < 400);
  assert.equal(result.success, true);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, "https://example.com/related");
  assert.equal(result.webWarning, "");
});

test("askVideo degrades to video-only answers when Tavily is missing or fails", async () => {
  for (const scenario of ["missing", "failing"]) {
    let tavilyCalls = 0;
    const helpers = loadAskHelpers({
      settings: {
        aiApiKey: "test-ai-key",
        aiModel: "deepseek-v4-flash",
        tavilyApiKey: scenario === "missing" ? "" : "test-tavily-key",
      },
      fetchImpl: async (url) => {
        if (String(url).startsWith("chrome-extension://")) {
          return { ok: true, text: async () => read("prompts/ask.md") };
        }
        if (String(url) === "https://api.tavily.com/search") {
          tavilyCalls += 1;
          return jsonResponse(
            { message: "unavailable" },
            { ok: false, status: 503 },
          );
        }
        if (String(url).includes("api.deepseek.com")) {
          return jsonResponse({
            choices: [{ message: { content: "Video-only fallback." } }],
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    const result = await helpers.handleAskVideo({
      question: "What should I learn next?",
      history: [],
      transcriptText: "[0:00] Learn from the available video evidence.",
      videoTitle: "Learning",
      webEnabled: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.answer, "Video-only fallback.");
    assert.deepEqual(Array.from(result.sources), []);
    assert.match(result.webWarning, /web search.*unavailable|Tavily.*not configured/i);
    assert.equal(tavilyCalls, scenario === "missing" ? 0 : 1);
  }
});

test("askVideo aborts a stalled Tavily request and clears its timeout before degrading", async () => {
  const timers = createFakeTimers();
  let tavilySignal;
  const helpers = loadAskHelpers({
    settings: {
      aiApiKey: "test-ai-key",
      aiModel: "deepseek-v4-flash",
      tavilyApiKey: "test-tavily-key",
    },
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (url, options = {}) => {
      if (String(url).startsWith("chrome-extension://")) {
        return { ok: true, text: async () => read("prompts/ask.md") };
      }
      if (String(url) === "https://api.tavily.com/search") {
        tavilySignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      }
      if (String(url).includes("api.deepseek.com")) {
        return jsonResponse({
          choices: [{ message: { content: "Video-only after timeout." } }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const pending = helpers.handleAskVideo({
    question: "What should I learn next?",
    history: [],
    transcriptText: "[0:00] The video contains enough evidence to answer.",
    videoTitle: "Learning",
    webEnabled: true,
  });
  await nextTurn();

  assert.equal(timers.activeCount(15_000), 1);
  timers.fireActive(15_000);
  const result = await pending;

  assert.equal(tavilySignal.aborted, true);
  assert.equal(result.success, true);
  assert.equal(result.answer, "Video-only after timeout.");
  assert.deepEqual(Array.from(result.sources), []);
  assert.match(result.webWarning, /web search was unavailable/i);
  assert.equal(timers.activeCount(15_000), 0);
  assert.equal(timers.clearedCount(15_000), 1);
});

test("askVideo rejects an oversized Tavily body while streaming and degrades", async () => {
  const timers = createFakeTimers();
  let readerCancelled = false;
  let jsonCalled = false;
  const oversizedChunk = new Uint8Array(512 * 1024 + 1);
  const helpers = loadAskHelpers({
    settings: {
      aiApiKey: "test-ai-key",
      aiModel: "deepseek-v4-flash",
      tavilyApiKey: "test-tavily-key",
    },
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (url) => {
      if (String(url).startsWith("chrome-extension://")) {
        return { ok: true, text: async () => read("prompts/ask.md") };
      }
      if (String(url) === "https://api.tavily.com/search") {
        let delivered = false;
        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              async read() {
                if (delivered) return { done: true };
                delivered = true;
                return { done: false, value: oversizedChunk };
              },
              async cancel() {
                readerCancelled = true;
              },
            }),
          },
          async json() {
            jsonCalled = true;
            return {
              results: [
                {
                  title: "Should never be accepted",
                  url: "https://example.com/oversized",
                  content: "x".repeat(600_000),
                  score: 1,
                },
              ],
            };
          },
        };
      }
      if (String(url).includes("api.deepseek.com")) {
        return jsonResponse({
          choices: [{ message: { content: "Video-only after oversized response." } }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const result = await helpers.handleAskVideo({
    question: "What should I learn next?",
    history: [],
    transcriptText: "[0:00] The video contains enough evidence to answer.",
    videoTitle: "Learning",
    webEnabled: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.answer, "Video-only after oversized response.");
  assert.deepEqual(Array.from(result.sources), []);
  assert.match(result.webWarning, /web search was unavailable/i);
  assert.equal(readerCancelled, true);
  assert.equal(jsonCalled, false);
  assert.equal(timers.activeCount(15_000), 0);
  assert.equal(timers.clearedCount(15_000), 1);
});

test("suggestVideoQuestions validates structured model output without live calls", async () => {
  const aiBodies = [];
  const helpers = loadAskHelpers({
    fetchImpl: async (url, options = {}) => {
      if (String(url).startsWith("chrome-extension://")) {
        return { ok: true, text: async () => read("prompts/ask.md") };
      }
      if (String(url).includes("api.deepseek.com")) {
        aiBodies.push(JSON.parse(options.body));
        return jsonResponse({
          choices: [
            {
              message: {
                content:
                  '{"questions":["Why does it matter?","What evidence is strongest?","What should I try next?"]}',
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const result = await helpers.handleSuggestVideoQuestions({
    videoId: "dQw4w9WgXcQ",
    videoTitle: "Evidence",
    transcriptText: "[0:00] Evidence should be tested.",
    overview: { summary: "Testing evidence" },
  });

  assert.equal(result.success, true);
  assert.equal(result.suggestions.length, 3);
  assert.deepEqual(aiBodies[0].response_format, { type: "json_object" });
  assert.deepEqual(aiBodies[0].thinking, { type: "disabled" });
});

test("Ask is the accessible fourth top tab with fixed and generated questions", () => {
  const html = read("sidepanel.html");
  const tabs = Array.from(
    html.matchAll(/<button class="tab(?: active)?" data-tab="([^"]+)">([^<]+)<\/button>/g),
    (match) => [match[1], match[2].trim()],
  );

  assert.deepEqual(tabs, [
    ["transcript", "Transcript"],
    ["overview", "Overview"],
      ["library", "Library"],
    ["ask", "Ask"],
  ]);
  assert.match(html, /class="tab-panel ask-panel" data-panel="ask"/);
  assert.match(html, /data-ask-question="总结视频"/);
  assert.match(html, /data-ask-question="推荐相关内容"[^>]*data-enable-web="true"/);
  assert.match(html, /data-ask-question="考考我"/);
  assert.match(
    html,
    /id="askGeneratedSuggestions"[^>]*aria-label="Suggested questions"[^>]*aria-live="polite"/,
  );
  assert.match(
    html,
    /id="askMessages"[^>]*aria-label="Conversation"/,
  );
  const messagesMarkup = html.match(/<div[^>]*id="askMessages"[^>]*>/)?.[0] || "";
  assert.doesNotMatch(messagesMarkup, /aria-live|role="log"/);
  assert.match(
    html,
    /id="askStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/,
  );
  assert.match(html, /<textarea[^>]*id="askInput"[^>]*maxlength="2000"/);
  assert.match(html, /<input[^>]*id="askWebToggle"[^>]*type="checkbox"/);
  assert.doesNotMatch(
    html.match(/<input[^>]*id="askWebToggle"[^>]*>/)?.[0] || "",
    /\schecked(?:\s|=|>)/,
  );
  assert.match(html, /<button[^>]*id="askSendBtn"[^>]*aria-label="Send question"/);
});

test("Ask state resets session messages and invalidates work on video changes", () => {
  const { createAskState, resetAskStateForVideo } = loadAskUiHelpers();
  const state = createAskState();

  assert.deepEqual(
    Object.keys(state).filter((key) =>
      ["messages", "suggestions", "loading", "webEnabled", "generation", "videoId"].includes(key),
    ),
    ["messages", "suggestions", "loading", "webEnabled", "generation", "videoId"],
  );
  state.messages.push({ role: "user", content: "old question", status: "complete" });
  state.webEnabled = true;
  const previousGeneration = state.generation;

  resetAskStateForVideo(state, "video-one", ["One?", "Two?", "Three?"]);
  assert.equal(state.videoId, "video-one");
  assert.equal(state.generation, previousGeneration + 1);
  assert.deepEqual(Array.from(state.messages), []);
  assert.deepEqual(Array.from(state.suggestions), ["One?", "Two?", "Three?"]);
  assert.equal(state.webEnabled, false);

  state.messages.push({ role: "user", content: "keep me", status: "complete" });
  resetAskStateForVideo(state, "video-one", []);
  assert.equal(state.messages.length, 1, "same-video refresh must retain the session");

  resetAskStateForVideo(state, "video-two", []);
  assert.equal(state.videoId, "video-two");
  assert.equal(state.generation, previousGeneration + 2);
  assert.deepEqual(Array.from(state.messages), []);
});

test("Ask suggestions load once and are the only Ask data saved in digest cache", () => {
  const js = read("sidepanel.js");
  const { createAskState, shouldLoadAskSuggestions } = loadAskUiHelpers();
  const state = createAskState("video-one");

  assert.equal(shouldLoadAskSuggestions(state), true);
  state.suggestionsLoading = true;
  assert.equal(shouldLoadAskSuggestions(state), false);
  state.suggestionsLoading = false;
  state.suggestionsRequested = true;
  assert.equal(shouldLoadAskSuggestions(state), false);

  assert.match(
    js,
    /function switchTab\(tabName\)[\s\S]*?tabName === "ask"[\s\S]*?ensureAskSuggestions\(\)/,
  );
  const cacheBlock = js.match(/const cacheData = \{[\s\S]*?\n\s*\};/)?.[0] || "";
  assert.match(cacheBlock, /askSuggestions:/);
  assert.doesNotMatch(cacheBlock, /messages|askState\.messages/);
  assert.match(js, /cached\.askSuggestions/);
});

test("Ask request state blocks invalid or duplicate sends and retries without duplicating the question", () => {
  const {
    createAskState,
    resetAskStateForVideo,
    beginAskRequest,
    applyAskRequestResult,
  } = loadAskUiHelpers();
  const state = createAskState();
  resetAskStateForVideo(state, "video-one", []);

  assert.throws(() => beginAskRequest(state, "   "), /question/i);
  assert.throws(() => beginAskRequest(state, "x".repeat(2001)), /2,000/);
  assert.equal(beginAskRequest(state, "x".repeat(2000)).question.length, 2000);
  assert.equal(beginAskRequest(state, "blocked while loading"), null);

  const firstSnapshot = {
    videoId: state.videoId,
    generation: state.generation,
  };
  applyAskRequestResult(
    state,
    firstSnapshot,
    { success: false, message: "Provider unavailable" },
    "x".repeat(2000),
  );
  assert.equal(state.loading, false);
  assert.equal(state.messages.filter((message) => message.role === "user").length, 1);
  const errorMessage = state.messages.find((message) => message.status === "error");
  assert.equal(errorMessage.retryQuestion, "x".repeat(2000));

  const retry = beginAskRequest(state, errorMessage.retryQuestion, {
    retryMessageId: errorMessage.id,
  });
  assert.ok(retry);
  assert.equal(state.messages.filter((message) => message.role === "user").length, 1);
  applyAskRequestResult(
    state,
    retry.snapshot,
    { success: true, answer: "Recovered", sources: [] },
    retry.question,
  );
  assert.equal(state.loading, false);
  assert.equal(state.messages.at(-1).content, "Recovered");
});

test("Ask payload sends completed history, transcript metadata, overview, and strict Web state", () => {
  const { buildAskRequestPayload } = loadAskUiHelpers();
  const messages = [
    { role: "user", content: "First?", status: "complete" },
    { role: "assistant", content: "First answer", status: "complete" },
    { role: "user", content: "Failed question", status: "complete" },
    { role: "assistant", status: "error", retryQuestion: "Failed question" },
  ];
  const payload = JSON.parse(
    JSON.stringify(
      buildAskRequestPayload({
        question: "Next question?",
        messages,
        webEnabled: false,
        videoId: "video-one",
        transcriptText: "[0:00] Complete transcript",
        videoTitle: "Title",
        channelName: "Channel",
        videoDescription: "Description",
        videoDuration: 123,
        overview: { summary: "Summary", chapters: [] },
      }),
    ),
  );

  assert.deepEqual(payload, {
    action: "askVideo",
    question: "Next question?",
    history: [
      { role: "user", content: "First?" },
      { role: "assistant", content: "First answer" },
    ],
    videoId: "video-one",
    transcriptText: "[0:00] Complete transcript",
    videoTitle: "Title",
    channelName: "Channel",
    videoDescription: "Description",
    videoDuration: 123,
    overview: { summary: "Summary", chapters: [] },
    webEnabled: false,
  });
});

test("Ask chips, keyboard handling, and stale-response checks preserve visible user intent", () => {
  const js = read("sidepanel.js");
  const {
    resolveAskChipAction,
    createAskState,
    resetAskStateForVideo,
    isCurrentAskSnapshot,
  } = loadAskUiHelpers();

  assert.deepEqual(
    JSON.parse(JSON.stringify(resolveAskChipAction("推荐相关内容", false, true))),
    { question: "推荐相关内容", webEnabled: true },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(resolveAskChipAction("总结视频", true, false))),
    { question: "总结视频", webEnabled: true },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(resolveAskChipAction("What changed?", false, false))),
    { question: "What changed?", webEnabled: false },
  );
  assert.match(
    js,
    /event\.key === "Enter"[\s\S]*?!event\.shiftKey[\s\S]*?event\.preventDefault\(\)[\s\S]*?submitAskFromComposer\(\)/,
  );

  const state = createAskState();
  resetAskStateForVideo(state, "video-one", []);
  const snapshot = { videoId: state.videoId, generation: state.generation };
  assert.equal(isCurrentAskSnapshot(state, snapshot), true);
  resetAskStateForVideo(state, "video-two", []);
  assert.equal(isCurrentAskSnapshot(state, snapshot), false);
});

test("Ask rendering treats provider text as text and only links safe external sources", () => {
  const js = read("sidepanel.js");
  const { normalizeAskAssistantResult } = loadAskUiHelpers();
  const result = JSON.parse(
    JSON.stringify(
      normalizeAskAssistantResult({
        success: true,
        answer: '<img src=x onerror="alert(1)">',
        contextReduced: true,
        webWarning: '<script>alert("warning")</script>',
        sources: [
          { title: '<svg onload="alert(1)">', url: "https://example.com/good" },
          { title: "bad", url: "javascript:alert(1)" },
          { title: "also bad", url: "data:text/html,bad" },
        ],
      }),
    ),
  );

  assert.equal(result.answer, '<img src=x onerror="alert(1)">');
  assert.equal(result.contextReduced, true);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, "https://example.com/good");
  assert.match(js, /messageBody\.textContent = message\.content/);
  assert.match(js, /sourceLink\.textContent = source\.title/);
  assert.match(js, /sourceLink\.target = "_blank"/);
  assert.match(js, /sourceLink\.rel = "noopener noreferrer"/);
  assert.match(js, /ask-context-label/);
  assert.match(js, /ask-web-warning/);
});

test("Ask announces only the newest update and preserves focused rerender controls", () => {
  const js = read("sidepanel.js");
  const renderStart = js.indexOf("function renderAskConversation()");
  const renderEnd = js.indexOf("function renderAskUi()", renderStart);
  const renderSource = js.slice(renderStart, renderEnd);

  assert.match(
    js,
    /function announceAskStatus\(state\)[\s\S]*?state\.lastAnnouncementKey[\s\S]*?status\.textContent = announcement\.text/,
  );
  assert.match(
    renderSource,
    /const focusSnapshot = captureAskFocusedControl\(messagesContainer\)/,
  );
  assert.match(renderSource, /messageElement\.dataset\.messageId = message\.id/);
  assert.match(renderSource, /retryButton\.dataset\.askFocusKey/);
  assert.match(renderSource, /sourceLink\.dataset\.askFocusKey/);
  assert.match(
    renderSource,
    /restoreAskFocusedControl\(focusSnapshot\)[\s\S]*?announceAskStatus\(askState\)/,
  );
  assert.match(
    js,
    /function restoreAskFocusedControl\(snapshot\)[\s\S]*?candidate\.focus\(\{ preventScroll: true \}\)[\s\S]*?document\.getElementById\("askInput"\)\?\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.doesNotMatch(renderSource, /messagesContainer\.setAttribute\([^)]*aria-live/);
});
