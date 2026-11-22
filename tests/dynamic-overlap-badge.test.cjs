const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const compile = (name) =>
  babel.transformFileSync(path.resolve(__dirname, '../src/pages/Content', name), {
    configFile: false,
    babelrc: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;

const compatibility = (() => {
  const Module = require('node:module');
  const file = path.resolve(__dirname, '../src/pages/Content/readerCompatibility.js');
  const mod = new Module(file, module);
  mod._compile(compile('readerCompatibility.js'), file);
  return mod.exports;
})();

const layout = (() => {
  const Module = require('node:module');
  const file = path.resolve(__dirname, '../src/pages/Content/popupBadgeLayout.js');
  const mod = new Module(file, module);
  mod._compile(compile('popupBadgeLayout.js'), file);
  return mod.exports;
})();

const browsing = (() => {
  const Module = require('node:module');
  const file = path.resolve(__dirname, '../src/pages/Content/commentBrowsing.js');
  const mod = new Module(file, module);
  mod._compile(compile('commentBrowsing.js'), file);
  return mod.exports;
})();

const navigation = (() => {
  const Module = require('node:module');
  const file = path.resolve(__dirname, '../src/pages/Content/readingNavigation.js');
  const mod = new Module(file, module);
  mod._compile(compile('readingNavigation.js'), file);
  return mod.exports;
})();

const createMockElement = (tagName = 'div') => {
  const classes = new Set();
  const children = [];
  const attrs = new Map();
  let rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    style: {},
    dataset: {},
    children,
    parentNode: null,
    get className() {
      return Array.from(classes).join(' ');
    },
    set className(value) {
      classes.clear();
      String(value || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => classes.add(c));
    },
    classList: {
      add: (...list) => list.forEach((c) => classes.add(c)),
      remove: (...list) => list.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle: (c, force) =>
        force === undefined
          ? classes.has(c)
            ? classes.delete(c)
            : (classes.add(c), true)
          : force
          ? (classes.add(c), true)
          : (classes.delete(c), false),
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k) ?? null,
    removeAttribute: (k) => attrs.delete(k),
    addEventListener() {},
    appendChild(child) {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    remove() {
      if (!el.parentNode) return;
      const idx = el.parentNode.children.indexOf(el);
      if (idx >= 0) el.parentNode.children.splice(idx, 1);
      el.parentNode = null;
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        if (cur.matches(selector)) return cur;
        cur = cur.parentNode;
      }
      return null;
    },
    matches(selector) {
      if (selector === '.wr_underline_wrapper:not(.wxrc_public_review_wrapper)') {
        return classes.has('wr_underline_wrapper') && !classes.has('wxrc_public_review_wrapper');
      }
      if (selector.startsWith('.')) {
        return classes.has(selector.slice(1));
      }
      return false;
    },
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const result = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (child.matches(selector)) result.push(child);
          walk(child);
        }
      };
      walk(el);
      return result;
    },
    setRect(next) {
      rect = {
        ...next,
        right: next.left + next.width,
        bottom: next.top + next.height,
      };
    },
    getBoundingClientRect: () => rect,
  };
  return el;
};

