// Fresh-profile, fully routed fixtures only. Never connect to a signed-in browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const output = path.resolve(__dirname, '../.test-artifacts/m5');
const longComment = '完整长评论：' + '历史与阅读。'.repeat(160) + '全文结尾标记';
const review = (id, uid, range, content, name = id, abstract = '') => ({
  review: { reviewId: id, chapterUid: uid, range, content, abstract, author: { name } },
});
const initial = [
  review('native-overlap', 12, '100-110', '原生重合评论', 'Alpha'),
  review('plain', 12, '0-10', '正文关键词', 'Beta', '引用关键词'),
  review('same-range', 12, '0-10', longComment, 'Gamma'),
  review('unmapped', 12, '900-910', '未定位全文', 'Delta'),
  review('quote', 12, '200-210', '另一个段落', 'Epsilon', '独特引用'),
];
const last = review('edge', 12, '300-310', '边缘段落评论', 'Zeta');
const chapterIds = [12, 13, 14, 15, 16, 17, 18];
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>M5 isolated Reader</title>
<style>body{margin:0;min-height:2400px}#reader{width:min(850px,calc(100vw - 32px));height:2200px;position:relative}
.wr_canvasContainer{position:relative;width:100%;height:2200px;background:#eef2f6}
.native-line{position:absolute;left:20px;top:280px;width:150px;height:28px;z-index:2;background:#ccd}
.reader_toolbar_container{position:absolute;top:460px;left:20px}</style></head>
<body class="wr_whiteTheme wr_reader_font_size_level_2"><div id="app">
<div class="readerTopBar_title_chapter">章节12</div><div id="reader" class="renderTargetContainer">
<div class="wr_canvasContainer"><span id="selectionText" style="position:absolute;top:180px;left:20px">可以拖选的正常正文</span>
<div id="nativeUnderline" class="wr_underline_wrapper native-line" onclick="metrics.nativeClicks++">原生划线</div>
<div class="reader_toolbar_container"><button id="nativeToolbar" onclick="metrics.toolbarClicks++">原生工具栏</button></div>
</div></div></div><script>window.__INITIAL_STATE__=${JSON.stringify({ reader: {
  bookId: '123', chapterInfos: chapterIds.map((uid) => ({ chapterUid: uid, title: `章节${uid}` })),
} })};
window.metrics={find:0,rects:0,capture:0,nativeClicks:0,toolbarClicks:0,selectionToolbar:0};
window.fixtureReader={ $options:{name:'reader'},currentChapterUid:'12',renderContentsVersion:1,
handleClickUnderline(){metrics.capture++;this.showSelectionToolBar();this.findObjsInOffsetRange([0,100,200,300].map(offset=>({offset,getOffset:()=>offset})),0,10)},
findObjsInOffsetRange(contents,start,end){metrics.find++;return contents.filter(x=>x.offset>=start&&x.offset<end)},
getRectsByContentObjs(objects){metrics.rects++;return objects.map(x=>({x:x.offset===300?document.querySelector('.wr_canvasContainer').clientWidth-170:20,y:180+x.offset,w:150,h:28}))},
showSelectionToolBar(){metrics.selectionToolbar++}};
window.originalDescriptors=Object.getOwnPropertyDescriptors(fixtureReader);
document.getElementById('app').__vue__=fixtureReader;
window.switchChapter=uid=>{fixtureReader.currentChapterUid=String(uid);fixtureReader.renderContentsVersion++;
document.querySelector('.readerTopBar_title_chapter').textContent='章节'+uid;
history.pushState({},'',location.pathname+'?bookId=123&chapterUid='+uid);dispatchEvent(new PopStateEvent('popstate'))};
</script></body></html>`;

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wxrc-m5-fixture-'));
  const extension = path.resolve(__dirname, '../build');
  const report = { controlledFixture: true, headless: process.env.WXRC_HEADLESS === '1', nodeVersion: process.version,
    playwrightVersion: require(process.env.PLAYWRIGHT_MODULE_PATH ? path.join(process.env.PLAYWRIGHT_MODULE_PATH, 'package.json') : 'playwright/package.json').version,
    cases: [], errors: [], requests: [] };
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: process.env.WXRC_HEADLESS === '1',
    viewport: { width: 1600, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  report.chromiumVersion = context.browser().version();
  let releaseSlow;
  let failurePending = true;
  let armSlow = false;
  const page = context.pages()[0];
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => report.errors.push(error.message));
  const check = async (name, action) => {
    const started = performance.now();
    try { await action(); report.cases.push({ name, passed: true, durationMs: Math.round(performance.now() - started) }); }
    catch (error) { report.cases.push({ name, passed: false, error: error.message }); throw error; }
  };
  const dataset = () => page.locator('.chrex-comment-wrapper').evaluate((node) => ({ ...node.dataset }));
  const settle = () => page.waitForTimeout(1100); // Observe one 1s chapter poll and the 180ms debounce.
  const waitReady = (uid, count) => page.waitForFunction(({ uid, count }) => {
    const node = document.querySelector('.chrex-comment-wrapper');
    return node?.dataset.chapterUid === String(uid) && node.dataset.compatibility === 'READY' &&
      node.dataset.reviewCount === String(count) &&
      (count === 0 ? node.dataset.mappedRangeCount === '0' : !!node.dataset.layoutVersion);
  }, { uid, count });
  const ids = () => page.locator('.comment-item').evaluateAll((nodes) => nodes.map((node) => node.dataset.reviewId));
  const expectIds = async (expected) => {
    await page.waitForFunction((expected) => JSON.stringify(Array.from(document.querySelectorAll('.comment-item'), (node) => node.dataset.reviewId)) === JSON.stringify(expected), expected);
    assert.deepEqual(await ids(), expected);
  };
  const switchChapter = (uid) => page.evaluate((uid) => window.switchChapter(uid), uid);
  const waitSlow = async () => {
    const deadline = Date.now() + 12000;
    while (!releaseSlow && Date.now() < deadline) await page.waitForTimeout(30);
    assert.ok(releaseSlow, 'Expected controlled slow request');
  };
  const fingerprint = () => page.evaluate(() => ({ mapping: window.m5.mapping, find: metrics.find, rects: metrics.rects, capture: metrics.capture }));
  const popup = () => page.getByRole('dialog', { name: '公开评论', exact: true });
  const surfaceClick = async (x, y) => {
    const box = await page.locator('.wr_canvasContainer').boundingBox();
    await page.mouse.click(box.x + x, box.y + y);
  };
  try {
    await context.route('https://weread.qq.com/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/web/review/list') {
        const uid = Number(url.searchParams.get('chapterUid'));
        report.requests.push({ chapterUid: uid, syncKey: url.searchParams.get('syncKey'), maxIdx: url.searchParams.get('maxIdx'), count: Number(url.searchParams.get('count')) });
        if ((uid === 14 || uid === 17) && armSlow) {
          armSlow = false;
          await new Promise((resolve) => { releaseSlow = resolve; });
          releaseSlow = null;
        }
        if (uid === 15 && failurePending) { failurePending = false; return route.fulfill({ status: 503, json: { error: 'controlled failure' } }); }
        let response;
        if (uid === 12) response = url.searchParams.has('syncKey')
          ? { reviews: [initial[1], last, review('foreign', 13, '0-10', '不应出现在本章')], hasMore: 0, chapterTotalCount: 6 }
          : { reviews: initial, hasMore: 1, synckey: 10, maxIdx: 2, chapterTotalCount: 6 };
        else if (uid === 13) response = { reviews: [], hasMore: 0 };
        else if (uid === 16) response = { reviews: Array.from({ length: 800 }, (_, i) => review(`stress-${i}`, uid, i % 2 ? '100-110' : '0-10', `压力评论${i}`)), hasMore: 0 };
        else if (uid === 17) response = { reviews: [review('stale-review', uid, '0-10', '旧章响应不可写回')], hasMore: 1, synckey: 17 };
        else response = { reviews: [review(`chapter-${uid}`, uid, '0-10', `章节${uid}完整评论`)], hasMore: 0 };
        return route.fulfill({ json: response });
      }
      if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: fixture });
      return route.abort(); // No real APIs, tracking, login, fonts or avatars.
    });
    await context.addInitScript(() => {
      window.m5 = { mapping: 0, popupCreations: 0, holdChapter: '', held: [] };
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element && node.classList.contains('wxrc_public_review_popup')) m5.popupCreations++;
        }
      }).observe(document, { childList: true, subtree: true });
      window.addEventListener('message', (event) => {
        if (event.source === window && event.data?.source === 'WXRC' && event.data.type === 'GET_RECTS_BATCH') m5.mapping++;
      });
      const nativePost = window.postMessage;
      window.postMessage = function (message, ...args) {
        if (message?.source === 'WXRC_PAGE' && message.type === 'RECTS_RESULT' && message.chapterUid === m5.holdChapter) {
          m5.held.push(message); return;
        }
        return nativePost.call(this, message, ...args);
      };
      window.releaseMapping = () => { m5.holdChapter = ''; for (const message of m5.held.splice(0)) nativePost.call(window, message, '*'); };
    });
    await page.goto('https://weread.qq.com/web/reader/m5-fixture?bookId=123&chapterUid=12');

    await check('分页、去重、章节过滤与按 range 合并映射', async () => {
      await waitReady(12, 6);
      await expectIds(['plain', 'same-range', 'native-overlap', 'quote', 'edge', 'unmapped']);
      assert.equal((await dataset()).reviewPageCount, '2');
      assert.equal((await dataset()).mappedRangeCount, '4');
      assert.equal((await dataset()).failedRangeCount, '1');
      assert.deepEqual(report.requests.map(({ syncKey, maxIdx }) => ({ syncKey, maxIdx })), [{ syncKey: null, maxIdx: null }, { syncKey: '10', maxIdx: '2' }]);
      assert.equal(await page.locator('.wxrc_public_review_wrapper').count(), 4);
      assert.equal(await page.locator('.wxrc_public_review_badge').count(), 1); // Only native-overlap ranges need a badge.
    });
    await check('正文／作者／引用搜索、组合筛选、无结果及清除恢复', async () => {
      await settle();
      const before = await fingerprint(); const network = report.requests.length;
      const search = page.getByLabel('搜索评论、引用或作者');
      for (const [query, expected] of [['正文关键词', ['plain']], ['Gamma', ['same-range']], ['独特引用', ['quote']], ['不存在的关键词', []]]) {
        await search.fill(query); await expectIds(expected);
      }
      await page.getByRole('button', { name: '清除筛选', exact: true }).click();
      await page.getByRole('combobox', { name: /^定位状态/ }).selectOption('unmapped'); await expectIds(['unmapped']);
      await search.fill('Delta'); await expectIds(['unmapped']);
      await page.getByRole('button', { name: '清除筛选', exact: true }).click();
      await expectIds(['plain', 'same-range', 'native-overlap', 'quote', 'edge', 'unmapped']);
      await page.getByLabel('右侧评论排序').selectOption('api');
      await expectIds(['native-overlap', 'plain', 'same-range', 'unmapped', 'quote', 'edge']);
      await settle(); assert.deepEqual(await fingerprint(), before); assert.equal(report.requests.length, network);
    });
    await check('引用键盘展开、紧凑密度及长评论全文保留', async () => {
      const quote = page.locator('[data-review-id="plain"] .comment-item-abstract');
      await quote.focus(); await page.keyboard.press('Enter'); assert.equal(await quote.getAttribute('aria-expanded'), 'true');
      await page.keyboard.press(' '); assert.equal(await quote.getAttribute('aria-expanded'), 'false');
      await page.getByRole('combobox', { name: /^显示密度/ }).selectOption('compact');
      assert.equal(await page.locator('[data-review-id="same-range"] .comment-item-content').innerText(), longComment);
      await page.waitForFunction(() => document.querySelector('.wxrc_comment_list')?.dataset.density === 'compact');
    });
    await check('五项设置持久化、刷新重建与侧栏恢复', async () => {
      await page.getByLabel('跟随阅读位置', { exact: true }).uncheck();
      await page.getByLabel('显示可点击评论划线', { exact: true }).uncheck();
      await page.getByRole('button', { name: '关闭右侧评论栏' }).click();
      const worker = context.serviceWorkers()[0];
      for (let i = 0; i < 30; i++) {
        const stored = await worker.evaluate(async () => (await chrome.storage.local.get('wxrc_phase6_settings')).wxrc_phase6_settings);
        if (stored?.showSidebar === false && stored?.showPublicUnderlines === false && stored?.followReadingPosition === false && stored?.sortOrder === 'api' && stored?.commentDensity === 'compact') break;
        if (i === 29) throw new Error('Settings were not persisted');
        await page.waitForTimeout(30);
      }
      await page.reload(); await waitReady(12, 6);
      assert.equal(await page.locator('.chrex-comment-wrapper').isVisible(), false);
      await page.getByRole('button', { name: '公开评论', exact: true }).click();
      assert.equal(await page.getByLabel('跟随阅读位置', { exact: true }).isChecked(), false);
      assert.equal(await page.getByLabel('显示可点击评论划线', { exact: true }).isChecked(), false);
      assert.equal(await page.getByLabel('右侧评论排序').inputValue(), 'api');
      assert.equal(await page.getByRole('combobox', { name: /^显示密度/ }).inputValue(), 'compact');
      await page.getByLabel('跟随阅读位置', { exact: true }).check();
      await page.getByLabel('显示可点击评论划线', { exact: true }).check();
      await page.getByLabel('右侧评论排序').selectOption('reading'); await settle();
      assert.equal(await page.locator('.chrex-comment-wrapper').count(), 1);
      assert.equal(await page.locator('.wxrc_sidebar_launcher').count(), 1);
      assert.equal(await page.locator('.wxrc_public_review_layer').count(), 1);
    });
    await check('日夜主题与 900px 窄窗口控件／popup 边界', async () => {
      const light = await page.locator('.comment-item').first().evaluate((node) => getComputedStyle(node).backgroundColor);
      await page.screenshot({ path: path.join(output, 'day-1600.png'), animations: 'disabled' });
      await page.evaluate(() => document.body.classList.remove('wr_whiteTheme'));
      await page.waitForFunction((light) => getComputedStyle(document.querySelector('.comment-item')).backgroundColor !== light, light);
      await page.screenshot({ path: path.join(output, 'night-1600.png'), animations: 'disabled' });
      await page.evaluate(() => document.body.classList.add('wr_whiteTheme'));
      await page.setViewportSize({ width: 900, height: 780 }); await settle();
      await page.screenshot({ path: path.join(output, 'day-900.png'), animations: 'disabled' });
      for (const label of ['搜索评论、引用或作者', '定位状态', '显示密度']) {
        const box = await page.getByLabel(label).boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= 900 && box.height >= 30, label);
      }
      await page.getByRole('button', { name: '关闭右侧评论栏' }).click(); await settle();
      const badge = page.locator('.wxrc_public_review_wrapper[data-range-key="12:300-310"]');
      await badge.focus(); await page.keyboard.press('Enter'); await popup().waitFor();
      const box = await popup().boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 900 && box.y + box.height <= 780);
      await page.keyboard.press('Escape'); assert.equal(await badge.evaluate((node) => node === document.activeElement), true);
      await page.setViewportSize({ width: 1600, height: 1000 }); await settle();
    });
    await check('非重合正文点击、原生重合划线与独立 badge', async () => {
      await page.evaluate(() => scrollTo(0, 0)); await settle();
      await surfaceClick(70, 192); await popup().waitFor();
      assert.equal(await popup().locator('.wxrc_public_review_popup_item').count(), 2);
      await page.keyboard.press('Escape');
      await page.locator('#nativeUnderline').click(); assert.equal(await page.evaluate(() => metrics.nativeClicks), 1);
      assert.equal(await popup().count(), 0);
      await page.locator('.wxrc_public_review_badge[data-range-key="12:100-110"]').click(); await popup().waitFor();
      assert.equal(await popup().locator('.wxrc_public_review_popup_item').count(), 1);
      await page.keyboard.press('Escape');
      await page.locator('#nativeToolbar').click(); assert.equal(await page.evaluate(() => metrics.toolbarClicks), 1); assert.equal(await popup().count(), 0);
    });
    await check('原生拖选不被评论 popup 抢占', async () => {
      const box = await page.locator('.wr_canvasContainer').boundingBox();
      await page.mouse.move(box.x + 25, box.y + 192); await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y + 192, { steps: 8 }); await page.mouse.up();
      assert.equal(await popup().count(), 0);
      await page.evaluate(() => getSelection().removeAllRanges());
    });
    await check('字号／resize 恢复复用评论并精确恢复原生方法', async () => {
      await settle(); const network = report.requests.length; const version = (await dataset()).layoutVersion;
      await page.evaluate(() => { document.body.classList.replace('wr_reader_font_size_level_2', 'wr_reader_font_size_level_3'); fixtureReader.renderContentsVersion++; });
      await page.waitForFunction((version) => document.querySelector('.chrex-comment-wrapper')?.dataset.layoutVersion !== version, version);
      await waitReady(12, 6); await page.setViewportSize({ width: 1500, height: 900 }); await settle();
      assert.equal(report.requests.length, network);
      assert.equal(await page.evaluate(() => ['findObjsInOffsetRange', 'showSelectionToolBar'].every((key) => {
        const current = Object.getOwnPropertyDescriptor(fixtureReader, key); const original = originalDescriptors[key];
        return current.value === original.value && current.configurable === original.configurable && current.writable === original.writable && current.enumerable === original.enumerable;
      })), true);
      assert.equal(await page.evaluate(() => metrics.selectionToolbar), 0);
    });
    await check('滚动、hover 与侧栏滚动热路径零映射／零接口请求', async () => {
      await page.getByRole('button', { name: '公开评论', exact: true }).click(); await settle();
      const before = await fingerprint(); const network = report.requests.length;
      await page.mouse.move(70, 192); await page.mouse.wheel(0, 400);
      await page.evaluate(() => { for (let i = 0; i < 30; i++) { dispatchEvent(new Event('scroll')); document.querySelector('.comment-react-wrapper').dispatchEvent(new Event('scroll')); } });
      await settle(); assert.deepEqual(await fingerprint(), before); assert.equal(report.requests.length, network);
    });
    await check('切章清空筛选与旧 popup、空章节正确显示', async () => {
      await page.getByLabel('搜索评论、引用或作者').fill('Beta'); await page.getByRole('combobox', { name: /^定位状态/ }).selectOption('mapped');
      await page.getByRole('button', { name: '关闭右侧评论栏' }).click(); await settle();
      await page.locator('.wxrc_public_review_badge').first().focus(); await page.keyboard.press('Enter'); await popup().waitFor();
      await switchChapter(13); await waitReady(13, 0);
      assert.equal(await popup().count(), 0); assert.equal(await page.locator('.wxrc_public_review_wrapper').count(), 0);
      await page.getByRole('button', { name: '公开评论', exact: true }).click();
      assert.equal(await page.getByLabel('搜索评论、引用或作者').inputValue(), '');
      assert.equal(await page.getByRole('combobox', { name: /^定位状态/ }).inputValue(), 'all');
      assert.ok((await page.locator('.wxrc_empty_state').innerText()).includes('本章暂无公开评论'));
    });
    await check('慢请求加载状态与 HTTP 错误重试', async () => {
      armSlow = true; await switchChapter(14);
      await waitSlow();
      await page.getByText('正在加载公开评论…', { exact: true }).waitFor(); assert.equal(await page.locator('.comment-item').count(), 0);
      releaseSlow(); await waitReady(14, 1); await switchChapter(15);
      await page.getByRole('alert').waitFor(); assert.ok((await page.getByRole('alert').innerText()).includes('公开评论加载失败'));
      await page.getByRole('button', { name: '重试', exact: true }).click(); await waitReady(15, 1);
      await expectIds(['chapter-15']);
    });
    await check('跨章慢响应不继续旧章分页或写入新章', async () => {
      armSlow = true; await switchChapter(17); await waitSlow();
      await switchChapter(18); await settle(); releaseSlow(); await waitReady(18, 1);
      await expectIds(['chapter-18']);
      assert.equal(report.requests.filter((request) => request.chapterUid === 17).length, 1, 'Old chapter must not request another page');
    });
    await check('延迟 range 响应不能重建旧章划线／popup／定位索引', async () => {
      await settle(); await page.evaluate(() => { m5.holdChapter = '18'; fixtureReader.renderContentsVersion++; });
      await page.waitForFunction(() => m5.held.length > 0); await switchChapter(13); await settle();
      await page.evaluate(() => releaseMapping()); await waitReady(13, 0);
      assert.equal(await page.locator('.wxrc_public_review_layer').count(), 0); assert.equal(await page.locator('.wxrc_jump_to_text').count(), 0); assert.equal(await popup().count(), 0);
    });
    await check('800 条评论按 2 个 range 批量映射，稳定滚动无额外工作', async () => {
      const before = await fingerprint(); await switchChapter(16); await waitReady(16, 800); await settle();
      assert.equal(await page.locator('.comment-item').count(), 800);
      assert.equal(await page.locator('.wxrc_public_review_wrapper').count(), 2);
      const counts = JSON.parse((await dataset()).mappingCallCounts);
      assert.equal((await fingerprint()).mapping - before.mapping, 1); assert.equal(counts.findObjsInOffsetRangeCalls - before.rects, 2);
      const stable = await fingerprint(); const network = report.requests.length;
      await page.mouse.move(200, 500); await page.mouse.wheel(0, 900); await settle();
      assert.deepEqual(await fingerprint(), stable); assert.equal(report.requests.length, network);
      report.stress = { commentCount: 800, uniqueRanges: 2, mappingBatchDelta: 1, steadyMappingDelta: 0, steadyReviewRequestDelta: 0 };
    });
    await check('重复布局与页面重建无重复侧栏、划线层或事件响应', async () => {
      await switchChapter(18); await waitReady(18, 1); await settle();
      for (let i = 0; i < 3; i++) {
        const version = (await dataset()).layoutVersion;
        await page.evaluate(() => fixtureReader.renderContentsVersion++);
        await page.waitForFunction((version) => document.querySelector('.chrex-comment-wrapper')?.dataset.layoutVersion !== version, version);
        await waitReady(18, 1);
        assert.equal(await page.locator('.chrex-comment-wrapper').count(), 1); assert.equal(await page.locator('.wxrc_public_review_layer').count(), 1);
      }
      await page.goto('https://weread.qq.com/web/reader/m5-fixture?bookId=123&chapterUid=12'); await waitReady(12, 6); await settle();
      assert.equal(await page.locator('.chrex-comment-wrapper').count(), 1); assert.equal(await page.locator('.wxrc_sidebar_launcher').count(), 1);
      await page.getByRole('button', { name: '关闭右侧评论栏' }).click(); await settle();
      const popupCreations = await page.evaluate(() => m5.popupCreations);
      await surfaceClick(70, 192); await popup().waitFor(); assert.equal(await popup().count(), 1);
      assert.equal(await popup().locator('.wxrc_public_review_popup_item').count(), 2);
      assert.equal(await page.evaluate(() => m5.popupCreations), popupCreations + 1, 'One click must create one popup, even if older popups would be removed');
    });
    assert.deepEqual(report.errors, []); report.passed = true;
    const failureImage = path.join(output, 'failure.png');
    if (fs.existsSync(failureImage)) fs.unlinkSync(failureImage);
  } catch (error) {
    report.passed = false; report.failure = error.stack;
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    releaseSlow?.();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, controlledFixture: true, cases: report.cases, stress: report.stress, errors: report.errors, report: path.join(output, 'report.json') }, null, 2));
    await context.close();
    // Only remove this run's own direct child of the system temp directory.
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(profile));
    if (!relative.startsWith('..') && !path.isAbsolute(relative) && !relative.includes(path.sep) && relative.startsWith('wxrc-m5-fixture-')) fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
