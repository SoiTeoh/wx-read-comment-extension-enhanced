import { captureReaderRenderContents, detectReaderCapabilities, readerError } from './readerCompatibility';
import { observeNativeOperations } from './nativeOperationBaseline';
import { getReaderMode, readVerticalSelection } from './readerMode';
import { createTextOperationSession } from './nativeTextOperations';
import { createReviewOperations } from './nativeReviewOperations';

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
let lastReaderMode = '';
let lastReaderBookId = '';
let observedReader = null;
let nativeSelection = null;
const readerObserverRestorations = [];
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
          try {
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
          } catch (_error) {
            // Observing or wrapping an incompatible export must not break its native factory.
          }
          return result;
        };
        Object.defineProperty(wrappedFactory, '__wxrcWrapped', { value: true });
        try { modules[moduleId] = wrappedFactory; } catch (_error) { /* Frozen factories remain untouched. */ }
      }
    };
    const safeWrapModules = (payload) => {
      try { wrapModules(payload); } catch (_error) { /* Native payload processing takes priority. */ }
    };
    for (const payload of array) safeWrapModules(payload);
    const originalPush = array.push;
    let currentPush = function (...payloads) {
      for (const payload of payloads) safeWrapModules(payload);
      return originalPush.apply(array, payloads);
    };
    Object.defineProperty(array, 'push', {
      configurable: true,
      get() {
        return currentPush;
      },
      set(nextPush) {
        if (typeof nextPush !== 'function') { currentPush = nextPush; return; }
        currentPush = function (...payloads) {
          for (const payload of payloads) safeWrapModules(payload);
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
      try { webpackJsonpValue = prepareJsonpArray(value); }
      catch (_error) { webpackJsonpValue = value; }
    },
  });
  if (webpackJsonpValue) webpackJsonpValue = prepareJsonpArray(webpackJsonpValue);
};

try {
  installWebpackRuntimeCapture();
} catch (_error) {
  // A frozen or changed webpack global must never prevent the native page from loading.
}

const normalizeChapterUid = (value) =>
  value === null || typeof value === 'undefined' ? '' : String(value);

const getReaderChapterUid = (reader) =>
  normalizeChapterUid(
    reader?.currentChapterUid ?? reader?.currentChapter?.chapterUid
  );

const isReader = (value) =>
  value &&
  !value._isDestroyed &&
  value.$el?.isConnected !== false &&
  (value.$options?.name === 'reader' || value.$options?.name === 'HorizontalReader' ||
    READER_DISCOVERY_METHODS.every((key) => typeof value[key] === 'function'));

const READER_DISCOVERY_METHODS = ['handleClickUnderline', 'findObjsInOffsetRange'];

const findReaderInVueTree = (seeds) => {
  const queue = seeds.filter(Boolean);
  const seen = new Set();
  let visited = 0;
  while (queue.length && visited < 500) {
    const candidate = queue.shift();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    visited += 1;
    try {
      if (isReader(candidate)) return candidate;
      if (candidate.$parent) queue.push(candidate.$parent);
      if (Array.isArray(candidate.$children)) queue.push(...candidate.$children);
    } catch (_error) {
      // Ignore incompatible Vue instances and throwing getters.
    }
  }
  return null;
};

