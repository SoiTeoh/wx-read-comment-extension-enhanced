const REQUEST_SOURCE = 'WXRC';
const RESPONSE_SOURCE = 'WXRC_PAGE';
const MAX_BATCH_SIZE = 1000;

let cachedReader = null;
let cachedRenderContents = null;
let cachedChapterUid = '';
let cachedRenderVersion = null;
let bridgeLayoutVersion = 0;
let lastLayoutSignature = '';
let capturedWebpackRequire = null;
const capturedVueInstances = [];
const mappingDiagnostics = {
  batchCalls: 0,
  findObjsInOffsetRangeCalls: 0,
  getRectsByContentObjsCalls: 0,
};

const installWebpackRuntimeCapture = () => {
  let webpackJsonpValue = window.webpackJsonp;
  const prepareJsonpArray = (array) => {
    if (!Array.isArray(array) || array.__wxrcWebpackCaptureInstalled) {
      return array;
    }
    Object.defineProperty(array, '__wxrcWebpackCaptureInstalled', {
      value: true,
    });
    const wrapModules = (payload) => {
      const modules = payload?.[1];
      if (!modules || typeof modules !== 'object') return;
      for (const moduleId of Object.keys(modules)) {
        const factory = modules[moduleId];
        if (typeof factory !== 'function' || factory.__wxrcWrapped) continue;
        const wrappedFactory = function (...args) {
          if (typeof args[2] === 'function') capturedWebpackRequire = args[2];
          const result = factory.apply(this, args);
          const moduleExports = args[0]?.exports;
          const candidates = [moduleExports];
          try {
            if (moduleExports?.default) candidates.push(moduleExports.default);
          } catch (_error) {
            // Ignore harmony getters that are not initialized yet.
          }
          for (const candidate of candidates) {
            if (
              typeof candidate === 'function' &&
              candidate.version &&
              typeof candidate.prototype?._init === 'function' &&
              !candidate.prototype._init.__wxrcWrapped
            ) {
              const originalInit = candidate.prototype._init;
              const wrappedInit = function (...initArgs) {
                capturedVueInstances.push(this);
                if (capturedVueInstances.length > 2000) capturedVueInstances.shift();
                return originalInit.apply(this, initArgs);
              };
              Object.defineProperty(wrappedInit, '__wxrcWrapped', { value: true });
              candidate.prototype._init = wrappedInit;
            }
          }
          return result;
        };
        Object.defineProperty(wrappedFactory, '__wxrcWrapped', { value: true });
        modules[moduleId] = wrappedFactory;
      }
    };
    for (const payload of array) wrapModules(payload);
    let currentPush = function (...payloads) {
      for (const payload of payloads) wrapModules(payload);
      return Array.prototype.push.apply(array, payloads);
    };
    Object.defineProperty(array, 'push', {
      configurable: true,
      get() {
        return currentPush;
      },
      set(nextPush) {
        currentPush = function (...payloads) {
          for (const payload of payloads) wrapModules(payload);
          return nextPush.apply(array, payloads);
        };
      },
    });
    return array;
  };

  Object.defineProperty(window, 'webpackJsonp', {
    configurable: true,
    get() {
      return webpackJsonpValue;
    },
    set(value) {
      webpackJsonpValue = prepareJsonpArray(value);
    },
  });
  if (webpackJsonpValue) webpackJsonpValue = prepareJsonpArray(webpackJsonpValue);
};

installWebpackRuntimeCapture();

const normalizeChapterUid = (value) =>
  value === null || typeof value === 'undefined' ? '' : String(value);

const getReaderChapterUid = (reader) =>
  normalizeChapterUid(
    reader?.currentChapterUid || reader?.currentChapter?.chapterUid
  );

const isReader = (value) =>
  value &&
  typeof value.handleClickUnderline === 'function' &&
  typeof value.findObjsInOffsetRange === 'function' &&
  typeof value.getRectsByContentObjs === 'function';

const findReaderInVueTree = (seeds) => {
  const queue = seeds.filter(Boolean);
  const seen = new Set();
  let visited = 0;
  while (queue.length && visited < 500) {
    const candidate = queue.shift();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    visited += 1;
    if (isReader(candidate)) return candidate;
    if (candidate.$parent) queue.push(candidate.$parent);
    if (Array.isArray(candidate.$children)) queue.push(...candidate.$children);
  }
  return null;
};

const captureWebpackRequire = () => {
  if (capturedWebpackRequire) return capturedWebpackRequire;
  if (typeof window.webpackJsonp?.push !== 'function') return null;
  let webpackRequire = null;
  try {
    window.webpackJsonp.push([
      [`wxrc_${Date.now()}`],
      {},
      (runtimeRequire) => {
        webpackRequire = runtimeRequire;
        capturedWebpackRequire = runtimeRequire;
      },
    ]);
  } catch (_error) {
    return null;
  }
  return webpackRequire;
};

