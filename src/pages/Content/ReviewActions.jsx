import React, { useSyncExternalStore } from 'react';
import { getReviewActionLabels, getReviewInteractionState, performReviewOperation, subscribeReviewInteractions } from './reviewInteractions';

export default function ReviewActions({ reviewId }) {
  const state = useSyncExternalStore(subscribeReviewInteractions, () => getReviewInteractionState(reviewId));
  const labels = getReviewActionLabels(state);
  const reason = state.capabilities.reason === 'LOGIN_REQUIRED' ? '请先登录微信读书，再刷新状态' : '当前 Reader 暂不支持此原生入口';
  const act = operation => event => { event.stopPropagation(); void performReviewOperation(reviewId, operation, event.currentTarget); };
  return <div className="wxrc_review_actions">
    <button type="button" data-review-operation="like" disabled={state.busy || !state.ready || !state.capabilities.like || state.needsRefresh}
      aria-pressed={state.isLike === null ? 'mixed' : state.isLike} title={state.capabilities.like ? '' : reason}
      onClick={act(state.isLike === null ? 'refresh' : 'like')}>{state.isLike ? '♥' : '♡'} {labels.like}</button>
    <button type="button" data-review-operation="reply" disabled={state.busy || !state.ready || !state.capabilities.reply}
      title={state.capabilities.reply ? '打开这条想法的原生回复详情，由你提交' : reason} onClick={act('reply')}>▱ {labels.reply}</button>
    {state.needsRefresh && <button type="button" data-review-operation="refresh" disabled={state.busy || !state.ready} onClick={act('refresh')}>刷新状态</button>}
    <span className="wxrc_review_action_status" role="status">{state.message || (state.ready && (!state.capabilities.like || !state.capabilities.reply) ? reason : '')}</span>
  </div>;
}
