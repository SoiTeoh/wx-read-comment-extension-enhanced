// Fully routed U1 large-group browsing. No real account writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const {fixture:base}=require('./i3-browser-regression.cjs');
const fixture=base+`<script>const u1Object=makeObject;window.makeObject=()=>{const object=u1Object();object.chapterUid=fixtureReader.currentChapterUid;return object};</script>`;
const long='完整长评论\n'+'这是需要保留的全部正文。'.repeat(130)+'全文末尾';
(async()=>{
 const output=path.resolve(__dirname,'../.test-artifacts/u1');fs.mkdirSync(output,{recursive:true});
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'wxrc-u1-')),{
  channel:'chromium',headless:process.env.WXRC_HEADLESS==='1',viewport:{width:1440,height:1000},
  args:[`--disable-extensions-except=${path.resolve(__dirname,'../build')}`,`--load-extension=${path.resolve(__dirname,'../build')}`]});
 const page=context.pages()[0],report={controlledFixture:true,cases:[],errors:[],listReads:0,singleReads:0,writes:0};page.on('pageerror',e=>report.errors.push(e.message));
 const check=async(name,fn)=>{await fn();report.cases.push({name,passed:true});console.log('PASS: '+name)};
 const popup=()=>page.locator('.wxrc_public_review_popup');const items=()=>popup().locator('.wxrc_public_review_popup_item');
 const open=async()=>{await page.locator('.wxrc_public_review_wrapper').first().focus();await page.waitForTimeout(150);await page.keyboard.press('Enter');await popup().waitFor()};
 const entries=uid=>Array.from({length:uid===12?800:65},(_,i)=>({reviewId:`${uid}-${i}`,likesCount:3,review:{reviewId:`${uid}-${i}`,bookId:'123',chapterUid:uid,range:'0-10',content:i===0?long:'评论 '+i,author:{name:'作者 '+i},isLike:0,isPrivate:0}}));
 try{
  await context.route('https://weread.qq.com/**',route=>{const request=route.request(),url=new URL(request.url());
   if(request.method()==='POST'){report.writes++;return route.abort()}
   if(url.pathname==='/web/review/list'){report.listReads++;return route.fulfill({json:{hasMore:0,reviews:entries(Number(url.searchParams.get('chapterUid')))}})}
   if(url.pathname==='/web/review/single'){report.singleReads++;return route.fulfill({json:entries(12).find(e=>e.reviewId===url.searchParams.get('reviewId'))})}
   return request.isNavigationRequest()?route.fulfill({contentType:'text/html',body:fixture}):route.abort();
  });
  await page.goto('https://weread.qq.com/web/reader/u1-fixture?bookId=123&chapterUid=12');await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.compatibility==='READY');
  await check('Sidebar long text stays complete and expansion does not jump to the original passage',async()=>{
   const card=page.locator('.comment-item[data-review-id="12-0"]'),content=card.locator('.comment-item-content');
   assert.equal(await content.textContent(),long);assert.match(await content.getAttribute('class'),/collapsed/);
   const before=await page.evaluate(()=>scrollY);await card.getByRole('button',{name:'展开全文',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await card.locator('.wxrc_comment_expand').getAttribute('aria-expanded'),'true');
   const captures=await page.evaluate(()=>metrics.capture);await page.getByLabel('搜索评论、引用或作者').fill('作者 0');await page.getByRole('button',{name:'清除筛选',exact:true}).click();
   assert.equal(await card.locator('.wxrc_comment_expand').getAttribute('aria-expanded'),'true');assert.equal(await page.evaluate(()=>metrics.capture),captures);assert.equal(await page.evaluate(()=>scrollY),before);
  });
  await page.getByRole('button',{name:'关闭右侧评论栏'}).click();await page.waitForTimeout(800);
  await check('800 loaded thoughts initially render only 30 popup cards',async()=>{
   const started=Date.now();await open();report.openMs=Date.now()-started;assert.equal(await items().count(),30);assert.match(await popup().innerText(),/800 条公开想法/);assert.equal(report.singleReads,0);assert.ok(report.openMs<5000);
  });
  await check('Keyboard expansion preserves full text and manual append preserves existing DOM and focus',async()=>{
   const first=items().first();assert.equal(await first.locator('.wxrc_public_review_popup_content').textContent(),long);
   await first.getByRole('button',{name:'展开全文',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await first.locator('.wxrc_comment_expand').getAttribute('aria-expanded'),'true');
   await page.evaluate(()=>window.u1First=document.querySelector('.wxrc_public_review_popup_item'));
   await popup().locator('.wxrc_popup_load_more').focus();await page.keyboard.press('Enter');assert.equal(await items().count(),60);
   assert.equal(await page.evaluate(()=>u1First===document.querySelector('.wxrc_public_review_popup_item')),true);assert.equal(await popup().locator('.wxrc_popup_load_more').evaluate(e=>e===document.activeElement),true);
   assert.equal(report.singleReads,0);assert.equal(report.writes,0);
  });
  await check('Reopening the same group restores loaded count, expansion and list position',async()=>{
   const top=await popup().evaluate(e=>{e.scrollTop=420;return e.scrollTop});await page.keyboard.press('Escape');await open();
   assert.equal(await items().count(),60);assert.equal(await items().first().locator('.wxrc_comment_expand').getAttribute('aria-expanded'),'true');assert.ok(Math.abs((await popup().evaluate(e=>e.scrollTop))-top)<2);
  });
  await check('Browsing and theme changes do not fetch, write or remap',async()=>{
   const reads=report.listReads,captures=await page.evaluate(()=>metrics.capture);await popup().evaluate(e=>e.scrollTop+=100);await popup().locator('.wxrc_popup_load_more').click();await page.evaluate(()=>document.body.classList.remove('wr_whiteTheme'));await page.waitForTimeout(700);
   assert.equal(await items().count(),90);assert.equal(report.listReads,reads);assert.equal(report.singleReads,0);assert.equal(await page.evaluate(()=>metrics.capture),captures);assert.equal(report.writes,0);
   await page.screenshot({path:path.join(output,'fixture-night.png')});
  });
  await check('Chapter changes clear old browsing state and final partial page keeps a keyboard target',async()=>{
   await page.evaluate(()=>switchChapter(13));await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.chapterUid==='13'&&document.querySelector('.wxrc_public_review_wrapper'));await page.waitForTimeout(800);await open();assert.equal(await items().count(),30);
   await popup().locator('.wxrc_popup_load_more').click();assert.equal(await items().count(),60);await popup().locator('.wxrc_popup_load_more').focus();await page.keyboard.press('Enter');assert.equal(await items().count(),65);assert.equal(await popup().locator('.wxrc_popup_load_more').isHidden(),true);
   assert.equal(await items().nth(60).locator('button').first().evaluate(e=>e===document.activeElement),true);
   await page.evaluate(()=>switchChapter(12));await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.chapterUid==='12'&&document.querySelector('.wxrc_public_review_wrapper'));await page.waitForTimeout(800);await open();assert.equal(await items().count(),30);assert.equal(await items().first().locator('.wxrc_comment_expand').getAttribute('aria-expanded'),'false');
  });
  await check('Narrow viewport and native reply remain usable with progressive rendering',async()=>{
   await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:800});await page.waitForTimeout(800);await open();assert.equal(await popup().evaluate(e=>e.getBoundingClientRect().right<=innerWidth),true);
   await items().first().locator('[data-review-operation="reply"]').click();await page.locator('#replyInput').waitFor({state:'visible'});assert.equal(await page.locator('#replyInput').inputValue(),'');
   await page.locator('#closeDetail').click();await page.waitForFunction(()=>document.activeElement?.dataset.reviewOperation==='reply');assert.equal(await items().count(),30);assert.equal(report.writes,0);
   await page.screenshot({path:path.join(output,'fixture-narrow.png')});
  });
  assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(error){report.failure=error.stack;process.exitCode=1;console.error(error)}finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await context.close()}
})();