const captureWebpackRequire = () => {
  if (capturedWebpackRequire) return capturedWebpackRequire;
  if (typeof window.webpackJsonp?.push !== 'function') return null;
  let webpackRequire = null;
  try {
    const id = `wxrc_probe_${Date.now()}`;
    window.webpackJsonp.push([[id], {
      [id]: (_module, _exports, runtimeRequire) => {
        webpackRequire = runtimeRequire;
        capturedWebpackRequire = runtimeRequire;
      },
    }, [[id]]]);
    if (webpackRequire) return webpackRequire;
    // Legacy JSONP runtimes and isolated fixtures use a callback payload.
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
  try {
    if (isReader(cachedReader) && cachedReader.$el?.isConnected !== false) return cachedReader;
  } catch (_error) { cachedReader = null; }

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
    const moduleSeeds = [];
    for (const module of Object.values(webpackRequire?.c || {}).slice(0, 2000)) {
      try {
        const exports = module?.exports;
        for (const value of [exports, exports?.default]) {
          if (value?.$options || value?.$parent || value?.$children) moduleSeeds.push(value);
          const subscriptions = value?.__ob__?.dep?.subs;
          if (Array.isArray(subscriptions)) moduleSeeds.push(...subscriptions.slice(0, 20).map((item) => item?.vm));
        }
      } catch (_error) {
        // Some webpack exports are lazy getters.
      }
    }
    reader = findReaderInVueTree(moduleSeeds);
  }
  if (cachedReader && cachedReader !== reader) invalidateLayout('reader-instance-changed');
  cachedReader = reader;
  if (observedReader && observedReader !== reader) observeReader(null);
  return reader;
};

const readerRenderSignature = reader => reader.renderContentsVersion;

const readingMode = () => {
  try { return getReaderMode(findReader(), document); } catch (_error) { return 'unknown'; }
};

const selectionLayoutSignature = reader => JSON.stringify([
  readerRenderSignature(reader), window.innerWidth, window.innerHeight,
  document.querySelector('.wr_canvasContainer')?.clientWidth,
  document.querySelector('.wr_canvasContainer')?.clientHeight,
]);

const mappingCapabilities = reader => {
  if (getReaderMode(reader, document) === 'horizontal') return { mappingAvailable: false, code: 'READING_MODE_DISABLED' };
  return detectReaderCapabilities(reader, document.querySelector('.wr_canvasContainer'));
};

const observeReader = reader => {
  if (reader === observedReader) return;
  for (const restore of readerObserverRestorations.splice(0).reverse()) {
    try { restore(); } catch (_error) { /* A destroyed native instance may be frozen. */ }
  }
  nativeSelection = null;
  observedReader = reader;
  if (!reader) return;
  const wrap = (owner, key, before, after) => {
    if (!owner || typeof owner[key] !== 'function') return;
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    const original = owner[key];
    const wrapped = function (...args) {
      try { before?.(args); } catch (_error) { nativeSelection = null; }
      const result = original.apply(this, args);
      try { after?.(args); } catch (_error) { nativeSelection = null; }
      return result;
    };
    try {
      Object.defineProperty(owner, key, descriptor && 'value' in descriptor
        ? { ...descriptor, value: wrapped } : { configurable: true, writable: true, value: wrapped });
      readerObserverRestorations.push(() => {
        // Do not overwrite a later native replacement.
        if (owner[key] !== wrapped) return;
        if (descriptor) Object.defineProperty(owner, key, descriptor);
        else delete owner[key];
      });
    } catch (_error) { /* Observation is optional; native methods take priority. */ }
  };
  const capture = objects => {
    const selection = getReaderMode(reader, document) === 'vertical' ? readVerticalSelection(reader, objects) : null;
    nativeSelection = selection
      ? { ...selection, bookId: normalizeChapterUid(reader.bookId), signature: selectionLayoutSignature(reader), layoutVersion: bridgeLayoutVersion } : null;
  };
  wrap(reader, 'selectObjs', null, args => capture(args[0]));
  wrap(reader, 'clearSelection', () => { nativeSelection = null; });
  wrap(reader, 'showSelectionToolBar', null, args => capture(args[0]?.objs));
};

const getCapabilities = () => {
  try {
    return mappingCapabilities(findReader());
  } catch (_error) {
    return { mappingAvailable: false, code: 'READER_INSPECTION_FAILED' };
  }
};