test('动态新增与移除原生划线时，原地重算重合 badge 且不重新请求映射', async () => {
  const root = createMockElement('div');
  const host = createMockElement('div');
  host.className = 'renderTargetContainer';
  host.setRect({ left: 0, top: 0, width: 600, height: 800 });
  const canvas = createMockElement('div');
  canvas.className = 'wr_canvasContainer';
  canvas.setRect({ left: 0, top: 0, width: 600, height: 800 });
  host.appendChild(canvas);
  root.appendChild(host);

  const listeners = new Map();
  const messages = [];
  const timers = new Map();
  let timerSeq = 0;
  let observerCallback = null;

  const windowMock = {
    innerWidth: 1280,
    innerHeight: 800,
    scrollY: 0,
    addEventListener(type, cb) {
      listeners.set(type, cb);
    },
    removeEventListener() {},
    postMessage(msg) {
      messages.push(msg);
    },
    setTimeout(cb) {
      const id = ++timerSeq;
      timers.set(id, cb);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };

  class MockMutationObserver {
    constructor(cb) {
      observerCallback = cb;
    }
    observe() {}
    disconnect() {}
  }

  const documentMock = {
    body: root,
    createElement: (tag) => createMockElement(tag),
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    addEventListener() {},
  };

  const baseDeps = {
    './utils': { getReview: (e) => e.review || e },
    './debug': { debugLog() {} },
    './readerCompatibility': compatibility,
    './popupBadgeLayout': layout,
    './commentBrowsing': browsing,
    './readingNavigation': { ...navigation, installNavigationTracking: () => {} },
    './nativeTextToolbar': {},
    './reviewInteractions': { isReviewDetailOpen: () => false },
    './favorites': { closeFavorites: () => {}, appendFavoriteButton: () => () => {}, openFavorites: () => {} },
  };

  const subModules = {};
  const sharedContext = vm.createContext({
    window: windowMock,
    document: documentMock,
    MutationObserver: MockMutationObserver,
    console: { warn() {} },
    require(name) {
      if (subModules[name]) return subModules[name];
      if (baseDeps[name]) return baseDeps[name];
      throw new Error(name);
    },
  });
  const runInShared = (file) => {
    const exp = {};
    sharedContext.exports = exp;
    vm.runInContext(compile(file), sharedContext);
    return exp;
  };
  subModules['./bridgeClient'] = runInShared('bridgeClient.js');
  subModules['./reviewIndex'] = runInShared('reviewIndex.js');
  subModules['./popupRenderer'] = runInShared('popupRenderer.js');
  const api = runInShared('publicReviewUnderlines.js');

  api.initializePublicReviewUnderlines(() => {});
  const pending = api.renderPublicReviewUnderlines(
    [
      { reviewId: 'r1', chapterUid: 12, range: '10-20', content: '测试想法' },
      { reviewId: 'r2', chapterUid: 12, range: '12-24', content: '同行重叠想法' },
    ],
    '12'
  );

  const reply = (payload) =>
    listeners.get('message')({
      source: windowMock,
      data: { source: 'WXRC_PAGE', requestId: messages.at(-1).requestId, ...payload },
    });

  reply({ type: 'CAPABILITIES_RESULT', capabilities: { mappingAvailable: true, code: 'READY' } });
  await Promise.resolve();
  const req = messages.at(-1);
  assert.equal(req.type, 'GET_RECTS_BATCH');
  reply({
    type: 'RECTS_RESULT',
    requestId: req.requestId,
    chapterUid: '12',
    clientLayoutEpoch: req.clientLayoutEpoch,
    layoutVersion: 1,
    results: [
      { reviewId: '12:10-20', rects: [{ x: 40, y: 100, w: 120, h: 22 }] },
      { reviewId: '12:12-24', rects: [{ x: 55, y: 100, w: 110, h: 22 }] },
    ],
  });
  await pending;

  // Initially no native underline -> 0 badges
  assert.equal(root.querySelectorAll('.wxrc_public_review_badge').length, 0);
  const initialMessageCount = messages.length;

  // User adds a native underline overlapping both public ranges on the same row
  const nativeUnderline = createMockElement('div');
  nativeUnderline.className = 'wr_underline_wrapper';
  nativeUnderline.setRect({ left: 45, top: 102, width: 100, height: 18 });
  canvas.appendChild(nativeUnderline);

  observerCallback([{ type: 'childList', addedNodes: [nativeUnderline], removedNodes: [] }]);
  for (const cb of [...timers.values()]) cb();
  timers.clear();

  // Merged into 1 right-gutter badge showing total deduplicated count '2'
  const badges = root.querySelectorAll('.wxrc_public_review_badge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, '2');
  assert.ok(parseFloat(badges[0].style.left) >= 610);
  // Must NOT trigger any new bridge requests
  assert.equal(messages.length, initialMessageCount);

  // User removes the native underline -> badge disappears
  nativeUnderline.remove();
  observerCallback([{ type: 'childList', addedNodes: [], removedNodes: [nativeUnderline] }]);
  for (const cb of [...timers.values()]) cb();
  timers.clear();

  assert.equal(root.querySelectorAll('.wxrc_public_review_badge').length, 0);
  assert.equal(messages.length, initialMessageCount);
});