const findReader = () => {
  if (isReader(cachedReader) && !cachedReader._isDestroyed) return cachedReader;

  const seeds = [];
  for (const selector of [
    '#app',
    '.readerContent',
    '.wr_canvasContainer',
    '.readerControls',
  ]) {
    const element = document.querySelector(selector);
    if (element?.__vue__) seeds.push(element.__vue__);
  }

  let reader = findReaderInVueTree([
    ...seeds,
    ...capturedVueInstances.slice().reverse(),
  ]);
  if (!reader) {
    const webpackRequire = captureWebpackRequire();
    let vm = webpackRequire?.c?.['1380']?.exports?.__ob__?.dep?.subs?.[0]?.vm;
    while (vm && vm.$options?.name !== 'reader') vm = vm.$parent;
    reader = findReaderInVueTree([vm]);
  }
  cachedReader = reader;
  return reader;
};

const invalidateLayout = (reason, notify = true) => {
  bridgeLayoutVersion += 1;
  cachedRenderContents = null;
  cachedChapterUid = '';
  cachedRenderVersion = null;
  if (notify) {
    window.postMessage(
      { source: RESPONSE_SOURCE, type: 'LAYOUT_INVALIDATED', reason },
      '*'
    );
  }
};

const captureRenderContents = (chapterUid, probeRange) => {
  const reader = findReader();
  if (!reader) throw new Error('Reader runtime is unavailable');

  const actualChapterUid = getReaderChapterUid(reader);
  if (actualChapterUid && actualChapterUid !== normalizeChapterUid(chapterUid)) {
    throw new Error(
      `Reader chapter mismatch: expected ${chapterUid}, got ${actualChapterUid}`
    );
  }

  const start = probeRange?.start ?? 0;
  const end = probeRange?.end ?? start + 1;
  const originalFind = reader.findObjsInOffsetRange;
  const originalToolbar = reader.showSelectionToolBar;
  let captured = null;

  try {
    reader.findObjsInOffsetRange = function (
      renderContents,
      rangeStart,
      rangeEnd,
      rangeChapterUid
    ) {
      if (Array.isArray(renderContents)) captured = renderContents;
      return originalFind.call(
        this,
        renderContents,
        rangeStart,
        rangeEnd,
        rangeChapterUid
      );
    };
    reader.showSelectionToolBar = () => {};
    reader.handleClickUnderline({ notes: [], range: { start, end } });
  } finally {
    reader.findObjsInOffsetRange = originalFind;
    reader.showSelectionToolBar = originalToolbar;
  }

  if (!Array.isArray(captured) || captured.length === 0) {
    throw new Error('Current renderContents could not be captured');
  }
  cachedReader = reader;
  cachedRenderContents = captured;
  cachedChapterUid = normalizeChapterUid(chapterUid);
  cachedRenderVersion = reader.renderContentsVersion;
  bridgeLayoutVersion += 1;
  return captured;
};

const numberFrom = (object, keys, methods) => {
  for (const key of keys) {
    if (typeof object?.[key] === 'number') return object[key];
  }
  for (const method of methods) {
    if (typeof object?.[method] === 'function') {
      const value = object[method]();
      if (typeof value === 'number') return value;
    }
  }
  return null;
};

const serializeRect = (rect) => ({
  x: numberFrom(rect, ['x', 'left'], ['getX', 'getLeft']),
  y: numberFrom(rect, ['y', 'top'], ['getY', 'getTop']),
  w: numberFrom(rect, ['w', 'width'], ['getWidth']),
  h: numberFrom(rect, ['h', 'height'], ['getHeight']),
});

const isValidRequestItem = (item) =>
  item &&
  typeof item.reviewId === 'string' &&
  Number.isFinite(item.start) &&
  Number.isFinite(item.end) &&
  item.start >= 0 &&
  item.end > item.start;

