export const FAVORITES_KEY = 'wxrc_local_favorites_v1';
export const favoriteKey = (bookId, reviewId) =>
  JSON.stringify([String(bookId || ''), String(reviewId || '')]);
export const plainFavoriteText = (value) =>
  String(value || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, entity) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[
          entity
        ])
    )
    .replace(/&#(x[\da-f]+|\d+);/gi, (full, entity) => {
      const n =
        entity[0].toLowerCase() === 'x'
          ? parseInt(entity.slice(1), 16)
          : Number(entity);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : full;
    });
const safeSource = (value) => {
  try {
    const url = new URL(value);
    if (
      url.origin !== 'https://weread.qq.com' ||
      !/^\/web\/reader\/[\w-]+\/?$/.test(url.pathname)
    )
      return '';
    return url.origin + url.pathname;
  } catch {
    return '';
  }
};
export const makeFavorite = (entry, context, now = Date.now()) => {
  const review = entry?.review || entry || {},
    bookId = String(context?.bookId || ''),
    chapterUid = String(context?.chapterUid || ''),
    reviewId = String(review.reviewId || entry?.reviewId || '');
  if (
    !bookId ||
    !chapterUid ||
    !reviewId ||
    [bookId, chapterUid, reviewId].some((v) => v.length > 200) ||
    (review.isPrivate !== undefined &&
      ![false, 0, '0'].includes(review.isPrivate)) ||
    (review.bookId !== undefined && String(review.bookId) !== bookId) ||
    (review.chapterUid !== undefined &&
      String(review.chapterUid) !== chapterUid)
  )
    throw Error('FAVORITE_TARGET_INVALID');
  const quote = context.verifiedQuote
    ? String(context.verifiedQuote)
    : plainFavoriteText(review.abstract || '');
  const record = {
    key: favoriteKey(bookId, reviewId),
    bookId,
    chapterUid,
    reviewId,
    bookTitle: String(context.bookTitle || `书籍 ${bookId}`),
    chapterTitle: String(context.chapterTitle || `章节 ${chapterUid}`),
    author: String(review.author?.name || '微信读书用户'),
    content: plainFavoriteText(review.content),
    quote,
    quoteSource: context.verifiedQuote ? 'verified' : quote ? 'review' : 'none',
    sourceUrl: safeSource(context.sourceUrl),
    savedAt: now,
  };
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now > 8640000000000000 ||
    record.content.length > 60000 ||
    quote.length > 60000 ||
    [record.bookTitle, record.chapterTitle, record.author].some(
      (v) => v.length > 1000
    )
  )
    throw Error('FAVORITE_TOO_LARGE');
  return record;
};
export const validateFavorites = (value) => {
  if (value === undefined) return [];
  if (
    value?.version !== 1 ||
    !Array.isArray(value.items) ||
    value.items.length > 500
  )
    throw Error('FAVORITE_DATA_INVALID');
  const seen = new Set();
  const items = value.items.map((record) => {
    if (
      !record ||
      [
        'bookId',
        'chapterUid',
        'reviewId',
        'bookTitle',
        'chapterTitle',
        'author',
        'content',
        'quote',
        'sourceUrl',
      ].some((field) => typeof record[field] !== 'string') ||
      ['bookId', 'chapterUid', 'reviewId'].some(
        (field) => !record[field] || record[field].length > 200
      ) ||
      ['bookTitle', 'chapterTitle', 'author'].some(
        (field) => record[field].length > 1000
      ) ||
      record.content.length > 60000 ||
      record.quote.length > 60000 ||
      !['verified', 'review', 'none'].includes(record.quoteSource) ||
      !Number.isSafeInteger(record.savedAt) ||
      record.savedAt < 0 ||
      record.savedAt > 8640000000000000 ||
      safeSource(record.sourceUrl) !== record.sourceUrl
    )
      throw Error('FAVORITE_DATA_INVALID');
    const clean = Object.fromEntries(
      [
        'key',
        'bookId',
        'chapterUid',
        'reviewId',
        'bookTitle',
        'chapterTitle',
        'author',
        'content',
        'quote',
        'quoteSource',
        'sourceUrl',
        'savedAt',
      ].map((field) => [field, record[field]])
    );
    if (clean.key !== favoriteKey(clean.bookId, clean.reviewId))
      throw Error('FAVORITE_DATA_INVALID');
    if (record.key !== clean.key || seen.has(clean.key))
      throw Error('FAVORITE_DATA_INVALID');
    seen.add(clean.key);
    return clean;
  });
  if (
    new TextEncoder().encode(JSON.stringify({ version: 1, items })).length >
    2000000
  )
    throw Error('FAVORITE_TOO_LARGE');
  return items;
};
const escape = (text) =>
  String(text)
    .replace(/\\/g, '\\\\')
    .replace(/([`*_\[\]<>#!])/g, '\\$1');
export const favoritesMarkdown = (items) =>
  '# 微信读书本地收藏\n\n' +
  items
    .map(
      (item) =>
        `## ${escape(item.bookTitle)} · ${escape(
          item.chapterTitle
        )}\n\n作者：${escape(item.author)}\n\n${
          item.quote
            ? `引用（${
                item.quoteSource === 'verified'
                  ? '已核实原文'
                  : '公开想法附带引用'
              }）：\n\n${item.quote
                .split('\n')
                .map((line) => '> ' + escape(line))
                .join('\n')}\n\n`
            : ''
        }${escape(item.content)}\n\n${
          item.sourceUrl ? `来源：[打开微信读书](${item.sourceUrl})\n\n` : ''
        }收藏时间：${new Date(item.savedAt).toISOString()}\n\n---\n`
    )
    .join('\n');
export const createFavoritesRepository = (storage) => {
  let queue = Promise.resolve();
  return {
    mutate(operation, payload) {
      const task = queue
        .catch(() => {})
        .then(async () => {
          let items = validateFavorites(
            (await storage.get(FAVORITES_KEY))[FAVORITES_KEY]
          );
          if (operation === 'save') {
            const record = validateFavorites({
              version: 1,
              items: [payload],
            })[0];
            items = [
              record,
              ...items.filter((item) => item.key !== record.key),
            ];
          } else if (operation === 'remove')
            items = items.filter((item) => item.key !== payload);
          else if (operation === 'clear') items = [];
          else throw Error('FAVORITE_OPERATION_INVALID');
          if (items.length > 500) throw Error('FAVORITE_TOO_LARGE');
          validateFavorites({ version: 1, items });
          await storage.set({ [FAVORITES_KEY]: { version: 1, items } });
          return items;
        });
      queue = task;
      return task;
    },
  };
};
