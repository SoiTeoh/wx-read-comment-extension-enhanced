import {
  FAVORITES_KEY,
  favoriteKey,
  makeFavorite,
  validateFavorites,
  favoritesMarkdown,
} from './favoriteModel';
import { isLongComment } from './commentBrowsing';
let items = [],
  ready = false,
  loading = null,
  storageWarning = '';
const watchers = new Map(),
  listeners = new Set();
const messages = {
  FAVORITE_TARGET_INVALID: '无法确认这条公开想法',
  FAVORITE_TOO_LARGE: '收藏容量已达上限，请先删除部分收藏',
  FAVORITE_DATA_INVALID: '收藏数据无法读取，未覆盖原数据',
  FAVORITE_RUNTIME_UNAVAILABLE: '请重新加载扩展并刷新阅读页，再操作本地收藏',
};
const errorText = (error) =>
  messages[error.message] || '本地收藏操作失败，请重试；原收藏仍保留';
const update = (next) => {
  const previous = new Set(items.map((item) => item.key)),
    after = new Set(next.map((item) => item.key));
  items = next;
  storageWarning = '';
  for (const key of new Set([...previous, ...after]))
    if (previous.has(key) !== after.has(key))
      watchers.get(key)?.forEach((listener) => listener());
  listeners.forEach((listener) => listener());
};
export const initializeFavorites = () => {
  if (ready) return Promise.resolve();
  if (loading) return loading;
  loading = chrome.storage.local
    .get(FAVORITES_KEY)
    .then((data) => {
      update(validateFavorites(data[FAVORITES_KEY]));
      ready = true;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[FAVORITES_KEY])
    try {
      update(validateFavorites(changes[FAVORITES_KEY].newValue));
      ready = true;
    } catch (error) {
      storageWarning = errorText(error);
      listeners.forEach((listener) => listener());
    }
});
export const isFavorite = (key) => items.some((item) => item.key === key);
export const subscribeFavorite = (key, listener) => {
  if (!watchers.has(key)) watchers.set(key, new Set());
  const set = watchers.get(key);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) watchers.delete(key);
  };
};
const mutate = async (operation, payload) => {
  await initializeFavorites();
  const response = await chrome.runtime.sendMessage({
    type: 'WXRC_FAVORITES_MUTATE',
    operation,
    payload,
  });
  if (!response) throw Error('FAVORITE_RUNTIME_UNAVAILABLE');
  if (!response?.ok) throw Error(response?.error || 'FAVORITE_WRITE_FAILED');
  update(validateFavorites({ version: 1, items: response.items }));
};
const context = (parent) => {
  const wrapper = document.querySelector('.chrex-comment-wrapper'),
    popup = parent?.closest('.wxrc_public_review_popup');
  return {
    bookId: wrapper?.dataset.bookId,
    chapterUid: wrapper?.dataset.chapterUid,
    bookTitle:
      document.querySelector('.readerTopBar_title_link')?.textContent?.trim() ||
      document.title.replace(/\s*[-–—]\s*微信读书.*$/, ''),
    chapterTitle: document
      .querySelector('.readerTopBar_title_chapter')
      ?.textContent?.trim(),
    sourceUrl: location.href,
    verifiedQuote:
      popup?.querySelector('.wxrc_text_operation_quote')?.textContent || '',
  };
};
export const favoriteEntryKey = (entry) =>
  favoriteKey(
    document.querySelector('.chrex-comment-wrapper')?.dataset.bookId,
    (entry?.review || entry)?.reviewId || entry?.reviewId
  );
