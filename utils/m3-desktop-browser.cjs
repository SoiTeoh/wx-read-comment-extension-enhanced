// Start from an elevated exec_command so headed Chromium uses the Windows desktop.
// The temporary profile is outside the repository; never export cookies or tokens.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wxrc-m3-desktop-'));
  const extension = path.resolve(__dirname, '../build');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: false, viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9231',
    ],
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://weread.qq.com/web/reader/a57325c05c8ed3a57224187', { waitUntil: 'domcontentloaded' });
  await page.locator('.readerTopBar_link').filter({ hasText: /^登录$/ }).click({ timeout: 15000 });
  console.log(JSON.stringify({ chromiumStarted: true, headed: true, loginOpened: true, cdp: 'http://127.0.0.1:9231' }));
  await new Promise(resolve => context.on('close', resolve));
})().catch(error => { console.error(error); process.exitCode = 1; });
