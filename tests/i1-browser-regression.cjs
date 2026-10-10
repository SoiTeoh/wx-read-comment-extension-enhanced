// Isolated vertical Reader and official horizontal-mode boundary; no real account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = path.resolve(__dirname, '../.test-artifacts/i1-vertical');
const fixture = `<!doctype html><meta charset="utf-8"><title>I1 vertical mode isolation</title>
<style>body{margin:0;min-height:1400px}.renderTargetContainer{position:relative;margin:80px 40px;width:900px;height:1100px}.wr_canvasContainer{position:relative;width:100%;height:1100px;background:#f7f6f2}.native-text{position:absolute;top:120px;left:30px;font:24px sans-serif}</style>
<body class="wr_whiteTheme"><div id="app"><div class="readerTopBar_title_chapter">章节12</div><div class="renderTargetContainer"><div class="wr_canvasContainer"><span class="native-text">上下滚动原文</span></div></div>
<button id="modeControl" class="readerControls_item isHorizontalReader" onclick="switchMode(mode==='horizontal'?'vertical':'horizontal')">切换阅读模式</button>
<button id="officialToolbar" onclick="metrics.officialClicks++">官方操作</button><div id="officialThoughts">官方想法面板</div></div>
<script>
window.__INITIAL_STATE__=${JSON.stringify({reader:{bookId:'123',chapterInfos:[{chapterUid:12,title:'章节12'},{chapterUid:13,title:'章节13'}]}})};
window.metrics={capture:0,officialClicks:0};window.mode='horizontal';
window.makeObject=()=>({chapterUid:12,text:'上下滚动原文',getOffset:()=>0,getTextLength:()=>10,isTextOrCanvasType:()=>true});
window.makeReader=horizontal=>horizontal?{$options:{name:'HorizontalReader'},$el:{isConnected:true},bookId:'123',currentChapterUid:12,getCurrentDisplayRenderContents(){throw Error('must not read horizontal content')},getCurrentChapterPages(){throw Error('must not inspect horizontal pages')},showSelectionToolBar(){},clearSelection(){},selectObjs(){}}:
{$options:{name:'reader'},$el:{isConnected:true},bookId:'123',currentChapterUid:12,renderContentsVersion:1,
handleClickUnderline(){metrics.capture++;this.showSelectionToolBar();this.findObjsInOffsetRange([makeObject()],0,10)},
findObjsInOffsetRange(objects,start,end){return objects.filter(o=>o.getOffset()<end&&o.getOffset()+o.getTextLength()>start)},
getRectsByContentObjs(){return [{x:30,y:120,w:150,h:30}]},
getTextFromObjs(objects,options){return objects.filter(options.filter).map(o=>o.text).join('')},
selectObjs(){return 'native-selection'},clearSelection(){},showSelectionToolBar(){return 'native-toolbar'}};
window.fixtureReader=makeReader(true);document.getElementById('app').__vue__=fixtureReader;
window.horizontalDescriptors=Object.getOwnPropertyDescriptors(fixtureReader);
window.switchMode=next=>{fixtureReader.$el.isConnected=false;window.mode=next;fixtureReader=makeReader(next==='horizontal');document.getElementById('app').__vue__=fixtureReader;document.getElementById('modeControl').className='readerControls_item '+(next==='horizontal'?'isHorizontalReader':'isNormalReader');if(next==='horizontal')horizontalDescriptors=Object.getOwnPropertyDescriptors(fixtureReader)};
window.switchChapter=uid=>{fixtureReader.currentChapterUid=uid;fixtureReader.renderContentsVersion++;document.querySelector('.readerTopBar_title_chapter').textContent='章节'+uid;history.pushState({},'',location.pathname+'?bookId=123&chapterUid='+uid);dispatchEvent(new PopStateEvent('popstate'))};
</script>`;

