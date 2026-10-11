import { getReview } from './utils';
import { debugLog } from './debug';
import { badgeWidthForCount, positionBadge, positionPopup } from './popupBadgeLayout';
import { compatibilityFailure } from './readerCompatibility';
import { createNativeTextToolbar } from './nativeTextToolbar';
import { appendReviewActions, isReviewDetailOpen } from './reviewInteractions';

const REQUEST_SOURCE = 'WXRC';
const RESPONSE_SOURCE = 'WXRC_PAGE';
const LAYER_CLASS = 'wxrc_public_review_layer';
const POPUP_CLASS = 'wxrc_public_review_popup';
const ACTIVE_CLASS = 'wxrc_comment_active';
const EMPHASIS_CLASS = 'wxrc_public_review_emphasis';
const HOVER_CLASS = 'wxrc_public_review_hover';
const BADGE_CLASS = 'wxrc_public_review_badge';
const REQUEST_TIMEOUT_MS = 8000;
const ACTIVE_SWITCH_THRESHOLD_PX = 80;
const SCROLL_TOP_PADDING_PX = 120;
const FAILURE_SAMPLE_LIMIT = 8;

const pendingRequests = new Map();
let requestSequence = 0;
let renderGeneration = 0;
let activeChapterUid = '';
let invalidationCallback = null;
let initialized = false;
let scrollFrame = 0;
let hoverFrame = 0;
let hoverPoint = null;
let hoveredRangeKey = '';
let pointerDownPoint = null;
let pointerDragged = false;
let scrollListenerInstalled = false;
let emphasisTimer = 0;
let activeRangeKey = '';
let manualActiveUntil = 0;
let followReadingPosition = true;
let showPublicUnderlines = true;
let sidebarVisible = true;
let publicReviewIndex = createEmptyIndex();
let popupReturnFocus = null;
let popupCleanups = [];
let readerCompatibility = null;
let enhancementEnabled = true;

export const setPublicReviewEnabled = enabled => {
  enhancementEnabled = Boolean(enabled);
  if (!enhancementEnabled) {
    invalidationCallback = null;
    setSidebarVisible(false);
    clearPublicReviewState();
    window.postMessage({ source: REQUEST_SOURCE, type: 'INVALIDATE_LAYOUT', reason: 'reader-mode-exited' }, '*');
  }
};

function createEmptyIndex(chapterUid = '') {
  return {
    chapterUid: String(chapterUid || ''),
    layoutVersion: null,
    reviewsById: new Map(),
    ranges: new Map(),
    reviews: new Map(),
    hitRects: [],
  };
}

const getReviewId = (review, entry, fallback = '') =>
  String(review?.reviewId || entry?.reviewId || fallback);