export const saveOrRemoveFavorite = async (entry, parent) => {
  const record = makeFavorite(entry, context(parent));
  await initializeFavorites();
  const saved = isFavorite(record.key);
  await mutate(saved ? 'remove' : 'save', saved ? record.key : record);
  return !saved;
};
export const appendFavoriteButton = (parent, entry) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.favoriteAction = 'toggle';
  const status = document.createElement('span');
  status.className = 'wxrc_favorite_status';
  status.setAttribute('role', 'status');
  const key = favoriteEntryKey(entry);
  let busy = false;
  const render = () => {
    const saved = isFavorite(key);
    button.textContent = saved ? '★ 已收藏' : '☆ 收藏';
    button.setAttribute('aria-pressed', String(saved));
    button.disabled = busy;
  };
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (busy) return;
    busy = true;
    render();
    try {
      const saved = await saveOrRemoveFavorite(entry, parent);
      status.textContent = saved ? '已保存到本地' : '已取消收藏';
    } catch (error) {
      status.textContent = errorText(error);
    } finally {
      busy = false;
      render();
    }
  });
  parent.append(button, status);
  const unsubscribe = subscribeFavorite(key, render);
  render();
  void initializeFavorites().catch((error) => {
    status.textContent = errorText(error);
  });
  return unsubscribe;
};
let closeManager = null;
export const openFavorites = (trigger) => {
  if (closeManager) return;
  const overlay = document.createElement('div');
  overlay.className = 'wxrc_favorites_overlay';
  const dialog = document.createElement('section');
  dialog.className = 'wxrc_favorites_dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', '本地收藏');
  const heading = document.createElement('h2');
  heading.textContent = '本地收藏';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '关闭收藏';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '搜索书籍、作者、正文或引用';
  search.setAttribute('aria-label', '搜索本地收藏');
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.textContent = '导出全部 Markdown';
  exportButton.disabled = true;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = '清空全部收藏';
  clear.disabled = true;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消清空';
  cancel.hidden = true;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = '正在读取本地收藏…';
  const list = document.createElement('div');
  list.className = 'wxrc_favorites_list';
  const toolbar = document.createElement('div');
  toolbar.className = 'wxrc_favorites_toolbar';
  toolbar.append(close, exportButton, clear, cancel);
  dialog.append(heading, toolbar, search, status, list);
  overlay.append(dialog);
  document.body.append(overlay);
  let confirming = false,
    busy = false,
    disposed = false,
    feedback = '';
  const expanded = new Set();
  const render = () => {
    if (disposed) return;
    list.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase(),
      filtered = items.filter((item) =>
        [
          item.bookTitle,
          item.chapterTitle,
          item.author,
          item.content,
          item.quote,
        ]
          .join('\n')
          .toLocaleLowerCase()
          .includes(query)
      );
    status.textContent = `显示 ${filtered.length} / ${
      items.length
    } 条 · 仅保存在本扩展本地${storageWarning ? ' · ' + storageWarning : ''}${
      feedback ? ' · ' + feedback : ''
    }`;
    exportButton.disabled = !ready || !items.length || busy;
    clear.disabled = !ready || !items.length || busy;
    clear.textContent = confirming ? '确认清空全部收藏' : '清空全部收藏';
    cancel.hidden = !confirming;
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.textContent = items.length
        ? '没有匹配的收藏'
        : '暂无收藏，可在想法卡片点击“收藏”';
      list.append(empty);
    }
    for (const item of filtered) {
      const card = document.createElement('article');
      card.className = 'wxrc_favorite_card';
      card.dataset.favoriteKey = item.key;
      card.dataset.reviewId = item.reviewId;
      const title = document.createElement('h3');
      title.textContent = `${item.bookTitle} · ${item.chapterTitle}`;
      const author = document.createElement('p');
      author.textContent = item.author;
      const quote = document.createElement('blockquote');
      quote.textContent = item.quote
        ? `${
            item.quoteSource === 'verified' ? '已核实原文' : '公开想法附带引用'
          }：\n${item.quote}`
        : '无附带引用';
      const content = document.createElement('p');
      content.className = 'wxrc_favorite_content';
      content.textContent = item.content;
      let expand = null;
      if (isLongComment(item.content)) {
        expand = document.createElement('button');
        expand.type = 'button';
        const show = () => {
          const opened = expanded.has(item.key);
          content.classList.toggle('wxrc_comment_content_collapsed', !opened);
          expand.textContent = opened ? '收起全文' : '展开全文';
          expand.setAttribute('aria-expanded', String(opened));
        };
        expand.addEventListener('click', () => {
          if (expanded.has(item.key)) expanded.delete(item.key);
          else expanded.add(item.key);
          show();
        });
        show();
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '删除收藏';
      remove.disabled = busy;
      remove.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        render();
        try {
          await mutate('remove', item.key);
          feedback = '已删除本地收藏';
        } catch (error) {
          feedback = errorText(error);
        } finally {
          busy = false;
          render();
          search.focus({ preventScroll: true });
        }
      });
      card.append(title, author, quote, content);
      if (expand) card.append(expand);
      card.append(remove);
      list.append(card);
    }
  };
  listeners.add(render);
  const finish = () => {
    disposed = true;
    listeners.delete(render);
    overlay.remove();
    closeManager = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    else
      document
        .querySelector('.wxrc_sidebar_launcher')
        ?.focus({ preventScroll: true });
  };
  closeManager = finish;
  close.addEventListener('click', finish);
  overlay.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target === overlay) finish();
  });
  overlay.addEventListener(
    'wheel',
    (event) => {
      if (event.target === overlay) event.preventDefault();
    },
    { passive: false }
  );
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish();
    } else if (event.key === 'Tab') {
      const nodes = [
        ...dialog.querySelectorAll('button:not(:disabled):not([hidden]),input'),
      ];
      const first = nodes[0],
        last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  search.addEventListener('input', () => {
    confirming = false;
    feedback = '';
    render();
  });
  cancel.addEventListener('click', () => {
    confirming = false;
    feedback = '';
    render();
    clear.focus();
  });
  clear.addEventListener('click', async () => {
    if (!confirming) {
      confirming = true;
      render();
      status.textContent = '将删除全部本地收藏；再次点击确认清空，或取消。';
      return;
    }
    busy = true;
    render();
    try {
      await mutate('clear');
      confirming = false;
      feedback = '已清空本地收藏';
    } catch (error) {
      feedback = errorText(error);
    } finally {
      busy = false;
      render();
      search.focus();
    }
  });
  exportButton.addEventListener('click', () => {
    const blob = new Blob([favoritesMarkdown(items)], {
        type: 'text/markdown;charset=utf-8',
      }),
      url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = 'wxread-favorites.md';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `已导出全部 ${items.length} 条收藏`;
  });
  search.focus();
  void initializeFavorites()
    .then(render)
    .catch((error) => {
      status.textContent = errorText(error);
    });
};
export const closeFavorites = () => closeManager?.();
export { errorText as favoriteErrorText };
