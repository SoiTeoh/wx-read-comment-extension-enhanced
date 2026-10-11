// I4 interaction lifecycle/performance regression, fully routed and account-free.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const {fixture:base}=require('./i3-browser-regression.cjs');
const fixture=base+`<script>fixtureReader.hasLogin=false;window.detailShows=0;
const panel=fixtureReader.$refs.readerNotePanel.$refs.reviewDetail,originalShow=panel.show;
panel.show=function(options){detailShows++;return originalShow.call(this,options)};
replyInput.oninput=()=>panel.commentText=replyInput.value;
</script>`;
(async()=>{
 const output=path.resolve(__dirname,'../.test-artifacts/i4');fs.mkdirSync(output,{recursive:true});
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'wxrc-i4-')),{
  channel:'chromium',headless:process.env.WXRC_HEADLESS==='1',viewport:{width:1440,height:1000},
  args:[`--disable-extensions-except=${path.resolve(__dirname,'../build')}`,`--load-extension=${path.resolve(__dirname,'../build')}`]});
 const page=context.pages()[0],report={controlledFixture:true,cases:[],errors:[],listReads:0,singleReads:0,writes:[],stress:{cardCount:800}};
 const entries=Array.from({length:800},(_,i)=>({reviewId:'thought-'+i,review:{reviewId:'thought-'+i,bookId:'123',chapterUid:12,range:'0-10',content:'Thought '+i,author:{name:'Reader '+i},isLike:0,isPrivate:0},likesCount:3}));
 let holdRead=false,releaseRead;
 page.on('pageerror',e=>report.errors.push(e.message));
 const check=async(name,fn)=>{await fn();report.cases.push({name,passed:true});console.log('PASS: '+name)};
 const popup=()=>page.locator('.wxrc_public_review_popup');
 const button=(operation,index=0)=>popup().locator(`[data-review-operation="${operation}"]`).nth(index);
 const settled=()=>page.waitForFunction(()=>![...document.querySelectorAll('.wxrc_review_action_status')].some(e=>e.textContent.startsWith('正在')));
 const open=async()=>{await page.locator('.wxrc_public_review_wrapper').first().focus();await page.waitForTimeout(150);await page.keyboard.press('Enter');await popup().waitFor()};
 try{
  await context.route('https://weread.qq.com/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/web/review/list'){report.listReads++;return route.fulfill({json:{hasMore:0,reviews:url.searchParams.get('chapterUid')==='12'?entries:[]}})}
   if(url.pathname==='/web/review/single'){
    report.singleReads++;if(holdRead){holdRead=false;await new Promise(resolve=>releaseRead=resolve);releaseRead=null}
    return route.fulfill({json:entries.find(e=>e.reviewId===url.searchParams.get('reviewId'))});
   }
   if(request.method()==='POST'){
    assert.equal(url.pathname,'/web/review/like');const data=request.postDataJSON();report.writes.push(data);const entry=entries.find(e=>e.reviewId===data.reviewId);entry.review.isLike=data.isUnlike?0:1;entry.likesCount+=data.isUnlike?-1:1;return route.fulfill({json:{succ:1}});
   }
   return request.isNavigationRequest()?route.fulfill({contentType:'text/html',body:fixture}):route.abort();
  });
  await page.goto('https://weread.qq.com/web/reader/i4-fixture?bookId=123&chapterUid=12');
  await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.compatibility==='READY');
  await check('Login recovery uses explicit read-only refresh without reloading the chapter',async()=>{
   const like=page.locator('.chrex-comment-wrapper [data-review-operation="like"]').first();assert.equal(await like.isDisabled(),true);
   assert.equal(report.singleReads,0);const lists=report.listReads;await page.evaluate(()=>fixtureReader.hasLogin=true);
   await page.locator('.chrex-comment-wrapper [data-review-operation="refresh"]').first().click();await settled();assert.equal(await like.isEnabled(),true);assert.equal(report.listReads,lists);assert.equal(report.writes.length,0);
  });
  await check('800-card interaction mutates only the target sidebar and popup rows',async()=>{
   await open();await page.evaluate(()=>{
    window.changedRows=new Set();const rows=[...document.querySelectorAll('.wxrc_review_actions')];
    window.rowObserver=new MutationObserver(records=>{for(const record of records){const node=record.target.nodeType===1?record.target:record.target.parentElement;const row=node.closest('.wxrc_review_actions');if(row)changedRows.add(rows.indexOf(row))}});
    rows.forEach(row=>rowObserver.observe(row,{attributes:true,childList:true,subtree:true,characterData:true}));
   });
   const started=Date.now();await button('like').click();await settled();report.stress.interactionMs=Date.now()-started;
   const changed=await page.evaluate(()=>{rowObserver.disconnect();return [...changedRows]});report.stress.changedRows=changed.length;
   assert.deepEqual(changed.sort((a,b)=>a-b),[0,800]);assert.ok(report.stress.interactionMs<5000);assert.equal(report.writes.length,1);
   assert.equal(await page.locator('.chrex-comment-wrapper [data-review-operation="like"]').first().getAttribute('aria-pressed'),'true');
  });
  await check('Drafts are preserved and a second reply cannot replace an active native editor',async()=>{
   await button('refresh',1).click();await settled();await button('reply').focus();await page.keyboard.press('Enter');await page.locator('#replyInput').waitFor({state:'visible'});await settled();
   assert.equal(await page.locator('#replyInput').inputValue(),'');await page.locator('#replyInput').fill('Unsubmitted draft');
   await button('reply',1).evaluate(e=>e.click());await settled();assert.equal(await page.locator('#detailTarget').innerText(),'thought-0');assert.equal(await page.locator('#replyInput').inputValue(),'Unsubmitted draft');
   assert.equal(await page.evaluate(()=>detailShows),1);assert.equal(report.writes.length,1);
   await page.locator('#closeDetail').click();await page.waitForFunction(()=>document.activeElement?.dataset.reviewOperation==='reply');
   await button('reply',1).click();await settled();assert.equal(await page.locator('#detailContainer').isHidden(),true);assert.equal(await page.evaluate(()=>detailShows),1);
   await page.evaluate(()=>{fixtureReader.$refs.readerNotePanel.$refs.reviewDetail.commentText='';replyInput.value=''});
   await button('refresh',1).click();await settled();
  });
  await check('Native capability loss and restoration recover per action through refresh',async()=>{
   await page.evaluate(()=>{window.savedActions=fixtureReader.$store._actions;fixtureReader.$store._actions={}});
   await button('like').click();await settled();await button('refresh').click();await settled();assert.equal(await button('like').isDisabled(),true);assert.equal(await button('reply').isEnabled(),true);
   await page.evaluate(()=>fixtureReader.$store._actions=savedActions);await button('refresh').click();await settled();assert.equal(await button('like').isEnabled(),true);assert.equal(report.writes.length,1);
  });
  await check('A delayed detail read after chapter exit cannot open a stale editor',async()=>{
   holdRead=true;await button('reply').click();while(!releaseRead)await page.waitForTimeout(20);
   await page.evaluate(()=>switchChapter(13));await page.waitForFunction(()=>!document.querySelector('.wxrc_public_review_popup'));
   releaseRead();await page.waitForTimeout(900);assert.equal(await page.locator('#detailContainer').isHidden(),true);assert.equal(await page.evaluate(()=>detailShows),1);assert.equal(report.writes.length,1);
   await page.evaluate(()=>switchChapter(12));await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.chapterUid==='12'&&document.querySelector('.wxrc_public_review_wrapper'));await page.waitForTimeout(700);
  });
  await check('Repeated popup lifecycle does not duplicate interaction calls',async()=>{
   for(let i=0;i<8;i++){await open();await page.keyboard.press('Escape')};await open();const before=report.singleReads;
   await button('reply').click();await page.locator('#replyInput').waitFor({state:'visible'});await settled();assert.equal(report.singleReads,before+1);
   await page.locator('#closeDetail').click();await page.waitForFunction(()=>document.activeElement?.dataset.reviewOperation==='reply');assert.equal(report.singleReads,before+2);
  });
  await check('Stable scroll and theme changes add no writes, detail reads or mapping',async()=>{
   await page.keyboard.press('Escape');const reads=report.singleReads,writes=report.writes.length,captures=await page.evaluate(()=>metrics.capture),lists=report.listReads;
   await page.mouse.wheel(0,100);await page.waitForTimeout(700);await page.evaluate(()=>document.body.classList.remove('wr_whiteTheme'));await page.waitForTimeout(700);
   report.stress.steadyMappingDelta=(await page.evaluate(()=>metrics.capture))-captures;assert.equal(report.stress.steadyMappingDelta,0);assert.equal(report.singleReads,reads);assert.equal(report.listReads,lists);assert.equal(report.writes.length,writes);
   await page.setViewportSize({width:390,height:800});await page.waitForTimeout(800);await open();await page.screenshot({path:path.join(output,'fixture-narrow-night.png')});
  });
  await check('Mode exit closes an owned detail and restores only vertical enhancement',async()=>{
   await button('reply').click();await page.locator('#replyInput').waitFor({state:'visible'});await page.evaluate(()=>switchMode('horizontal'));
   await page.waitForFunction(()=>!document.querySelector('.chrex-comment-wrapper,.wxrc_public_review_popup'));assert.equal(await page.locator('#detailContainer').isHidden(),true);
   const reads=report.listReads;await page.waitForTimeout(700);assert.equal(report.listReads,reads);await page.evaluate(()=>switchMode('vertical'));
   await page.waitForFunction(()=>document.querySelector('.chrex-comment-wrapper')?.dataset.compatibility==='READY');assert.equal(report.writes.length,1);
  });
  assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(error){report.failure=error.stack;process.exitCode=1;console.error(error)}
 finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await context.close()}
})();
