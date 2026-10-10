import { debugLog } from '../debug';

export interface WeReadAuthor {
  avatar?: string;
  name?: string;
  [key: string]: unknown;
}

export interface WeReadReview {
  reviewId?: string;
  bookId?: string;
  chapterUid?: string | number;
  chapterIdx?: string | number;
  chapterName?: string;
  chapterTitle?: string;
  range?: string;
  abstract?: string;
  content?: string;
  createTime?: number;
  author?: WeReadAuthor;
  [key: string]: unknown;
}

export interface WeReadReviewItem {
  reviewId?: string;
  chapterUid?: string | number;
  chapterIdx?: string | number;
  chapterName?: string;
  range?: string;
  abstract?: string;
  content?: string;
  author?: WeReadAuthor;
  review?: WeReadReview;
  [key: string]: unknown;
}

export interface WeReadReviewResponse {
  reviews?: WeReadReviewItem[];
  totalCount?: number;
  chapterTotalCount?: number;
  hasMore?: number;
  synckey?: number;
  maxIdx?: number;
  count?: number;
  pages?: WeReadReviewResponse[];
  pageCount?: number;
  paginationStoppedReason?: string;
  [key: string]: unknown;
}

export interface WeReadChapter {
  chapterUid: string | number;
  chapterIdx?: string | number;
  title?: string;
  [key: string]: unknown;
}

export interface ReaderIdentity {
  value: string;
  source: string;
}

export interface ChapterIdentity {
  chapterUid: string;
  chapterIdx?: string | number;
  chapterName?: string;
  source: string;
}

interface ChapterCatalogResult {
  raw: Record<string, unknown>;
  chapters: WeReadChapter[];
  source: string;
}

const BOOK_ID_KEYS = ['bookId', 'bookid'];

export const phase2Log = (label: string, data?: unknown) => {
  debugLog('Reader', label, data);
};

export function safeParseJSON(str: string) {
  try {
    return JSON.parse(str);
  } catch (error) {
    return null;
  }
}

const normalizeId = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return '';
  }

  const candidate = value.trim();
  if (/^\d+$/.test(candidate) || /^MP_WXS_[\w-]+$/.test(candidate)) {
    return candidate;
  }

  const queryMatch = candidate.match(/[?&](?:bookId|bookid|bId)=([^&#]+)/i);
  if (queryMatch) {
    return decodeURIComponent(queryMatch[1]);
  }
  return '';
};

const normalizeChapterUid = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return '';
  }
  const candidate = value.trim();
  return /^\d+$/.test(candidate) ? candidate : '';
};

const findKeyDeep = (
  value: unknown,
  keys: string[],
  normalizer: (value: unknown) => string,
  depth = 0,
  seen = new Set<unknown>()
): string => {
  if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) {
    return '';
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const normalized = normalizer(record[key]);
    if (normalized) {
      return normalized;
    }
  }
  for (const child of Object.values(record)) {
    const result = findKeyDeep(child, keys, normalizer, depth + 1, seen);
    if (result) {
      return result;
    }
  }
  return '';
};

const extractJsonObject = (text: string, marker: string): unknown => {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const start = text.indexOf('{', markerIndex + marker.length);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return safeParseJSON(text.slice(start, index + 1));
      }
    }
  }
  return null;
};

const readInitialState = (root: ParentNode): unknown => {
  const nextData = root.querySelector('script#__NEXT_DATA__');
  if (nextData?.textContent) {
    const parsed = safeParseJSON(nextData.textContent);
    if (parsed) {
      return parsed;
    }
  }

  const scripts = Array.from(root.querySelectorAll('script'));
  for (const script of scripts) {
    const text = script.textContent || '';
    if (!text.includes('__INITIAL_STATE__')) {
      continue;
    }
    const parsed = extractJsonObject(text, '__INITIAL_STATE__');
    if (parsed) {
      return parsed;
    }
  }
  return null;
};

