let navigationVersion = 0, installed = false;
export const getNavigationVersion = () => navigationVersion;
export const installNavigationTracking = () => {
  if (installed) return; installed = true;
  const intent = event => {
    if (event.target?.closest?.('.wxrc_public_review_popup, .chrex-comment-wrapper, .readerNotePanel, .wr_float_panel_container')) return;
    navigationVersion++;
  };
  window.addEventListener('wheel', intent, { passive: true });
  window.addEventListener('touchmove', intent, { passive: true });
  document.addEventListener('pointerdown', event => {
    if (event.target === document.documentElement && event.clientX >= window.innerWidth - 16) intent(event);
  });
  document.addEventListener('keydown', event => {
    if (['PageDown','PageUp','Home','End','ArrowDown','ArrowUp',' '].includes(event.key) &&
      !event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) intent(event);
  });
};
export const chooseReadingAnchor = (ranges, canvasTop, height) => {
  let best = null;
  for (const [key, group] of ranges) group.rects.forEach((rect, index) => {
    const top = canvasTop + rect.y;
    if (top + rect.h < 80 || top > height - 40) return;
    const distance = Math.abs(top - 120);
    if (!best || distance < best.distance) best = { key, index, offset: top, distance };
  });
  return best;
};
export const anchorScrollTop = (anchor, ranges, canvasDocumentTop) => {
  const rects = ranges.get(anchor.key)?.rects;
  const rect = rects?.[anchor.index] || rects?.[0];
  return rect ? Math.max(0, canvasDocumentTop + rect.y - anchor.offset) : null;
};
export const capturePanelPosition = () => ({ top: window.scrollY, navigation: navigationVersion, layout: document.querySelector('.chrex-comment-wrapper')?.dataset.layoutVersion,
  sidebar: document.querySelector('.comment-react-wrapper'), sidebarTop: document.querySelector('.comment-react-wrapper')?.scrollTop,
  popup: document.querySelector('.wxrc_public_review_popup'), popupTop: document.querySelector('.wxrc_public_review_popup')?.scrollTop });
export const restorePanelPosition = position => {
  if (!position || position.navigation !== navigationVersion) return;
  if (position.layout === document.querySelector('.chrex-comment-wrapper')?.dataset.layoutVersion && Number.isFinite(position.top) && Math.abs(window.scrollY - position.top) > 1) window.scrollTo({ top: position.top, behavior: 'instant' });
  if (position.sidebar?.isConnected) position.sidebar.scrollTop = position.sidebarTop;
  if (position.popup?.isConnected) position.popup.scrollTop = position.popupTop;
};
export const shortcutOperation = event => {
  if (event.defaultPrevented || event.repeat || event.isComposing || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return null;
  return event.code === 'KeyC' ? 'nearby' : event.code === 'KeyY' ? 'copy' : null;
};
