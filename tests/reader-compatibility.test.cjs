const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const babel = require('@babel/core');

const compile = (file) => babel.transformFileSync(path.resolve(__dirname, '../src/pages/Content', file), {
  configFile: false, babelrc: false,
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;
const modulePath = path.resolve(__dirname, '../src/pages/Content/readerCompatibility.js');
const helper = new Module(modulePath, module);
helper._compile(compile('readerCompatibility.js'), modulePath);
const baselineHelper = new Module(modulePath, module);
baselineHelper._compile(compile('nativeOperationBaseline.js'), modulePath);
Object.assign(helper.exports, baselineHelper.exports);
const { detectReaderCapabilities, captureReaderRenderContents } = helper.exports;
const bridgeCode = compile('pageBridge.js');

const createReader = () => ({
  $options: { name: 'reader' }, currentChapterUid: '12', renderContentsVersion: 1,
  handleClickUnderline() { this.showSelectionToolBar(); this.findObjsInOffsetRange([{ getOffset: () => 0 }], 0, 1); },
  findObjsInOffsetRange(contents) { return contents; },
  getRectsByContentObjs() { return [{ x: 1, y: 2, w: 30, h: 10 }]; },
  showSelectionToolBar() { throw new Error('Native toolbar must not open during capture'); },
});

const harness = (reader, { canvas = true, frozenWebpack = false, useModuleCache = false } = {}) => {
  const listeners = new Map();
  const sent = [];
  const timers = [];
  const window = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    postMessage(message) { sent.push(message); },
    setInterval(callback) { timers.push(callback); },
  };
  if (frozenWebpack) Object.defineProperty(window, 'webpackJsonp', { configurable: false, value: [] });
  const scope = vm.createContext({ window, console, exports: {}, require: () => helper.exports,
    document: { querySelector(selector) {
      if (selector === '#app' && reader && !useModuleCache) return { __vue__: reader };
      if (selector === '.wr_canvasContainer' && canvas) return { clientWidth: 600, clientHeight: 800 };
      return null;
    } },
  });
  vm.runInContext(bridgeCode, scope);
  if (useModuleCache) {
    window.webpackJsonp = [];
    window.webpackJsonp.push = (payload) => {
      if (typeof payload[2] === 'function') payload[2](Object.assign(() => {}, {
        c: { ...Object.fromEntries(Array.from({ length: 700 }, (_, index) =>
          [index, { exports: {} }])),
          renamed_webpack_module: { exports: { __ob__: { dep: { subs: [{ vm: reader }] } } } } },
      }));
    };
  }
  const send = (type, extra = {}) => {
    listeners.get('message')({ source: window, data: { source: 'WXRC', type, requestId: 'test', ...extra } });
    return sent.at(-1);
  };
  const map = () => send('GET_RECTS_BATCH', { chapterUid: '12', clientLayoutEpoch: 7,
    reviews: [{ reviewId: 'a', start: 0, end: 5, range: '0-5' }],
  });
  return { window, send, map, sent, tick: () => timers[0]() };
};

test('M4 public context retains identity after initial script removal without exposing user state', () => {
  const reader = createReader();
  const h = harness(reader, { useModuleCache: true });
  h.window.__INITIAL_STATE__ = { user: { token: 'not-public' }, reader: { bookId: '638162' } };
  const result = h.send('GET_READER_CONTEXT');
  assert.equal(JSON.stringify(result.context), JSON.stringify({ bookId: '638162', chapterUid: '12' }));
  assert.equal(JSON.stringify(result).includes('not-public'), false);
  assert.equal(h.send('GET_CAPABILITIES').capabilities.code, 'READY');
});

test('I0 bridge returns an independent read-only baseline without mapping or native writes', () => {
  const reader = createReader();
  reader.showAiChatPanel = () => { throw new Error('must not call native operation'); };
  const h = harness(reader);
  const response = h.send('GET_NATIVE_OPERATION_BASELINE');
  assert.equal(response.type, 'NATIVE_OPERATION_BASELINE_RESULT');
  assert.equal(response.baseline.operations.find(x => x.id === 'askAI').observed, true);
  assert.equal(response.baseline.operations.every(x => !x.callable), true);
  assert.equal(h.sent.some(x => x.type === 'RECTS_RESULT'), false);
});

test('M4 能力检测只读，识别缺方法、画布缺失、不可替换方法与恢复', () => {
  const reader = createReader();
  const before = Object.getOwnPropertyDescriptors(reader);
  assert.equal(detectReaderCapabilities(reader, {}).code, 'READY');
  assert.deepEqual(Object.getOwnPropertyDescriptors(reader), before);
  assert.equal(detectReaderCapabilities(null, {}).code, 'READER_UNAVAILABLE');
  assert.equal(detectReaderCapabilities(reader, null).code, 'CANVAS_UNAVAILABLE');
  const rectMethod = reader.getRectsByContentObjs;
  delete reader.getRectsByContentObjs;
  assert.deepEqual(detectReaderCapabilities(reader, {}).missingMethods, ['getRectsByContentObjs']);
  reader.getRectsByContentObjs = rectMethod;
  assert.equal(detectReaderCapabilities(Object.freeze(reader), {}).code, 'READER_HOOK_UNAVAILABLE');
});

test('M4 capture 成功或原生方法抛错后，精确恢复 own descriptors 与继承关系', () => {
  for (const fail of [false, true]) {
    const prototype = createReader();
    if (fail) prototype.handleClickUnderline = () => { throw new Error('capture failed'); };
    const reader = Object.create(prototype);
    const before = Object.getOwnPropertyDescriptors(reader);
    if (fail) assert.throws(() => captureReaderRenderContents(reader, 0, 5), /capture failed/);
    else assert.equal(captureReaderRenderContents(reader, 0, 5).length, 1);
    assert.deepEqual(Object.getOwnPropertyDescriptors(reader), before);
    assert.equal(reader.findObjsInOffsetRange, prototype.findObjsInOffsetRange);
    assert.equal(reader.showSelectionToolBar, prototype.showSelectionToolBar);
  }
});

test('M4 第二个 hook 不可替换时回滚第一个 hook，原生点击不执行', () => {
  const reader = createReader();
  Object.defineProperty(reader, 'showSelectionToolBar', { configurable: false, writable: false });
  const before = Object.getOwnPropertyDescriptors(reader);
  assert.throws(() => captureReaderRenderContents(reader, 0, 5));
  assert.deepEqual(Object.getOwnPropertyDescriptors(reader), before);
});

test('M4 bridge 兼容路径保留 range→rect，并复用 capture 缓存', () => {
  const h = harness(createReader());
  assert.equal(h.send('GET_CAPABILITIES').capabilities.code, 'READY');
  const first = h.map();
  assert.equal(first.results[0].rects.length, 1);
  assert.equal(first.clientLayoutEpoch, 7);
  const second = h.map();
  assert.equal(second.layoutVersion, first.layoutVersion);
});

test('M4 Reader 缺方法时返回明确失败码，不调用原生映射', () => {
  const reader = createReader();
  delete reader.getRectsByContentObjs;
  reader.handleClickUnderline = () => { throw new Error('must not call'); };
  const h = harness(reader);
  assert.equal(h.send('GET_CAPABILITIES').capabilities.code, 'READER_METHODS_MISSING');
  assert.equal(h.map().errorCode, 'READER_METHODS_MISSING');
});

test('M4 原生方法返回格式变化或捕获失败时安全降级并恢复 hook', () => {
  for (const shape of ['objects', 'rects', 'capture']) {
    const reader = createReader();
    if (shape === 'objects') reader.findObjsInOffsetRange = () => null;
    if (shape === 'rects') reader.getRectsByContentObjs = () => ({ x: 1 });
    if (shape === 'capture') reader.handleClickUnderline = () => {};
    const before = Object.getOwnPropertyDescriptors(reader);
    const result = harness(reader).map();
    assert.equal(result.errorCode, shape === 'capture' ? 'RENDER_CONTENTS_UNAVAILABLE' : 'READER_RESULT_INVALID');
    assert.equal(result.results.length, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptors(reader), before);
  }
});

test('M4 即使缓存存在，切章不匹配也不会映射旧章节', () => {
  const reader = createReader();
  const h = harness(reader);
  assert.equal(h.map().results.length, 1);
  reader.currentChapterUid = '13';
  assert.equal(h.map().errorCode, 'CHAPTER_MISMATCH');
});

test('M4 webpack 模块编号改变、冻结 webpack 全局不影响能力检测', () => {
  assert.equal(harness(createReader(), { useModuleCache: true }).send('GET_CAPABILITIES').capabilities.code, 'READY');
  assert.equal(harness(createReader(), { frozenWebpack: true }).send('GET_CAPABILITIES').capabilities.code, 'READY');
});

test('M4 周期检测丢失及恢复能力，只通知布局失效，不执行 range 映射', () => {
  const reader = createReader();
  const h = harness(reader);
  h.tick();
  const rects = reader.getRectsByContentObjs;
  delete reader.getRectsByContentObjs;
  h.tick();
  reader.getRectsByContentObjs = rects;
  h.tick();
  assert.equal(h.sent.filter((message) => message.type === 'LAYOUT_INVALIDATED').length, 2);
  assert.equal(h.sent.filter((message) => message.type === 'RECTS_RESULT').length, 0);
});

test('M4 webpack 观察保护不改变已有 push 行为或让冻结导出破坏原生 factory', () => {
  const h = harness(createReader());
  // Install a real-ish runtime through the captured setter; its return value must be preserved.
  // The factory exports a frozen Vue prototype, which cannot be instrumented.
  const source = compile('pageBridge.js');
  const Vue = function () {};
  Vue.version = '2';
  Vue.prototype._init = () => {};
  Object.freeze(Vue.prototype);
  let nativePushes = 0;
  const array = [];
  array.push = function (...payloads) { nativePushes++; return Array.prototype.push.apply(this, payloads); };
  const window = { webpackJsonp: array, addEventListener() {}, postMessage() {}, setInterval() {} };
  vm.runInNewContext(source, { window, document: { querySelector: () => null }, exports: {}, require: () => helper.exports });
  const payload = [['chunk'], { factory(module) { module.exports = Vue; return 42; } }];
  assert.equal(array.push(payload), 1);
  assert.equal(nativePushes, 1);
  const output = {};
  assert.equal(payload[1].factory(output, {}, () => {}), 42);
  assert.equal(output.exports, Vue);
  assert.equal(h.send('GET_CAPABILITIES').capabilities.code, 'READY');
});