module.exports = { fixture };
if (require.main === module) (async () => {
  fs.mkdirSync(output, { recursive: true });
  const extension = path.resolve(__dirname, '../build');
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'wxrc-i1-vertical-')), {
    channel: 'chromium', headless: process.env.WXRC_HEADLESS === '1', viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const page = context.pages()[0];
  const report = { controlledFixture: true, chromiumVersion: context.browser().version(), cases: [], errors: [], requests: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  let slow = false, releaseSlow;
  const check = async (name, action) => { await action(); report.cases.push({ name, passed: true }); console.log(`PASS: ${name}`); };
  const popup = () => page.getByRole('dialog', { name: '公开评论', exact: true });
  const contextRequest = type => page.evaluate(type => new Promise(resolve => {
    const requestId = 'i1-' + Date.now();
    const timer = setTimeout(() => { removeEventListener('message', listener); resolve(null); }, 4000);
    const listener = event => { if (event.source === window && event.data?.source === 'WXRC_PAGE' && event.data.requestId === requestId) {
      clearTimeout(timer); removeEventListener('message', listener); resolve(event.data);
    }};
    addEventListener('message', listener); postMessage({source:'WXRC',type,requestId},'*');
  }), type);
  const ready = () => page.waitForFunction(() => {
    const node = document.querySelector('.chrex-comment-wrapper');
    return node?.dataset.chapterUid === '12' && node.dataset.compatibility === 'READY' && node.dataset.mappedRangeCount === '1';
  });
  const noUI = () => page.waitForFunction(() => !document.querySelector('.chrex-comment-wrapper,.wxrc_sidebar_launcher,.wxrc_public_review_layer,.wxrc_public_review_popup') && !document.body.classList.contains('wxrc_sidebar_visible'));
  const switchMode = async mode => { await page.evaluate(mode => window.switchMode(mode), mode); };
  try {
    await context.route('https://weread.qq.com/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/web/review/list') {
        const uid = Number(url.searchParams.get('chapterUid'));
        report.requests.push({ uid, bookId: url.searchParams.get('bookId'), mode: await page.evaluate(() => window.mode) });
        if (uid === 13 && slow) { slow = false; await new Promise(resolve => { releaseSlow = resolve; }); releaseSlow = null; }
        try { await route.fulfill({ json: {hasMore:uid===13?1:0,synckey:13,reviews:[{review:{reviewId:'chapter-'+uid,chapterUid:uid,range:'0-10',content:uid===13?'迟到旧章评论':'纵向公开评论',author:{name:'验收读者'}}}]}}); } catch { /* request was aborted on mode exit */ }
        return;
      }
      return route.request().isNavigationRequest() ? route.fulfill({ contentType:'text/html', body:fixture }) : route.abort();
    });
    await page.goto('https://weread.qq.com/web/reader/i1-fixture?bookId=123&chapterUid=12');
    await check('初始横向无插件 UI、无评论请求，官方方法和点击不受影响', async () => {
      await page.waitForTimeout(1200); await noUI();
      assert.equal(report.requests.length,0); assert.equal(await page.evaluate(()=>metrics.capture),0);
      await page.locator('#officialToolbar').click(); assert.equal(await page.evaluate(()=>metrics.officialClicks),1);
      assert.equal((await contextRequest('GET_CAPABILITIES')).capabilities.code,'READING_MODE_DISABLED');
      assert.equal((await contextRequest('GET_READER_INTERACTION_CONTEXT')).context,null);
      assert.equal(await page.evaluate(()=>['showSelectionToolBar','selectObjs','clearSelection'].every(k=>fixtureReader[k]===horizontalDescriptors[k].value)),true);
    });
    await check('切回纵向恢复一次，侧栏关闭时划线与 popup 可用', async () => {
      await page.locator('#modeControl').click(); await ready();
      assert.equal(await page.locator('.chrex-comment-wrapper').count(),1);
      await page.getByRole('button',{name:'关闭右侧评论栏'}).click();
      await page.waitForTimeout(900); await ready();
      await page.locator('.wxrc_public_review_wrapper').first().waitFor();
      await page.locator('.wxrc_public_review_wrapper').first().focus(); await page.keyboard.press('Enter'); await popup().waitFor();
      assert.ok((await popup().innerText()).includes('纵向公开评论')); await page.keyboard.press('Escape');
    });
    await check('纵向选区、字号和窗口变化清除旧上下文，稳定页复用缓存', async () => {
      await contextRequest('GET_READER_INTERACTION_CONTEXT');
      assert.equal(await page.evaluate(()=>fixtureReader.selectObjs([makeObject()])),'native-selection');
      assert.equal((await contextRequest('GET_READER_INTERACTION_CONTEXT')).context.selection.text,'上下滚动原文');
      const requests=report.requests.length;
      await page.evaluate(()=>{fixtureReader.renderContentsVersion++;document.body.classList.add('wr_reader_font_size_level_3')});
      await page.waitForTimeout(1100); await ready();
      assert.equal((await contextRequest('GET_READER_INTERACTION_CONTEXT')).context.selection,null);
      await page.evaluate(()=>fixtureReader.selectObjs([makeObject()]));
      await page.setViewportSize({width:1250,height:900});
      assert.equal((await contextRequest('GET_READER_INTERACTION_CONTEXT')).context.selection,null);
      await page.waitForTimeout(1100); await ready();
      const captures=await page.evaluate(()=>metrics.capture); await page.waitForTimeout(1100);
      assert.equal(await page.evaluate(()=>metrics.capture),captures); assert.equal(report.requests.length,requests);
    });
    await check('慢请求期间退出纵向，取消旧请求且迟到响应不能重建 UI 或继续分页', async () => {
      slow=true; await page.evaluate(()=>switchChapter(13));
      await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.chapterUid==='13');
      for(let i=0;i<100&&!releaseSlow;i++)await page.waitForTimeout(30);
      assert.ok(releaseSlow);
      assert.equal(await page.locator('.chrex-comment-wrapper').getAttribute('data-compatibility'), null, 'loading chapter must not retain old READY status');
      await switchMode('horizontal'); await noUI();
      const count=report.requests.length; releaseSlow(); await page.waitForTimeout(1300); await noUI();
      assert.equal(report.requests.length,count);
      assert.equal((await contextRequest('GET_READER_INTERACTION_CONTEXT')).context,null);
      assert.equal(await page.locator('#officialThoughts').innerText(),'官方想法面板');
    });
    await check('重复切换无重复插件实例或监听响应，横向一直零加载', async () => {
      for(let i=0;i<3;i++) {
        await switchMode('vertical'); await page.evaluate(()=>switchChapter(12)); await ready();
        assert.equal(await page.locator('.chrex-comment-wrapper').count(),1);
        assert.equal(await page.locator('.wxrc_sidebar_launcher').count(),1);
        await switchMode('horizontal'); await noUI();
        const count=report.requests.length; await page.waitForTimeout(1100); assert.equal(report.requests.length,count);
      }
      await switchMode('vertical'); await page.evaluate(()=>switchChapter(12)); await ready();
      assert.equal(report.requests.every(request=>request.mode==='vertical'),true);
      assert.deepEqual(report.errors,[]);
      await page.screenshot({path:path.join(output,'vertical-fixture.png')});
    });
    await check('纵向同页切书重新绑定书籍，不沿用上一书的评论会话', async () => {
      await page.evaluate(() => { fixtureReader.bookId='456'; history.pushState({},'',location.pathname+'?bookId=456&chapterUid=12'); });
      await page.waitForFunction(() => document.querySelector('.chrex-comment-wrapper')?.dataset.bookId === '456' && document.querySelector('.chrex-comment-wrapper')?.dataset.mappedRangeCount === '1');
      assert.equal(report.requests.at(-1).bookId, '456');
      assert.equal(await page.locator('.chrex-comment-wrapper').count(), 1);
      assert.deepEqual(report.errors, []);
    });
  } finally {
    releaseSlow?.();
    fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify(report,null,2));
    await context.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1});