const getBookIdFromDocument = (root: ParentNode, structuredOnly = false): ReaderIdentity | null => {
  const initialState = readInitialState(root) as Record<string, unknown> | null;
  const reader = initialState?.reader as Record<string, unknown> | undefined;
  const bookInfo = reader?.bookInfo as Record<string, unknown> | undefined;
  const stateBookId =
    normalizeId(bookInfo?.bookId) ||
    findKeyDeep(initialState, BOOK_ID_KEYS, normalizeId);
  if (stateBookId) {
    return {
      value: stateBookId,
      source: '__INITIAL_STATE__.reader.bookInfo.bookId',
    };
  }
  if (structuredOnly) return null;

  const jsonLdScripts = Array.from(
    root.querySelectorAll('script[type="application/ld+json"]')
  );
  for (const script of jsonLdScripts) {
    const json = safeParseJSON(script.textContent || '');
    const bookId = findKeyDeep(
      json,
      [...BOOK_ID_KEYS, '@Id', '@id'],
      normalizeId
    );
    if (bookId) {
      return { value: bookId, source: 'application/ld+json' };
    }
  }

  const bookIdElement = root.querySelector(
    '[data-book-id], [data-bookid]'
  ) as HTMLElement | null;
  if (bookIdElement) {
    const bookId = normalizeId(
      bookIdElement.dataset.bookId || bookIdElement.getAttribute('data-bookid')
    );
    if (bookId) {
      return { value: bookId, source: 'DOM data-book-id' };
    }
  }

  const cover = root.querySelector(
    'img.wr_bookCover_img'
  ) as HTMLImageElement | null;
  const coverMatch = cover?.src.match(/\/cover\/[^/]+\/([^/]+)\//);
  const coverBookId = normalizeId(coverMatch?.[1]);
  if (coverBookId) {
    return { value: coverBookId, source: 'cover URL' };
  }
  return null;
};

const getBookIdFromLocation = (): ReaderIdentity | null => {
  const params = new URLSearchParams(window.location.search);
  const bookId = normalizeId(
    params.get('bookId') || params.get('bookid') || params.get('bId')
  );
  return bookId ? { value: bookId, source: 'reader URL query' } : null;
};

const fetchReaderDocument = async (): Promise<Document | null> => {
  try {
    const response = await fetch(window.location.href, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    return new DOMParser().parseFromString(html, 'text/html');
  } catch (error) {
    phase2Log('reader HTML fallback failed', String(error));
    return null;
  }
};

const getBookIdFromBackground = async (
  timeoutMs = 5000
): Promise<ReaderIdentity | null> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const bookId = await new Promise<string>((resolve) => {
      chrome.runtime.sendMessage('getBookId', (value) =>
        resolve(normalizeId(value))
      );
    });
    if (bookId) {
      return { value: bookId, source: 'background network fallback' };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
};

const requestReaderContext = (): Promise<{ bookId?: string; chapterUid?: string } | null> =>
  new Promise((resolve) => {
    const requestId = `context_${Date.now()}_${Math.random()}`;
    const finish = (value: { bookId?: string; chapterUid?: string } | null) => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.data?.source !== 'WXRC_PAGE' ||
          event.data.type !== 'READER_CONTEXT_RESULT' || event.data.requestId !== requestId) return;
      finish(event.data.context || null);
    };
    const timer = window.setTimeout(() => finish(null), 1000);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'WXRC', type: 'GET_READER_CONTEXT', requestId }, '*');
  });

export const resolveBookId = async (): Promise<ReaderIdentity | null> => {
  const query = getBookIdFromLocation();
  if (query) return query;
  const context = await requestReaderContext();
  const runtimeBookId = normalizeId(context?.bookId);
  if (runtimeBookId) return { value: runtimeBookId, source: 'Reader runtime context' };
  const direct = getBookIdFromDocument(document, true);
  if (direct) {
    return direct;
  }

  const readerDocument = await fetchReaderDocument();
  const fromHtml = readerDocument && getBookIdFromDocument(readerDocument, true);
  if (fromHtml) {
    return { ...fromHtml, source: `reader HTML ${fromHtml.source}` };
  }
  return getBookIdFromDocument(document) || getBookIdFromBackground();
};

export const getChapterCatalog = async (
  bookId: string
): Promise<ChapterCatalogResult> => {
  const initialState = readInitialState(document) as Record<
    string,
    unknown
  > | null;
  const reader = initialState?.reader as Record<string, unknown> | undefined;
  const stateChapters = reader?.chapterInfos;
  if (Array.isArray(stateChapters) && stateChapters.length > 0) {
    return {
      raw: initialState || {},
      chapters: stateChapters as WeReadChapter[],
      source: '__INITIAL_STATE__.reader.chapterInfos',
    };
  }

  const response = await fetch('https://weread.qq.com/web/book/chapterInfos', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ bookIds: [bookId] }),
  });
  if (!response.ok) {
    throw new Error(`chapterInfos failed: HTTP ${response.status}`);
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const data = Array.isArray(raw.data)
    ? (raw.data[0] as Record<string, unknown>)
    : raw;
  const chapters = Array.isArray(data?.updated)
    ? (data.updated as WeReadChapter[])
    : Array.isArray(raw.updated)
    ? (raw.updated as WeReadChapter[])
    : [];
  return { raw, chapters, source: '/web/book/chapterInfos' };
};

