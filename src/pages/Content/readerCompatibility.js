export const READER_METHODS = [
  'handleClickUnderline', 'findObjsInOffsetRange', 'getRectsByContentObjs',
];

export const compatibilityFailure = (code) => ({ mappingAvailable: false, code });

export const readerError = (code) => Object.assign(new Error(code), { code });

const canOverride = (reader, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(reader, key);
  return descriptor
    ? Boolean(descriptor.configurable || ('value' in descriptor && descriptor.writable))
    : Object.isExtensible(reader);
};

// Read-only detection: never call native Reader methods during a capability probe.
export const detectReaderCapabilities = (reader, canvas) => {
  try {
    if (!reader || reader._isDestroyed) return compatibilityFailure('READER_UNAVAILABLE');
    const missingMethods = READER_METHODS.filter((key) => typeof reader[key] !== 'function');
    if (missingMethods.length) return { ...compatibilityFailure('READER_METHODS_MISSING'), missingMethods };
    if (!canvas) return compatibilityFailure('CANVAS_UNAVAILABLE');
    if (!['findObjsInOffsetRange', 'showSelectionToolBar'].every((key) => canOverride(reader, key))) {
      return compatibilityFailure('READER_HOOK_UNAVAILABLE');
    }
    return { mappingAvailable: true, code: 'READY' };
  } catch (_error) {
    return compatibilityFailure('READER_INSPECTION_FAILED');
  }
};

// Restore exact own-property descriptors, including the absence of inherited methods.
export const captureReaderRenderContents = (reader, start, end) => {
  const replacements = [];
  const originalFind = reader.findObjsInOffsetRange;
  let captured = null;
  const replace = (key, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(reader, key);
    Object.defineProperty(reader, key, descriptor && 'value' in descriptor
      ? { ...descriptor, value }
      : { configurable: true, enumerable: descriptor?.enumerable || false, writable: true, value });
    replacements.push({ key, descriptor });
  };
  try {
    replace('findObjsInOffsetRange', function (contents, ...args) {
      if (Array.isArray(contents)) captured = contents;
      return originalFind.call(this, contents, ...args);
    });
    replace('showSelectionToolBar', () => {});
    reader.handleClickUnderline({ notes: [], range: { start, end } });
  } finally {
    for (const { key, descriptor } of replacements.reverse()) {
      if (descriptor) Object.defineProperty(reader, key, descriptor);
      else delete reader[key];
    }
  }
  if (!Array.isArray(captured) || !captured.length) throw readerError('RENDER_CONTENTS_UNAVAILABLE');
  return captured;
};

export const getCompatibilityMessage = (code) => {
  switch (code) {
    case 'READER_UNAVAILABLE':
      return '暂未识别到正文阅读页面。请打开章节并使用上下滚动阅读模式，再重试定位。';
    case 'CANVAS_UNAVAILABLE':
      return '正文画布暂不可用。请等待章节加载，或切换到上下滚动阅读模式后重试定位。';
    case 'BRIDGE_TIMEOUT':
      return '正文定位组件未响应。请刷新微信读书页面后重试。';
    case 'CHAPTER_MISMATCH':
      return '章节正在切换，正文定位暂不可用。请等待新章节加载后重试。';
    default:
      return '当前微信读书页面暂不支持评论划线与正文定位。可继续浏览公开评论，或刷新页面后重试。';
  }
};
