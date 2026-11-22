import { getReview } from './utils';
import { debugLog } from './debug';
import { badgeWidthForCount, positionBadge } from './popupBadgeLayout';
import { compatibilityFailure } from './readerCompatibility';
import { isReviewDetailOpen } from './reviewInteractions';
import { createPopupBrowsingMemory } from './commentBrowsing';
import {
  chooseReadingAnchor,
  anchorScrollTop,
  getNavigationVersion,
  installNavigationTracking,
  shortcutOperation,
} from './readingNavigation';
import { closeFavorites } from './favorites';
import { createBridgeClient } from './bridgeClient';
import {
  FAILURE_SAMPLE_LIMIT,
  createEmptyIndex,
  getReviewId,
  groupReviews,
  getRangeAtClientPoint,
  isNativeUnderlineAt,
  isReaderSurfaceTarget,
  isNativeReaderInteraction,
  hasActiveTextSelection,
  buildSyncProps,
} from './reviewIndex';
import {
  POPUP_CLASS,
  BADGE_CLASS,
  createPopupController,
} from './popupRenderer';

const LAYER_CLASS = 'wxrc_public_review_layer';
const ACTIVE_CLASS = 'wxrc_comment_active';
const EMPHASIS_CLASS = 'wxrc_public_review_emphasis';
const HOVER_CLASS = 'wxrc_public_review_hover';
const ACTIVE_SWITCH_THRESHOLD_PX = 80;
const SCROLL_TOP_PADDING_PX = 120;

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
let readerCompatibility = null;
let enhancementEnabled = true;
let keyboardShortcuts = false;
let pendingReadingAnchor = null;
let readingRestoreTimer = 0;

const popupBrowsingMemory = createPopupBrowsingMemory();

const readingGeometry = () =>
  new Map(
    Array.from(publicReviewIndex.ranges, ([key, group]) => [
      key,
      {
        rects: group.wrappers.map((node) => {
          const rect = node.getBoundingClientRect();
          return { y: rect.top, h: rect.height };
        }),
      },
    ])
  );

const rememberReadingAnchor = (force = false) => {
  if (
    !force &&
    pendingReadingAnchor &&
    pendingReadingAnchor.navigation === getNavigationVersion() &&
    Date.now() - pendingReadingAnchor.time < 2500
  ) {
    return;
  }
  const anchor = chooseReadingAnchor(readingGeometry(), 0, window.innerHeight);
  pendingReadingAnchor = anchor
    ? {
        ...anchor,
        chapter: activeChapterUid,
        navigation: getNavigationVersion(),
        time: Date.now(),
        sidebar: document.querySelector('.comment-react-wrapper'),
        sidebarTop: document.querySelector('.comment-react-wrapper')?.scrollTop,
      }
    : null;
};

export const setKeyboardShortcuts = (enabled) => {
  keyboardShortcuts = Boolean(enabled);
};

export const prepareReadingPosition = () => rememberReadingAnchor(true);

const setHoveredRange = (rangeKey) => {
  if (rangeKey === hoveredRangeKey) return;
  publicReviewIndex.ranges
    .get(hoveredRangeKey)
    ?.wrappers.forEach((node) => node.classList.remove(HOVER_CLASS));
  hoveredRangeKey = rangeKey || '';
  publicReviewIndex.ranges
    .get(hoveredRangeKey)
    ?.wrappers.forEach((node) => node.classList.add(HOVER_CLASS));
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

  document
    .querySelectorAll(`.comment-item[data-range-key="${activeRangeKey}"]`)
    .forEach((node) => {
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

const bridge = createBridgeClient({
  onLayoutInvalidated: (reason) => {
    if (!enhancementEnabled) return;
    rememberReadingAnchor();
    renderGeneration += 1;
    clearPublicUnderlines();
    clearPublicReviewIndex(activeChapterUid);
    invalidationCallback?.(reason);
  },
});

const popupController = createPopupController({
  sendRequest: bridge.sendRequest,
  popupBrowsingMemory,
});

export const clearPublicUnderlines = () => {
  document.querySelectorAll(`.${LAYER_CLASS}`).forEach((node) => node.remove());
  popupController.removePopup();
};

export const setPublicReviewEnabled = (enabled) => {
  enhancementEnabled = Boolean(enabled);
  if (!enhancementEnabled) {
    invalidationCallback = null;
    setSidebarVisible(false);
    clearPublicReviewState();
    bridge.postInvalidateLayout('reader-mode-exited');
  }
};

export const clearPublicReviewState = (chapterUid = '') => {
  closeFavorites();
  readerCompatibility = null;
  renderGeneration += 1;
  activeChapterUid = String(chapterUid || '');
  clearPublicUnderlines();
  popupBrowsingMemory.clear();
  pendingReadingAnchor = null;
  window.clearTimeout(readingRestoreTimer);
  clearPublicReviewIndex(activeChapterUid);
};

const openGroupPopup = (event, group) => {
  event.preventDefault();
  event.stopPropagation();
  if (sidebarVisible) setActiveRange(group.key);
  popupController.showPopup(event, group.reviews, group);
};

const onDocumentPointerDown = (event) => {
  if (!enhancementEnabled) return;
  pointerDownPoint =
    event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  pointerDragged = false;
};

const onDocumentPointerMoveCapture = (event) => {
  if (!enhancementEnabled) return;
  if (!pointerDownPoint || !(event.buttons & 1)) return;
  if (
    Math.abs(event.clientX - pointerDownPoint.x) > 5 ||
    Math.abs(event.clientY - pointerDownPoint.y) > 5
  ) {
    pointerDragged = true;
  }
};

const onDocumentClickCapture = (event) => {
  if (!enhancementEnabled) return;
  const wasDrag = pointerDragged;
  pointerDownPoint = null;
  pointerDragged = false;
  if (wasDrag) return;
  if (event.target instanceof Element && event.target.closest(`.${BADGE_CLASS}`)) {
    return;
  }
  if (isNativeReaderInteraction(event) || hasActiveTextSelection()) return;
  if (event.button !== 0 || !isReaderSurfaceTarget(event.target)) return;
  const group = getRangeAtClientPoint(publicReviewIndex, {
    clientX: event.clientX,
    clientY: event.clientY,
    showPublicUnderlines,
    activeChapterUid,
  });
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
  const group = getRangeAtClientPoint(publicReviewIndex, {
    clientX: x,
    clientY: y,
    showPublicUnderlines,
    activeChapterUid,
  });
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
      openGroupPopup(
        {
          preventDefault: () => {},
          stopPropagation: () => event.stopPropagation(),
          clientX: box.left + box.width / 2,
          clientY: box.bottom,
        },
        group
      );
    }
  });
  return wrapper;
};

