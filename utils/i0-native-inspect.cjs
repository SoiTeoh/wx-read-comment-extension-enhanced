// Explicit local inspection only. Connect to the user-authorized desktop browser.
// This tool never invokes native operations, exports login state, or submits content.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

(async () => {
  const browser = await chromium.connectOverCDP(process.env.WXRC_CDP_URL || 'http://127.0.0.1:9231');
  try {
    const page = browser.contexts()[0].pages().find(p => /^https:\/\/weread\.qq\.com\/web\/reader\//.test(p.url()));
    if (!page) throw new Error('No desktop WeRead Reader tab found');
    const report = await page.evaluate(async () => {
      const baseline = await new Promise((resolve, reject) => {
        const requestId = `i0-${Date.now()}`;
        const listener = event => {
          if (event.source !== window || event.data?.source !== 'WXRC_PAGE' || event.data?.requestId !== requestId) return;
          window.removeEventListener('message', listener);
          clearTimeout(timer);
          resolve(event.data.baseline);
        };
        const timer = setTimeout(() => {
          window.removeEventListener('message', listener);
          reject(new Error('Native baseline bridge timed out'));
        }, 5000);
        window.addEventListener('message', listener);
        window.postMessage({ source: 'WXRC', type: 'GET_NATIVE_OPERATION_BASELINE', requestId }, '*');
      });
      const visible = element => element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
      const labels = [...document.querySelectorAll('.reader_toolbar_container .toolbarItem, .reader_floatReviewsPanel_content .review_section_toolbar_item')]
        .filter(visible).map(element => element.textContent.trim()).filter(Boolean);
      return { baseline, nativeToolbarLabels: [...new Set(labels)],
        domSelectionHasText: Boolean(window.getSelection()?.toString().trim()),
        hasNativeReviewCards: [...document.querySelectorAll('.reader_float_reviews_panel_item')].some(visible),
        capturedAt: new Date().toISOString() };
    });
    const output = path.resolve(__dirname, '../.test-artifacts/i0');
    fs.mkdirSync(output, { recursive: true });
    const label = ['horizontal', 'vertical'].includes(process.env.WXRC_INSPECTION_LABEL)
      ? `-${process.env.WXRC_INSPECTION_LABEL}` : '';
    fs.writeFileSync(path.join(output, `native-baseline${label}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close(); // Disconnect CDP; leave the desktop browser open.
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
