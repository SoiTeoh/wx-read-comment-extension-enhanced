const assert = require('node:assert/strict'),
  test = require('node:test'),
  path = require('node:path'),
  Module = require('node:module'),
  vm = require('node:vm'),
  babel = require('@babel/core');
const compile = (name) =>
  babel.transformFileSync(
    path.resolve(__dirname, '../src/pages/Content', name),
    {
      configFile: false,
      babelrc: false,
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    }
  ).code;
const modelPath = path.resolve(
    __dirname,
    '../src/pages/Content/favoriteModel.js'
  ),
  modelModule = new Module(modelPath, module);
modelModule._compile(compile('favoriteModel.js'), modelPath);
const model = modelModule.exports;
const entry = {
  review: {
    reviewId: 'one',
    bookId: '123',
    chapterUid: 12,
    content: '公开正文',
    abstract: '接口引用',
    author: { name: '作者' },
  },
};
const setup = () => {
  const state = {
    data: { wxrc_phase6_settings: { keyboardShortcuts: true } },
    sends: 0,
    noResponse: false,
    readFailure: false,
    hold: false,
    release: null,
    book: '123',
    chapter: '12',
    title: '旧书',
  };
  const listeners = [];
  const storage = {
    get: async () => {
      if (state.readFailure) throw Error('read failure');
      if (state.hold) {
        state.hold = false;
        await new Promise((resolve) => (state.release = resolve));
      }
      return state.data;
    },
    set: async (values) => {
      state.data = { ...state.data, ...values };
      listeners.forEach((fn) =>
        fn(
          {
            [model.FAVORITES_KEY]: {
              newValue: state.data[model.FAVORITES_KEY],
            },
          },
          'local'
        )
      );
    },
  };
  const repository = model.createFavoritesRepository(storage),
    exports = {};
  const chrome = {
    storage: {
      local: storage,
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    runtime: {
      sendMessage: async (message) => {
        state.sends++;
        if (state.noResponse) return null;
        return {
          ok: true,
          items: await repository.mutate(message.operation, message.payload),
        };
      },
    },
  };
  const document = {
    title: '旧书 - 微信读书',
    querySelector: (selector) =>
      selector === '.chrex-comment-wrapper'
        ? { dataset: { bookId: state.book, chapterUid: state.chapter } }
        : selector === '.readerTopBar_title_link'
        ? { textContent: state.title }
        : selector === '.readerTopBar_title_chapter'
        ? { textContent: '第12章' }
        : null,
  };
  vm.runInNewContext(compile('favorites.js'), {
    exports,
    chrome,
    document,
    location: { href: 'https://weread.qq.com/web/reader/test?token=secret' },
    require: (name) =>
      name === './favoriteModel' ? model : { isLongComment: () => false },
  });
  return { state, api: exports, parent: { closest: () => null } };
};
test('U3 content-side save/remove shares target state and keeps unrelated settings', async () => {
  const h = setup(),
    key = model.favoriteKey('123', 'one');
  let calls = 0;
  const stop = h.api.subscribeFavorite(key, () => calls++);
  assert.equal(await h.api.saveOrRemoveFavorite(entry, h.parent), true);
  assert.equal(h.api.isFavorite(key), true);
  assert.equal(calls, 1);
  assert.equal(h.state.data.wxrc_phase6_settings.keyboardShortcuts, true);
  assert.equal(await h.api.saveOrRemoveFavorite(entry, h.parent), false);
  assert.equal(h.api.isFavorite(key), false);
  assert.equal(calls, 2);
  stop();
});
test('U3 missing background response prompts reload without changing local favorite state', async () => {
  const h = setup();
  await h.api.saveOrRemoveFavorite(entry, h.parent);
  h.state.noResponse = true;
  await assert.rejects(
    h.api.saveOrRemoveFavorite(entry, h.parent),
    /FAVORITE_RUNTIME_UNAVAILABLE/
  );
  assert.equal(h.state.data[model.FAVORITES_KEY].items.length, 1);
  assert.equal(h.api.isFavorite(model.favoriteKey('123', 'one')), true);
  assert.match(
    h.api.favoriteErrorText(Error('FAVORITE_RUNTIME_UNAVAILABLE')),
    /重新加载扩展/
  );
});
test('U3 selection context is captured before async local storage loading', async () => {
  const h = setup();
  h.state.hold = true;
  const task = h.api.saveOrRemoveFavorite(entry, h.parent);
  h.state.book = '456';
  h.state.chapter = '99';
  h.state.title = '新书';
  h.state.release();
  await task;
  const item = h.state.data[model.FAVORITES_KEY].items[0];
  assert.equal(item.bookId, '123');
  assert.equal(item.chapterUid, '12');
  assert.equal(item.bookTitle, '旧书');
});
test('U3 failed initial storage read never sends a mutation or overwrites settings', async () => {
  const h = setup();
  h.state.readFailure = true;
  await assert.rejects(
    h.api.saveOrRemoveFavorite(entry, h.parent),
    /read failure/
  );
  assert.equal(h.state.sends, 0);
  assert.equal(h.state.data[model.FAVORITES_KEY], undefined);
});
