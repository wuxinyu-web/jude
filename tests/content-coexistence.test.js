const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');

// Shared DOM, separate JavaScript worlds: the same boundary Chrome gives
// separately installed extensions. Deliver mutation callbacks as microtasks,
// before timers, so a remove/reinsert loop cannot be hidden by fake timers.
function harness() {
  const observers = new Set(), pending = new Set(), timers = new Map();
  const elements = [], events = new Map();
  let timerId = 0, mutations = 0;
  function changed() { mutations++; for (const o of observers) pending.add(o); }
  function element(id = '') {
    const e = {
      id, style: {}, children: [], parentElement: null, isConnected: false,
      listeners: [], innerHTML: '',
      setAttribute(name, value) { this[name] = value; },
      addEventListener(...args) { this.listeners.push(args); },
      getBoundingClientRect() { return { width: 600, height: 40 }; },
      closest() { return null; },
      querySelectorAll(selector) { return this.children.filter(c => '#' + c.id === selector); },
      appendChild(child) { return this.insertBefore(child, null); },
      insertBefore(child, before) {
        if (child.parentElement) child.remove();
        const i = this.children.indexOf(before);
        this.children.splice(i < 0 ? this.children.length : i, 0, child);
        child.parentElement = this; child.isConnected = this.isConnected;
        changed(); return child;
      },
      remove() {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter(c => c !== this);
        this.parentElement = null; this.isConnected = false; changed();
      },
      get firstChild() { return this.children[0] || null; },
    };
    elements.push(e); return e;
  }
  const body = element('body'); body.isConnected = true;
  const player = element('movie_player'); body.appendChild(player);
  const row = element('actions-inner'), group = element('top-level-buttons-computed');
  body.appendChild(row); row.appendChild(group);
  const document = {
    readyState: 'loading', body,
    createElement: () => element(),
    getElementById: id => elements.find(e => e.isConnected && e.id === id) || null,
    querySelector: selector => selector.includes('#movie_player') ? player : null,
    querySelectorAll(selector) {
      if (selector === 'ytd-watch-metadata #actions-inner') return [row];
      return elements.filter(e => e.isConnected && '#' + e.id === selector);
    },
    addEventListener(name, callback) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(callback);
    },
  };
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); pending.delete(this); }
  }
  function world(id, script = source) {
    const context = vm.createContext({
      document, console,
      window: { location: { pathname: '/watch' }, addEventListener() {},
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', position: 'relative' }) },
      chrome: { runtime: { id, onMessage: { addListener() {} }, sendMessage: async () => ({ success: true }) } },
      MutationObserver: Observer,
      setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); }, setInterval() { return ++timerId; }, clearInterval() {},
    });
    vm.runInContext(script, context);
    return context;
  }
  function settle() {
    for (let round = 0; round < 50; round++) {
      if (pending.size) {
        const batch = [...pending]; pending.clear();
        for (const o of batch) o.callback([]);
      } else if (timers.size) {
        const batch = [...timers.values()]; timers.clear();
        batch.forEach(callback => callback());
      } else return;
    }
    assert.fail('DOM never settles: competing extension controls starve page loading');
  }
  return { world, settle, document, player, group, events,
    get mutations() { return mutations; } };
}

// The old extension deletes a same-ID node it does not own, then its body
// observer immediately restores its button when the new extension removes it.
const legacy = `
let note;
function injectNoteButton() {
  const existing = document.getElementById('ytd-note-button');
  if (existing === note && existing?.isConnected) return;
  existing?.remove();
  note = document.createElement('button'); note.id = 'ytd-note-button';
  document.querySelector('#movie_player').appendChild(note);
}
injectNoteButton();
new MutationObserver(() => {
  if (!note?.isConnected) injectNoteButton();
}).observe(document.body, {childList:true, subtree:true});
const digest = document.createElement('button'); digest.id='ytd-digest-button';
document.querySelectorAll('ytd-watch-metadata #actions-inner')[0]
  .querySelectorAll('#top-level-buttons-computed')[0].appendChild(digest);
`;

test('YouTube controls coexist with the legacy extension without starving the DOM', () => {
  const h = harness(); h.world('legacy', legacy);
  const legacyNote = h.document.getElementById('ytd-note-button');
  const legacyDigest = h.document.getElementById('ytd-digest-button');
  const jude = h.world('jude');
  jude.injectNoteButton(); jude.injectDigestButton(); jude.setupButtonObserver();
  h.settle();
  assert.ok(legacyNote.isConnected, 'must not remove the old extension’s note control');
  assert.ok(legacyDigest.isConnected, 'must not remove its action button');
  assert.equal(h.player.children.length, 2);
  assert.equal(h.group.children.length, 2);
  const writes = h.mutations;
  for (let i = 0; i < 5; i++) { jude.injectNoteButton(); jude.injectDigestButton(); }
  h.settle(); assert.equal(h.mutations, writes, 'reconciliation must not recreate controls');
  // SPA cleanup must leave the foreign instance’s nodes and handlers alone.
  for (const callback of h.events.get('yt-navigate-finish')) callback();
  h.settle();
  assert.ok(legacyNote.isConnected); assert.ok(legacyDigest.isConnected);
  assert.equal(h.player.children.length, 2); assert.equal(h.group.children.length, 2);
});

test('two separately installed Jude copies own separate controls', () => {
  const h = harness();
  for (const id of ['copya', 'copyb']) {
    const c = h.world(id); c.injectNoteButton(); c.injectDigestButton(); c.setupButtonObserver();
  }
  h.settle();
  assert.equal(h.player.children.length, 2); assert.equal(h.group.children.length, 2);
  assert.equal(new Set(h.player.children.map(e => e.id)).size, 2);
});
