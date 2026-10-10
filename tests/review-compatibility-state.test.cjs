const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const compile = (name) => babel.transformFileSync(path.resolve(__dirname, '../src/pages/Content', name), {
  configFile: false, babelrc: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;
const load = (name) => {
  const file = path.resolve(__dirname, '../src/pages/Content', name);
  const mod = new Module(file, module);
  mod._compile(compile(name), file);
  return mod.exports;
};
const compatibility = load('readerCompatibility.js');
const layout = load('popupBadgeLayout.js');
const code = compile('publicReviewUnderlines.js');

const harness = () => {
  const listeners = new Map();
  const messages = [];
  const timers = new Map();
  let sequence = 0;
  const window = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    postMessage(message) { messages.push(message); },
    setTimeout(callback) { timers.set(++sequence, callback); return sequence; },
    clearTimeout(id) { timers.delete(id); },
    cancelAnimationFrame() {}, removeEventListener() {},
  };
  const exports = {};
  vm.runInNewContext(code, { window, exports, console: { warn() {} },
    document: { querySelectorAll: () => [], querySelector: () => null, addEventListener() {} },
    require(name) {
      if (name === './utils') return { getReview: (entry) => entry.review || entry };
      if (name === './debug') return { debugLog() {} };
      if (name === './readerCompatibility') return compatibility;
      if (name === './popupBadgeLayout') return layout;
      if (name === './nativeTextToolbar') return {};
      throw new Error(name);
    },
  });
  exports.initializePublicReviewUnderlines(() => {});
  const reply = (payload) => listeners.get('message')({ source: window,
    data: { source: 'WXRC_PAGE', requestId: messages.at(-1).requestId, ...payload },
  });
  return { api: exports, messages, reply, timeout() { for (const callback of [...timers.values()]) callback(); } };
};
const reviews = [{ reviewId: 'a', chapterUid: 12, range: '0-5', content: '保留全文' }];

test('M4 bridge 超时显示明确兼容性状态，不留下可点击的过期索引', async () => {
  const h = harness();
  const pending = h.api.renderPublicReviewUnderlines(reviews, '12');
  h.timeout();
  const stats = await pending;
  assert.equal(stats.compatibility.code, 'BRIDGE_TIMEOUT');
  assert.equal(h.api.getPublicReviewSyncProps().mappedReviewIds.size, 0);
  assert.equal(reviews[0].content, '保留全文');
});

test('M4 能力探测失败不发 GET_RECTS_BATCH；清章后旧探测不能写回状态', async () => {
  const h = harness();
  let pending = h.api.renderPublicReviewUnderlines(reviews, '12');
  h.reply({ type: 'CAPABILITIES_RESULT', capabilities: { mappingAvailable: false, code: 'CANVAS_UNAVAILABLE' } });
  assert.equal((await pending).compatibility.code, 'CANVAS_UNAVAILABLE');
  assert.equal(h.messages.filter((item) => item.type === 'GET_RECTS_BATCH').length, 0);
  pending = h.api.renderPublicReviewUnderlines(reviews, '12');
  h.api.clearPublicReviewState('13');
  h.reply({ type: 'CAPABILITIES_RESULT', capabilities: { mappingAvailable: false, code: 'READER_METHODS_MISSING' } });
  assert.equal((await pending).staleDiscarded, true);
  assert.equal(h.api.getPublicReviewSyncProps().compatibility, null);
});

test('M4 映射异常保留错误码，过期失败响应不覆盖新章节', async () => {
  for (const stale of [false, true]) {
    const h = harness();
    const pending = h.api.renderPublicReviewUnderlines(reviews, '12');
    h.reply({ type: 'CAPABILITIES_RESULT', capabilities: { mappingAvailable: true, code: 'READY' } });
    await Promise.resolve();
    assert.equal(h.messages.at(-1).type, 'GET_RECTS_BATCH');
    if (stale) h.api.clearPublicReviewState('13');
    h.reply({ type: 'RECTS_RESULT', error: 'invalid native result', errorCode: 'READER_RESULT_INVALID' });
    const stats = await pending;
    if (stale) {
      assert.equal(stats.staleDiscarded, true);
      assert.equal(h.api.getPublicReviewSyncProps().compatibility, null);
    } else assert.equal(stats.compatibility.code, 'READER_RESULT_INVALID');
  }
});

test('M5 过期成功映射的章节、epoch 或版本错误均不能重建定位索引', async () => {
  for (const scenario of ['chapter', 'epoch', 'version', 'invalidated']) {
    const h = harness();
    const pending = h.api.renderPublicReviewUnderlines(reviews, '12');
    h.reply({ type: 'CAPABILITIES_RESULT', capabilities: { mappingAvailable: true, code: 'READY' } });
    await Promise.resolve();
    const request = h.messages.at(-1);
    if (scenario === 'invalidated') h.api.invalidatePublicReviewLayout('test-resize');
    h.reply({ type: 'RECTS_RESULT', requestId: request.requestId, chapterUid: scenario === 'chapter' ? '13' : '12',
      clientLayoutEpoch: scenario === 'epoch' ? request.clientLayoutEpoch + 1 : request.clientLayoutEpoch,
      layoutVersion: scenario === 'version' ? null : 1,
      results: [{ reviewId: '12:0-5', rects: [{ x: 1, y: 2, w: 10, h: 20 }] }],
    });
    assert.equal((await pending).staleDiscarded, true, scenario);
    assert.equal(h.api.getPublicReviewSyncProps().mappedReviewIds.size, 0, scenario);
  }
});
