import { readVerticalSelection } from './readerMode';

// Native objects stay in the page world. The popup receives only a short-lived handle.
export const createTextOperationSession = (environment) => {
  let current = null, sequence = 0;
  const valid = context => context && environment.getMode() === 'vertical' &&
    environment.getReader() === context.reader && !context.reader._isDestroyed &&
    context.reader.$el?.isConnected !== false && String(context.reader.bookId) === context.bookId &&
    environment.getChapterUid(context.reader) === context.chapterUid &&
    environment.getSignature(context.reader) === context.signature &&
    environment.getLayoutVersion() === context.layoutVersion;
  const capabilities = context => {
    const reader = context.reader;
    const login = reader.hasLogin === true;
    const available = (enabled, reason) => ({ enabled: Boolean(enabled), reason: enabled ? '' : reason });
    return {
      copy: available(true, ''),
      underline: available(typeof reader.showSelectionToolBar === 'function' && typeof reader.getRectsByContentObjs === 'function', 'NATIVE_ENTRY_UNAVAILABLE'),
      writeThought: available(login && typeof reader.showWriteReviewPanel === 'function', login ? 'NATIVE_ENTRY_UNAVAILABLE' : 'LOGIN_REQUIRED'),
      askAI: available(login && reader.isAIChatEnabled !== false && typeof reader.showAiChatPanel === 'function', !login ? 'LOGIN_REQUIRED' : reader.isAIChatEnabled === false ? 'AI_UNAVAILABLE' : 'NATIVE_ENTRY_UNAVAILABLE'),
    };
  };
  return {
    clear() { current = null; },
    prepare({ bookId, chapterUid, range } = {}) {
      current = null;
      const reader = environment.getReader();
      if (!reader || environment.getMode() !== 'vertical') throw Error('READING_MODE_DISABLED');
      if (!bookId || String(bookId) !== String(reader.bookId)) throw Error('CONTEXT_EXPIRED');
      if (String(chapterUid) !== environment.getChapterUid(reader)) throw Error('CHAPTER_CHANGED');
      if (!Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end) || range.start < 0 || range.end <= range.start) throw Error('INVALID_RANGE');
      const objects = environment.getObjects(reader, String(chapterUid), range);
      const selection = readVerticalSelection(reader, objects);
      if (!selection || selection.chapterUid !== String(chapterUid) || selection.range.start !== range.start || selection.range.end !== range.end) throw Error('ORIGINAL_TEXT_UNAVAILABLE');
      const context = { reader, objects, ...selection, bookId: String(reader.bookId),
        signature: environment.getSignature(reader), layoutVersion: environment.getLayoutVersion(),
        token: `text-${Date.now()}-${++sequence}`, busy: false, consumed: false };
      if (!valid(context)) throw Error('CONTEXT_EXPIRED');
      current = context;
      return { token: context.token, bookId: context.bookId, chapterUid: context.chapterUid,
        range: context.range, text: context.text, operations: capabilities(context) };
    },
    async execute(token, operation) {
      const context = current;
      if (!context || token !== context.token || !valid(context)) throw Error('CONTEXT_EXPIRED');
      if (!Object.hasOwn(capabilities(context), operation)) throw Error('UNKNOWN_OPERATION');
      if (context.busy || context.consumed) throw Error('OPERATION_BUSY');
      const capability = capabilities(context)[operation];
      if (!capability.enabled) throw Error(capability.reason);
      context.busy = true;
      try {
        // Copy validation returns the native text; clipboard write happens in the clicked UI.
        if (operation === 'copy') return { text: context.text };
        if (operation === 'underline') {
          const rects = context.reader.getRectsByContentObjs(context.objects);
          if (!Array.isArray(rects) || !rects.length || !environment.validateRects(rects)) throw Error('NATIVE_RESULT_INVALID');
          if (!valid(context)) throw Error('CONTEXT_EXPIRED');
          await context.reader.showSelectionToolBar({ objs: context.objects, rects });
        } else if (operation === 'writeThought') await context.reader.showWriteReviewPanel(context.objects);
        else if (operation === 'askAI') await context.reader.showAiChatPanel(context.text);
        context.consumed = true;
        return { opened: true };
      } catch (_error) {
        // Never retry an invocation whose native effect may already have happened.
        if (!['CONTEXT_EXPIRED', 'NATIVE_RESULT_INVALID'].includes(_error.message)) context.consumed = true;
        throw _error;
      } finally { context.busy = false; }
    },
  };
};