const normalizeTitle = (value: string) => value.replace(/\s+/g, ' ').trim();

const identityFromChapter = (
  chapter: WeReadChapter,
  source: string
): ChapterIdentity => ({
  chapterUid: String(chapter.chapterUid),
  chapterIdx: chapter.chapterIdx,
  chapterName: chapter.title,
  source,
});

const findChapterByUid = (
  chapters: WeReadChapter[],
  uid: string,
  source: string
) => {
  const chapter = chapters.find((item) => String(item.chapterUid) === uid);
  return chapter ? identityFromChapter(chapter, source) : null;
};

const readChapterUidFromElement = (element: Element | null): string => {
  let current = element;
  while (current) {
    for (const name of [
      'data-chapter-uid',
      'data-chapteruid',
      'data-chapter-id',
    ]) {
      const uid = normalizeChapterUid(current.getAttribute(name));
      if (uid) {
        return uid;
      }
    }
    current = current.parentElement;
  }
  return '';
};

const getCurrentChapterTitle = (): string => {
  const selectors = [
    '.readerTopBar_title_chapter',
    '.renderTargetPageInfo_header_chapterTitle',
    '.readerCatalog_list_item_selected',
    '[aria-current="true"]',
  ];
  for (const selector of selectors) {
    const title = normalizeTitle(
      document.querySelector(selector)?.textContent || ''
    );
    if (title) {
      return title;
    }
  }
  return '';
};

export const resolveCurrentChapter = async (
  chapters: WeReadChapter[]
): Promise<ChapterIdentity | null> => {
  const query = new URLSearchParams(window.location.search);
  const queryUid = normalizeChapterUid(
    query.get('chapterUid') || query.get('progressChapterUid')
  );
  if (queryUid) {
    return findChapterByUid(chapters, queryUid, 'reader URL query');
  }

  const context = await requestReaderContext();
  const runtimeChapterUid = normalizeChapterUid(context?.chapterUid);
  if (runtimeChapterUid) {
    return findChapterByUid(chapters, runtimeChapterUid, 'Reader runtime context');
  }

  const centerElement = document.elementFromPoint(
    Math.round(window.innerWidth / 2),
    Math.round(window.innerHeight / 2)
  );
  const visibleUid = readChapterUidFromElement(centerElement);
  if (visibleUid) {
    return findChapterByUid(
      chapters,
      visibleUid,
      'visible chapter DOM attribute'
    );
  }

  const selected = document.querySelector(
    '.readerCatalog_list_item_selected, [aria-current="true"]'
  );
  const selectedUid = readChapterUidFromElement(selected);
  if (selectedUid) {
    return findChapterByUid(
      chapters,
      selectedUid,
      'selected catalog DOM attribute'
    );
  }

  const title = getCurrentChapterTitle();
  if (title) {
    const matches = chapters.filter(
      (chapter) => normalizeTitle(chapter.title || '') === title
    );
    if (matches.length === 1) {
      return identityFromChapter(
        matches[0],
        'current title matched chapterInfos'
      );
    }
    if (matches.length > 1) {
      const catalogItems = Array.from(
        document.querySelectorAll('.readerCatalog_list_item')
      );
      const selectedIndex = catalogItems.findIndex((item) =>
        item.classList.contains('readerCatalog_list_item_selected')
      );
      if (selectedIndex >= 0) {
        const occurrence =
          catalogItems
            .slice(0, selectedIndex + 1)
            .filter((item) => normalizeTitle(item.textContent || '') === title)
            .length - 1;
        if (occurrence >= 0 && matches[occurrence]) {
          return identityFromChapter(
            matches[occurrence],
            'selected catalog title occurrence matched chapterInfos'
          );
        }
      }
      phase2Log('ambiguous chapter title', {
        title,
        candidates: matches.map((item) => ({
          chapterUid: item.chapterUid,
          chapterIdx: item.chapterIdx,
        })),
      });
    }
  }

  const state = readInitialState(document) as Record<string, unknown> | null;
  const reader = state?.reader as Record<string, unknown> | undefined;
  const currentChapter = reader?.currentChapter as
    | Record<string, unknown>
    | undefined;
  const chapterInfo = reader?.chapterInfo as
    | Record<string, unknown>
    | undefined;
  const progress = reader?.progress as Record<string, unknown> | undefined;
  const stateUid = normalizeChapterUid(
    reader?.currentChapterUid ||
      currentChapter?.chapterUid ||
      chapterInfo?.chapterUid ||
      progress?.chapterUid
  );
  if (stateUid) {
    return findChapterByUid(chapters, stateUid, '__INITIAL_STATE__');
  }
  return null;
};

