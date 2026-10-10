const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { fixture: base } = require('./i1-browser-regression.cjs');
const fixture = base.replace("window.mode='horizontal'", "window.mode='vertical'")
  .replace('class="readerControls_item isHorizontalReader"', 'class="readerControls_item isNormalReader"')
  .replace('window.fixtureReader=makeReader(true)', 'window.fixtureReader=makeReader(false)') + `<script>
window.commands=[];window.failAI=false;window.slowWrite=false;
const nativeMakeReader=makeReader;
window.makeReader=horizontal=>{const r=nativeMakeReader(horizontal);if(!horizontal)Object.assign(r,{
 hasLogin:true,isAIChatEnabled:true,
 showSelectionToolBar(options){commands.push({operation:'underline',bookId:this.bookId,chapterUid:this.currentChapterUid,range:options.objs.map(o=>[o.getOffset(),o.getTextLength()])});document.getElementById('nativeToolbar').hidden=false;},
 showWriteReviewPanel(objects){commands.push({operation:'writeThought',chapterUid:this.currentChapterUid,range:objects.map(o=>[o.getOffset(),o.getTextLength()])});document.getElementById('nativeWriter').hidden=false;if(slowWrite)return new Promise(resolve=>window.releaseWrite=resolve);},
 showAiChatPanel(text){commands.push({operation:'askAI',text});if(failAI)throw Error('private failure');document.getElementById('nativeAI').hidden=false;document.getElementById('nativeAIInput').value=text;}
});return r};
fixtureReader=makeReader(false);document.getElementById('app').__vue__=fixtureReader;
</script><div id="nativeToolbar" hidden>官方划线样式 <button onclick="this.parentNode.hidden=true">关闭原生划线</button></div>
<div id="nativeWriter" hidden><textarea aria-label="原生想法编辑器"></textarea><button onclick="this.parentNode.hidden=true">关闭原生编辑器</button></div>
<div id="nativeAI" hidden><textarea id="nativeAIInput" aria-label="原生 AI 输入"></textarea><button onclick="this.parentNode.hidden=true">关闭原生 AI</button></div>`;
(async()=>{
  const output=path.resolve(__dirname,'../.test-artifacts/i2');fs.mkdirSync(output,{recursive:true});
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'wxrc-i2-')),{
    channel:'chromium',headless:process.env.WXRC_HEADLESS==='1',viewport:{width:1440,height:1000},
    args:[`--disable-extensions-except=${path.resolve(__dirname,'../build')}`,`--load-extension=${path.resolve(__dirname,'../build')}`]});
  const page=context.pages()[0],report={controlledFixture:true,cases:[],errors:[],writeRequests:0,reviewRequests:0};
  page.on('pageerror',e=>report.errors.push(e.message));
  const check=async(name,action)=>{await action();report.cases.push({name,passed:true});console.log('PASS: '+name)};
  const request=(type,payload={})=>page.evaluate(({type,payload})=>new Promise(resolve=>{
    const requestId='i2-'+Date.now()+Math.random();const listener=e=>{if(e.source===window&&e.data?.source==='WXRC_PAGE'&&e.data.requestId===requestId){clearTimeout(timer);removeEventListener('message',listener);resolve(e.data)}};
    const timer=setTimeout(()=>{removeEventListener('message',listener);resolve(null)},4000);addEventListener('message',listener);postMessage({source:'WXRC',type,requestId,...payload},'*');
  }),{type,payload});
  const open=async()=>{await page.locator('.wxrc_public_review_wrapper').first().focus();await page.waitForTimeout(150);await page.keyboard.press('Enter');await page.waitForFunction(()=>{const e=document.querySelector('.wxrc_text_operation_status');return e&&!e.textContent.includes('正在')})};
  const operation=id=>page.locator(`.wxrc_text_operations [data-operation="${id}"]`);
  try{
    await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://weread.qq.com'});
    await context.route('https://weread.qq.com/**',route=>{
      const url=new URL(route.request().url());if(route.request().method()==='POST')report.writeRequests++;
      if(url.pathname==='/web/review/list'){report.reviewRequests++;return route.fulfill({json:{hasMore:0,reviews:[{review:{reviewId:'i2review',chapterUid:12,range:'0-10',abstract:'不是可靠的原文',content:'这是评论内容，不能复制',author:{name:'测试读者'}}}]}})}
      return route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:fixture}):route.abort();
    });
    await page.goto('https://weread.qq.com/web/reader/i2-fixture?bookId=123&chapterUid=12');
    await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.compatibility==='READY');
    await page.getByRole('button',{name:'关闭右侧评论栏'}).click();await page.waitForTimeout(800);
    await check('侧栏关闭时独立可用，核实原文不执行任何命令',async()=>{await open();assert.equal(await page.locator('.wxrc_text_operation_quote').innerText(),'上下滚动原文');assert.equal(await page.locator('.wxrc_text_operations button:enabled').count(),4);assert.equal(await page.evaluate(()=>commands.length),0)});
    await check('复制仅写入核实原文并反馈，键盘操作不复制评论正文',async()=>{await operation('copy').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.wxrc_text_operation_status')?.textContent==='已复制原文');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'上下滚动原文');assert.equal(await page.evaluate(()=>commands.length),0)});
    await check('划线入口带入精确原文对象，只打开原生工具',async()=>{await operation('underline').click();await page.locator('#nativeToolbar').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('.wxrc_public_review_popup'));assert.deepEqual(await page.evaluate(()=>commands.at(-1)),{operation:'underline',bookId:'123',chapterUid:12,range:[[0,10]]});await page.getByRole('button',{name:'关闭原生划线'}).click()});
    await check('写想法和 AI 复用原生界面并保留原文',async()=>{await open();await operation('writeThought').click();await page.locator('#nativeWriter').waitFor({state:'visible'});assert.equal(await page.getByRole('textbox',{name:'原生想法编辑器'}).inputValue(),'');await page.getByRole('button',{name:'关闭原生编辑器'}).click();await open();await operation('askAI').click();await page.locator('#nativeAI').waitFor({state:'visible'});assert.equal(await page.getByRole('textbox',{name:'原生 AI 输入'}).inputValue(),'上下滚动原文');await page.getByRole('button',{name:'关闭原生 AI'}).click()});
    await check('原生入口缺失及登录失效按单项降级，复制不受影响',async()=>{await page.evaluate(()=>{fixtureReader.showAiChatPanel=undefined;fixtureReader.hasLogin=false});await open();assert.equal(await operation('copy').isEnabled(),true);assert.equal(await operation('underline').isEnabled(),true);assert.equal(await operation('writeThought').isDisabled(),true);assert.equal(await operation('askAI').isDisabled(),true);assert.equal(await operation('writeThought').getAttribute('title'),'请先登录微信读书');await page.keyboard.press('Escape');await page.evaluate(()=>{fixtureReader.hasLogin=true;fixtureReader.showAiChatPanel=text=>{commands.push({operation:'askAI',text});throw Error('native failure')}})});
    await check('过期上下文与不支持的命令被拒绝，失败不自动重试',async()=>{const c=(await request('PREPARE_TEXT_OPERATIONS',{bookId:'123',chapterUid:'12',range:{start:0,end:10}})).result;const before=await page.evaluate(()=>commands.length);await page.evaluate(()=>fixtureReader.renderContentsVersion++);assert.equal((await request('EXECUTE_TEXT_OPERATION',{token:c.token,operation:'writeThought'})).error,'CONTEXT_EXPIRED');assert.equal(await page.evaluate(()=>commands.length),before);await page.waitForTimeout(700);await open();await operation('askAI').click();await page.waitForFunction(()=>document.querySelector('.wxrc_text_operation_status')?.textContent.includes('不会自动重试'));assert.equal(await page.locator('.wxrc_text_operations button:enabled').count(),0);await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>commands.length),before+1);await page.keyboard.press('Escape')});
    await check('原生操作待完成时禁止重复点击，迟到结果不重建已关闭 popup',async()=>{await page.evaluate(()=>slowWrite=true);await open();const before=await page.evaluate(()=>commands.length);await page.evaluate(()=>{const e=document.querySelector('[data-operation="writeThought"]');e.click();e.click()});await page.waitForFunction(()=>!!window.releaseWrite);assert.equal(await page.evaluate(()=>commands.length),before+1);assert.equal(await page.locator('.wxrc_text_operations button:enabled').count(),0);await page.keyboard.press('Escape');await page.evaluate(()=>releaseWrite());await page.waitForTimeout(100);assert.equal(await page.locator('.wxrc_public_review_popup').count(),0);await page.getByRole('button',{name:'关闭原生编辑器'}).click();await page.evaluate(()=>slowWrite=false)});
    await check('窄窗口、日夜主题及稳定滚动不增加写入或重复映射',async()=>{await page.setViewportSize({width:390,height:800});await page.waitForTimeout(800);await open();assert.equal(await page.locator('.wxrc_text_operations').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),2);assert.equal(await page.locator('.wxrc_public_review_popup').evaluate(e=>{let r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}),true);await page.screenshot({path:path.join(output,'fixture-day.png')});await page.evaluate(()=>document.body.classList.remove('wr_whiteTheme'));await page.screenshot({path:path.join(output,'fixture-night.png')});await page.keyboard.press('Escape');const before=report.reviewRequests;const captures=await page.evaluate(()=>metrics.capture);await page.mouse.wheel(0,200);await page.waitForTimeout(1000);assert.equal(report.reviewRequests,before);assert.equal(await page.evaluate(()=>metrics.capture),captures);assert.equal(report.writeRequests,0)});
    await check('无法核实原文时全部禁用，退出纵向后旧句柄不能执行原生操作',async()=>{
      await page.evaluate(()=>fixtureReader.getTextFromObjs=()=> '');await open();
      assert.equal(await page.locator('.wxrc_text_operations button:enabled').count(),0);
      assert.equal(await page.locator('.wxrc_text_operation_status').innerText(),'无法核实完整原文，操作暂不可用');
      await page.keyboard.press('Escape');await page.evaluate(()=>fixtureReader.getTextFromObjs=()=> '上下滚动原文');
      const c=(await request('PREPARE_TEXT_OPERATIONS',{bookId:'123',chapterUid:'12',range:{start:0,end:10}})).result;
      const before=await page.evaluate(()=>commands.length);await page.evaluate(()=>switchMode('horizontal'));
      await page.waitForFunction(()=>!document.querySelector('.chrex-comment-wrapper,.wxrc_public_review_popup'));
      assert.equal((await request('EXECUTE_TEXT_OPERATION',{token:c.token,operation:'writeThought'})).error,'CONTEXT_EXPIRED');
      assert.equal(await page.evaluate(()=>commands.length),before);assert.equal(report.writeRequests,0);
    });
    assert.deepEqual(report.errors,[]);
  }finally{fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify(report,null,2));await context.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
