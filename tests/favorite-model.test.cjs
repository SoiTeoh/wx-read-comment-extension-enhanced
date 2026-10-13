const assert = require('node:assert/strict'),
  test = require('node:test'),
  path = require('node:path'),
  Module = require('node:module'),
  babel = require('@babel/core');
const filename = path.resolve(
    __dirname,
    '../src/pages/Content/favoriteModel.js'
  ),
  helper = new Module(filename, module);
helper._compile(
  babel.transformFileSync(filename, {
    configFile: false,
    babelrc: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code,
  filename
);
const {
  makeFavorite,
  validateFavorites,
  favoritesMarkdown,
  createFavoritesRepository,
  FAVORITES_KEY,
} = helper.exports;
const entry = {
  review: {
    reviewId: 'one',
    bookId: '123',
    chapterUid: 12,
    content: '正文 &lt;文本&gt;<br>第二行',
    abstract: '引用原文',
    author: { name: '作者' },
    cookie: 'should not persist',
  },
};
const context = {
  bookId: '123',
  chapterUid: '12',
  bookTitle: '书名',
  chapterTitle: '章节',
  sourceUrl: 'https://weread.qq.com/web/reader/publicBook?token=secret',
};
test('U3 favorites whitelist fields, preserve plaintext round-trips and distinguish quote sources', () => {
  const saved = makeFavorite(entry, context, 123);
  assert.equal(saved.content, '正文 <文本>\n第二行');
  assert.equal(saved.quoteSource, 'review');
  assert.equal(saved.sourceUrl, 'https://weread.qq.com/web/reader/publicBook');
  assert.equal('cookie' in saved, false);
  assert.equal(
    validateFavorites({ version: 1, items: [saved] })[0].content,
    saved.content
  );
  assert.equal(
    makeFavorite(entry, { ...context, verifiedQuote: '核实 <原文>' }, 123)
      .quote,
    '核实 <原文>'
  );
  assert.equal(
    makeFavorite(entry, { ...context, verifiedQuote: '核实 <原文>' }, 123)
      .quoteSource,
    'verified'
  );
  assert.equal(
    'token' in
      validateFavorites({
        version: 1,
        items: [{ ...saved, token: 'secret' }],
      })[0],
    false
  );
});
test('U3 rejects private, mismatched or oversized records and does not silently truncate', () => {
  for (const change of [
    { isPrivate: 1 },
    { isPrivate: true },
    { isPrivate: '1' },
    { bookId: 'other' },
    { chapterUid: 13 },
  ])
    assert.throws(
      () => makeFavorite({ review: { ...entry.review, ...change } }, context),
      /INVALID/
    );
  assert.throws(
    () =>
      makeFavorite(
        { review: { ...entry.review, content: 'x'.repeat(60001) } },
        context
      ),
    /TOO_LARGE/
  );
  const record = makeFavorite(entry, context, 123);
  assert.throws(
    () => validateFavorites({ version: 1, items: [record, record] }),
    /INVALID/
  );
  assert.throws(() => validateFavorites({ version: 0, items: [] }), /INVALID/);
  assert.throws(
    () =>
      validateFavorites({
        version: 1,
        items: [{ ...record, sourceUrl: 'javascript:alert(1)' }],
      }),
    /INVALID/
  );
});
test('U3 exported Markdown contains full text and escapes HTML and link syntax', () => {
  const record = makeFavorite(
      {
        review: {
          ...entry.review,
          content: '[run](javascript:alert(1)) &lt;img&gt;',
        },
      },
      context,
      123
    ),
    markdown = favoritesMarkdown([record]);
  assert.match(markdown, /\\\[run\\\]/);
  assert.match(markdown, /\\<img\\>/);
  assert.match(markdown, /公开想法附带引用/);
  assert.doesNotMatch(markdown, /token=secret/);
});
test('U3 serialized repository mutations retain concurrent additions and deduplicate a target', async () => {
  let data = {};
  const repo = createFavoritesRepository({
    get: async () => data,
    set: async (value) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      data = value;
    },
  });
  const first = makeFavorite(entry, context, 123),
    second = makeFavorite(
      { review: { ...entry.review, reviewId: 'two' } },
      context,
      124
    );
  await Promise.all([repo.mutate('save', first), repo.mutate('save', second)]);
  assert.equal(data[FAVORITES_KEY].items.length, 2);
  await repo.mutate('save', first);
  assert.equal(data[FAVORITES_KEY].items.length, 2);
  await repo.mutate('remove', first.key);
  assert.equal(data[FAVORITES_KEY].items[0].reviewId, 'two');
  await repo.mutate('clear');
  assert.deepEqual(data[FAVORITES_KEY].items, []);
});
test('U3 storage errors and invalid existing data never overwrite the existing library', async () => {
  let writes = 0;
  const record = makeFavorite(entry, context, 123);
  const repo = createFavoritesRepository({
    get: async () => ({ [FAVORITES_KEY]: { version: 0 } }),
    set: async () => writes++,
  });
  await assert.rejects(repo.mutate('save', record));
  assert.equal(writes, 0);
  let data = { [FAVORITES_KEY]: { version: 1, items: [record] } };
  const failed = createFavoritesRepository({
    get: async () => data,
    set: async () => {
      throw Error('quota');
    },
  });
  await assert.rejects(failed.mutate('clear'), /quota/);
  assert.equal(data[FAVORITES_KEY].items.length, 1);
});
