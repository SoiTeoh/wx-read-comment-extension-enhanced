const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright'),{fixture:base}=require('./i3-browser-regression.cjs');
const fixture=base+`<script>document.body.style.minHeight='4000px';window.u2Y=120;fixtureReader.getRectsByContentObjs=()=>[{x:30,y:u2Y,w:150,h:30}];
window.holdMap=false;const u2Post=window.postMessage;window.postMessage=function(message,...args){if(holdMap&&message?.type==='RECTS_RESULT'){holdMap=false;window.releaseMap=()=>u2Post.call(window,message,...args);return}return u2Post.call(window,message,...args)};</script>
<button id="nativeSize" class="reader_font_control_slider_wrapper" style="position:fixed;top:10px;left:950px" onclick="u2Y=420;document.querySelector('.renderTargetContainer').style.marginTop='180px';document.querySelector('.native-text').style.top='420px';document.body.classList.add('wr_reader_font_size_level_3')">Native size</button>`;
(async()=>{
 const output=path.resolve(__dirname,'../.test-artifacts/u2');fs.mkdirSync(output,{recursive:true});
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'wxrc-u2-')),{
 channel:'chromium',headless:process.env.WXRC_HEADLESS==='1',viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${path.resolve(__dirname,'../build')}`,`--load-extension=${path.resolve(__dirname,'../build')}`]});
 const page=context.pages()[0],report={controlledFixture:true,cases:[],errors:[],reads:0,writes:0};page.on('pageerror',e=>report.errors.push(e.message));
 const entry={reviewId:'navigation-review',likesCount:3,review:{reviewId:'navigation-review',bookId:'123',chapterUid:12,range:'0-10',content:'长评论'.repeat(300),author:{name:'导航读者'},isLike:0,isPrivate:0}};
 const check=async(name,fn)=>{await fn();report.cases.push({name,passed:true});console.log('PASS: '+name)};
 const popup=()=>page.locator('.wxrc_public_review_popup');
 try{
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://weread.qq.com'});
 await context.route('https://weread.qq.com/**',route=>{const r=route.request(),u=new URL(r.url());if(r.method()==='POST'){report.writes++;return route.abort()}if(u.pathname==='/web/review/list'){report.reads++;return route.fulfill({json:{hasMore:0,reviews:u.searchParams.get('chapterUid')==='12'?[entry]:[]}})}if(u.pathname==='/web/review/single')return route.fulfill({json:entry});return r.isNavigationRequest()?route.fulfill({contentType:'text/html',body:fixture}):route.abort()});
 await page.goto('https://weread.qq.com/web/reader/u2-fixture?bookId=123&chapterUid=12');await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.compatibility==='READY');await page.evaluate(()=>scrollTo(0,80));await page.waitForTimeout(500);
 await check('Shortcuts default off, persist when enabled and ignore editable fields',async()=>{
  await page.keyboard.press('Alt+Shift+C');assert.equal(await popup().count(),0);await page.getByLabel('启用阅读快捷键').check();await page.getByLabel('搜索评论、引用或作者').focus();await page.keyboard.press('Alt+Shift+C');assert.equal(await popup().count(),0);
  await page.locator('body').click({position:{x:900,y:600}});await page.keyboard.press('Alt+Shift+C');await popup().waitFor();await page.waitForFunction(()=>!document.querySelector('[data-operation="copy"]')?.disabled);
  await page.keyboard.press('Alt+Shift+Y');await page.waitForFunction(()=>document.querySelector('.wxrc_text_operation_status')?.textContent==='已复制原文');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'上下滚动原文');await page.keyboard.press('Escape');
  await page.reload();await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.compatibility==='READY');assert.equal(await page.getByLabel('启用阅读快捷键').isChecked(),true);
  await page.getByLabel('启用阅读快捷键').uncheck();await page.locator('body').click({position:{x:900,y:600}});await page.keyboard.press('Alt+Shift+C');assert.equal(await popup().count(),0);await page.getByLabel('启用阅读快捷键').check();
  await page.locator('body').click({position:{x:900,y:600}});await page.evaluate(()=>{const mask=document.createElement('div');mask.className='wr_mask_Show u2_native_mask';mask.style.cssText='position:fixed;inset:0';document.body.append(mask)});await page.keyboard.press('Alt+Shift+C');assert.equal(await popup().count(),0);await page.evaluate(()=>document.querySelector('.u2_native_mask').remove());
 });
 await check('Font re-layout restores the cached passage to its previous viewport offset',async()=>{
  await page.evaluate(()=>scrollTo(0,80));await page.waitForTimeout(200);const reads=report.reads;
  await page.locator('#nativeSize').click();
  await page.waitForFunction(()=>Math.abs(scrollY-480)<2);assert.equal(report.reads,reads);
 });
 await check('Deliberate navigation while mapping is pending cancels automatic restoration',async()=>{
  await page.evaluate(()=>{holdMap=true;u2Y=620;document.body.classList.replace('wr_reader_font_size_level_3','wr_reader_font_size_level_4')});await page.waitForFunction(()=>!!window.releaseMap);
  await page.evaluate(()=>{dispatchEvent(new WheelEvent('wheel',{bubbles:true}));scrollTo(0,160);releaseMap();releaseMap=null});await page.waitForTimeout(1000);assert.ok(Math.abs((await page.evaluate(()=>scrollY))-160)<2);
 });
 await check('Sidebar toggling and native reply retain passage and popup scroll position',async()=>{
  await page.evaluate(()=>{u2Y=120;document.body.classList.replace('wr_reader_font_size_level_4','wr_reader_font_size_level_3')});await page.waitForTimeout(1000);await page.evaluate(()=>scrollTo(0,80));
  await page.getByRole('button',{name:'关闭右侧评论栏'}).click();await page.waitForTimeout(900);assert.ok(Math.abs((await page.evaluate(()=>scrollY))-80)<2);await page.keyboard.press('Alt+Shift+C');await popup().waitFor();
  await popup().locator('.wxrc_comment_expand').click();await popup().locator('[data-review-operation="reply"]').scrollIntoViewIfNeeded();const top=await popup().evaluate(e=>e.scrollTop);await popup().locator('[data-review-operation="reply"]').click();await page.locator('#replyInput').waitFor({state:'visible'});
  await page.keyboard.press('Alt+Shift+C');assert.equal(await popup().count(),1);await page.locator('#closeDetail').click();await page.waitForFunction(()=>document.activeElement?.dataset.reviewOperation==='reply');
  assert.equal(await popup().evaluate(e=>e.scrollTop),top);assert.ok(Math.abs((await page.evaluate(()=>scrollY))-80)<2);assert.equal(report.writes,0);
 });
 await check('Rounded popup scrollbar is thin, transparent and inset in both themes',async()=>{
  const style=await popup().evaluate(e=>({width:getComputedStyle(e,'::-webkit-scrollbar').width,track:getComputedStyle(e,'::-webkit-scrollbar-track').backgroundColor,margin:getComputedStyle(e,'::-webkit-scrollbar-track').marginTop,radius:getComputedStyle(e,'::-webkit-scrollbar-thumb').borderRadius}));assert.equal(style.width,'8px');assert.equal(style.track,'rgba(0, 0, 0, 0)');assert.equal(style.radius,'999px');
  await page.screenshot({path:path.join(output,'day.png')});await page.evaluate(()=>document.body.classList.remove('wr_whiteTheme'));await page.screenshot({path:path.join(output,'night.png')});
  await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:800});await page.waitForTimeout(900);await page.evaluate(()=>scrollTo(0,80));await page.keyboard.press('Alt+Shift+C');await popup().waitFor();assert.equal(await popup().evaluate(e=>e.getBoundingClientRect().right<=innerWidth),true);
 });
 await check('Mode exit disables shortcuts and never starts a write',async()=>{
  await page.evaluate(()=>switchMode('horizontal'));await page.waitForFunction(()=>!document.querySelector('.chrex-comment-wrapper'));await page.keyboard.press('Alt+Shift+C');assert.equal(await popup().count(),0);assert.equal(report.writes,0);
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(error){report.failure=error.stack;process.exitCode=1;console.error(error)}finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await context.close()}
})();
