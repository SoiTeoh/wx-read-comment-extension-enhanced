import { getReview } from './utils';
import { reviewState } from './nativeReviewOperations';

const empty = Object.freeze({ isLike: null, likesCount: null, commentsCount: null, busy: false,
  ready: false, capabilities: {}, message: '', needsRefresh: false });
const subscribers = new Map(), pending = new Map();
let generation = 0, sequence = 0, session = null, states = new Map(), detailOpen = false, returnFocus = null;
const notify = reviewId => {
  if (reviewId !== undefined) subscribers.get(reviewId)?.forEach(listener => listener());
  else subscribers.forEach(listeners => listeners.forEach(listener => listener()));
};
const request = (type, payload) => new Promise((resolve, reject) => {
  const requestId = `interaction-${Date.now()}-${++sequence}`;
  const timer = setTimeout(() => { pending.delete(requestId); reject(Error('BRIDGE_TIMEOUT')); }, 30000);
  pending.set(requestId, { resolve, reject, timer });
  window.postMessage({ source: 'WXRC', type, requestId, ...payload }, '*');
});
const messages = {
  LOGIN_REQUIRED: '请先登录微信读书，再刷新状态', CONTEXT_EXPIRED: '阅读上下文已变化，请重新打开评论',
  NATIVE_ENTRY_UNAVAILABLE: '当前 Reader 暂不支持此原生入口', REVIEW_TARGET_INVALID: '无法核实这条公开想法',
  OPERATION_BUSY: '操作正在进行，请稍候', LIKE_REJECTED: '点赞未成功，可刷新状态后重试',
  LIKE_RESULT_UNKNOWN: '点赞结果未确认，请刷新状态；不会自动重试',
  LIKE_APPLIED_STATE_UNKNOWN: '点赞已提交，状态未确认，请刷新；不会自动重试',
};
window.addEventListener('message', event => {
  if (event.source !== window || event.data?.source !== 'WXRC_PAGE') return;
  const message = event.data;
  if (message.type === 'REVIEW_OPERATION_RESULT') {
    const job = pending.get(message.requestId); if (!job) return;
    pending.delete(message.requestId); clearTimeout(job.timer);
    if (message.error) job.reject(Error(message.error)); else job.resolve(message.result);
  }
  if (message.type === 'REVIEW_DETAIL_CLOSED' && message.token === session?.token) {
    detailOpen = false; const target = returnFocus; returnFocus = null;
    const epoch = generation;
    void performReviewOperation(message.reviewId, 'refresh').then(() => {
      if (epoch === generation && !detailOpen && message.restoreFocus !== false && target?.isConnected) target.focus({ preventScroll: true });
    });
  }
});
export const subscribeReviewInteractions = (reviewId, listener) => {
  const id = String(reviewId);
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  const listeners = subscribers.get(id); listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) subscribers.delete(id); };
};
export const getReviewInteractionState = reviewId => states.get(String(reviewId)) || empty;
export const isReviewDetailOpen = () => detailOpen;
export const clearReviewInteractions = () => {
  generation++; session = null; states = new Map(); detailOpen = false; returnFocus = null;
  // Release obsolete content-side timers, not native writes already in flight.
  for (const job of pending.values()) { clearTimeout(job.timer); job.reject(Error('CONTEXT_EXPIRED')); }
  pending.clear();
  window.postMessage({ source: 'WXRC', type: 'CLEAR_REVIEW_INTERACTIONS', requestId: `clear-${++sequence}` }, '*');
  notify();
};
export const activateReviewInteractions = async (bookId, chapterUid, entries) => {
  clearReviewInteractions(); const epoch = generation;
  const ids = [], seen = new Set();
  for (const entry of entries) {
    const review = getReview(entry), id = String(review.reviewId || entry.reviewId || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id); states.set(id, { ...empty, ...reviewState(entry) });
  }
  try {
    const result = await request('REGISTER_REVIEW_INTERACTIONS', { bookId, chapterUid, reviewIds: ids });
    if (generation !== epoch) return;
    session = result;
    states.forEach((state, id) => states.set(id, { ...state, ready: true, capabilities: result.capabilities }));
  } catch (error) {
    if (generation !== epoch) return;
    states.forEach((state, id) => states.set(id, { ...state, message: messages[error.message] || '互动入口暂不可用' }));
  }
  notify();
};
export const performReviewOperation = async (reviewId, operation, trigger) => {
  reviewId = String(reviewId);
  const before = getReviewInteractionState(reviewId), epoch = generation, token = session?.token;
  if (!token || before.busy || !states.has(reviewId)) return;
  states.set(reviewId, { ...before, busy: true, message: operation === 'like' ? '正在同步点赞…' : operation === 'reply' ? '正在打开评论…' : '正在刷新状态…' }); notify(reviewId);
  try {
    const result = await request('EXECUTE_REVIEW_OPERATION', { token, reviewId, operation, expectedIsLike: before.isLike });
    if (generation !== epoch) return;
    if (result.stale) throw Error('CONTEXT_EXPIRED');
    if (result.opened) { detailOpen = true; returnFocus = trigger; }
    states.set(reviewId, { ...before, ...result.state, capabilities: result.capabilities || before.capabilities, busy: false, needsRefresh: false,
      message: result.changed ? '点赞状态已变化，已同步；再次点击可操作' : result.applied ? result.state.isLike ? '已点赞' : '已取消点赞' : '' });
  } catch (error) {
    if (generation !== epoch) return;
    const capabilities = error.message === 'LOGIN_REQUIRED' ? { like: false, reply: false, reason: 'LOGIN_REQUIRED' }
      : error.message === 'NATIVE_ENTRY_UNAVAILABLE' ? { ...before.capabilities, [operation]: false, reason: error.message } : before.capabilities;
    states.set(reviewId, { ...before, capabilities, busy: false, needsRefresh: true,
      message: messages[error.message] || (operation === 'like' ? '点赞结果未确认，请刷新状态；不会自动重试' : '操作未完成，请刷新状态后再试') });
  }
  notify(reviewId);
};

