import { readerError } from './readerCompatibility';

export const isHorizontalReader = reader => Boolean(reader && !reader._isDestroyed && (
  reader.$options?.name === 'HorizontalReader' ||
  ['getCurrentDisplayRenderContents', 'getRangeFromObjs', 'getCurrentChapterPages']
    .every(key => typeof reader[key] === 'function')
));

export const isNativeContentTools = tools => Boolean(tools &&
  ['findObjsInOffsetRange', 'getRectsByContentObjs', 'getTextFromObjs']
    .every(key => typeof tools[key] === 'function'));

export const getHorizontalContext = reader => ({
  mode: 'horizontal',
  visibleChapterUids: [...new Set([
    reader.leftPageChapterUid, reader.isSinglePage ? null : reader.rightPageChapterUid,
  ].filter(value => value !== null && value !== undefined && value !== '').map(String))],
  leftPageIndex: Number.isInteger(reader.leftRenderPageIdx) ? reader.leftRenderPageIdx : null,
  rightPageIndex: !reader.isSinglePage && Number.isInteger(reader.rightRenderPageIdx) ? reader.rightRenderPageIdx : null,
  singlePage: Boolean(reader.isSinglePage),
});

export const horizontalLayoutSignature = reader => JSON.stringify([
  reader.currentChapterUid, reader.renderContentsVersion,
  reader.leftRenderPageIdx, reader.isSinglePage ? null : reader.rightRenderPageIdx,
  reader.leftPageChapterUid, reader.isSinglePage ? null : reader.rightPageChapterUid,
  reader.leftPageRenderContentsChangeTrigger, reader.rightPageRenderContentsChangeTrigger,
  reader.isSinglePage, reader.pageWidth, reader.pageHeight,
]);

export const getHorizontalContents = (reader, chapterUid) => {
  const contents = reader.getCurrentDisplayRenderContents();
  if (!Array.isArray(contents)) throw readerError('READER_RESULT_INVALID');
  // Native offsets restart in each chapter; a spread can contain two chapters.
  return contents.filter(object => String(object?.chapterUid) === String(chapterUid));
};

export const findHorizontalObjects = (tools, contents, start, end, chapterUid) => {
  // Native helper uses strict numeric chapter identity. Preserve the native type.
  const nativeChapterUid = contents[0]?.chapterUid;
  if (String(nativeChapterUid) !== String(chapterUid)) return [];
  return tools.findObjsInOffsetRange(contents, start, end, nativeChapterUid);
};

export const readNativeSelection = (reader, tools, objects) => {
  if (!Array.isArray(objects) || !objects.length || objects.length > 10000 || !isNativeContentTools(tools)) return null;
  const chapters = [...new Set(objects.map(object => String(object?.chapterUid ?? reader.currentChapterUid ?? '')))];
  if (chapters.length !== 1 || !chapters[0]) return null;
  const offsets = objects.map(object => {
    if (typeof object?.getOffset !== 'function' || typeof object?.getTextLength !== 'function') return null;
    const start = object.getOffset(), length = object.getTextLength();
    return Number.isFinite(start) && start >= 0 && Number.isFinite(length) && length >= 0
      ? { start, end: start + length } : null;
  });
  if (offsets.some(value => !value)) return null;
  const start = Math.min(...offsets.map(value => value.start));
  const end = Math.max(...offsets.map(value => value.end));
  if (!(end > start)) return null;
  const text = tools.getTextFromObjs(objects, {
    filter: object => typeof object.isTextOrCanvasType === 'function' && object.isTextOrCanvasType(),
  });
  if (typeof text !== 'string' || !text.trim() || text.length > 50000) return null;
  return { chapterUid: chapters[0], range: { start, end }, text };
};
