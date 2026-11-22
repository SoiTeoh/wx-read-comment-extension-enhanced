export const REQUEST_SOURCE = 'WXRC';
export const RESPONSE_SOURCE = 'WXRC_PAGE';
export const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

const RESPONSE_TYPES = new Set([
  'PONG',
  'RECTS_RESULT',
  'CAPABILITIES_RESULT',
  'TEXT_OPERATIONS_RESULT',
  'TEXT_OPERATION_RESULT',
]);

/**
 * Create a postMessage bridge client between content script and pageBridge.
 */
export const createBridgeClient = ({
  onLayoutInvalidated,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) => {
  const pendingRequests = new Map();
  let requestSequence = 0;
  let listenerInstalled = false;

  const createRequestId = () =>
    `wxrc-${Date.now()}-${++requestSequence}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const onPageMessage = (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || message.source !== RESPONSE_SOURCE) return;

    if (message.type === 'LAYOUT_INVALIDATED') {
      onLayoutInvalidated?.(message.reason || 'page-layout');
      return;
    }

    if (
      !RESPONSE_TYPES.has(message.type) ||
      typeof message.requestId !== 'string'
    ) {
      return;
    }

    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;
    pendingRequests.delete(message.requestId);
    window.clearTimeout(pending.timer);

    if (message.error) {
      pending.reject(
        Object.assign(new Error(message.error), { code: message.errorCode })
      );
    } else {
      pending.resolve(message);
    }
  };

  const install = () => {
    if (listenerInstalled) return;
    listenerInstalled = true;
    window.addEventListener('message', onPageMessage);
  };

  const sendRequest = (type, payload = {}) =>
    new Promise((resolve, reject) => {
      const requestId = createRequestId();
      const timer = window.setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(
          Object.assign(new Error(`${type} timed out`), {
            code: 'BRIDGE_TIMEOUT',
          })
        );
      }, timeoutMs);
      pendingRequests.set(requestId, { resolve, reject, timer });
      window.postMessage(
        { source: REQUEST_SOURCE, type, requestId, ...payload },
        '*'
      );
    });

  const postInvalidateLayout = (reason) => {
    window.postMessage(
      { source: REQUEST_SOURCE, type: 'INVALIDATE_LAYOUT', reason },
      '*'
    );
  };

  return {
    install,
    sendRequest,
    postInvalidateLayout,
  };
};