const createRequestId = () =>
  `wxrc-${Date.now()}-${++requestSequence}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

const removePopup = (restoreFocus = false) => {
  for (const cleanup of popupCleanups.splice(0)) cleanup();
  document.querySelectorAll(`.${POPUP_CLASS}`).forEach((node) => node.remove());
  const returnFocus = popupReturnFocus;
  popupReturnFocus = null;
  if (restoreFocus && returnFocus?.isConnected) {
    returnFocus.focus({ preventScroll: true });
  }
};

export const clearPublicUnderlines = () => {
  document.querySelectorAll(`.${LAYER_CLASS}`).forEach((node) => node.remove());
  removePopup();
};

const setActiveRange = (rangeKey) => {
  if (!sidebarVisible) {
    activeRangeKey = '';
    return;
  }
  if (rangeKey !== activeRangeKey && activeRangeKey) {
    document
      .querySelectorAll(`.comment-item[data-range-key="${activeRangeKey}"]`)
      .forEach((node) => {
        node.classList.remove(ACTIVE_CLASS);
        node.removeAttribute('aria-current');
      });
  }
  activeRangeKey = rangeKey || '';
  if (!activeRangeKey) return;

  const items = document.querySelectorAll(
    `.comment-item[data-range-key="${activeRangeKey}"]`
  );
  items.forEach((node) => {
    node.classList.add(ACTIVE_CLASS);
    node.setAttribute('aria-current', 'true');
  });
};

const clearPublicReviewIndex = (chapterUid = '') => {
  window.cancelAnimationFrame(scrollFrame);
  scrollFrame = 0;
  window.cancelAnimationFrame(hoverFrame);
  hoverFrame = 0;
  hoverPoint = null;
  setHoveredRange('');
  window.clearTimeout(emphasisTimer);
  emphasisTimer = 0;
  document
    .querySelectorAll(`.${EMPHASIS_CLASS}`)
    .forEach((node) => node.classList.remove(EMPHASIS_CLASS));
  setActiveRange('');
  manualActiveUntil = 0;
  publicReviewIndex = createEmptyIndex(chapterUid);
};

export const clearPublicReviewState = (chapterUid = '') => {
  readerCompatibility = null;
  renderGeneration += 1;
  activeChapterUid = String(chapterUid || '');
  clearPublicUnderlines();
  clearPublicReviewIndex(activeChapterUid);
};

const onPageMessage = (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== RESPONSE_SOURCE) return;

  if (message.type === 'LAYOUT_INVALIDATED') {
    if (!enhancementEnabled) return;
    renderGeneration += 1;
    clearPublicUnderlines();
    clearPublicReviewIndex(activeChapterUid);
    invalidationCallback?.(message.reason || 'page-layout');
    return;
  }

  if (
    !['PONG', 'RECTS_RESULT', 'CAPABILITIES_RESULT', 'TEXT_OPERATIONS_RESULT', 'TEXT_OPERATION_RESULT'].includes(message.type) ||
    typeof message.requestId !== 'string'
  ) {
    return;
  }
  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;
  pendingRequests.delete(message.requestId);
  window.clearTimeout(pending.timer);
  if (message.error) pending.reject(Object.assign(new Error(message.error), { code: message.errorCode }));
  else pending.resolve(message);
};

const sendPageRequest = (type, payload = {}) =>
  new Promise((resolve, reject) => {
    const requestId = createRequestId();
    const timer = window.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(Object.assign(new Error(`${type} timed out`), { code: 'BRIDGE_TIMEOUT' }));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, reject, timer });
    window.postMessage(
      { source: REQUEST_SOURCE, type, requestId, ...payload },
      '*'
    );
  });

const parseRange = (value) => {
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

const groupReviews = (entries, chapterUid) => {
  const groups = new Map();
  const invalidFailures = [];
  let invalidRangeCount = 0;
  for (const entry of entries) {
    const review = getReview(entry);
    const rangeValue = review.range || entry.range;
    const range = parseRange(rangeValue);
    if (!range) {
      invalidRangeCount += 1;
      if (invalidFailures.length < FAILURE_SAMPLE_LIMIT) {
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

const appendTextBlock = (parent, className, text) => {
  if (!text) return;
  const node = document.createElement('div');
  node.className = className;
  node.textContent = String(text);
  parent.appendChild(node);
};

const showPopup = (event, reviews, group) => {
  removePopup();
  const trigger = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : event.currentTarget ? null : document.activeElement;
  popupReturnFocus = trigger instanceof HTMLElement &&
    trigger.matches(`.${BADGE_CLASS}, .wxrc_public_review_wrapper`)
    ? trigger : null;
  const popup = document.createElement('div');
  popup.className = POPUP_CLASS;
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', '公开评论');
  popup.setAttribute('aria-modal', 'false');
  const toolbar = document.createElement('div');
  toolbar.className = 'wxrc_public_review_popup_toolbar';
  const count = document.createElement('span');
  count.textContent = `${reviews.length} 条公开想法`;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '关闭';
  close.setAttribute('aria-label', '关闭公开评论');
  close.addEventListener('click', () => removePopup(true));
  toolbar.append(count, close);
  popup.appendChild(toolbar);

  const reposition = () => {
    if (!popup.isConnected) return;
    const rect = popup.getBoundingClientRect();
    const position = positionPopup({ x: event.clientX, y: event.clientY },
      { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
    popup.style.left = `${position.left}px`; popup.style.top = `${position.top}px`;
  };
  if (group) {
    const operations = createNativeTextToolbar({ popup, group, request: sendPageRequest,
      close: () => removePopup(), reposition });
    popup.append(operations.toolbar, operations.quote, operations.status);
  }

  for (const review of reviews) {
    const item = document.createElement('div');
    item.className = 'wxrc_public_review_popup_item';
    const header = document.createElement('div');
    header.className = 'wxrc_public_review_popup_author';
    if (review.author?.avatar) {
      const avatar = document.createElement('img');
      avatar.src = review.author.avatar;
      avatar.alt = '';
      header.appendChild(avatar);
    }
    const name = document.createElement('span');
    name.textContent = review.author?.name || '微信读书用户';
    header.appendChild(name);
    item.appendChild(header);
    appendTextBlock(item, 'wxrc_public_review_popup_abstract', review.abstract);
    appendTextBlock(item, 'wxrc_public_review_popup_content', review.content);
    popupCleanups.push(appendReviewActions(item, String(review.reviewId || '')));
    popup.appendChild(item);
  }

  document.body.appendChild(popup);
  const popupRect = popup.getBoundingClientRect();
  const position = positionPopup(
    { x: event.clientX, y: event.clientY },
    { width: popupRect.width, height: popupRect.height },
    { width: window.innerWidth, height: window.innerHeight }
  );
  popup.style.left = `${position.left}px`;
  popup.style.top = `${position.top}px`;
  close.focus({ preventScroll: true });
};

const openGroupPopup = (event, group) => {
  event.preventDefault();
  event.stopPropagation();
  if (sidebarVisible) setActiveRange(group.key);
  showPopup(event, group.reviews, group);
};

const setHoveredRange = (rangeKey) => {
  if (rangeKey === hoveredRangeKey) return;
  publicReviewIndex.ranges.get(hoveredRangeKey)?.wrappers.forEach((node) =>
    node.classList.remove(HOVER_CLASS)
  );
  hoveredRangeKey = rangeKey || '';
  publicReviewIndex.ranges.get(hoveredRangeKey)?.wrappers.forEach((node) =>
    node.classList.add(HOVER_CLASS)
  );
};

const getRangeAtClientPoint = (clientX, clientY) => {
  if (!showPublicUnderlines || publicReviewIndex.chapterUid !== activeChapterUid) {
    return null;
  }
  const container = document.querySelector('.wr_canvasContainer');
  if (!container) return null;
  const box = container.getBoundingClientRect();
  const x = clientX - box.left;
  const y = clientY - box.top;
  if (x < 0 || y < 0 || x >= box.width || y >= box.height) return null;
  let best = null;
  for (const entry of publicReviewIndex.hitRects) {
    const { rect } = entry;
    if (x < rect.x || x >= rect.x + rect.w || y < rect.y || y >= rect.y + rect.h) {
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
  return best ? publicReviewIndex.ranges.get(best.rangeKey) : null;
};

const isNativeUnderlineAt = (clientX, clientY) =>
  Array.from(
    document.querySelectorAll(
      '.wr_underline_wrapper:not(.wxrc_public_review_wrapper)'
    )
  ).some((node) => {
    const box = node.getBoundingClientRect();
    return (
      box.width > 0 && box.height > 0 &&
      clientX >= box.left && clientX < box.right &&
      clientY >= box.top && clientY < box.bottom
    );
  });

const isReaderSurfaceTarget = (target) => {
  if (!(target instanceof Element)) return false;
  const container = document.querySelector('.wr_canvasContainer');
  const readerHost = container?.closest('.renderTargetContainer') || container;
  return Boolean(
    readerHost?.contains(target) &&
    !target.closest('.wr_float_panel_container, .wr_mask, .reader-font-control-panel-wrapper')
  );
};

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

const isNativeReaderInteraction = (event) => {
  const path = typeof event.composedPath === 'function'
    ? event.composedPath()
    : [event.target];
  return path.some((node) =>
    node instanceof Element && node.matches(NATIVE_READER_CONTROL_SELECTOR)
  );
};

const hasActiveTextSelection = () => {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim()) return true;
  const toolbar = document.querySelector('.reader_toolbar_container');
  const readerSelection = document.querySelector('.wr_selection');
  return Boolean(
    toolbar?.getClientRects().length &&
    readerSelection?.getClientRects().length &&
    getComputedStyle(toolbar).visibility !== 'hidden'
  );
};

const onDocumentPointerDown = (event) => {
  if (!enhancementEnabled) return;
  pointerDownPoint = event.button === 0
    ? { x: event.clientX, y: event.clientY }
    : null;
  pointerDragged = false;
};

const onDocumentPointerMoveCapture = (event) => {
  if (!enhancementEnabled) return;
  if (!pointerDownPoint || !(event.buttons & 1)) return;
  if (
    Math.abs(event.clientX - pointerDownPoint.x) > 5 ||
    Math.abs(event.clientY - pointerDownPoint.y) > 5
  ) pointerDragged = true;
};

const onDocumentClickCapture = (event) => {
  if (!enhancementEnabled) return;
  const wasDrag = pointerDragged;
  pointerDownPoint = null;
  pointerDragged = false;
  if (wasDrag) return;
  if (event.target instanceof Element && event.target.closest(`.${BADGE_CLASS}`)) return;
  if (isNativeReaderInteraction(event) || hasActiveTextSelection()) return;
  if (event.button !== 0 || !isReaderSurfaceTarget(event.target)) return;
  const group = getRangeAtClientPoint(event.clientX, event.clientY);
  if (!group || isNativeUnderlineAt(event.clientX, event.clientY)) return;
  openGroupPopup(event, group);
};

const updateHoverAtPoint = () => {
  hoverFrame = 0;
  if (!hoverPoint) return;
  const { x, y, target } = hoverPoint;
  if (!isReaderSurfaceTarget(target)) {
    setHoveredRange('');
    return;
  }
  const group = getRangeAtClientPoint(x, y);
  setHoveredRange(group && !isNativeUnderlineAt(x, y) ? group.key : '');
};

const onDocumentPointerMove = (event) => {
  if (!enhancementEnabled) return;
  hoverPoint = { x: event.clientX, y: event.clientY, target: event.target };
  if (!hoverFrame) hoverFrame = window.requestAnimationFrame(updateHoverAtPoint);
};

const createUnderline = (rect, group) => {
  const wrapper = document.createElement('div');
  wrapper.className = 'wr_underline_wrapper wxrc_public_review_wrapper';
  wrapper.dataset.reviewId = getReviewId(group.reviews[0], null, group.key);
  wrapper.dataset.rangeKey = group.key;
  wrapper.dataset.reviewCount = String(group.reviews.length);
  wrapper.title = `查看 ${group.reviews.length} 条公开想法`;
  wrapper.setAttribute('role', 'button');
  wrapper.setAttribute('tabindex', '0');
  wrapper.setAttribute('aria-label', `查看 ${group.reviews.length} 条公开想法`);
  Object.assign(wrapper.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
  });
  const underline = document.createElement('div');
  underline.className = 'wr_underline wr_underline_thought wxrc_public_review';
  wrapper.appendChild(underline);
  wrapper.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const box = wrapper.getBoundingClientRect();
      openGroupPopup({
        preventDefault: () => {},
        stopPropagation: () => event.stopPropagation(),
        clientX: box.left + box.width / 2,
        clientY: box.bottom,
      }, group);
    }
  });
  return wrapper;
};

const createOverlapBadge = (group, canvasSize, placedBadges) => {
  const lastRect = group.rects.reduce((last, rect) =>
    !last || rect.y > last.y || (rect.y === last.y && rect.x > last.x)
      ? rect : last, null);
  if (!lastRect) return null;
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = BADGE_CLASS;
  badge.dataset.rangeKey = group.key;
  badge.textContent = String(group.reviews.length);
  badge.title = `查看 ${group.reviews.length} 条公开想法`;
  badge.setAttribute('aria-label', badge.title);
  const width = badgeWidthForCount(group.reviews.length);
  const position = positionBadge(lastRect, canvasSize, { width, height: 18 }, placedBadges);
  placedBadges.push(position);
  badge.style.left = `${position.x}px`;
  badge.style.top = `${position.y}px`;
  badge.style.width = `${width}px`;
  badge.addEventListener('click', (event) => openGroupPopup(event, group));
  return badge;
};

const appendOverlapBadges = (index, layer, container, canvasSize) => {
  const canvasBox = container.getBoundingClientRect();
  const nativeRects = Array.from(document.querySelectorAll(
    '.wr_underline_wrapper:not(.wxrc_public_review_wrapper)'
  ), (node) => {
    const box = node.getBoundingClientRect();
    return {
      left: box.left - canvasBox.left,
      right: box.right - canvasBox.left,
      top: box.top - canvasBox.top,
      bottom: box.bottom - canvasBox.top,
    };
  });
  const placedBadges = [];
  for (const group of index.ranges.values()) {
    const overlaps = group.rects.some((rect) => nativeRects.some((native) =>
      Math.min(rect.x + rect.w, native.right) - Math.max(rect.x, native.left) > 2 &&
      Math.min(rect.y + rect.h, native.bottom) - Math.max(rect.y, native.top) > 2
    ));
    if (!overlaps) continue;
    const badge = createOverlapBadge(group, canvasSize, placedBadges);
    if (badge) layer.appendChild(badge);
  }
};

const selectNearestRange = () => {
  scrollFrame = 0;
  if (!followReadingPosition || !sidebarVisible) return;
  if (!publicReviewIndex.ranges.size) return;
  if (activeRangeKey && Date.now() < manualActiveUntil) return;
  const container = document.querySelector('.wr_canvasContainer');
  if (!container) return;
  const containerRect = container.getBoundingClientRect();
  const viewportTop = 70;
  const viewportBottom = window.innerHeight - 40;
  const viewportCenter = (viewportTop + viewportBottom) / 2;
  let best = null;
  let current = null;

  for (const [rangeKey, value] of publicReviewIndex.ranges) {
    let candidate = null;
    for (const rect of value.rects) {
      const top = containerRect.top + rect.y;
      const bottom = top + rect.h;
      const visible = bottom >= viewportTop && top <= viewportBottom;
      const score = Math.abs((top + bottom) / 2 - viewportCenter);
      if (
        !candidate ||
        (visible && !candidate.visible) ||
        (visible === candidate.visible && score < candidate.score)
      ) {
        candidate = { rangeKey, visible, score };
      }
    }
    if (!candidate) continue;
    if (rangeKey === activeRangeKey) current = candidate;
    if (
      !best ||
      (candidate.visible && !best.visible) ||
      (candidate.visible === best.visible && candidate.score < best.score)
    ) {
      best = candidate;
    }
  }

  if (!best) return;
  if (best.rangeKey === activeRangeKey) {
    setActiveRange(best.rangeKey);
    return;
  }
  const shouldSwitch =
    !current ||
    (best.visible && !current.visible) ||
    best.score + ACTIVE_SWITCH_THRESHOLD_PX < current.score;
  if (shouldSwitch) setActiveRange(best.rangeKey);
};

const scheduleScrollSync = () => {
  if (!followReadingPosition || !sidebarVisible) return;
  if (!scrollFrame) scrollFrame = window.requestAnimationFrame(selectNearestRange);
};

const updateSidebarScrollListener = () => {
  if (!initialized) return;
  const needed = sidebarVisible && followReadingPosition;
  if (needed && !scrollListenerInstalled) {
    window.addEventListener('scroll', scheduleScrollSync, { passive: true });
    scrollListenerInstalled = true;
  } else if (!needed && scrollListenerInstalled) {
    window.removeEventListener('scroll', scheduleScrollSync);
    scrollListenerInstalled = false;
  }
};

export const setFollowReadingPosition = (enabled) => {
  followReadingPosition = Boolean(enabled);
  updateSidebarScrollListener();
  if (followReadingPosition && sidebarVisible) scheduleScrollSync();
  else {
    window.cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    setActiveRange('');
  }
};

export const setSidebarVisible = (visible) => {
  const next = Boolean(visible);
  if (sidebarVisible && !next) setActiveRange('');
  sidebarVisible = next;
  updateSidebarScrollListener();
  if (sidebarVisible) scheduleScrollSync();
  else {
    window.cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    activeRangeKey = '';
  }
};

export const setPublicUnderlinesVisible = (visible) => {
  showPublicUnderlines = Boolean(visible);
  document.querySelectorAll(`.${LAYER_CLASS}`).forEach((layer) => {
    layer.hidden = !showPublicUnderlines;
  });
  if (!showPublicUnderlines) removePopup();
};

const emphasizeRange = (rangeKey) => {
  window.clearTimeout(emphasisTimer);
  document
    .querySelectorAll(`.${EMPHASIS_CLASS}`)
    .forEach((node) => node.classList.remove(EMPHASIS_CLASS));
  const wrappers = document.querySelectorAll(
    `.wxrc_public_review_wrapper[data-range-key="${rangeKey}"]`
  );
  wrappers.forEach((node) => node.classList.add(EMPHASIS_CLASS));
  emphasisTimer = window.setTimeout(() => {
    wrappers.forEach((node) => node.classList.remove(EMPHASIS_CLASS));
  }, 1600);
};

export const scrollToPublicReview = (reviewId) => {
  const mapped = publicReviewIndex.reviews.get(String(reviewId));
  const rect = mapped?.rects?.[0];
  const container = document.querySelector('.wr_canvasContainer');
  if (!mapped || !rect || !container) return false;
  const containerRect = container.getBoundingClientRect();
  const targetDocumentY = containerRect.top + window.scrollY + rect.y;
  manualActiveUntil = Date.now() + 1800;
  setActiveRange(mapped.rangeKey);
  emphasizeRange(mapped.rangeKey);
  window.scrollTo({
    top: Math.max(0, targetDocumentY - SCROLL_TOP_PADDING_PX),
    behavior: 'smooth',
  });
  return true;
};

export const getPublicReviewSyncProps = () => {
  const reviewRangeKeys = new Map();
  const rangeReviewCounts = new Map();
  for (const [reviewId, value] of publicReviewIndex.reviews) {
    reviewRangeKeys.set(reviewId, value.rangeKey);
  }
  for (const [rangeKey, value] of publicReviewIndex.ranges) {
    rangeReviewCounts.set(rangeKey, value.reviews.length);
  }
  return {
    compatibility: readerCompatibility,
    chapterUid: publicReviewIndex.chapterUid,
    layoutVersion: publicReviewIndex.layoutVersion,
    mappedReviewIds: new Set(publicReviewIndex.reviews.keys()),
    reviewRangeKeys,
    rangeReviewCounts,
    onReviewClick: scrollToPublicReview,
  };
};

export const initializePublicReviewUnderlines = (onInvalidated) => {
  invalidationCallback = onInvalidated;
  if (initialized) return;
  initialized = true;
  window.addEventListener('message', onPageMessage);
  window.addEventListener('resize', () => invalidatePublicReviewLayout('resize'));
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('pointermove', onDocumentPointerMoveCapture, true);
  document.addEventListener('click', onDocumentClickCapture, true);
  document.addEventListener('pointermove', onDocumentPointerMove, { passive: true });
  updateSidebarScrollListener();
  document.addEventListener('click', (event) => {
    if (isReviewDetailOpen()) return;
    if (
      !event.target.closest(`.${POPUP_CLASS}`) &&
      !event.target.closest('.wxrc_public_review_wrapper')
    ) {
      removePopup();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !isReviewDetailOpen() && document.querySelector(`.${POPUP_CLASS}`)) {
      event.preventDefault();
      event.stopPropagation();
      removePopup(true);
    }
  });
  window.addEventListener('scroll', () => { if (!isReviewDetailOpen()) removePopup(); }, { passive: true });
};

export const probePublicReviewCompatibility = async () => {
  const generation = renderGeneration;
  try {
    const response = await sendPageRequest('GET_CAPABILITIES');
    if (generation === renderGeneration) {
      readerCompatibility = response.capabilities?.mappingAvailable === true
        ? response.capabilities : compatibilityFailure(response.capabilities?.code || 'READER_INSPECTION_FAILED');
    }
  } catch (error) {
    if (generation === renderGeneration) readerCompatibility = compatibilityFailure(error.code || 'READER_INSPECTION_FAILED');
  }
};

export const invalidatePublicReviewLayout = (reason) => {
  if (!enhancementEnabled) return;
  renderGeneration += 1;
  clearPublicUnderlines();
  clearPublicReviewIndex(activeChapterUid);
  window.postMessage(
    { source: REQUEST_SOURCE, type: 'INVALIDATE_LAYOUT', reason },
    '*'
  );
  invalidationCallback?.(reason);
};

export const renderPublicReviewUnderlines = async (entries, chapterUid) => {
  const normalizedChapterUid = String(chapterUid);
  const generation = ++renderGeneration;
  activeChapterUid = normalizedChapterUid;
  clearPublicUnderlines();
  clearPublicReviewIndex(normalizedChapterUid);
  const { groups, invalidFailures, invalidRangeCount } = groupReviews(
    entries,
    normalizedChapterUid
  );
  const payload = Array.from(groups.values()).map((group) => ({
    reviewId: group.key,
    range: group.range.value,
    start: group.range.start,
    end: group.range.end,
  }));

  const emptyStats = {
    chapterUid: normalizedChapterUid,
    layoutVersion: null,
    reviewCount: entries.length,
    uniqueRangeCount: groups.size,
    invalidRangeCount,
    mappedRangeCount: 0,
    failedRangeCount: groups.size,
    renderedRectCount: 0,
    mappingCallCounts: null,
    failureCounts: {
      INVALID_RANGE: invalidRangeCount,
      NO_MATCHED_OBJECT: 0,
      MATCHED_BUT_NO_RECT: 0,
      OUTSIDE_CURRENT_LAYOUT: 0,
      OTHER: 0,
    },
    failedRangeSamples: invalidFailures,
  };
  if (!enhancementEnabled) return { ...emptyStats, staleDiscarded: true };
  try {
    const probe = await sendPageRequest('GET_CAPABILITIES');
    if (generation !== renderGeneration || activeChapterUid !== normalizedChapterUid) {
      return { ...emptyStats, staleDiscarded: true };
    }
    readerCompatibility = probe.capabilities?.mappingAvailable === true
      ? probe.capabilities : compatibilityFailure(probe.capabilities?.code || 'READER_INSPECTION_FAILED');
    if (!readerCompatibility.mappingAvailable) return { ...emptyStats, compatibility: readerCompatibility };
    if (payload.length === 0) return { ...emptyStats, compatibility: readerCompatibility };
    const response = await sendPageRequest('GET_RECTS_BATCH', {
      chapterUid: normalizedChapterUid,
      clientLayoutEpoch: generation,
      reviews: payload,
    });
    const responseChapterUid = String(response.chapterUid || '');
    const stale =
      generation !== renderGeneration ||
      activeChapterUid !== normalizedChapterUid ||
      responseChapterUid !== normalizedChapterUid ||
      response.clientLayoutEpoch !== generation ||
      !Number.isFinite(response.layoutVersion);
    if (stale) {
      const staleStats = {
        ...emptyStats,
        staleDiscarded: true,
        requestChapterUid: normalizedChapterUid,
        responseChapterUid,
        requestLayoutEpoch: generation,
        responseLayoutEpoch: response.clientLayoutEpoch,
        responseLayoutVersion: response.layoutVersion,
      };
      debugLog('Mapping', 'stale result discarded', staleStats);
      return staleStats;
    }

    const container = document.querySelector('.wr_canvasContainer');
    if (!container) throw new Error('.wr_canvasContainer was not found');
    const overlayHost = container.closest('.renderTargetContainer') || container;
    const containerRect = container.getBoundingClientRect();
    const hostRect = overlayHost.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = LAYER_CLASS;
    layer.hidden = !showPublicUnderlines;
    if (overlayHost !== container) {
      Object.assign(layer.style, {
        inset: 'auto',
        left: `${containerRect.left - hostRect.left + overlayHost.scrollLeft}px`,
        top: `${containerRect.top - hostRect.top + overlayHost.scrollTop}px`,
        width: `${containerRect.width}px`,
        height: `${containerRect.height}px`,
      });
    }
    const nextIndex = createEmptyIndex(normalizedChapterUid);
    nextIndex.layoutVersion = response.layoutVersion;
    for (const entry of entries) {
      const review = getReview(entry);
      const reviewId = getReviewId(review, entry);
      if (reviewId) nextIndex.reviewsById.set(reviewId, review);
    }

    let mappedRangeCount = 0;
    let renderedRectCount = 0;
    const failureCounts = { ...emptyStats.failureCounts };
    const failedRangeSamples = [...invalidFailures];
    for (const result of response.results || []) {
      const group = groups.get(result.reviewId);
      const rects = Array.isArray(result.rects) ? result.rects : [];
      if (!group || rects.length === 0) {
        const failureReason = result.failureReason || 'OTHER';
        failureCounts[failureReason] = (failureCounts[failureReason] || 0) + 1;
        if (group && failedRangeSamples.length < FAILURE_SAMPLE_LIMIT) {
          failedRangeSamples.push({
            range: group.range.value,
            abstract: group.reviews[0]?.abstract || '',
            chapterUid: normalizedChapterUid,
            matchedObjectCount: result.matchedObjectCount || 0,
            rectCount: result.rectCount || 0,
            failureReason,
          });
        }
        continue;
      }

      mappedRangeCount += 1;
      const rangeEntry = { key: group.key, range: group.range, reviews: group.reviews, rects, wrappers: [] };
      nextIndex.ranges.set(group.key, rangeEntry);
      for (const review of group.reviews) {
        const reviewId = getReviewId(review);
        if (reviewId) {
          nextIndex.reviews.set(reviewId, {
            review,
            rangeKey: group.key,
            rects,
          });
        }
      }
      for (const rect of rects) {
        const node = createUnderline(rect, group);
        layer.appendChild(node);
        rangeEntry.wrappers.push(node);
        nextIndex.hitRects.push({
          rangeKey: group.key,
          rect,
          area: rect.w * rect.h,
          rangeLength: group.range.end - group.range.start,
        });
        renderedRectCount += 1;
      }
    }

    if (
      generation !== renderGeneration ||
      activeChapterUid !== normalizedChapterUid
    ) {
      return { ...emptyStats, staleDiscarded: true };
    }
    publicReviewIndex = nextIndex;
    overlayHost.appendChild(layer);
    appendOverlapBadges(nextIndex, layer, container, {
      width: containerRect.width,
      height: containerRect.height,
    });
    scheduleScrollSync();
    window.setTimeout(scheduleScrollSync, 0);

    const stats = {
      chapterUid: normalizedChapterUid,
      layoutVersion: response.layoutVersion,
      reviewCount: entries.length,
      uniqueRangeCount: groups.size,
      invalidRangeCount,
      mappedRangeCount,
      failedRangeCount: groups.size - mappedRangeCount,
      renderedRectCount,
      mappingCallCounts: response.diagnostics || null,
      failureCounts,
      failedRangeSamples,
    };
    debugLog('Mapping', 'range mapping stats', stats);
    return stats;
  } catch (error) {
    if (generation !== renderGeneration || activeChapterUid !== normalizedChapterUid) {
      return { ...emptyStats, staleDiscarded: true };
    }
    clearPublicUnderlines();
    clearPublicReviewIndex(normalizedChapterUid);
    readerCompatibility = compatibilityFailure(error.code || 'READER_MAPPING_FAILED');
    const failedStats = { ...emptyStats, error: String(error), compatibility: readerCompatibility };
    console.warn(
      '[WxReadComments][Phase4.5] underline render failed',
      failedStats.error
    );
    debugLog('Mapping', 'failed range stats', failedStats);
    return failedStats;
  }
};
