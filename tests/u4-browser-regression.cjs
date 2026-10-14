const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright'),{fixture}=require('./i3-browser-regression.cjs');
(async()=>{
 const output=path.resolve(__dirname,'../.test-artifacts/u4');fs.mkdirSync(output,{recursive:true});
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'wxrc-u4-')),{channel:'chromium',headless:process.env.WXRC_HEADLESS==='1',viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${path.resolve(__dirname,'../build')}`,`--load-extension=${path.resolve(__dirname,'../build')}`]});
 const page=context.pages()[0],report={controlledFixture:true,cases:[],reads:0,writes:0,errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
 const entries=[undefined,0,9,9].map((likesCount,i)=>({likesCount,reviewId:'u4-'+i,review:{reviewId:'u4-'+i,bookId:'123',chapterUid:12,range:'0-10',content:'公开正文 '+i,abstract:'引用原文',isLike:0,isPrivate:0,author:{name:i===3?'另一作者':'同名',userVid:i===2?2:i===3?3:1}}}));
 const check=async(name,fn)=>{await fn();report.cases.push({name,passed:true});console.log('PASS: '+name)};
 const rows=()=>page.locator('.chrex-comment-wrapper .comment-item'),ids=()=>rows().evaluateAll(nodes=>nodes.map(n=>n.dataset.reviewId));
 try{
  await context.route('https://weread.qq.com/**',route=>{const request=route.request(),url=new URL(request.url());if(request.method()==='POST'){report.writes++;return route.abort();}if(url.pathname==='/web/review/list'){report.reads++;return route.fulfill({json:{hasMore:0,reviews:url.searchParams.get('chapterUid')==='12'?entries:[]}});}return request.isNavigationRequest()?route.fulfill({contentType:'text/html',body:fixture}):route.abort();});
  await page.goto('https://weread.qq.com/web/reader/u4-fixture?bookId=123&chapterUid=12');await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.compatibility==='READY');
  await check('Likes descending keeps zero before unknown and ties in API order',async()=>{await page.getByLabel('右侧评论排序').selectOption('likes');assert.deepEqual(await ids(),['u4-2','u4-3','u4-1','u4-0']);});
  await check('Author identity combines with query and mapping filters; clear restores all',async()=>{await page.getByLabel('按作者筛选评论').selectOption('id:1');assert.deepEqual(await ids(),['u4-1','u4-0']);await page.getByLabel('搜索评论、引用或作者').fill('正文 0');await page.waitForTimeout(100);assert.deepEqual(await ids(),['u4-0']);await page.getByRole('button',{name:'清除筛选',exact:true}).click();assert.equal(await rows().count(),4);});
  await check('Sidebar filter preserves full same-range popup and mapping; no additional requests',async()=>{const reads=report.reads;await page.getByLabel('按作者筛选评论').selectOption('id:2');assert.equal(await rows().count(),1);assert.match(await rows().first().innerText(),/同段还有 3 条/);await page.locator('.wxrc_public_review_wrapper').first().focus();await page.keyboard.press('Enter');await page.locator('.wxrc_public_review_popup').waitFor();assert.equal(await page.locator('.wxrc_public_review_popup [data-review-operation="like"]').count(),4);assert.equal(report.reads,reads);assert.equal(report.writes,0);await page.keyboard.press('Escape');});
  await check('Sort persists on reload, author resets; API order remains intact',async()=>{await page.reload();await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.compatibility==='READY');assert.equal(await page.getByLabel('右侧评论排序').inputValue(),'likes');assert.equal(await page.getByLabel('按作者筛选评论').inputValue(),'');await page.getByLabel('右侧评论排序').selectOption('api');assert.deepEqual(await ids(),['u4-0','u4-1','u4-2','u4-3']);});
  await check('Day/night and narrow layout remain usable without horizontal enhancement',async()=>{await page.getByLabel('右侧评论排序').selectOption('likes');await page.getByLabel('按作者筛选评论').selectOption('id:2');await page.screenshot({path:path.resolve(__dirname,'../docs/previews/u4-author-likes-day.png')});await page.evaluate(()=>document.body.classList.remove('wr_whiteTheme'));await page.waitForTimeout(700);await page.screenshot({path:path.resolve(__dirname,'../docs/previews/u4-author-likes-night.png')});await page.setViewportSize({width:760,height:800});assert.equal(await page.getByLabel('按作者筛选评论').isVisible(),true);await page.evaluate(()=>{switchMode('horizontal');});await page.waitForFunction(()=>!document.querySelector('.chrex-comment-wrapper'));});
  await check('Returning from horizontal mode restores vertical controls with cleared author',async()=>{
    await page.evaluate(()=>{switchMode('vertical');});
    await page.getByLabel('按作者筛选评论').waitFor();
    assert.equal(await page.getByLabel('按作者筛选评论').inputValue(),'');
    await page.getByLabel('按作者筛选评论').selectOption('id:2');
    await page.evaluate(()=>{switchChapter(13);});
    await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.chapterUid==='13');
    assert.equal(await page.getByLabel('按作者筛选评论').inputValue(),'');
    assert.equal(await rows().count(),0);
  });
  assert.deepEqual(report.errors,[]);assert.equal(report.writes,0);
 }finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
