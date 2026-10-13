const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH ||
    'playwright'),
  { fixture } = require('./i3-browser-regression.cjs');
(async () => {
  const output = path.resolve(__dirname, '../.test-artifacts/u3');
  fs.mkdirSync(output, { recursive: true });
  const context = await chromium.launchPersistentContext(
    fs.mkdtempSync(path.join(os.tmpdir(), 'wxrc-u3-')),
    {
      channel: 'chromium',
      headless: process.env.WXRC_HEADLESS === '1',
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
      args: [
        `--disable-extensions-except=${path.resolve(__dirname, '../build')}`,
        `--load-extension=${path.resolve(__dirname, '../build')}`,
      ],
    }
  );
  const page = context.pages()[0],
    report = {
      controlledFixture: true,
      cases: [],
      errors: [],
      reads: 0,
      writes: 0,
    };
  page.on('pageerror', (e) => report.errors.push(e.message));
  const entries = [0, 1].map((i) => ({
    reviewId: 'favorite-' + i,
    review: {
      reviewId: 'favorite-' + i,
      bookId: '123',
      chapterUid: 12,
      range: '0-10',
      content: i ? '第二条公开想法' + '收藏段落。'.repeat(150) + '完整收藏末尾' : '完整收藏正文 &lt;文字&gt;<br>第二行',
      abstract: '接口附带引用',
      author: { name: '收藏作者 ' + i },
      isLike: 0,
      isPrivate: 0,
    },
  }));
  const check = async (name, fn) => {
    await fn();
    report.cases.push({ name, passed: true });
    console.log('PASS: ' + name);
  };
  const popup = () => page.locator('.wxrc_public_review_popup'),
    manager = () => page.getByRole('dialog', { name: '本地收藏', exact: true });
  const open = async () => {
    await page.locator('.wxrc_public_review_wrapper').first().focus();
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await popup().waitFor();
  };
  const savedButton = (root, index = 0) =>
    root.locator('[data-favorite-action="toggle"]').nth(index);
  try {
    await context.route('https://weread.qq.com/**', (route) => {
      const r = route.request(),
        u = new URL(r.url());
      if (r.method() === 'POST') {
        report.writes++;
        return route.abort();
      }
      if (u.pathname === '/web/review/list') {
        report.reads++;
        return route.fulfill({
          json: {
            hasMore: 0,
            reviews: u.searchParams.get('chapterUid') === '12' ? entries : [],
          },
        });
      }
      return r.isNavigationRequest()
        ? route.fulfill({ contentType: 'text/html', body: fixture })
        : route.abort();
    });
    await page.goto(
      'https://weread.qq.com/web/reader/u3-fixture?bookId=123&chapterUid=12'
    );
    await page.waitForFunction(
      () =>
        document.querySelector('.chrex-comment-wrapper')?.dataset
          .compatibility === 'READY'
    );
    await check(
      'No automatic collection; sidebar save is local and shares the popup state',
      async () => {
        await page
          .getByRole('button', { name: '本地收藏', exact: true })
          .click();
        await manager().getByText('暂无收藏', { exact: false }).waitFor();
        await manager().getByRole('button', { name: '关闭收藏' }).click();
        await savedButton(page.locator('.chrex-comment-wrapper')).evaluate(
          (e) => {
            e.click();
            e.click();
          }
        );
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-favorite-action="toggle"]')
              ?.getAttribute('aria-pressed') === 'true'
        );
        await open();
        assert.equal(
          await savedButton(popup()).getAttribute('aria-pressed'),
          'true'
        );
        assert.equal(report.writes, 0);
      }
    );
    await check(
      'Popup saves a verified quote without a single-review or write request',
      async () => {
        await page.waitForFunction(
          () =>
            document.querySelector('.wxrc_text_operation_quote')
              ?.textContent === '上下滚动原文'
        );
        const reads = report.reads;
        await savedButton(popup(), 1).click();
        await page.waitForFunction(
          () =>
            document
              .querySelectorAll(
                '.wxrc_public_review_popup [data-favorite-action="toggle"]'
              )[1]
              ?.getAttribute('aria-pressed') === 'true'
        );
        assert.equal(report.reads, reads);
        assert.equal(report.writes, 0);
        await popup()
          .getByRole('button', { name: '本地收藏', exact: true })
          .click();
        await manager().locator('.wxrc_favorite_card').nth(1).waitFor();
        assert.match(await manager().innerText(), /已核实原文/);
        const expand = manager().getByRole('button', { name: '展开全文', exact: true });
        await expand.focus(); await page.keyboard.press('Enter');
        assert.equal(await manager().getByRole('button', { name: '收起全文', exact: true }).getAttribute('aria-expanded'), 'true');
        assert.match(await manager().innerText(), /完整收藏末尾/);
        assert.match(await manager().innerText(), /公开想法附带引用/);
      }
    );
    await check(
      'Search is local and export contains all entries and complete escaped text',
      async () => {
        await page.getByLabel('搜索本地收藏').fill('收藏作者 1');
        assert.equal(await manager().locator('.wxrc_favorite_card').count(), 1);
        await page.getByLabel('搜索本地收藏').fill('不存在');
        assert.equal(await manager().locator('.wxrc_favorite_card').count(), 0);
        const downloadPromise = page.waitForEvent('download');
        await manager()
          .getByRole('button', { name: '导出全部 Markdown' })
          .click();
        const download = await downloadPromise;
        const file = path.join(output, 'favorites.md');
        await download.saveAs(file);
        const markdown = fs.readFileSync(file, 'utf8');
        assert.match(markdown, /完整收藏正文 \\<文字\\>/);
        assert.match(markdown, /第二条公开想法/);
        assert.match(markdown, /上下滚动原文/);
        assert.match(markdown, /接口附带引用/);
        assert.equal(report.writes, 0);
      }
    );
    await check(
      'Reload and chapter change preserve saved snapshots without collecting new entries',
      async () => {
        await manager().getByRole('button', { name: '关闭收藏' }).click();
        await page.reload();
        await page.waitForFunction(
          () =>
            document.querySelector('.chrex-comment-wrapper')?.dataset
              .compatibility === 'READY'
        );
        await page
          .getByRole('button', { name: '本地收藏', exact: true })
          .click();
        await manager().locator('.wxrc_favorite_card').nth(1).waitFor();
        assert.equal(await manager().locator('.wxrc_favorite_card').count(), 2);
        await page.evaluate(() => switchChapter(13));
        await manager().waitFor({ state: 'detached' });
        await page.waitForFunction(
          () =>
            document.querySelector('.chrex-comment-wrapper')?.dataset
              .chapterUid === '13'
        );
        await page
          .getByRole('button', { name: '本地收藏', exact: true })
          .click();
        assert.equal(await manager().locator('.wxrc_favorite_card').count(), 2);
      }
    );
    await check(
      'Invalid storage fails visibly without erasing the last valid collection',
      async () => {
        const worker = context.serviceWorkers()[0];
        const previous = await worker.evaluate(async () => {
          const data = await chrome.storage.local.get(
            'wxrc_local_favorites_v1'
          );
          await chrome.storage.local.set({
            wxrc_local_favorites_v1: { version: 999, items: [] },
          });
          return data.wxrc_local_favorites_v1;
        });
        await manager()
          .getByRole('button', { name: '删除收藏' })
          .first()
          .click();
        await page.waitForFunction(() =>
          document
            .querySelector('.wxrc_favorites_dialog [role="status"]')
            ?.textContent.includes('收藏数据无法读取')
        );
        assert.equal(await manager().locator('.wxrc_favorite_card').count(), 2);
        await worker.evaluate(
          (value) =>
            chrome.storage.local.set({ wxrc_local_favorites_v1: value }),
          previous
        );
      }
    );
    await check(
      'Single delete and two-step clear update local state; cancelling clear keeps entries',
      async () => {
        await page.getByLabel('搜索本地收藏').fill('收藏作者 1');
        await manager().getByRole('button', { name: '删除收藏' }).click();
        await page.waitForFunction(() =>
          document
            .querySelector('.wxrc_favorites_dialog [role="status"]')
            ?.textContent.includes('/ 1 条')
        );
        await manager()
          .getByRole('button', { name: '清空全部收藏', exact: true })
          .click();
        assert.equal(
          await manager()
            .getByRole('button', { name: '确认清空全部收藏' })
            .count(),
          1
        );
        await manager().getByRole('button', { name: '取消清空' }).click();
        assert.match(await manager().innerText(), /1 条/);
        await manager()
          .getByRole('button', { name: '清空全部收藏', exact: true })
          .click();
        await manager()
          .getByRole('button', { name: '确认清空全部收藏' })
          .click();
        await manager().getByText('暂无收藏', { exact: false }).waitFor();
      }
    );
    await check(
      'Narrow/day/night manager retains modal keyboard focus and closes on mode exit',
      async () => {
        await page.setViewportSize({ width: 390, height: 800 });
        assert.equal(
          await manager().evaluate(
            (e) => e.getBoundingClientRect().right <= innerWidth
          ),
          true
        );
        await page.screenshot({ path: path.join(output, 'day.png') });
        await page.evaluate(() =>
          document.body.classList.remove('wr_whiteTheme')
        );
        await page.screenshot({ path: path.join(output, 'night.png') });
        await manager().getByRole('button', { name: '关闭收藏' }).focus();
        await page.keyboard.press('Shift+Tab');
        assert.equal(
          await page
            .getByLabel('搜索本地收藏')
            .evaluate((e) => e === document.activeElement),
          true
        );
        await page.keyboard.press('Escape');
        await manager().waitFor({ state: 'detached' });
        await page
          .getByRole('button', { name: '本地收藏', exact: true })
          .click();
        await page.evaluate(() => switchMode('horizontal'));
        await manager().waitFor({ state: 'detached' });
        assert.equal(report.writes, 0);
      }
    );
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    report.failure = error.stack;
    process.exitCode = 1;
    console.error(error);
  } finally {
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(report, null, 2)
    );
    await context.close();
  }
})();
