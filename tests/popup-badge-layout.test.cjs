const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const babel = require('@babel/core');

const sourcePath = path.resolve(__dirname, '../src/pages/Content/popupBadgeLayout.js');
const compiled = babel.transformFileSync(sourcePath, {
  configFile: false,
  babelrc: false,
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;
const layoutModule = new Module(sourcePath, module);
layoutModule.filename = sourcePath;
layoutModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
layoutModule._compile(compiled, sourcePath);
const { badgeWidthForCount, positionBadge, positionPopup } = layoutModule.exports;

test('popup 在视口四角和窄窗口内保持完整可见', () => {
  const viewport = { width: 320, height: 300 };
  const popup = { width: 296, height: 276 };
  for (const anchor of [{ x: 0, y: 0 }, { x: 319, y: 0 }, { x: 0, y: 299 }, { x: 319, y: 299 }]) {
    const result = positionPopup(anchor, popup, viewport);
    assert.ok(result.left >= 12 && result.left + popup.width <= viewport.width - 12);
    assert.ok(result.top >= 12 && result.top + popup.height <= viewport.height - 12);
  }
});

test('多位数 badge 宽度增加，密集 badge 在章节边缘错位而不重叠', () => {
  assert.ok(badgeWidthForCount(100) > badgeWidthForCount(1));
  const canvas = { width: 300, height: 120 };
  const badge = { width: badgeWidthForCount(12), height: 18 };
  const rect = { x: 270, y: 102, w: 30, h: 18 };
  const placed = [];
  for (let index = 0; index < 4; index += 1) {
    const item = positionBadge(rect, canvas, badge, placed);
    if (index === 0) assert.ok(item.x + item.w < rect.x);
    assert.ok(item.x >= 0 && item.x + item.w <= canvas.width);
    assert.ok(item.y >= 0 && item.y + item.h <= canvas.height);
    assert.ok(placed.every((other) =>
      item.x + item.w <= other.x || other.x + other.w <= item.x ||
      item.y + item.h <= other.y || other.y + other.h <= item.y
    ));
    placed.push(item);
  }
});
