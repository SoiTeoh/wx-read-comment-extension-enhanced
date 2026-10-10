// Isolated horizontal Reader fixture; all network requests are intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = path.resolve(__dirname, '../.test-artifacts/i1');
const fixture = `<!doctype html><meta charset="utf-8"><title>I1 horizontal Reader</title>
<style>body{margin:0}.renderTargetContainer{position:relative;margin:80px 40px;width:1100px;height:700px}.wr_canvasContainer{position:relative;width:100%;height:700px;background:#f7f6f2}.native-text{position:absolute;top:120px;left:30px;font:24px sans-serif}</style>
<body class="wr_whiteTheme"><div id="app"><div class="readerTopBar_title_chapter">章节12</div><div class="renderTargetContainer"><div class="wr_canvasContainer"><span class="native-text">左页原文与右页跨章节</span></div></div></div>
<script>
window.__INITIAL_STATE__=${JSON.stringify({reader:{bookId:'123',chapterInfos:[{chapterUid:12,title:'章节12'},{chapterUid:13,title:'章节13'}]}})};
window.metrics={capture:0};
window.makeObject=(uid,offset,x)=>({chapterUid:uid,text:'原文',getOffset:()=>offset,getTextLength:()=>10,isTextOrCanvasType:()=>true,rect:{x,y:120,w:140,h:30}});
window.fixtureReader={$options:{name:'HorizontalReader'},bookId:'123',currentChapterUid:12,leftPageChapterUid:12,rightPageChapterUid:13,leftRenderPageIdx:0,rightRenderPageIdx:1,renderContentsVersion:1,isSinglePage:false,pageWidth:550,pageHeight:700,
contents:[makeObject(12,0,30),makeObject(13,0,600)],getCurrentDisplayRenderContents(){metrics.capture++;return this.contents},getRangeFromObjs(){},getCurrentChapterPages(){return []},selectObjs(objs){return 'native-selection'},clearSelection(){},showSelectionToolBar(){},
setCurrentChapterRenderContents(){this.leftRenderPageIdx+=2;this.rightRenderPageIdx+=2;this.contents=[makeObject(12,100,220)]},
changeChapter(){this.currentChapterUid=13;this.leftPageChapterUid=13;this.rightPageChapterUid=13;this.contents=[makeObject(13,0,30)];document.querySelector('.readerTopBar_title_chapter').textContent='章节13';history.pushState({},'',location.pathname+'?bookId=123&chapterUid=13');dispatchEvent(new PopStateEvent('popstate'))}};
document.getElementById('app').__vue__=fixtureReader;
window.nativeTools={findObjsInOffsetRange:(objs,start,end,uid)=>objs.filter(o=>o.chapterUid===uid&&o.getOffset()<end&&o.getOffset()+o.getTextLength()>start),getRectsByContentObjs:objs=>objs.map(o=>o.rect),getTextFromObjs:(objs,options)=>objs.filter(options.filter).map(o=>o.text).join('')};
window.webpackJsonp=[];window.webpackJsonp.push=payload=>{const id=payload[2]?.[0]?.[0];if(id)payload[1][id]({}, {},Object.assign(()=>{},{c:{renamed_module:{exports:{default:nativeTools}}}}))};
</script>`;

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wxrc-i1-fixture-'));
  const extension = path.resolve(__dirname, '../build');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: process.env.WXRC_HEADLESS === '1', viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const page = context.pages()[0];
  const report = { controlledFixture: true, chromiumVersion: context.browser().version(), cases: [], errors: [], unexpectedWrites: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  const check = async (name, action) => { await action(); report.cases.push({ name, passed: true }); console.log(`PASS: ${name}`); };
  const popup = () => page.getByRole('dialog', { name: '公开评论', exact: true });
  const interaction = () => page.evaluate(() => new Promise(resolve => {
    const requestId = `i1-${Date.now()}`;
    const timeout = setTimeout(() => { removeEventListener('message', listener); resolve(null); }, 5000);
    const listener = event => {
      if (event.source === window && event.data?.source === 'WXRC_PAGE' && event.data.requestId === requestId) {
        clearTimeout(timeout); removeEventListener('message', listener); resolve(event.data.context);
      }
    };
    addEventListener('message', listener);
    postMessage({ source: 'WXRC', type: 'GET_READER_INTERACTION_CONTEXT', requestId }, '*');
  }));
  try {
    await context.route('https://weread.qq.com/**', route => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET') {
        report.unexpectedWrites.push({ method: route.request().method(), pathname: url.pathname });
        return route.abort();
      }
      if (url.pathname === '/web/review/list') {
        const uid = Number(url.searchParams.get('chapterUid'));
        return route.fulfill({ json: { hasMore: 0, reviews: (uid === 12 ? [0, 100] : [0]).map((offset, i) => ({ review: {
          reviewId: `${uid}-${i}`, chapterUid: uid, range: `${offset}-${offset + 10}`, content: `横向章节${uid}评论${i}`, author: { name: '验收读者' },
        } })) } });
      }
      return route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort();
    });
    await page.goto('https://weread.qq.com/web/reader/i1-fixture?bookId=123&chapterUid=12');
    await page.waitForFunction(() => document.querySelector('.chrex-comment-wrapper')?.dataset.compatibility === 'READY' && document.querySelector('.chrex-comment-wrapper')?.dataset.mappedRangeCount === '1');
    if (await page.getByRole('button', { name: '关闭右侧评论栏' }).isVisible()) await page.getByRole('button', { name: '关闭右侧评论栏' }).click();
    await page.locator('.wxrc_public_review_wrapper').first().waitFor();
    await check('侧栏关闭时横向定位、章节重叠偏移与评论 popup', async () => {
      const line = page.locator('.wxrc_public_review_wrapper').first();
      assert.equal(await page.locator('.wxrc_public_review_wrapper').count(), 1);
      const box = await line.boundingBox(); assert.ok(box.x < 200, 'must map left chapter only');
      await line.focus(); await page.keyboard.press('Enter'); await popup().waitFor();
      assert.ok((await popup().innerText()).includes('横向章节12评论0'));
      await page.keyboard.press('Escape');
    });
    await check('右页选区归属及翻页立即清空旧选区和 popup', async () => {
      await interaction();
      await page.evaluate(() => fixtureReader.selectObjs([fixtureReader.contents[1]]));
      assert.equal((await interaction()).selection.chapterUid, '13');
      await page.locator('.wxrc_public_review_wrapper').first().focus(); await page.keyboard.press('Enter'); await popup().waitFor();
      await page.evaluate(() => fixtureReader.setCurrentChapterRenderContents());
      assert.equal((await interaction()).selection, null);
      await page.waitForFunction(() => !document.querySelector('.wxrc_public_review_popup') && !!document.querySelector('.wxrc_public_review_wrapper[data-range-key="12:100-110"]'));
    });
    await check('字号布局变化、窗口缩放和稳定页缓存', async () => {
      await page.evaluate(() => { fixtureReader.pageWidth += 20; fixtureReader.contents[0].rect.x = 280; });
      await page.waitForTimeout(850);
      assert.ok((await page.locator('.wxrc_public_review_wrapper').first().boundingBox()).x > 300);
      const before = await page.evaluate(() => metrics.capture);
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => metrics.capture), before, 'stable layout must reuse capture');
      await page.evaluate(() => fixtureReader.selectObjs(fixtureReader.contents));
      await page.setViewportSize({ width: 1250, height: 900 });
      assert.equal((await interaction()).selection, null);
    });
    await check('切章后仅新章评论、原生无写入、页面无异常', async () => {
      await page.evaluate(() => fixtureReader.changeChapter());
      await page.waitForFunction(() => document.querySelector('.chrex-comment-wrapper')?.dataset.chapterUid === '13' && !!document.querySelector('.wxrc_public_review_wrapper[data-range-key="13:0-10"]'));
      assert.equal(await page.locator('.wxrc_public_review_wrapper[data-range-key^="12:"]').count(), 0);
      assert.deepEqual(report.unexpectedWrites, []);
      assert.deepEqual(report.errors, []);
      await page.screenshot({ path: path.join(output, 'horizontal-fixture.png') });
    });
  } finally {
    report.dataset = await page.locator('.chrex-comment-wrapper').evaluateAll(nodes => nodes.map(node => ({ ...node.dataset })));
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
