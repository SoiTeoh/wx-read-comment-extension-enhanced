const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');
const filename = path.resolve(__dirname, '../src/pages/Content/nativeOperationBaseline.js');
const helper = new Module(filename, module);
helper._compile(babel.transformFileSync(filename, {
  configFile: false, babelrc: false,
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code, filename);
const { observeNativeOperations } = helper.exports;

test('I0 detects each operation independently without invoking methods or leaking state', () => {
  let calls = 0;
  const component = { $options: { name: 'ReaderFloatReviewsPanel' },
    handleReviewLikeClick() { calls++; }, handleReviewCommentClick() { calls++; },
    token: 'private-token', $data: { user: 'private-account' },
  };
  const before = Object.getOwnPropertyDescriptors(component);
  const result = observeNativeOperations([component]);
  assert.equal(result.operations.find(x => x.id === 'like').observed, true);
  assert.equal(result.operations.find(x => x.id === 'reply').observed, true);
  assert.equal(result.operations.find(x => x.id === 'copy').observed, false);
  assert.equal(result.operations.every(x => !x.callable), true);
  assert.equal(calls, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptors(component), before);
  assert.equal(JSON.stringify(result).includes('private-'), false);
});

test('I0 does not evaluate getters or mistake unrelated/destroyed components for capabilities', () => {
  let reads = 0;
  const native = { $options: { name: 'reader' } };
  for (const key of ['copyText', '$parent', '$children', '$el']) Object.defineProperty(native, key, {
    get() { reads++; throw new Error('getter executed'); },
  });
  const result = observeNativeOperations([native,
    { $options: { name: 'unrelated' }, handleReviewLikeClick() {} },
    { $options: { name: 'ReaderRenderContentPassageCodeEditorDialog' }, copyText() {} },
    { $options: { name: 'reader' }, _isDestroyed: true, copyText() {} },
  ]);
  assert.equal(result.operations.some(x => x.observed), false);
  assert.equal(reads, 0);
});

test('I0 traversal is bounded, cycle-safe and publishes only allowlisted metadata', () => {
  const root = { $options: { name: 'reader' }, showAiChatPanel() {} };
  root.$parent = root;
  root.$children = Array.from({ length: 1000 }, () => ({ $options: { name: 'reader' }, copyText() {} }));
  const result = observeNativeOperations([root]);
  assert.equal(result.visitedComponents, 500);
  assert.equal(result.truncated, true);
  assert.equal(result.operations.find(x => x.id === 'askAI').observed, true);
  assert.equal(result.operations.find(x => x.id === 'copy').evidence.length, 1);
  assert.deepEqual(Object.keys(result.operations[0]).sort(), ['callable', 'evidence', 'id', 'label', 'observed', 'reason', 'target']);
});

test('I0 supports inherited Vue option names and kebab-case component tags', () => {
  const result = observeNativeOperations([
    { $options: Object.create({ name: 'ReaderFloatReviewsPanel' }), handleReviewLikeClick() {} },
    { $options: { _componentTag: 'reader-float-review-detail-panel' }, openCommentInput() {} },
  ]);
  assert.equal(result.operations.find(x => x.id === 'like').observed, true);
  assert.equal(result.operations.find(x => x.id === 'reply').observed, true);
});
