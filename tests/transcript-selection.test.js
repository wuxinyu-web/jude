const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "sidepanel.js"),
  "utf8",
);
const styles = fs.readFileSync(
  path.resolve(__dirname, "..", "sidepanel.css"),
  "utf8",
);

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
    /if \(!tab\.url\.startsWith\("https:\/\/www\.youtube\.com"\)\) \{\s*handleFrontTabUrl\(tab\.url\);\s*return;\s*\}/,
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

test("the Explain and Save tooltip preserves selection and contains pointer events", () => {
  assert.match(
    source,
    /tooltip\.addEventListener\("mousedown", \(event\) => \{\s+event\.preventDefault\(\);\s+event\.stopPropagation\(\);/,
  );
  assert.match(
    source,
    /tooltip\.addEventListener\("mouseup", \(event\) => \{\s+event\.stopPropagation\(\);/,
  );
  assert.match(
    source,
    /\.addEventListener\("click", async \(event\) => \{\s+event\.preventDefault\(\);\s+event\.stopPropagation\(\);/,
  );
  assert.match(source, /div\.dataset\.segmentId = group\.id/);
  assert.match(source, /div\.dataset\.segmentIndex = index/);
  assert.match(
    source,
    /buildExplainContextFromSelection\([\s\S]*?selectedTranscriptEntry[\s\S]*?getActiveTranscriptSegments\(\)/,
  );
  assert.match(
    source,
    /tooltip\.innerHTML = `[\s\S]*?class="explain-btn"[\s\S]*?class="vocabulary-save-btn"[\s\S]*?Save/,
  );
  assert.match(
    source,
    /buildVocabularySelectionMetadata\([\s\S]*?selectedText[\s\S]*?selectedTranscriptEntry[\s\S]*?getActiveTranscriptSegments\(\)/,
  );
  assert.match(
    source,
    /showExplanation\([\s\S]*?selectedText,[\s\S]*?selectedContext,[\s\S]*?selectedVocabularyMetadata,[\s\S]*?event\.currentTarget/,
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
  assert.match(showExplanationSource, /id="explainModalTitle"[^>]*>Explain</);
  assert.match(
    showExplanationSource,
    /id="closeExplain"[^>]*aria-label="Close explanation"/,
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
    /class="explain-save-vocabulary"[^>]*>Save to Vocabulary<\/button>/,
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
    /className = "[^"]*transcript-row-explain"[\s\S]*?setAttribute\(\s*"aria-label",\s*"Explain this transcript segment"/,
  );
  assert.match(
    source,
    /className = "[^"]*transcript-row-save"[\s\S]*?setAttribute\(\s*"aria-label",\s*"Save this transcript segment to Vocabulary"/,
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

test("repeated Explain setup aborts old document listeners before adding new ones", () => {
  const start = source.indexOf("function setupExplainFeature()");
  const end = source.indexOf("function getSelectionTranscriptEntry", start);
  const setupSource = source.slice(start, end);

  assert.match(source, /let explainSelectionAbortController = null/);
  assert.match(
    setupSource,
    /explainSelectionAbortController\?\.abort\(\)[\s\S]*?explainSelectionAbortController = new AbortController\(\)/,
  );
  assert.equal(
    (setupSource.match(/\{ signal: explainSelectionAbortController\.signal \}/g) || [])
      .length,
    2,
    "mouseup and mousedown document listeners must share the abort signal",
  );
});