const invalidateLayout = (reason, notify = true) => {
  textOperations.clear();
  bridgeLayoutVersion += 1;
  cachedRenderContents = null;
  cachedChapterUid = '';
  cachedRenderVersion = null;
  nativeSelection = null;
  if (notify) {
    window.postMessage(
      { source: RESPONSE_SOURCE, type: 'LAYOUT_INVALIDATED', reason },
      '*'
    );
  }
};

const updateReaderMode = () => {
  const mode = readingMode();
  const bookId = normalizeChapterUid(cachedReader?.bookId || window.__INITIAL_STATE__?.reader?.bookId);
  if (mode !== lastReaderMode || bookId !== lastReaderBookId) {
    if (mode !== 'vertical') observeReader(null);
    if (lastReaderMode) invalidateLayout(mode === lastReaderMode ? 'reader-book-changed' : 'reader-mode-changed');
    lastLayoutSignature = '';
    lastReaderMode = mode;
    lastReaderBookId = bookId;
    window.postMessage({ source: RESPONSE_SOURCE, type: 'READER_MODE_CHANGED', mode, bookId }, '*');
  }
  return mode;
};

const captureRenderContents = (chapterUid, probeRange) => {
  const reader = findReader();
  const capabilities = mappingCapabilities(reader);
  if (!capabilities.mappingAvailable) throw readerError(capabilities.code);

  const actualChapterUid = getReaderChapterUid(reader);
  if (actualChapterUid && actualChapterUid !== normalizeChapterUid(chapterUid)) {
    throw readerError('CHAPTER_MISMATCH');
  }

  const start = probeRange?.start ?? 0;
  const end = probeRange?.end ?? start + 1;
  const captured = captureReaderRenderContents(reader, start, end);
  cachedReader = reader;
  cachedRenderContents = captured;
  cachedChapterUid = normalizeChapterUid(chapterUid);
  cachedRenderVersion = readerRenderSignature(reader);
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
  if (readingMode() === 'horizontal') throw readerError('READING_MODE_DISABLED');
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
  const capabilities = getCapabilities();
  if (!capabilities.mappingAvailable) throw readerError(capabilities.code);
  const normalizedChapterUid = normalizeChapterUid(chapterUid);
  const actualChapterUid = getReaderChapterUid(reader);
  if (actualChapterUid && actualChapterUid !== normalizedChapterUid) throw readerError('CHAPTER_MISMATCH');
  const renderVersionChanged =
    cachedRenderVersion !== null &&
    readerRenderSignature(reader) !== cachedRenderVersion;
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
      if (!Array.isArray(objects)) throw readerError('READER_RESULT_INVALID');
      mappingDiagnostics.getRectsByContentObjsCalls += 1;
      const rawRects = reader.getRectsByContentObjs(objects);
      if (!Array.isArray(rawRects)) throw readerError('READER_RESULT_INVALID');
      const rects = rawRects
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
        failureReason: error.code === 'READER_RESULT_INVALID' ? error.code : 'OTHER',
        error: String(error),
      };
    }
  });
  if (results.some((item) => item.failureReason === 'READER_RESULT_INVALID')) {
    throw readerError('READER_RESULT_INVALID');
  }
  if (results.length && results.every((item) => item.failureReason === 'OTHER')) {
    throw readerError('READER_MAPPING_FAILED');
  }
  return {
    results,
    chapterUid: getReaderChapterUid(reader) || normalizedChapterUid,
    layoutVersion: bridgeLayoutVersion,
    diagnostics: { ...mappingDiagnostics },
    layoutBounds,
  };
};

const textOperations = createTextOperationSession({
  getReader: findReader, getMode: readingMode, getChapterUid: getReaderChapterUid,
  getSignature: selectionLayoutSignature, getLayoutVersion: () => bridgeLayoutVersion,
  validateRects: rects => rects.map(serializeRect).every(r => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0),
  getObjects: (reader, chapterUid, range) => {
    const contents = cachedReader === reader && cachedChapterUid === chapterUid &&
      cachedRenderContents && cachedRenderVersion === readerRenderSignature(reader)
      ? cachedRenderContents : captureRenderContents(chapterUid, range);
    return reader.findObjsInOffsetRange(contents, range.start, range.end);
  },
});

