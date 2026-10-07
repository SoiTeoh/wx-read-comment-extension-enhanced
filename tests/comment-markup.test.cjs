const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const babel = require('@babel/core');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const sourcePath = path.resolve(__dirname, '../src/pages/Content/Comment.jsx');
const compiled = babel.transformFileSync(sourcePath, {
  configFile: false,
  babelrc: false,
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-react',
  ],
}).code;
const componentModule = new Module(sourcePath, module);
componentModule.filename = sourcePath;
componentModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
componentModule.require = (name) => name === './utils'
  ? { getReview: (entry) => entry.review || entry, getFormattedDate: () => '' }
  : require(name);
componentModule._compile(compiled, sourcePath);
const Comment = componentModule.exports.default;
const { matchesCommentFilter } = componentModule.exports;

test('M3 筛选匹配正文、引用和作者，清除后完整恢复且不修改源数据', () => {
  const entries = [
    { review: { content: '<b>Hello</b>', abstract: '引用文字', author: { name: '读者甲' } } },
    { content: '另一条' },
  ];
  const before = JSON.stringify(entries);
  for (const query of [' hello ', '引用', '读者甲']) {
    assert.equal(matchesCommentFilter(entries[0], true, query, 'all'), true);
  }
  assert.equal(matchesCommentFilter(entries[0], true, '不存在', 'all'), false);
  assert.equal(matchesCommentFilter(entries[0], true, '', 'unmapped'), false);
  assert.equal(matchesCommentFilter(entries[1], false, '', 'mapped'), false);
  assert.equal(matchesCommentFilter(entries[1], false, '', 'unmapped'), true);
  assert.equal(entries.filter((entry) => matchesCommentFilter(entry, false, '', 'all')).length, 2);
  assert.equal(JSON.stringify(entries), before);
});

test('M3 密度不截断长评论且保留浏览控件', () => {
  const content = '完整长评论'.repeat(100);
  const html = renderToStaticMarkup(React.createElement(Comment, {
    list: [{ content }], settings: { commentDensity: 'compact' }, loadStatus: 'ready',
  }));
  assert.match(html, /data-density="compact"/);
  assert.match(html, /搜索评论、引用或作者/);
  assert.match(html, /显示 1 \/ 1 条/);
  assert.ok(html.includes(content));
});

const reviews = [
  { review: { reviewId: 'mapped', range: '10-20', abstract: '可定位原文', content: '公开想法', author: { name: '读者甲' } } },
  { review: { reviewId: 'unmapped', range: '30-40', abstract: '暂不可定位', content: '另一条想法' } },
];
const reviewSync = {
  mappedReviewIds: new Set(['mapped']),
  reviewRangeKeys: new Map([['mapped', '12:10-20']]),
  rangeReviewCounts: new Map([['12:10-20', 2]]),
  onReviewClick() {},
};

test('侧栏仅为已映射评论提供独立的键盘定位按钮', () => {
  const html = renderToStaticMarkup(React.createElement(Comment, {
    list: reviews,
    width: 400,
    reviewSync,
    settings: { sortOrder: 'reading' },
  }));
  assert.match(html, /class="comment-item wxrc_comment_mapped"/);
  assert.match(html, /class="comment-item wxrc_comment_unmapped"/);
  assert.equal((html.match(/class="wxrc_comment_mapping_status wxrc_jump_to_text"/g) || []).length, 1);
  assert.match(html, /aria-label="定位正文：读者甲"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /项目说明/);
  assert.match(html, /aria-label="关闭右侧评论栏"/);
  assert.doesNotMatch(html, /求 star 支持/);
});

test('空状态区分加载中、空章节和加载失败', () => {
  const render = (loadStatus) => renderToStaticMarkup(React.createElement(Comment, {
    list: [],
    chapterName: '测试章节',
    loadStatus,
    reviewSync,
  }));
  assert.match(render('loading'), /正在加载公开评论/);
  assert.match(render('ready'), /本章暂无公开评论/);
  assert.match(render('error'), /公开评论加载失败/);
  assert.match(render('error'), />重试<\/button>/);
  assert.doesNotMatch(render('loading'), />重试<\/button>/);
});

test('阅读顺序将可定位评论排在不可定位评论之前，接口顺序保持不变', () => {
  const render = (sortOrder) => renderToStaticMarkup(React.createElement(Comment, {
    list: [...reviews].reverse(),
    reviewSync,
    settings: { sortOrder },
  }));
  assert.ok(render('reading').indexOf('data-review-id="mapped"') < render('reading').indexOf('data-review-id="unmapped"'));
  assert.ok(render('api').indexOf('data-review-id="unmapped"') < render('api').indexOf('data-review-id="mapped"'));
});
