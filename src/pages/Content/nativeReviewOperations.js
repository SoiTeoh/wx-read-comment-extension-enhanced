export const reviewState = entry => {
  const review = entry?.review || entry || {};
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    isLike: [true, 1].includes(review.isLike) ? true : [false, 0].includes(review.isLike) ? false : null,
    likesCount: count(entry?.likesCount ?? review.likesCount),
    commentsCount: count(entry?.commentsCount ?? review.commentsCount),
  };
};

export const inspectReviewRuntime = reader => {
  const actions = Object.keys(reader?.$store?._actions || {}).filter(key =>
    key.split('/').at(-1).replace(/[^a-z]/gi, '').toLowerCase() === 'fetchreviewlike');
  const note = reader?.$refs?.readerNotePanel;
  const named = (item, name) => String(item?.$options?.name || '').replace(/[^a-z]/gi, '').toLowerCase() === name;
  const detail = note?.$refs?.reviewDetail;
  if (named(note, 'readernotepanel') && !note._isDestroyed && note.$el?.isConnected !== false &&
    ['show', 'close', 'isShowing'].every(key => typeof note[key] === 'function') &&
    named(detail, 'readerfloatreviewdetailpanel') && !detail._isDestroyed &&
    ['show', 'hide'].every(key => typeof detail[key] === 'function')) {
    return { likeAction: actions.length === 1 ? actions[0] : null, panel: detail, container: note };
  }
  let panel = null;
  const queue = [reader], seen = new Set();
  while (queue.length && seen.size < 300) {
    const item = queue.shift();
    if (!item || seen.has(item) || typeof item !== 'object') continue;
    seen.add(item);
    if (item._isDestroyed || item.$el?.isConnected === false) continue;
    const name = String(item.$options?.name || '').replace(/[^a-z]/gi, '').toLowerCase();
    if (name === 'readerfloatreviewdetailpanel' && typeof item.show === 'function' && typeof item.hide === 'function') { panel = item; break; }
    queue.push(...(item.$children || []).slice(0, 100), ...Object.values(item.$refs || {}).slice(0, 100));
    if (queue.length > 600) queue.length = 600;
  }
  return { likeAction: actions.length === 1 ? actions[0] : null, panel, container: null };
};