const createOverlapBadge = (group, canvasSize, placedBadges) => {
  const lastRect = group.rects.reduce(
    (last, rect) =>
      !last || rect.y > last.y || (rect.y === last.y && rect.x > last.x)
        ? rect
        : last,
    null
  );
  if (!lastRect) return null;

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = BADGE_CLASS;
  badge.dataset.rangeKey = group.key;
  badge.textContent = String(group.reviews.length);
  badge.title = `查看 ${group.reviews.length} 条公开想法`;
  badge.setAttribute('aria-label', badge.title);

  const width = badgeWidthForCount(group.reviews.length);
  const position = positionBadge(
    lastRect,
    canvasSize,
    { width, height: 18 },
    placedBadges
  );
  placedBadges.push(position);
  badge.style.left = `${position.x}px`;
  badge.style.top = `${position.y}px`;
  badge.style.width = `${width}px`;
  badge.addEventListener('click', (event) => openGroupPopup(event, group));
  return badge;
};

const appendOverlapBadges = (index, layer, container, canvasSize) => {
  const canvasBox = container.getBoundingClientRect();
  const nativeRects = Array.from(
    document.querySelectorAll(
      '.wr_underline_wrapper:not(.wxrc_public_review_wrapper)'
    ),
    (node) => {
      const box = node.getBoundingClientRect();
      return {
        left: box.left - canvasBox.left,
        right: box.right - canvasBox.left,
        top: box.top - canvasBox.top,
        bottom: box.bottom - canvasBox.top,
      };
    }
  );

  const placedBadges = [];
  for (const group of index.ranges.values()) {
    const overlaps = group.rects.some((rect) =>
      nativeRects.some(
        (native) =>
          Math.min(rect.x + rect.w, native.right) - Math.max(rect.x, native.left) >
            2 &&
          Math.min(rect.y + rect.h, native.bottom) - Math.max(rect.y, native.top) >
            2
      )
    );
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
  if (!showPublicUnderlines) popupController.removePopup();
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

export const getPublicReviewSyncProps = () =>
  buildSyncProps(publicReviewIndex, readerCompatibility, scrollToPublicReview);

export const initializePublicReviewUnderlines = (onInvalidated) => {
  invalidationCallback = onInvalidated;
  if (initialized) return;
  initialized = true;
  installNavigationTracking();
  bridge.install();
  window.addEventListener('resize', () => invalidatePublicReviewLayout('resize'));
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        enhancementEnabled &&
        event.target?.closest?.('.reader_font_control_slider_wrapper')
      ) {
        rememberReadingAnchor(true);
      }
    },
    true
  );
  document.addEventListener('pointermove', onDocumentPointerMoveCapture, true);
  document.addEventListener('click', onDocumentClickCapture, true);
  document.addEventListener('pointermove', onDocumentPointerMove, {
    passive: true,
  });
  updateSidebarScrollListener();

  document.addEventListener('click', (event) => {
    if (isReviewDetailOpen()) return;
    if (
      !event.target.closest(`.${POPUP_CLASS}`) &&
      !event.target.closest('.wxrc_public_review_wrapper')
    ) {
      popupController.removePopup();
    }
  });

  document.addEventListener('keydown', (event) => {
    const operation = shortcutOperation(event);
    const nativeMaskVisible =
      operation &&
      Array.from(document.querySelectorAll('.wr_mask_Show')).some((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.left < window.innerWidth &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight
        );
      });
    if (
      keyboardShortcuts &&
      enhancementEnabled &&
      operation &&
      !isReviewDetailOpen() &&
      !nativeMaskVisible &&
      !event.target?.closest?.(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .readerNotePanel, .wr_float_panel_container, .reader-font-control-panel-wrapper, .wxrc_favorites_dialog'
      ) &&
      !hasActiveTextSelection()
    ) {
      if (operation === 'copy') {
        const copy = document.querySelector(
          `.${POPUP_CLASS} [data-operation="copy"]`
        );
        if (copy && !copy.disabled) {
          event.preventDefault();
          copy.click();
        }
      } else {
        const nearest = chooseReadingAnchor(
          readingGeometry(),
          0,
          window.innerHeight
        );
        const group = nearest && publicReviewIndex.ranges.get(nearest.key);
        const trigger =
          group?.wrappers?.[nearest.index] || group?.wrappers?.[0];
        if (trigger && showPublicUnderlines) {
          event.preventDefault();
          trigger.focus({ preventScroll: true });
          const box = trigger.getBoundingClientRect();
          popupController.showPopup(
            { currentTarget: trigger, clientX: box.left, clientY: box.bottom },
            group.reviews,
            group
          );
        }
      }
    }
    if (
      event.key === 'Escape' &&
      !isReviewDetailOpen() &&
      document.querySelector(`.${POPUP_CLASS}`)
    ) {
      event.preventDefault();
      event.stopPropagation();
      popupController.removePopup(true);
    }
  });

  window.addEventListener(
    'scroll',
    () => {
      if (!isReviewDetailOpen()) popupController.removePopup();
    },
    { passive: true }
  );
};

