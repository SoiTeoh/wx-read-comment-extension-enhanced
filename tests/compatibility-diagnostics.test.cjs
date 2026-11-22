const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const babel = require('@babel/core');

const sourcePath = path.resolve(
  __dirname,
  '../src/pages/Content/compatibilityDiagnostics.js'
);
const compiled = babel.transformFileSync(sourcePath, {
  configFile: false,
  babelrc: false,
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;
const mod = new Module(sourcePath, module);
mod.filename = sourcePath;
mod.paths = Module._nodeModulePaths(path.dirname(sourcePath));
mod._compile(compiled, sourcePath);
const { buildDiagnosticReport, formatDiagnosticReport } = mod.exports;

test('U5 诊断报告包含能力矩阵且不包含账号或书籍正文等敏感信息', () => {
  const report = buildDiagnosticReport({
    compatibility: {
      mappingAvailable: false,
      code: 'READER_METHODS_MISSING',
      missingMethods: ['getRectsByContentObjs'],
    },
    reviewSync: {
      layoutVersion: 3,
      totalReviewCount: 42,
      mappedReviewIds: new Set(['r1', 'r2']),
      rangeReviewCounts: new Map([['12:0-5', 2]]),
      bookId: 'SECRET_BOOK_ID',
      chapterName: '第一章 私密标题',
    },
    interactionCapabilities: {
      like: true,
      reply: false,
      reason: 'NATIVE_ENTRY_UNAVAILABLE',
    },
    extensionVersion: '1.6.0',
    userAgent: 'Mozilla/5.0 Test',
    timestamp: '2026-11-22T10:00:00.000Z',
  });

  assert.equal(report.extensionVersion, '1.6.0');
  assert.equal(report.mapping.available, false);
  assert.equal(report.mapping.code, 'READER_METHODS_MISSING');
  assert.deepEqual(report.mapping.missingMethods, ['getRectsByContentObjs']);
  assert.equal(report.stats.reviewCount, 42);
  assert.equal(report.stats.mappedReviewCount, 2);
  assert.equal(report.stats.mappedRangeCount, 1);
  assert.equal(report.interactions.likeAvailable, true);
  assert.equal(report.interactions.replyAvailable, false);

  const formatted = formatDiagnosticReport(report);
  assert.ok(formatted.includes('READER_METHODS_MISSING'));
  assert.ok(formatted.includes('getRectsByContentObjs'));
  assert.ok(!formatted.includes('SECRET_BOOK_ID'));
  assert.ok(!formatted.includes('第一章 私密标题'));
});