const getRectsForReviews = (chapterUid, reviews) => {
  mappingDiagnostics.batchCalls += 1;
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return {
      results: [],
      chapterUid: normalizeChapterUid(chapterUid),
      layoutVersion: bridgeLayoutVersion,
      diagnostics: { ...mappingDiagnostics },
    };
  }
  if (reviews.length > MAX_BATCH_SIZE) throw new Error('Review batch is too large');
  if (!reviews.every(isValidRequestItem)) throw new Error('Invalid review range batch');

  const reader = findReader();
  if (!reader) throw new Error('Reader runtime is unavailable');
  const normalizedChapterUid = normalizeChapterUid(chapterUid);
  const renderVersionChanged =
    cachedRenderVersion !== null &&
    reader.renderContentsVersion !== cachedRenderVersion;
  if (
    !cachedRenderContents ||
    cachedChapterUid !== normalizedChapterUid ||
    renderVersionChanged
  ) {
    captureRenderContents(normalizedChapterUid, reviews[0]);
  }

  const offsets = cachedRenderContents
    .filter((item) => item && typeof item.getOffset === 'function')
    .map((item) => item.getOffset());
  const minOffset = offsets.length ? offsets[0] : null;
  const maxOffset = offsets.length ? offsets[offsets.length - 1] : null;
  const layoutBounds = {
    renderContentCount: cachedRenderContents.length,
    minOffset,
    maxOffset,
  };
  const results = reviews.map((review) => {
    try {
      mappingDiagnostics.findObjsInOffsetRangeCalls += 1;
      const objects = reader.findObjsInOffsetRange(
        cachedRenderContents,
        review.start,
        review.end
      );
      mappingDiagnostics.getRectsByContentObjsCalls += 1;
      const rects = reader
        .getRectsByContentObjs(objects)
        .map(serializeRect)
        .filter(
          (rect) =>
            [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) &&
            rect.w > 0 &&
            rect.h > 0
        );
      let failureReason = null;
      if (objects.length === 0) {
        failureReason =
          minOffset !== null &&
          maxOffset !== null &&
          (review.end <= minOffset || review.start > maxOffset)
            ? 'OUTSIDE_CURRENT_LAYOUT'
            : 'NO_MATCHED_OBJECT';
      } else if (rects.length === 0) {
        failureReason = 'MATCHED_BUT_NO_RECT';
      }
      return {
        reviewId: review.reviewId,
        range: review.range,
        rects,
        matchedObjectCount: objects.length,
        rectCount: rects.length,
        failureReason,
      };
    } catch (error) {
      return {
        reviewId: review.reviewId,
        range: review.range,
        rects: [],
        matchedObjectCount: 0,
        rectCount: 0,
        failureReason: 'OTHER',
        error: String(error),
      };
    }
  });
  return {
    results,
    chapterUid: getReaderChapterUid(reader) || normalizedChapterUid,
    layoutVersion: bridgeLayoutVersion,
    diagnostics: { ...mappingDiagnostics },
    layoutBounds,
  };
};

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== REQUEST_SOURCE) return;
  if (typeof message.type !== 'string') return;
  if (
    message.type !== 'INVALIDATE_LAYOUT' &&
    (typeof message.requestId !== 'string' || !message.requestId)
  ) {
    return;
  }

  if (message.type === 'INVALIDATE_LAYOUT') {
    invalidateLayout(message.reason || 'content-script', false);
    return;
  }
  if (message.type === 'PING') {
    window.postMessage(
      {
        source: RESPONSE_SOURCE,
        type: 'PONG',
        requestId: message.requestId,
      },
      '*'
    );
    return;
  }
  if (message.type !== 'GET_RECTS_BATCH') return;

  try {
    const mapped = getRectsForReviews(message.chapterUid, message.reviews);
    window.postMessage(
      {
        source: RESPONSE_SOURCE,
        type: 'RECTS_RESULT',
        requestId: message.requestId,
        chapterUid: mapped.chapterUid,
        layoutVersion: mapped.layoutVersion,
        clientLayoutEpoch: message.clientLayoutEpoch,
        diagnostics: mapped.diagnostics,
        layoutBounds: mapped.layoutBounds,
        results: mapped.results,
      },
      '*'
    );
  } catch (error) {
    window.postMessage(
      {
        source: RESPONSE_SOURCE,
        type: 'RECTS_RESULT',
        requestId: message.requestId,
        chapterUid: normalizeChapterUid(message.chapterUid),
        layoutVersion: null,
        clientLayoutEpoch: message.clientLayoutEpoch,
        results: [],
        error: String(error),
      },
      '*'
    );
  }
});

const getLayoutSignature = () => {
  const reader = findReader();
  const container = document.querySelector('.wr_canvasContainer');
  if (!reader || !container) return '';
  return [
    getReaderChapterUid(reader),
    reader.renderContentsVersion,
    container.clientWidth,
    container.clientHeight,
  ].join(':');
};

window.setInterval(() => {
  const signature = getLayoutSignature();
  if (!signature) return;
  if (lastLayoutSignature && signature !== lastLayoutSignature) {
    invalidateLayout('reader-layout-changed');
  }
  lastLayoutSignature = signature;
}, 500);

window.addEventListener('resize', () => invalidateLayout('window-resize'));
window.postMessage({ source: RESPONSE_SOURCE, type: 'BRIDGE_READY' }, '*');