export const getReviewActionLabels = state => ({
  like: `${state.isLike === null ? '同步点赞状态' : state.isLike ? '取消点赞' : '点赞'}${state.likesCount === null ? '' : ` ${state.likesCount}`}`,
  reply: `评论${state.commentsCount === null ? '' : ` ${state.commentsCount}`}`,
});

// The same state feeds sidebar cards and the DOM popup; neither mutates or filters the source list.
export const appendReviewActions = (parent, reviewId) => {
  const row = document.createElement('div'); row.className = 'wxrc_review_actions';
  const like = document.createElement('button'), reply = document.createElement('button'), refresh = document.createElement('button');
  like.type = reply.type = refresh.type = 'button';
  like.dataset.reviewOperation = 'like'; reply.dataset.reviewOperation = 'reply'; refresh.dataset.reviewOperation = 'refresh';
  const status = document.createElement('span'); status.className = 'wxrc_review_action_status'; status.setAttribute('role', 'status');
  row.append(like, reply, refresh, status); parent.appendChild(row);
  const render = () => {
    const state = getReviewInteractionState(reviewId), labels = getReviewActionLabels(state);
    like.textContent = `${state.isLike ? '♥' : '♡'} ${labels.like}`; reply.textContent = `▱ ${labels.reply}`;
    like.setAttribute('aria-pressed', state.isLike === null ? 'mixed' : String(state.isLike));
    like.disabled = state.busy || !state.ready || !state.capabilities.like || state.needsRefresh;
    reply.disabled = state.busy || !state.ready || !state.capabilities.reply;
    like.title = state.capabilities.like ? '' : messages[state.capabilities.reason] || '互动入口暂不可用';
    reply.title = state.capabilities.reply ? '打开这条想法的原生回复详情，由你提交' : like.title;
    refresh.textContent = '刷新状态'; refresh.hidden = !state.needsRefresh && state.capabilities.like && state.capabilities.reply; refresh.disabled = state.busy || !state.ready;
    status.textContent = state.message || (state.ready && (!state.capabilities.like || !state.capabilities.reply) ? messages[state.capabilities.reason] || '部分互动入口暂不可用' : '');
  };
  like.addEventListener('click', event => { event.stopPropagation(); const state = getReviewInteractionState(reviewId); void performReviewOperation(reviewId, state.isLike === null ? 'refresh' : 'like', like); });
  reply.addEventListener('click', event => { event.stopPropagation(); void performReviewOperation(reviewId, 'reply', reply); });
  refresh.addEventListener('click', event => { event.stopPropagation(); void performReviewOperation(reviewId, 'refresh', refresh); });
  const unsubscribe = subscribeReviewInteractions(reviewId, render); render(); return unsubscribe;
};
