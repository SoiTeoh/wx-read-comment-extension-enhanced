const entries = [
  ['copy', '复制', 'M8 4h10v14H8z M5 8H3v13h11v-2 M11 8h4 M11 11h4'],
  ['underline', '划线', 'M5 19h14 M8 15l4-11 4 11 M9 12h6'],
  ['writeThought', '写想法', 'M8 18v-3a6 6 0 1 1 8 0v3 M9 21h6'],
  ['askAI', 'AI 问书', 'M15 15l5 5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0'],
];
const reasons = {
  LOGIN_REQUIRED: '请先登录微信读书', AI_UNAVAILABLE: '本书暂不可用 AI 问书',
  NATIVE_ENTRY_UNAVAILABLE: '当前 Reader 不支持此原生入口',
  CONTEXT_EXPIRED: '原文上下文已变化，请重新打开评论',
  ORIGINAL_TEXT_UNAVAILABLE: '无法核实完整原文，操作暂不可用',
  CHAPTER_CHANGED: '章节已变化，请重新打开评论',
  READING_MODE_DISABLED: '操作仅在上下滚动模式可用',
  NATIVE_RESULT_INVALID: '原生定位结果不可用，请重新打开评论',
  OPERATION_BUSY: '操作已打开，请在原生界面继续',
};

export const createNativeTextToolbar = ({ popup, group, request, close, reposition }) => {
  const toolbar = document.createElement('div');
  toolbar.className = 'wxrc_text_operations';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', '原文操作');
  const quote = document.createElement('div');
  quote.className = 'wxrc_text_operation_quote';
  const status = document.createElement('div');
  status.className = 'wxrc_text_operation_status';
  status.setAttribute('role', 'status');
  status.textContent = '正在核实原文…';
  let context = null, busy = false;
  const buttons = new Map();
  const disableAll = () => buttons.forEach(button => { button.disabled = true; });
  for (const [id, label, path] of entries) {
    const button = document.createElement('button');
    button.type = 'button'; button.disabled = true; button.dataset.operation = id;
    button.title = '正在核实原文';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path); svg.appendChild(shape);
    const text = document.createElement('span'); text.textContent = label;
    button.append(svg, text); toolbar.appendChild(button); buttons.set(id, button);
    button.addEventListener('click', async () => {
      if (busy || !context || !popup.isConnected) return;
      busy = true; disableAll(); status.textContent = id === 'copy' ? '正在复制原文…' : '正在打开原生操作…';
      try {
        const response = await request('EXECUTE_TEXT_OPERATION', { token: context.token, operation: id });
        if (!popup.isConnected) return;
        if (id === 'copy') {
          if (response.result?.text !== context.text) throw Error('CONTEXT_EXPIRED');
          await navigator.clipboard.writeText(response.result.text);
          if (!popup.isConnected) return;
          status.textContent = '已复制原文';
          buttons.forEach((node, key) => { node.disabled = !context.operations[key]?.enabled; });
          button.focus({ preventScroll: true });
        } else close();
      } catch (error) {
        if (!popup.isConnected) return;
        status.textContent = reasons[error.message] || (id === 'copy' ? '复制失败，请检查浏览器剪贴板权限后重新打开评论' : '原生操作未确认，请检查页面；插件不会自动重试');
        // No automatic retries: a native invocation may have produced a visible side effect.
      } finally { busy = false; }
    });
  }
  void request('PREPARE_TEXT_OPERATIONS', { bookId: document.querySelector('.chrex-comment-wrapper')?.dataset.bookId,
    chapterUid: group.key.split(':')[0], range: { start: group.range.start, end: group.range.end } })
    .then(response => {
      if (!popup.isConnected) return;
      context = response.result;
      quote.textContent = context.text; quote.title = context.text;
      buttons.forEach((button, id) => {
        const capability = context.operations[id]; button.disabled = !capability?.enabled;
        button.title = capability?.enabled ? id === 'underline' ? '打开官方划线工具，选择样式或删除已有划线' : id === 'writeThought' ? '打开原生想法编辑器，由你提交' : id === 'askAI' ? '将这段原文带入官方 AI 问书' : '复制这段原文'
          : reasons[capability?.reason] || '此操作暂不可用';
      });
      const unavailable = entries.filter(([id]) => !context.operations[id]?.enabled)
        .map(([id, label]) => `${label}：${reasons[context.operations[id]?.reason] || '暂不可用'}`);
      status.textContent = unavailable.length ? unavailable.join('；') : '针对这段原文 · 划线和想法由原生界面继续';
      reposition();
    }).catch(error => {
      if (!popup.isConnected) return;
      disableAll(); status.textContent = reasons[error.message] || '无法核实原文，操作暂不可用'; reposition();
    });
  return { toolbar, quote, status };
};
