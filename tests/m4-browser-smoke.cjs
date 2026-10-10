// Controlled fixtures in a real extension-enabled Chromium; not a live WeRead acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>M4 controlled Reader</title></head>
<body class="wr_whiteTheme"><div id="app"><div class="readerTopBar_title_chapter">测试章节</div>
<button id="native" onclick="window.nativeClicks++">原生阅读操作</button>
<div class="renderTargetContainer" style="position:relative;width:750px;height:1500px">
<div class="wr_canvasContainer" style="position:relative;width:750px;height:1500px">正常正文</div></div></div>
<script>window.__INITIAL_STATE__={"reader":{"bookInfo":{"bookId":"123"},"chapterInfos":[{"chapterUid":12,"title":"测试章节"}],"currentChapterUid":12}};
window.nativeClicks=0;window.fixtureReader={
$options:{name:'reader'},currentChapterUid:'12',renderContentsVersion:1,
handleClickUnderline(){this.showSelectionToolBar();this.findObjsInOffsetRange([{getOffset:()=>0}],0,5)},
findObjsInOffsetRange(contents){return contents},getRectsByContentObjs(){return [{x:20,y:180,w:150,h:30}]},
showSelectionToolBar(){window.nativeToolbarCalls=(window.nativeToolbarCalls||0)+1}
};document.getElementById('app').__vue__=window.fixtureReader;</script></body></html>`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wxrc-m4-fixture-'));
  const extension = path.resolve(__dirname, '../build');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: false, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  let reviewRequests = 0;
  const checks = [];
  const errors = [];
  try {
    await context.route('https://weread.qq.com/**', async (route) => {
      const endpoint = new URL(route.request().url()).pathname;
      if (endpoint === '/web/review/list') {
        reviewRequests++;
        return route.fulfill({ json: { reviews: [
          { review: { reviewId: 'a', chapterUid: 12, range: '0-5', content: '可以搜索的公开评论', author: { name: '读者' } } },
          { review: { reviewId: 'b', chapterUid: 12, range: '0-5', content: '另一条公开评论' } },
        ], hasMore: 0, totalCount: 2 } });
      }
      if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: fixture });
      return route.abort();
    });
    const page = context.pages()[0];
    page.setDefaultTimeout(8000);
    page.on('pageerror', (error) => errors.push(error.message));
    await context.addInitScript(() => {
      window.mappingRequests = 0;
      window.addEventListener('message', (event) => {
        if (event.data?.source === 'WXRC' && event.data.type === 'GET_RECTS_BATCH') window.mappingRequests++;
      });
    });
    await page.goto('https://weread.qq.com/web/reader/m4-fixture?bookId=123&chapterUid=12');
    const waitCode = (code) => page.waitForFunction((expected) =>
      document.querySelector('.chrex-comment-wrapper')?.dataset.compatibility === expected, code);
    await waitCode('READY');
    assert.equal(await page.locator('.comment-item').count(), 2);
    assert.ok(await page.locator('.wxrc_public_review_wrapper').count());
    checks.push('正常 Reader 保留评论及 range→rect');
    await page.waitForTimeout(1000);
    const originalMethods = await page.evaluate(() => {
      window.savedRects = fixtureReader.getRectsByContentObjs;
      window.savedFind = fixtureReader.findObjsInOffsetRange;
      window.savedToolbar = fixtureReader.showSelectionToolBar;
      fixtureReader.getRectsByContentObjs = undefined;
      return true;
    });
    assert.equal(originalMethods, true);
    await waitCode('READER_METHODS_MISSING');
    assert.equal(await page.locator('.wxrc_public_review_wrapper').count(), 0);
    assert.equal(await page.locator('.wxrc_public_review_badge').count(), 0);
    assert.equal(await page.locator('.comment-item').count(), 2);
    assert.equal(await page.locator('.wxrc_jump_to_text').count(), 0);
    await page.getByLabel('搜索评论、引用或作者').fill('可以搜索');
    assert.equal(await page.locator('.comment-item').count(), 1);
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.locator('#native').click();
    assert.equal(await page.evaluate(() => nativeClicks), 1);
    assert.equal(await page.evaluate(() => window.nativeToolbarCalls || 0), 0);
    checks.push('缺失方法安全降级，保留搜索、全文和原生操作');
    const networkBeforeRetry = reviewRequests;
    const mappingBeforeRetry = await page.evaluate(() => mappingRequests);
    await page.getByRole('button', { name: '重试定位', exact: true }).click();
    await page.waitForTimeout(700);
    assert.equal(reviewRequests, networkBeforeRetry);
    assert.equal(await page.evaluate(() => mappingRequests), mappingBeforeRetry);
    checks.push('不兼容重试仅检测能力，不重取评论或执行映射');
    await page.evaluate(() => { fixtureReader.getRectsByContentObjs = savedRects; });
    await waitCode('READY');
    await page.locator('.wxrc_public_review_wrapper').first().waitFor();
    assert.equal(reviewRequests, networkBeforeRetry);
    checks.push('能力恢复后自动定位，复用完整评论');
    await page.evaluate(() => { fixtureReader.getRectsByContentObjs = () => null; fixtureReader.renderContentsVersion++; });
    await waitCode('READER_RESULT_INVALID');
    assert.equal(await page.locator('.wxrc_public_review_wrapper').count(), 0);
    assert.equal(await page.evaluate(() => fixtureReader.findObjsInOffsetRange === savedFind && fixtureReader.showSelectionToolBar === savedToolbar), true);
    await page.evaluate(() => { fixtureReader.getRectsByContentObjs = savedRects; fixtureReader.renderContentsVersion++; });
    await waitCode('READY');
    checks.push('返回格式改变安全降级、hook 恢复、布局更新可恢复');
    await page.evaluate(() => document.querySelector('.wr_canvasContainer').classList.remove('wr_canvasContainer'));
    await waitCode('CANVAS_UNAVAILABLE');
    assert.equal(await page.locator('.comment-item').count(), 2);
    await page.evaluate(() => document.querySelector('.renderTargetContainer').firstElementChild.classList.add('wr_canvasContainer'));
    await waitCode('READY');
    checks.push('画布丢失后降级，恢复后重新定位');
    await page.waitForTimeout(800);
    const mappingBeforeScroll = await page.evaluate(() => mappingRequests);
    await page.mouse.move(400, 600);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => mappingRequests), mappingBeforeScroll);
    assert.equal(reviewRequests, networkBeforeRetry);
    checks.push('滚动不执行 range 映射或重取评论');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, controlledFixture: true, checks, reviewRequests, errors }, null, 2));
  } finally { await context.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
