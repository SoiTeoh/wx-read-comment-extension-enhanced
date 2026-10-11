// Routed vertical Reader fixture. Never connects to a real account or write endpoint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { fixture: base } = require('./i2-browser-regression.cjs');
const fixture = base + `<div id="detailContainer" hidden style="position:fixed;right:0;top:0;width:400px;height:100vh;background:white;z-index:999999">
<div id="detail" hidden><span id="detailTarget"></span><textarea id="replyInput" aria-label="Native reply"></textarea>
<button id="submitReply">Submit reply</button><button id="moreReplies">More replies</button><button id="closeDetail">Close detail</button></div></div>
<script>
const i3MakeReader=makeReader;
window.makeReader=horizontal=>{const r=i3MakeReader(horizontal);if(horizontal)return r;
 const container=document.getElementById('detailContainer'),el=document.getElementById('detail');
 const panel={$options:{name:'ReaderFloatReviewDetailPanel'},$el:el,showing:false,commentText:'',$nextTick:()=>Promise.resolve(),
  show({review,showComment}){this.review=review;this.showing=true;el.hidden=false;detailTarget.textContent=review.reviewId;replyInput.value='';if(showComment)replyInput.focus()},hide(){this.showing=false;el.hidden=true}};
 const note={$options:{name:'ReaderNotePanel'},$el:container,$refs:{reviewDetail:panel},$nextTick:()=>Promise.resolve(),
  show(){container.hidden=false},close(){container.hidden=true;panel.hide()},isShowing(){return !container.hidden}};
 r.$refs={readerNotePanel:note};r.$store={_actions:{'reader/FETCH_REVIEW_LIKE':[()=>{}]},dispatch:async(action,payload)=>({data:await(await fetch('/web/review/like',{method:'POST',body:JSON.stringify(payload)})).json()})};
 closeDetail.onclick=()=>panel.hide();moreReplies.onclick=()=>fetch('/web/review/comments?reviewId='+panel.review.reviewId);
 submitReply.onclick=async()=>{if(!replyInput.value.trim())return;await fetch('/web/review/comment',{method:'POST',body:JSON.stringify({reviewId:panel.review.reviewId,content:replyInput.value})});replyInput.value=''};
 return r};fixtureReader=makeReader(false);document.getElementById('app').__vue__=fixtureReader;
</script>`;

