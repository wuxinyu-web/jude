const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "sidepanel.js"),
  "utf8",
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSearchHelpers({ forbidRegExpConstruction = false } = {}) {
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    RegExp: forbidRegExpConstruction
      ? function ForbiddenDynamicRegExp() {
          throw new Error("dynamic RegExp construction is forbidden");
        }
      : RegExp,
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
      createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
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
      storage: { session: { get: async () => ({}), set: async () => {} } },
    },
    YTD_SETTINGS: {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.__YTD_TRANSCRIPT_TESTING__;
}

test("literal Transcript search is case-insensitive for Latin text", () => {
  const { findLiteralTranscriptMatches } = loadSearchHelpers();

  assert.deepEqual(
    plain(findLiteralTranscriptMatches("Alpha beta ALPHA", "alpha")),
    [
      { start: 0, end: 5 },
      { start: 11, end: 16 },
    ],
  );
});

test("literal Transcript search treats punctuation and metacharacters literally", () => {
  const { findLiteralTranscriptMatches } = loadSearchHelpers();

  assert.deepEqual(
    plain(findLiteralTranscriptMatches("[a+b] and [A+B]", "[a+b]")),
    [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ],
  );
});

test("literal Transcript search finds Chinese text", () => {
  const { findLiteralTranscriptMatches } = loadSearchHelpers();

  assert.deepEqual(
    plain(findLiteralTranscriptMatches("学习中文，中文很有趣", "中文")),
    [
      { start: 2, end: 4 },
      { start: 5, end: 7 },
    ],
  );
});

test("literal Transcript search ignores blank input and trims meaningful queries", () => {
  const { findLiteralTranscriptMatches } = loadSearchHelpers();

  assert.deepEqual(plain(findLiteralTranscriptMatches("alpha beta", "   ")), []);
  assert.deepEqual(
    plain(findLiteralTranscriptMatches("alpha beta", "  beta  ")),
    [{ start: 6, end: 10 }],
  );
});

test("literal Transcript search accepts 200 characters and rejects longer queries", () => {
  const { findLiteralTranscriptMatches } = loadSearchHelpers();
  const acceptedQuery = "a".repeat(200);

  assert.deepEqual(
    plain(findLiteralTranscriptMatches(acceptedQuery, acceptedQuery)),
    [{ start: 0, end: 200 }],
  );
  assert.deepEqual(
    plain(findLiteralTranscriptMatches("a".repeat(201), "a".repeat(201))),
    [],
  );
});

test("literal Transcript search returns non-overlapping matches", () => {
  const { findLiteralTranscriptMatches } = loadSearchHelpers();

  assert.deepEqual(
    plain(findLiteralTranscriptMatches("aaaa", "aa")),
    [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ],
  );
});

test("literal Transcript search bounds source work to one rendered segment", () => {
  const { findLiteralTranscriptMatches } = loadSearchHelpers();
  const withinBound = `${"x".repeat(11_994)}needle`;
  const beyondBound = `${"x".repeat(12_000)}needle`;

  assert.deepEqual(
    plain(findLiteralTranscriptMatches(withinBound, "needle")),
    [{ start: 11_994, end: 12_000 }],
  );
  assert.deepEqual(
    plain(findLiteralTranscriptMatches(beyondBound, "needle")),
    [],
  );
});

test("literal Transcript search does not construct a RegExp from the query", () => {
  const { findLiteralTranscriptMatches } = loadSearchHelpers({
    forbidRegExpConstruction: true,
  });

  assert.deepEqual(
    plain(findLiteralTranscriptMatches("Use (a+b)* safely", "(a+b)*")),
    [{ start: 4, end: 10 }],
  );
});

test("clearing Transcript search marks preserves vocabulary and inline markup", () => {
  const { clearTranscriptSearchHighlights } = loadSearchHelpers();
  const vocabularyMark = { className: "vocabulary-highlight", replaced: false };
  const inlineMarkup = { tagName: "EM", textContent: "kept" };
  let queriedSelector = "";
  let normalized = 0;
  const parent = { normalize: () => { normalized += 1; } };
  const searchMarks = ["first", "second"].map((textContent) => ({
    className: "transcript-search-highlight",
    textContent,
    parentNode: parent,
    replaceWith(node) {
      this.replacement = node;
    },
  }));
  const root = {
    children: [vocabularyMark, inlineMarkup, ...searchMarks],
    querySelectorAll(selector) {
      queriedSelector = selector;
      return this.children.filter(
        (child) =>
          child.className === "transcript-search-highlight" &&
          selector === "mark.transcript-search-highlight",
      );
    },
  };

  clearTranscriptSearchHighlights(root);

  assert.equal(queriedSelector, "mark.transcript-search-highlight");
  assert.equal(vocabularyMark.replaced, false);
  assert.equal(inlineMarkup.tagName, "EM");
  assert.deepEqual(
    searchMarks.map((mark) => mark.replacement?.textContent),
    ["first", "second"],
  );
  assert.equal(normalized, 2);
});