const reviewOperations = createReviewOperations({
  getReader: findReader, getMode: readingMode, getChapterUid: getReaderChapterUid,
  isPanelVisible: panel => Boolean(panel.$el?.getBoundingClientRect?.().width),
  readReview: async reviewId => {
    const response = await fetch(`/web/review/single?reviewId=${encodeURIComponent(reviewId)}`, { credentials: 'same-origin' });
    if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'LOGIN_REQUIRED' : 'REVIEW_READ_FAILED');
    return response.json();
  },
  onDetailClosed: result => window.postMessage({ source: RESPONSE_SOURCE, type: 'REVIEW_DETAIL_CLOSED', ...result }, '*'),
});

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
    if (readingMode() !== 'vertical') observeReader(null);
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
  if (message.type === 'GET_CAPABILITIES') {
    window.postMessage({ source: RESPONSE_SOURCE, type: 'CAPABILITIES_RESULT',
      requestId: message.requestId, capabilities: getCapabilities() }, '*');
    return;
  }
  if (message.type === 'GET_READER_MODE') {
    window.postMessage({ source: RESPONSE_SOURCE, type: 'READER_MODE_RESULT', requestId: message.requestId, mode: updateReaderMode() }, '*');
    return;
  }
  if (message.type === 'REGISTER_REVIEW_INTERACTIONS' || message.type === 'EXECUTE_REVIEW_OPERATION') {
    void Promise.resolve().then(() => message.type === 'REGISTER_REVIEW_INTERACTIONS'
      ? reviewOperations.register(message) : reviewOperations.execute(message))
      .then(result => window.postMessage({ source: RESPONSE_SOURCE, type: 'REVIEW_OPERATION_RESULT', requestId: message.requestId, result }, '*'))
      .catch(error => window.postMessage({ source: RESPONSE_SOURCE, type: 'REVIEW_OPERATION_RESULT', requestId: message.requestId,
        error: ['CONTEXT_EXPIRED', 'REVIEW_TARGET_INVALID', 'LOGIN_REQUIRED', 'UNKNOWN_OPERATION', 'OPERATION_BUSY',
          'NATIVE_ENTRY_UNAVAILABLE', 'LIKE_REJECTED', 'LIKE_RESULT_UNKNOWN', 'LIKE_APPLIED_STATE_UNKNOWN',
          'REVIEW_READ_FAILED'].includes(error.message) ? error.message : 'REVIEW_OPERATION_FAILED' }, '*'));
    return;
  }
  if (message.type === 'CLEAR_REVIEW_INTERACTIONS') {
    reviewOperations.clear();
    return;
  }
  if (message.type === 'PREPARE_TEXT_OPERATIONS' || message.type === 'EXECUTE_TEXT_OPERATION') {
    const type = message.type === 'PREPARE_TEXT_OPERATIONS' ? 'TEXT_OPERATIONS_RESULT' : 'TEXT_OPERATION_RESULT';
    void Promise.resolve().then(() => message.type === 'PREPARE_TEXT_OPERATIONS'
      ? textOperations.prepare(message) : textOperations.execute(message.token, message.operation))
      .then(result => window.postMessage({ source: RESPONSE_SOURCE, type, requestId: message.requestId, result }, '*'))
      .catch(error => window.postMessage({ source: RESPONSE_SOURCE, type, requestId: message.requestId,
        error: ['READING_MODE_DISABLED', 'CHAPTER_CHANGED', 'INVALID_RANGE', 'ORIGINAL_TEXT_UNAVAILABLE',
          'CONTEXT_EXPIRED', 'UNKNOWN_OPERATION', 'OPERATION_BUSY', 'LOGIN_REQUIRED', 'AI_UNAVAILABLE',
          'NATIVE_ENTRY_UNAVAILABLE', 'NATIVE_RESULT_INVALID'].includes(error.message) ? error.message : 'NATIVE_OPERATION_FAILED' }, '*'));
    return;
  }
  if (message.type === 'GET_NATIVE_OPERATION_BASELINE') {
    let reader = null;
    try { reader = findReader(); } catch (_error) { /* I0 does not alter mapping availability. */ }
    const baseline = observeNativeOperations([reader, ...capturedVueInstances.slice().reverse()]);
    window.postMessage({ source: RESPONSE_SOURCE, type: 'NATIVE_OPERATION_BASELINE_RESULT',
      requestId: message.requestId, baseline }, '*');
    return;
  }
  if (message.type === 'GET_READER_CONTEXT') {
    let context = { bookId: '', chapterUid: '' };
    try {
      const reader = findReader();
      const initial = window.__INITIAL_STATE__?.reader;
      context = {
        bookId: normalizeChapterUid(reader?.bookId || initial?.bookId || initial?.bookInfo?.bookId),
        chapterUid: getReaderChapterUid(reader),
      };
    } catch (_error) { /* Return only public identity fields, never the full initial state. */ }
    window.postMessage({ source: RESPONSE_SOURCE, type: 'READER_CONTEXT_RESULT',
      requestId: message.requestId, context }, '*');
    return;
  }
  if (message.type === 'GET_READER_INTERACTION_CONTEXT') {
    let context = null;
    try {
      const reader = findReader();
      const mode = getReaderMode(reader, document);
      observeReader(mode === 'vertical' ? reader : null);
      if (reader && mode === 'vertical') {
        const modeContext = { mode: 'vertical', visibleChapterUids: [getReaderChapterUid(reader)] };
        if (nativeSelection && (reader._isDestroyed || nativeSelection.bookId !== normalizeChapterUid(reader.bookId) || nativeSelection.signature !== selectionLayoutSignature(reader) ||
          nativeSelection.layoutVersion !== bridgeLayoutVersion || !modeContext.visibleChapterUids.includes(nativeSelection.chapterUid))) nativeSelection = null;
        context = { bookId: normalizeChapterUid(reader.bookId), chapterUid: getReaderChapterUid(reader),
          ...modeContext, layoutVersion: bridgeLayoutVersion,
          selection: nativeSelection ? { chapterUid: nativeSelection.chapterUid, range: nativeSelection.range, text: nativeSelection.text } : null };
      }
    } catch (_error) { nativeSelection = null; }
    window.postMessage({ source: RESPONSE_SOURCE, type: 'READER_INTERACTION_CONTEXT_RESULT', requestId: message.requestId, context }, '*');
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
        errorCode: error.code || 'READER_MAPPING_FAILED',
      },
      '*'
    );
  }
});

const getLayoutSignature = () => {
  const capabilities = getCapabilities();
  if (!capabilities.mappingAvailable) return capabilities.code;
  const reader = findReader();
  const container = document.querySelector('.wr_canvasContainer');
  if (!reader || !container) return '';
  return [
    getReaderChapterUid(reader),
    readerRenderSignature(reader),
    container.clientWidth,
    container.clientHeight,
  ].join(':');
};

window.setInterval(() => {
  try { reviewOperations.poll(); } catch (_error) { /* Native UI replacement must not affect reading. */ }
  updateReaderMode();
  let signature;
  try { signature = getLayoutSignature(); } catch (_error) { signature = 'READER_INSPECTION_FAILED'; }
  if (!signature) return;
  if (lastLayoutSignature && signature !== lastLayoutSignature) {
    invalidateLayout('reader-layout-changed');
  }
  lastLayoutSignature = signature;
}, 500);

window.addEventListener('resize', () => invalidateLayout('window-resize'));
window.postMessage({ source: RESPONSE_SOURCE, type: 'BRIDGE_READY' }, '*');
