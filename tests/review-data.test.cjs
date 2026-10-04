const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/pages/Content/utils/index.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const utilityModule = new Module(sourcePath, module);
utilityModule.filename = sourcePath;
utilityModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
utilityModule.require = (name) => name === '../debug'
  ? { debugLog() {} }
  : require(name);
utilityModule._compile(compiled, sourcePath);

const {
  filterReviewsByChapterUid,
  getAllCommentData,
  getCommentData,
} = utilityModule.exports;

const item = (reviewId, chapterUid) => ({
  reviewId,
  review: { reviewId, chapterUid, range: '10-20', abstract: reviewId },
});

test('章节筛选保留完整接口条目，只选真实 chapterUid', () => {
  const first = item('a', 12);
  const second = item('b', 14);
  const envelope = { ...item('c', 12), chapterUid: 14 };
  const filtered = filterReviewsByChapterUid(
    { reviews: [first, second, envelope] }, '12'
  );
  assert.deepEqual(filtered, [first, envelope]);
  assert.equal(filtered[0].review.abstract, 'a');
});

test('分页携带 syncKey/maxIdx，去重并保留原始分页响应', async (t) => {
  const calls = [];
  const pages = [
    { reviews: [item('a', 12), item('b', 12)], hasMore: 1, synckey: 8, maxIdx: 30 },
    { reviews: [item('b', 12), item('c', 12)], hasMore: 0, synckey: 9, maxIdx: 20 },
  ];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), options });
    return { ok: true, json: async () => pages[calls.length - 1] };
  });

  const result = await getAllCommentData({ bookId: 'book', chapterUid: 12, listType: 8 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('count'), '1000');
  assert.equal(calls[1].url.searchParams.get('syncKey'), '8');
  assert.equal(calls[1].url.searchParams.get('maxIdx'), '30');
  assert.ok(calls.every(({ options }) => options.credentials === 'include' && !options.method));
  assert.deepEqual(result.reviews.map(({ reviewId }) => reviewId), ['a', 'b', 'c']);
  assert.equal(result.pageCount, 2);
  assert.equal(result.pages[0], pages[0]);
  assert.equal(result.paginationStoppedReason, 'hasMore=0');
});

test('满页但 hasMore=0 时扩大 count，不丢失已取评论', async (t) => {
  const firstPage = Array.from({ length: 1000 }, (_, index) => item(`r${index}`, 12));
  const counts = [];
  t.mock.method(global, 'fetch', async (url) => {
    const count = new URL(url).searchParams.get('count');
    counts.push(count);
    return {
      ok: true,
      json: async () => count === '1000'
        ? { reviews: firstPage, hasMore: 0 }
        : { reviews: [...firstPage, item('r1000', 12)], hasMore: 0 },
    };
  });

  const result = await getAllCommentData({ bookId: 'book', chapterUid: 12 });
  assert.deepEqual(counts, ['1000', '2000']);
  assert.equal(result.reviews.length, 1001);
  assert.equal(result.pageCount, 2);
});

test('章节切换后不再请求下一页', async (t) => {
  let fetchCount = 0;
  t.mock.method(global, 'fetch', async () => {
    fetchCount += 1;
    return { ok: true, json: async () => ({ reviews: [item('a', 12)], hasMore: 1, synckey: 2 }) };
  });

  let checkCount = 0;
  const result = await getAllCommentData({ bookId: 'book', chapterUid: 12 }, () => ++checkCount === 1);
  assert.equal(fetchCount, 1);
  assert.equal(result.pageCount, 1);
  assert.equal(result.paginationStoppedReason, 'chapter-changed');
});

test('无新增评论时停止，避免继续请求', async (t) => {
  let fetchCount = 0;
  t.mock.method(global, 'fetch', async () => {
    fetchCount += 1;
    return { ok: true, json: async () => ({ reviews: [item('a', 12)], hasMore: 1, synckey: 2 }) };
  });

  const result = await getAllCommentData({ bookId: 'book', chapterUid: 12 });
  assert.equal(fetchCount, 2);
  assert.equal(result.reviews.length, 1);
  assert.equal(result.paginationStoppedReason, 'no-new-reviews');
});

test('重复游标时停止，保留此前已加载的评论', async (t) => {
  let fetchCount = 0;
  t.mock.method(global, 'fetch', async () => {
    fetchCount += 1;
    return {
      ok: true,
      json: async () => ({ reviews: [item(`r${fetchCount}`, 12)], hasMore: 1, synckey: 2 }),
    };
  });

  const result = await getAllCommentData({ bookId: 'book', chapterUid: 12 });
  assert.equal(fetchCount, 2);
  assert.deepEqual(result.reviews.map(({ reviewId }) => reviewId), ['r1', 'r2']);
  assert.equal(result.paginationStoppedReason, 'missing-or-repeated-cursor');
});

test('评论列表 HTTP 错误直接报告，不继续分页', async (t) => {
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(getCommentData({ bookId: 'book' }), /HTTP 503/);
});
