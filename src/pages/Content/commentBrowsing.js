export const POPUP_PAGE_SIZE = 30;
export const isLongComment = text => {
  const plain = String(text || '').replace(/<[^>]*>/g, ' ');
  return plain.length > 600 || plain.split('\n').length > 8;
};

// Session-only, bounded by recently visited groups. Never persists book content.
export const createPopupBrowsingMemory = (limit = 20) => {
  const groups = new Map();
  return {
    read(key) {
      const state = groups.get(key);
      if (!state) return { loaded: POPUP_PAGE_SIZE, scrollTop: 0, expanded: new Set() };
      return { ...state, expanded: new Set(state.expanded) };
    },
    save(key, state) {
      if (!key) return;
      groups.delete(key);
      groups.set(key, { loaded: state.loaded, scrollTop: state.scrollTop, expanded: new Set(state.expanded) });
      while (groups.size > limit) groups.delete(groups.keys().next().value);
    },
    clear() { groups.clear(); },
  };
};