// Only IDs registered from the loaded public chapter list can become interaction targets.
export const createReviewOperations = environment => {
  let current = null, sequence = 0, detail = null;
  const inFlight = new Set();
  const valid = context => context && context === current && environment.getMode() === 'vertical' &&
    environment.getReader() === context.reader && !context.reader._isDestroyed && context.reader.$el?.isConnected !== false &&
    String(context.reader.bookId) === context.bookId && environment.getChapterUid(context.reader) === context.chapterUid;
  const check = (token, reviewId) => {
    if (!valid(current) || current.token !== token) throw Error('CONTEXT_EXPIRED');
    if (!current.ids.has(reviewId)) throw Error('REVIEW_TARGET_INVALID');
    if (current.reader.hasLogin !== true) throw Error('LOGIN_REQUIRED');
    return current;
  };
  const load = async (context, reviewId) => {
    const entry = await environment.readReview(reviewId);
    const review = entry?.review;
    if (!review || String(entry.reviewId || review.reviewId) !== reviewId || String(review.reviewId) !== reviewId ||
      String(review.bookId) !== context.bookId || String(review.chapterUid) !== context.chapterUid ||
      review.isPrivate === true || review.isPrivate === 1) throw Error('REVIEW_TARGET_INVALID');
    return entry;
  };
  const closeDetail = () => {
    if (!detail) return;
    const old = detail; detail = null;
    if (String(old.panel.review?.reviewId) === old.reviewId) {
      try { if (old.panel.showing) old.panel.hide(); } catch (_error) { /* Do not break reading on native teardown failure. */ }
      try { if (old.ownsContainer && old.container?.isShowing()) old.container.close(); } catch (_error) { /* Native containers may have been destroyed. */ }
    }
  };
  const capabilities = reader => {
    const runtime = inspectReviewRuntime(reader), loggedIn = reader?.hasLogin === true;
    return { like: loggedIn && Boolean(runtime.likeAction), reply: loggedIn && Boolean(runtime.panel),
      reason: loggedIn ? 'NATIVE_ENTRY_UNAVAILABLE' : 'LOGIN_REQUIRED' };
  };
  return {
    clear() { closeDetail(); current = null; },
    register({ bookId, chapterUid, reviewIds } = {}) {
      const reader = environment.getReader();
      if (!reader || environment.getMode() !== 'vertical' || !bookId || String(reader.bookId) !== String(bookId) ||
        environment.getChapterUid(reader) !== String(chapterUid)) throw Error('CONTEXT_EXPIRED');
      if (!Array.isArray(reviewIds) || reviewIds.length > 20000 || reviewIds.some(id => typeof id !== 'string' || !id || id.length > 200)) throw Error('REVIEW_TARGET_INVALID');
      closeDetail();
      current = { reader, bookId: String(bookId), chapterUid: String(chapterUid), ids: new Set(reviewIds), token: `review-${Date.now()}-${++sequence}` };
      return { token: current.token, capabilities: capabilities(reader) };
    },
    async execute({ token, reviewId, operation, expectedIsLike }) {
      const context = check(token, reviewId);
      if (!['refresh', 'like', 'reply'].includes(operation)) throw Error('UNKNOWN_OPERATION');
      const key = `${context.bookId}:${reviewId}`;
      if (inFlight.has(key)) throw Error('OPERATION_BUSY');
      inFlight.add(key);
      try {
        const entry = await load(context, reviewId);
        if (!valid(context)) throw Error('CONTEXT_EXPIRED');
        if (context.reader.hasLogin !== true) throw Error('LOGIN_REQUIRED');
        const state = reviewState(entry);
        if (operation === 'refresh') return { state };
        const runtime = inspectReviewRuntime(context.reader);
        if (operation === 'reply') {
          if (!runtime.panel || detail?.panel.showing) throw Error(detail ? 'OPERATION_BUSY' : 'NATIVE_ENTRY_UNAVAILABLE');
          if (runtime.panel.isCommenting || runtime.panel.commentText?.trim()) throw Error('OPERATION_BUSY');
          const ownsContainer = Boolean(runtime.container && !runtime.container.isShowing());
          detail = { panel: runtime.panel, container: runtime.container, ownsContainer, context, reviewId };
          if (ownsContainer) await runtime.container.show();
          if (runtime.container?.$nextTick) await runtime.container.$nextTick();
          await runtime.panel.show({ review: entry, showComment: true });
          if (runtime.panel.$nextTick) await runtime.panel.$nextTick();
          if (!valid(context)) { closeDetail(); throw Error('CONTEXT_EXPIRED'); }
          if (environment.isPanelVisible && !environment.isPanelVisible(runtime.panel)) { closeDetail(); throw Error('NATIVE_ENTRY_UNAVAILABLE'); }
          return { opened: true, state };
        }
        if (!runtime.likeAction) throw Error('NATIVE_ENTRY_UNAVAILABLE');
        if (state.isLike === null || typeof expectedIsLike !== 'boolean' || expectedIsLike !== state.isLike) return { state, changed: true };
        if (context.reader.hasLogin !== true) throw Error('LOGIN_REQUIRED');
        let response;
        try { response = await context.reader.$store.dispatch(runtime.likeAction, { reviewId, isUnlike: state.isLike }); }
        catch (_error) { throw Error('LIKE_RESULT_UNKNOWN'); }
        if (![1, true].includes(response?.data?.succ)) throw Error(response?.data ? 'LIKE_REJECTED' : 'LIKE_RESULT_UNKNOWN');
        // A completed write is never cancelled or retried just because its UI became stale.
        let updated;
        try { updated = reviewState(await load(context, reviewId)); }
        catch (_error) { throw Error('LIKE_APPLIED_STATE_UNKNOWN'); }
        if (updated.isLike !== !state.isLike) throw Error('LIKE_APPLIED_STATE_UNKNOWN');
        return { state: updated, applied: true, stale: !valid(context) };
      } finally { inFlight.delete(key); }
    },
    poll() {
      if (!detail) return;
      if (!valid(detail.context)) { closeDetail(); return; }
      if (!detail.panel.showing || String(detail.panel.review?.reviewId) !== detail.reviewId) {
        const old = detail; closeDetail();
        environment.onDetailClosed({ token: old.context.token, reviewId: old.reviewId, restoreFocus: !old.panel.showing });
      }
    },
  };
};
