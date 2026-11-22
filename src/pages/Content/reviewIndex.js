import { getReview } from './utils';

export const FAILURE_SAMPLE_LIMIT = 8;

const NATIVE_READER_CONTROL_SELECTOR = [
  '.reader_toolbar_container',
  '.readerControls',
  '.readerCatalog',
  '.wr_float_panel_container',
  '.wr_mask',
  '.reader-font-control-panel-wrapper',
  '.reader_float_search_panel_wrapper',
  '.wr_underline_wrapper:not(.wxrc_public_review_wrapper)',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="dialog"]',
  '[aria-modal="true"]',
  'button',
  'input',
  'select',
  'textarea',
  'a',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

export const createEmptyIndex = (chapterUid = '') => ({
  chapterUid: String(chapterUid || ''),
  layoutVersion: null,
  reviewsById: new Map(),
  ranges: new Map(),
  reviews: new Map(),
  hitRects: [],
});

export const getReviewId = (review, entry, fallback = '') =>
  String(review?.reviewId || entry?.reviewId || fallback);

export const parseRange = (value) => {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return end > start ? { start, end, value: `${start}-${end}` } : null;
  }
  if (value && typeof value === 'object') {
    const start = Number(value.start);
    const end = Number(value.end);
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? { start, end, value: `${start}-${end}` }
      : null;
  }
  return null;
};

export const groupReviews = (
  entries,
  chapterUid,
  failureSampleLimit = FAILURE_SAMPLE_LIMIT
) => {
  const groups = new Map();
  const invalidFailures = [];
  let invalidRangeCount = 0;

  for (const entry of entries) {
    const review = getReview(entry);
    const rangeValue = review.range || entry.range;
    const range = parseRange(rangeValue);
    if (!range) {
      invalidRangeCount += 1;
      if (invalidFailures.length < failureSampleLimit) {
        invalidFailures.push({
          range: rangeValue || '',
          abstract: review.abstract || '',
          chapterUid: String(chapterUid),
          matchedObjectCount: 0,
          rectCount: 0,
          failureReason: 'INVALID_RANGE',
        });
      }
      continue;
    }
    const key = `${chapterUid}:${range.value}`;
    const current = groups.get(key) || { key, range, reviews: [] };
    current.reviews.push(review);
    groups.set(key, current);
  }

  return { groups, invalidFailures, invalidRangeCount };
};

export const getRangeAtClientPoint = (
  index,
  { clientX, clientY, showPublicUnderlines, activeChapterUid }
) => {
  if (!showPublicUnderlines || index.chapterUid !== activeChapterUid) {
    return null;
  }
  const container = document.querySelector('.wr_canvasContainer');
  if (!container) return null;
  const box = container.getBoundingClientRect();
  const x = clientX - box.left;
  const y = clientY - box.top;
  if (x < 0 || y < 0 || x >= box.width || y >= box.height) return null;

  let best = null;
  for (const entry of index.hitRects) {
    const { rect } = entry;
    if (
      x < rect.x ||
      x >= rect.x + rect.w ||
      y < rect.y ||
      y >= rect.y + rect.h
    ) {
      continue;
    }
    if (
      !best ||
      entry.area < best.area ||
      (entry.area === best.area && entry.rangeLength < best.rangeLength)
    ) {
      best = entry;
    }
  }

  return best ? index.ranges.get(best.rangeKey) : null;
};

export const isNativeUnderlineAt = (clientX, clientY) =>
  Array.from(
    document.querySelectorAll(
      '.wr_underline_wrapper:not(.wxrc_public_review_wrapper)'
    )
  ).some((node) => {
    const box = node.getBoundingClientRect();
    return (
      box.width > 0 &&
      box.height > 0 &&
      clientX >= box.left &&
      clientX < box.right &&
      clientY >= box.top &&
      clientY < box.bottom
    );
  });

export const isReaderSurfaceTarget = (target) => {
  if (!(target instanceof Element)) return false;
  const container = document.querySelector('.wr_canvasContainer');
  const readerHost = container?.closest('.renderTargetContainer') || container;
  return Boolean(
    readerHost?.contains(target) &&
      !target.closest(
        '.wr_float_panel_container, .wr_mask, .reader-font-control-panel-wrapper'
      )
  );
};

export const isNativeReaderInteraction = (event) => {
  const path =
    typeof event.composedPath === 'function'
      ? event.composedPath()
      : [event.target];
  return path.some(
    (node) => node instanceof Element && node.matches(NATIVE_READER_CONTROL_SELECTOR)
  );
};

export const hasActiveTextSelection = () => {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim()) {
    return true;
  }
  const toolbar = document.querySelector('.reader_toolbar_container');
  const readerSelection = document.querySelector('.wr_selection');
  return Boolean(
    toolbar?.getClientRects().length &&
      readerSelection?.getClientRects().length &&
      getComputedStyle(toolbar).visibility !== 'hidden'
  );
};

export const buildSyncProps = (index, compatibility, onReviewClick) => {
  const reviewRangeKeys = new Map();
  const rangeReviewCounts = new Map();
  for (const [reviewId, value] of index.reviews) {
    reviewRangeKeys.set(reviewId, value.rangeKey);
  }
  for (const [rangeKey, value] of index.ranges) {
    rangeReviewCounts.set(rangeKey, value.reviews.length);
  }
  return {
    compatibility,
    chapterUid: index.chapterUid,
    layoutVersion: index.layoutVersion,
    mappedReviewIds: new Set(index.reviews.keys()),
    reviewRangeKeys,
    rangeReviewCounts,
    onReviewClick,
  };
};
