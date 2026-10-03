// Network observation is a fallback only. The content script first reads the
// stable bookId from the reader HTML structured data.
import { debugLog } from '../Content/debug';

const tabContext = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message === 'getBookId') {
    const tabId = sender.tab && sender.tab.id;
    sendResponse(
      typeof tabId === 'number' ? tabContext.get(tabId)?.bookId : undefined
    );
    return;
  }
  debugLog('Background', 'message received', message);
});

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) {
      return;
    }

    const context = tabContext.get(details.tabId) || {};
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
    tabContext.set(details.tabId, context);
  },
  {
    urls: [
      'https://weread.qq.com/web/review/*',
      'https://weread.qq.com/web/reader/*',
    ],
  }
);

chrome.tabs?.onRemoved?.addListener((tabId) => tabContext.delete(tabId));
