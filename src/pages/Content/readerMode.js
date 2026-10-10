// Horizontal Reader is recognised only to leave the official UI untouched.
export const getReaderMode = (reader, document) => {
  if (document?.querySelector('.readerControls_item.isHorizontalReader')) return 'horizontal';
  if (document?.querySelector('.readerControls_item.isNormalReader')) return 'vertical';
  if (!reader || reader._isDestroyed || reader.$el?.isConnected === false) return 'unknown';
  if (reader.$options?.name === 'HorizontalReader' ||
      ['getCurrentDisplayRenderContents', 'getCurrentChapterPages'].every(key => typeof reader[key] === 'function')) return 'horizontal';
  return reader.$options?.name === 'reader' ||
    ['handleClickUnderline', 'findObjsInOffsetRange'].every(key => typeof reader[key] === 'function') ? 'vertical' : 'unknown';
};

export const readVerticalSelection = (reader, objects) => {
  if (!Array.isArray(objects) || !objects.length || objects.length > 10000 || typeof reader.getTextFromObjs !== 'function') return null;
  const chapterUid = String(reader.currentChapterUid ?? reader.currentChapter?.chapterUid ?? '');
  if (!chapterUid || objects.some(object => object?.chapterUid != null && String(object.chapterUid) !== chapterUid)) return null;
  const ranges = objects.map(object => {
    if (typeof object?.getOffset !== 'function' || typeof object?.getTextLength !== 'function') return null;
    const start = object.getOffset(), length = object.getTextLength();
    return Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(length) && length >= 0 && Number.isSafeInteger(start + length)
      ? { start, end: start + length } : null;
  });
  if (ranges.some(range => !range)) return null;
  const start = Math.min(...ranges.map(range => range.start));
  const end = Math.max(...ranges.map(range => range.end));
  const text = reader.getTextFromObjs(objects, { filter: object => object.isTextOrCanvasType?.() === true });
  return end > start && typeof text === 'string' && text.trim() && text.length <= 50000
    ? { chapterUid, range: { start, end }, text } : null;
};