(async()=>{
 const output=path.resolve(__dirname,'../.test-artifacts/i3');fs.mkdirSync(output,{recursive:true});
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'wxrc-i3-')),{
  channel:'chromium',headless:process.env.WXRC_HEADLESS==='1',viewport:{width:1440,height:1000},
  args:[`--disable-extensions-except=${path.resolve(__dirname,'../build')}`,`--load-extension=${path.resolve(__dirname,'../build')}`]});
 const page=context.pages()[0],report={controlledFixture:true,cases:[],errors:[],writes:[],singleReads:0,commentReads:0};
 page.on('pageerror',e=>report.errors.push(e.message));
 const reviews=new Map(['first','second'].map((id,i)=>[id,{reviewId:id,review:{reviewId:id,bookId:'123',chapterUid:12,range:'0-10',content:'Thought '+id,author:{name:'Author '+id},isLike:i,isPrivate:0},likesCount:3+i,...i?{commentsCount:2}:{}}]));
 let reject=false,hold=false,release,failCalibration=false;
 const check=async(name,action)=>{await action();report.cases.push({name,passed:true});console.log('PASS: '+name)};
 const popup=()=>page.locator('.wxrc_public_review_popup');
 const action=(op,i=0)=>popup().locator(`[data-review-operation="${op}"]`).nth(i);
 const open=async()=>{await page.locator('.wxrc_public_review_wrapper').first().focus();await page.waitForTimeout(150);await page.keyboard.press('Enter');await popup().waitFor();};
 const settled=()=>page.waitForFunction(()=>![...document.querySelectorAll('.wxrc_public_review_popup .wxrc_review_action_status')].some(e=>e.textContent.startsWith('正在')));
 try{
  await context.route('https://weread.qq.com/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/web/review/list')return route.fulfill({json:{hasMore:0,reviews:[...reviews.values()].filter(e=>String(e.review.chapterUid)===url.searchParams.get('chapterUid'))}});
   if(url.pathname==='/web/review/single'){report.singleReads++;if(failCalibration){failCalibration=false;return route.fulfill({status:503,json:{}})}return route.fulfill({json:reviews.get(url.searchParams.get('reviewId'))})}
   if(url.pathname==='/web/review/comments'){report.commentReads++;return route.fulfill({json:{hasMore:0,comments:[]}})}
   if(request.method()==='POST'){
    const payload=request.postDataJSON();report.writes.push({path:url.pathname,...payload});
    if(hold){hold=false;await new Promise(resolve=>release=resolve);release=null}
    if(url.pathname==='/web/review/like'){
     if(reject){reject=false;return route.fulfill({json:{succ:0}})}
     const e=reviews.get(payload.reviewId);e.review.isLike=payload.isUnlike?0:1;e.likesCount+=payload.isUnlike?-1:1;
    }else if(url.pathname==='/web/review/comment'){const e=reviews.get(payload.reviewId);e.commentsCount=(e.commentsCount||0)+1}
    else throw Error('Unexpected fixture write');
    return route.fulfill({json:{succ:1}});
   }
   return request.isNavigationRequest()?route.fulfill({contentType:'text/html',body:fixture}):route.abort();
  });
  await page.goto('https://weread.qq.com/web/reader/i3-fixture?bookId=123&chapterUid=12');
  await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.compatibility==='READY');
  await page.waitForFunction(()=>document.querySelector('[data-review-operation="like"]')?.disabled===false);
  await check('List and stable scrolling remain read-only; unknown reply count is omitted',async()=>{
   assert.equal(report.singleReads,0);assert.equal(report.writes.length,0);
   await page.getByRole('button',{name:'关闭右侧评论栏'}).click();await page.waitForTimeout(800);await open();
   assert.equal((await action('reply').innerText()).trim(),'▱ 评论');
   const captures=await page.evaluate(()=>metrics.capture);await page.keyboard.press('Escape');await page.mouse.wheel(0,100);await page.waitForTimeout(800);
   assert.equal(report.singleReads,0);assert.equal(report.writes.length,0);assert.equal(await page.evaluate(()=>metrics.capture),captures);await open();
  });
  await check('Like/unlike targets the clicked thought and calibrates shared UI state',async()=>{
   const captures=await page.evaluate(()=>metrics.capture);
   await action('like').click();await settled();assert.equal(await action('like').getAttribute('aria-pressed'),'true');assert.match(await action('like').innerText(),/4/);
   assert.deepEqual(report.writes.at(-1),{path:'/web/review/like',reviewId:'first',isUnlike:false});
   await action('like').click();await settled();assert.equal(await action('like').getAttribute('aria-pressed'),'false');
   await action('like',1).click();await settled();assert.deepEqual(report.writes.at(-1),{path:'/web/review/like',reviewId:'second',isUnlike:true});
   assert.equal(await page.evaluate(()=>metrics.capture),captures);
  });
  await check('In-flight clicks cannot create duplicate writes',async()=>{
   hold=true;const before=report.writes.length;await action('like').evaluate(e=>{e.click();e.click()});
   await page.waitForFunction(()=>document.querySelector('.wxrc_public_review_popup [data-review-operation="like"]').disabled);
   while(!release)await page.waitForTimeout(20);assert.equal(report.writes.length,before+1);assert.equal(await action('reply').isDisabled(),true);release();await settled();
  });
  await check('Rejected writes require an explicit read-only refresh and do not retry',async()=>{
   reject=true;const before=report.writes.length;await action('like').click();await settled();assert.equal(await action('like').isDisabled(),true);
   assert.match(await popup().innerText(),/点赞未成功/);await page.waitForTimeout(600);assert.equal(report.writes.length,before+1);
   await action('refresh').click();await settled();assert.equal(await action('like').isEnabled(),true);assert.equal(report.writes.length,before+1);
  });
  await check('Server state drift synchronizes the button without reversing user intent',async()=>{
   reviews.get('first').review.isLike=0;const before=report.writes.length;await action('like').click();await settled();assert.match(await popup().innerText(),/状态已变化/);assert.equal(report.writes.length,before);assert.equal(await action('like').getAttribute('aria-pressed'),'false');
  });
  await check('Applied write with failed calibration stays uncertain until manual refresh',async()=>{
   hold=true;const before=report.writes.length;await action('like').click();while(!release)await page.waitForTimeout(20);
   failCalibration=true;release();await settled();assert.match(await popup().innerText(),/已提交，状态未确认/);
   await page.waitForTimeout(600);assert.equal(report.writes.length,before+1);assert.equal(await action('like').isDisabled(),true);
   await action('refresh').click();await settled();assert.equal(await action('like').getAttribute('aria-pressed'),'true');assert.equal(report.writes.length,before+1);
  });
  await check('Native reply is blank, pagination and submission are explicit, close restores focus',async()=>{
   const before=report.writes.length;await action('reply',1).click();await page.locator('#replyInput').waitFor({state:'visible'});await settled();
   assert.equal(await page.locator('#detailTarget').innerText(),'second');assert.equal(await page.locator('#replyInput').inputValue(),'');assert.equal(report.writes.length,before);assert.equal(report.commentReads,0);
   await page.locator('#moreReplies').click();await page.waitForTimeout(100);assert.equal(report.commentReads,1);
   await page.locator('#replyInput').fill('Explicit fixture reply');assert.equal(report.writes.length,before);await page.locator('#submitReply').click();await page.waitForTimeout(100);
   assert.deepEqual(report.writes.at(-1),{path:'/web/review/comment',reviewId:'second',content:'Explicit fixture reply'});
   await page.locator('#closeDetail').click();await page.waitForFunction(()=>document.activeElement?.dataset.reviewOperation==='reply');
   assert.match(await action('reply',1).innerText(),/3/);assert.equal(await page.locator('#detailContainer').isHidden(),true);
  });
  await check('Narrow viewport, themes and repeated popup lifecycle preserve controls without background writes',async()=>{
   const before=report.writes.length;await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:800});await page.waitForTimeout(800);await open();
   assert.equal(await popup().evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}),true);
   await page.screenshot({path:path.join(output,'fixture-day.png')});await page.evaluate(()=>document.body.classList.remove('wr_whiteTheme'));await page.screenshot({path:path.join(output,'fixture-night.png')});
   for(let i=0;i<3;i++){await page.keyboard.press('Escape');await open()};assert.equal(report.writes.length,before);
  });
  await check('Sidebar and popup use the same per-thought state without remapping on writes',async()=>{
   await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});await page.locator('.wxrc_sidebar_launcher').click();await page.waitForTimeout(900);
   const button=page.locator('.chrex-comment-wrapper [data-review-operation="like"]').first();assert.equal(await button.getAttribute('aria-pressed'),'true');
   const captures=await page.evaluate(()=>metrics.capture);await button.click();await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper [data-review-operation="like"]')?.getAttribute('aria-pressed')==='false');
   assert.equal(await page.evaluate(()=>metrics.capture),captures);await open();assert.equal(await action('like').getAttribute('aria-pressed'),'false');
   await page.keyboard.press('Escape');await page.getByRole('button',{name:'关闭右侧评论栏'}).click();await page.waitForTimeout(900);await open();
  });
  await check('A late applied write cannot rebuild old chapter UI or write the new chapter',async()=>{
   hold=true;const before=report.writes.length;await action('like').click();while(!release)await page.waitForTimeout(20);
   await page.evaluate(()=>switchChapter(13));await page.waitForFunction(()=>!document.querySelector('.wxrc_public_review_popup'));
   release();await page.waitForTimeout(1000);assert.equal(report.writes.length,before+1);assert.equal(reviews.get('first').review.isLike,1);assert.equal(await popup().count(),0);
   await page.evaluate(()=>switchChapter(12));await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.chapterUid==='12'&&document.querySelector('.wxrc_public_review_wrapper'));
   await page.waitForTimeout(800);await open();assert.equal(await action('like').getAttribute('aria-pressed'),'true');
  });
  await check('Native capability loss and mode exit reject stale interactions',async()=>{
   await page.evaluate(()=>fixtureReader.$store._actions={});await action('like').click();await settled();assert.match(await popup().innerText(),/暂不支持/);
   const before=report.writes.length;await page.evaluate(()=>switchMode('horizontal'));await page.waitForFunction(()=>!document.querySelector('.wxrc_public_review_popup,.chrex-comment-wrapper'));
   await page.waitForTimeout(600);assert.equal(report.writes.length,before);assert.equal(await page.locator('#detailContainer').isHidden(),true);
  });
  assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(error){report.failure=error.stack;process.exitCode=1;console.error(error)}
 finally{fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify(report,null,2));await context.close()}
})();
