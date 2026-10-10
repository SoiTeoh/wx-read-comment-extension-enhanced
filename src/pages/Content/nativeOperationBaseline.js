// I0 observes native entries only. Finding a method is never permission to invoke it.
export const NATIVE_OPERATIONS = [
  { id: 'copy', label: '复制', target: 'selection', components: ['reader'], methods: ['copyText'] },
  { id: 'underline', label: '划线', target: 'selection', components: ['reader', 'readerfloatreviewspanel'], methods: ['handleFloatPanelUnderlineObjs', 'handleUnderline'] },
  { id: 'writeThought', label: '写想法', target: 'selection', components: ['reader'], methods: ['showWriteReviewPanel', 'handleWriteReview'] },
  { id: 'askAI', label: 'AI 问书', target: 'selection', components: ['reader'], methods: ['showAiChatPanel'] },
  { id: 'like', label: '点赞', target: 'review', components: ['readerfloatreviewdetailpanel', 'readerfloatreviewspanel', 'readerfloatreviewspanelitem'], methods: ['handleReviewLikeClick', 'handleClickLike'] },
  { id: 'reply', label: '评论', target: 'review', components: ['readerfloatreviewdetailpanel', 'readerfloatreviewsubcommentdetailpanel', 'readerfloatreviewspanel'], methods: ['handleReviewCommentClick', 'openCommentInput'] },
  { id: 'readReplies', label: '查看回复', target: 'review', components: ['reader', 'readerfloatreviewdetailpanel', 'readerfloatreviewsubcommentdetailpanel'], methods: ['showReviewDetailPanel', 'loadComment', 'loadMoreSubComment'] },
];

const ownValue = (object, key) => {
  try {
    // Do not evaluate accessors, computed Vue properties, or arbitrary getters.
    for (let depth = 0; object && depth < 6; depth++, object = Object.getPrototypeOf(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
    }
    return undefined;
  } catch (_error) { return undefined; }
};

export const observeNativeOperations = (seeds = []) => {
  const queue = seeds.slice(0, 500);
  let truncated = seeds.length > 500;
  const seen = new Set();
  const evidence = Object.fromEntries(NATIVE_OPERATIONS.map(({ id }) => [id, []]));
  while (queue.length && seen.size < 500) {
    const component = queue.shift();
    if (!component || (typeof component !== 'object' && typeof component !== 'function') || seen.has(component)) continue;
    seen.add(component);
    if (ownValue(component, '_isDestroyed')) continue;
    const options = ownValue(component, '$options');
    const name = ownValue(options, 'name') || ownValue(options, '_componentTag') || (
      ['handleClickUnderline', 'findObjsInOffsetRange'].every(key => typeof ownValue(component, key) === 'function')
        ? 'reader' : ''
    );
    // A similarly named method on an unrelated component is not native evidence.
    if (typeof name === 'string' && /reader|review|selection/i.test(name)) {
      for (const operation of NATIVE_OPERATIONS) {
        if (!operation.components.includes(name.replace(/[^a-z]/gi, '').toLowerCase())) continue;
        for (const method of operation.methods) {
          if (typeof ownValue(component, method) !== 'function') continue;
          const entry = { component: name.slice(0, 80), method };
          if (evidence[operation.id].length < 12 && !evidence[operation.id].some(
            (item) => item.component === entry.component && item.method === method
          )) evidence[operation.id].push(entry);
        }
      }
    }
    const parent = ownValue(component, '$parent');
    if (parent && queue.length < 500) queue.push(parent);
    else if (parent) truncated = true;
    const children = ownValue(component, '$children');
    if (Array.isArray(children)) {
      const available = Math.max(0, 500 - queue.length);
      if (children.length > available) truncated = true;
      queue.push(...children.slice(0, available));
    }
  }
  return {
    stage: 'I0', readOnly: true, visitedComponents: seen.size, truncated: truncated || queue.length > 0,
    operations: NATIVE_OPERATIONS.map(({ id, label, target }) => ({
      id, label, target,
      observed: evidence[id].length > 0,
      callable: false,
      reason: evidence[id].length ? 'NATIVE_ARGUMENTS_NOT_VERIFIED' : 'NATIVE_ENTRY_NOT_OBSERVED',
      evidence: evidence[id],
    })),
  };
};