export const getReview = (item: WeReadReviewItem): WeReadReview =>
  item.review || item;

export const getReviewChapterUid = (item: WeReadReviewItem): string => {
  const review = getReview(item);
  return normalizeChapterUid(review.chapterUid || item.chapterUid);
};

export const filterReviewsByChapterUid = (
  response: WeReadReviewResponse,
  chapterUid: string
): WeReadReviewItem[] => {
  return (response.reviews || []).filter(
    (item) => getReviewChapterUid(item) === String(chapterUid)
  );
};

export const getCommentData = async (
  params: Record<string, string | number>
): Promise<WeReadReviewResponse> => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) =>
    query.set(key, String(value))
  );
  const url = `https://weread.qq.com/web/review/list?${query.toString()}`;
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`review/list failed: HTTP ${response.status}`);
  }
  return response.json();
};

// /web/review/list uses syncKey for continuation; maxIdx is used only when
// the server explicitly returns it. A short page is not proof of completion.
export const getAllCommentData = async (
  params: Record<string, string | number>,
  isCurrent: () => boolean | Promise<boolean> = () => true
): Promise<WeReadReviewResponse> => {
  let pageSize = 1000;
  const maxPageSize = 5000;
  const maxPages = 30;
  const pages: WeReadReviewResponse[] = [];
  const reviews: WeReadReviewItem[] = [];
  const seenReviewIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: Record<string, number> = {};
  let stoppedReason = 'hasMore=0';

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    if (!(await isCurrent())) {
      stoppedReason = 'chapter-changed';
      break;
    }
    const page = await getCommentData({ ...params, count: pageSize, ...cursor });
    pages.push(page);
    if (!(await isCurrent())) {
      stoppedReason = 'chapter-changed';
      break;
    }
    let newReviewCount = 0;
    for (const item of page.reviews || []) {
      const review = getReview(item);
      const reviewId = String(review.reviewId || item.reviewId || '');
      if (reviewId && seenReviewIds.has(reviewId)) continue;
      if (reviewId) seenReviewIds.add(reviewId);
      reviews.push(item);
      newReviewCount++;
    }
    if (!page.hasMore) {
      if (
        (page.reviews || []).length >= pageSize &&
        pageSize < maxPageSize &&
        newReviewCount > 0
      ) {
        // Some list modes report hasMore=0 even for a count-limited response.
        // Expand the requested window instead of treating maxIdx as an offset.
        pageSize = Math.min(pageSize * 2, maxPageSize);
        cursor = {};
        stoppedReason = 'expanded-count';
        continue;
      }
      stoppedReason = 'hasMore=0';
      break;
    }
    if (newReviewCount === 0) {
      stoppedReason = 'no-new-reviews';
      break;
    }
    const nextCursor: Record<string, number> = {};
    if (typeof page.synckey === 'number' && Number.isFinite(page.synckey)) {
      nextCursor.syncKey = page.synckey;
    }
    if (typeof page.maxIdx === 'number' && Number.isFinite(page.maxIdx)) {
      nextCursor.maxIdx = page.maxIdx;
    }
    const cursorKey = JSON.stringify(nextCursor);
    if (Object.keys(nextCursor).length === 0 || seenCursors.has(cursorKey)) {
      stoppedReason = 'missing-or-repeated-cursor';
      break;
    }
    seenCursors.add(cursorKey);
    cursor = nextCursor;
    stoppedReason = 'page-limit';
  }

  const first = pages[0] || {};
  const last = pages[pages.length - 1] || first;
  return {
    ...first,
    reviews,
    hasMore: last.hasMore,
    synckey: last.synckey ?? first.synckey,
    maxIdx: last.maxIdx ?? first.maxIdx,
    pages,
    pageCount: pages.length,
    paginationStoppedReason: stoppedReason,
  };
};

export function getFormattedDate(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const day = ('0' + date.getDate()).slice(-2);
  const hour = ('0' + date.getHours()).slice(-2);
  const minute = ('0' + date.getMinutes()).slice(-2);
  const second = ('0' + date.getSeconds()).slice(-2);

  return (
    year + '-' + month + '-' + day + ' ' + hour + ':' + minute + ':' + second
  );
}
