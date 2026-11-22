// Network observation is a fallback only. The content script first reads the
// stable bookId from the reader HTML structured data.
import { debugLog } from '../Content/debug';
import { createFavoritesRepository } from '../Content/favoriteModel';

const favorites = createFavoritesRepository(chrome.storage.local);
const TAB_CONTEXT_PREFIX = 'wxrc_tab_ctx_';
const KNOWN_FAVORITE_ERRORS = new Set([
  'FAVORITE_DATA_INVALID',
  'FAVORITE_TOO_LARGE',
  'FAVORITE_TARGET_INVALID',
  'FAVORITE_OPERATION_INVALID',
]);

const tabContextKey = (tabId) => `${TAB_CONTEXT_PREFIX}${tabId}`;

const readTabContext = async (tabId) => {
  if (!chrome.storage?.session || typeof tabId !== 'number' || tabId < 0) {
    return {};
  }
  try {
    const key = tabContextKey(tabId);
    const result = await chrome.storage.session.get(key);
    return result?.[key] && typeof result[key] === 'object' ? result[key] : {};
  } catch (error) {
    debugLog('Background', 'failed to read tab context', String(error));
    return {};
  }
};

const writeTabContext = async (tabId, context) => {
  if (!chrome.storage?.session || typeof tabId !== 'number' || tabId < 0) {
    return;
  }
  try {
    await chrome.storage.session.set({ [tabContextKey(tabId)]: context });
  } catch (error) {
    debugLog('Background', 'failed to write tab context', String(error));
  }
};

const deleteTabContext = async (tabId) => {
  if (!chrome.storage?.session || typeof tabId !== 'number' || tabId < 0) {
    return;
  }
  try {
    await chrome.storage.session.remove(tabContextKey(tabId));
  } catch (error) {
    debugLog('Background', 'failed to remove tab context', String(error));
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'WXRC_FAVORITES_MUTATE') {
    if (sender.id !== chrome.runtime.id) return false;
    (async () => {
      try {
        const items = await favorites.mutate(message.operation, message.payload);
        sendResponse({ ok: true, items });
      } catch (error) {
        const errorCode = KNOWN_FAVORITE_ERRORS.has(error?.message)
          ? error.message
          : 'FAVORITE_WRITE_FAILED';
        sendResponse({ ok: false, error: errorCode });
      }
    })();
    return true;
  }

  if (message === 'getBookId') {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      sendResponse(undefined);
      return false;
    }
    (async () => {
      const context = await readTabContext(tabId);
      sendResponse(context.bookId);
    })();
    return true;
  }

  debugLog('Background', 'message received', message);
  return false;
});

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) {
      return;
    }
    (async () => {
      const context = await readTabContext(details.tabId);
      const requestUrl = details.url || '';
      if (requestUrl.includes('/web/reader/')) {
        context.readerKey =
          requestUrl.split('/reader/')[1]?.split(/[?#]/)[0] || '';
      }

      try {
        const bookId = new URL(requestUrl).searchParams.get('bookId');
        if (bookId) {
          context.bookId = bookId;
        }
      } catch (error) {
        console.warn('[WxReadComments] failed to parse observed URL', requestUrl);
      }

      await writeTabContext(details.tabId, context);

      if (
        details.method === 'POST' &&
        details.statusCode >= 200 &&
        details.statusCode < 400 &&
        /\/web\/review\/(add|delete|edit)\b/.test(requestUrl)
      ) {
        chrome.tabs
          ?.sendMessage?.(details.tabId, { type: 'WXRC_CHAPTER_REVIEWS_CHANGED' })
          ?.catch?.(() => {});
      }
    })();
  },
  {
    urls: [
      'https://weread.qq.com/web/review/*',
      'https://weread.qq.com/web/reader/*',
    ],
  }
);

chrome.tabs?.onRemoved?.addListener((tabId) => {
  void deleteTabContext(tabId);
});