export const probePublicReviewCompatibility = async () => {
  const generation = renderGeneration;
  try {
    const response = await bridge.sendRequest('GET_CAPABILITIES');
    if (generation === renderGeneration) {
      readerCompatibility =
        response.capabilities?.mappingAvailable === true
          ? response.capabilities
          : compatibilityFailure(
              response.capabilities?.code || 'READER_INSPECTION_FAILED'
            );
    }
  } catch (error) {
    if (generation === renderGeneration) {
      readerCompatibility = compatibilityFailure(
        error.code || 'READER_INSPECTION_FAILED'
      );
    }
  }
};

export const invalidatePublicReviewLayout = (reason) => {
  if (!enhancementEnabled) return;
  rememberReadingAnchor();
  renderGeneration += 1;
  clearPublicUnderlines();
  clearPublicReviewIndex(activeChapterUid);
  bridge.postInvalidateLayout(reason);
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
    const probe = await bridge.sendRequest('GET_CAPABILITIES');
    if (
      generation !== renderGeneration ||
      activeChapterUid !== normalizedChapterUid
    ) {
      return { ...emptyStats, staleDiscarded: true };
    }
    readerCompatibility =
      probe.capabilities?.mappingAvailable === true
        ? probe.capabilities
        : compatibilityFailure(
            probe.capabilities?.code || 'READER_INSPECTION_FAILED'
          );
    if (!readerCompatibility.mappingAvailable) {
      return { ...emptyStats, compatibility: readerCompatibility };
    }
    if (payload.length === 0) {
      return { ...emptyStats, compatibility: readerCompatibility };
    }

    const response = await bridge.sendRequest('GET_RECTS_BATCH', {
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
      const rangeEntry = {
        key: group.key,
        range: group.range,
        reviews: group.reviews,
        rects,
        wrappers: [],
      };
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

    const anchor = pendingReadingAnchor;
    window.clearTimeout(readingRestoreTimer);
    if (anchor) {
      readingRestoreTimer = window.setTimeout(() => {
        if (
          pendingReadingAnchor !== anchor ||
          generation !== renderGeneration
        ) {
          return;
        }
        pendingReadingAnchor = null;
        if (
          anchor.chapter !== activeChapterUid ||
          anchor.navigation !== getNavigationVersion() ||
          Date.now() - anchor.time >= 2500
        ) {
          return;
        }
        const top = anchorScrollTop(
          anchor,
          readingGeometry(),
          window.scrollY
        );
        if (top !== null && Math.abs(top - window.scrollY) > 1) {
          window.scrollTo({ top, behavior: 'instant' });
        }
        if (anchor.sidebar?.isConnected) {
          anchor.sidebar.scrollTop = anchor.sidebarTop;
        }
      }, 350);
    }

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
    if (
      generation !== renderGeneration ||
      activeChapterUid !== normalizedChapterUid
    ) {
      return { ...emptyStats, staleDiscarded: true };
    }
    clearPublicUnderlines();
    clearPublicReviewIndex(normalizedChapterUid);
    readerCompatibility = compatibilityFailure(
      error.code || 'READER_MAPPING_FAILED'
    );
    const failedStats = {
      ...emptyStats,
      error: String(error),
      compatibility: readerCompatibility,
    };
    console.warn(
      '[WxReadComments][Phase4.5] underline render failed',
      failedStats.error
    );
    debugLog('Mapping', 'failed range stats', failedStats);
    return failedStats;
  }
};
