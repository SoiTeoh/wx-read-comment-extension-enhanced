// Enable locally only when investigating a Reader/runtime issue.
export const DEBUG = false;

export const debugLog = (area: string, label: string, data?: unknown): void => {
  if (!DEBUG) return;
  const prefix = `[WxReadComments][${area}] ${label}`;
  if (typeof data === 'undefined') console.info(prefix);
  else console.info(prefix, data);
};
