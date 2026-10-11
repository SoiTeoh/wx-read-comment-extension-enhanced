const assert=require('node:assert/strict');
const test=require('node:test');
const path=require('node:path');
const Module=require('node:module');
const babel=require('@babel/core');
const filename=path.resolve(__dirname,'../src/pages/Content/nativeReviewOperations.js');
const helper=new Module(filename,module);
helper._compile(babel.transformFileSync(filename,{configFile:false,babelrc:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,filename);
const {createReviewOperations,reviewState,inspectReviewRuntime}=helper.exports;
const setup=()=>{
  const state={mode:'vertical',liked:false,count:3,reads:0,writes:[],closed:[],readFailure:false};
  const panel={$options:{name:'ReaderFloatReviewDetailPanel'},showing:false,review:null,
    show(options){this.review=options.review;this.showing=true;this.options=options},hide(){this.showing=false}};
  const reader={bookId:'123',currentChapterUid:12,hasLogin:true,$el:{isConnected:true},$children:[panel],
    $store:{_actions:{FETCH_REVIEW_LIKE:[()=>{}]},async dispatch(action,payload){state.writes.push({action,payload});state.liked=!payload.isUnlike;state.count+=state.liked?1:-1;return{data:{succ:1}}}}};
  const env={getReader:()=>reader,getMode:()=>state.mode,getChapterUid:r=>String(r.currentChapterUid),
    readReview:async id=>{state.reads++;if(state.readFailure)throw Error('read failure');return{reviewId:id,review:{reviewId:id,bookId:'123',chapterUid:12,isPrivate:0,isLike:state.liked?1:0},likesCount:state.count}},
    onDetailClosed:e=>state.closed.push(e)};
  const operations=createReviewOperations(env),register=()=>operations.register({bookId:'123',chapterUid:'12',reviewIds:['first','second']});
  return{state,panel,reader,env,operations,register,execute:(token,operation,id='first',expectedIsLike=false)=>operations.execute({token,reviewId:id,operation,expectedIsLike})};
};
test('I3 registration and capability inspection are read-only, unknown counts remain unknown',()=>{
  const h=setup(),r=h.register();assert.equal(r.capabilities.like,true);assert.equal(r.capabilities.reply,true);
  assert.equal(h.state.reads,0);assert.equal(h.state.writes.length,0);assert.equal(h.panel.showing,false);
  assert.deepEqual(reviewState({review:{}}),{isLike:null,likesCount:null,commentsCount:null});
  assert.equal(reviewState({likesCount:0,commentsCount:0,review:{isLike:0}}).commentsCount,0);
  assert.equal(reviewState({likesCount:-1,review:{isLike:'0'}}).isLike,null);
});
test('I3 target whitelist, server identity, private reviews and context changes prevent writes',async()=>{
  for(const mutate of [h=>h.reader.bookId='other',h=>h.reader.currentChapterUid=13,h=>h.state.mode='horizontal',
    h=>h.reader._isDestroyed=true,h=>h.reader.$el.isConnected=false,h=>h.reader.hasLogin=false]){
    const h=setup(),{token}=h.register();mutate(h);await assert.rejects(h.execute(token,'like'));assert.equal(h.state.writes.length,0);
  }
  for(const change of [{bookId:'other'},{chapterUid:13},{reviewId:'second'},{isPrivate:1}]){
    const h=setup(),{token}=h.register();h.env.readReview=async()=>({reviewId:'first',review:{reviewId:'first',bookId:'123',chapterUid:12,isLike:0,...change}});
    await assert.rejects(h.execute(token,'like'),/REVIEW_TARGET_INVALID/);assert.equal(h.state.writes.length,0);
  }
  const h=setup(),{token}=h.register();await assert.rejects(h.execute(token,'like','unknown'),/REVIEW_TARGET_INVALID/);
  await assert.rejects(h.execute(token,'publish'),/UNKNOWN_OPERATION/);
});
test('I3 like and unlike bind the exact review ID and calibrate server counts after success',async()=>{
  const h=setup(),{token}=h.register();
  assert.deepEqual((await h.execute(token,'like','second')).state,{isLike:true,likesCount:4,commentsCount:null});
  assert.deepEqual(h.state.writes[0],{action:'FETCH_REVIEW_LIKE',payload:{reviewId:'second',isUnlike:false}});
  assert.equal((await h.execute(token,'like','second',true)).state.isLike,false);assert.equal(h.state.count,3);
  assert.deepEqual(h.state.writes[1].payload,{reviewId:'second',isUnlike:true});
});
test('I3 fresh server state mismatch synchronizes without silently toggling the opposite state',async()=>{
  const h=setup(),{token}=h.register();h.state.liked=true;
  const r=await h.execute(token,'like');assert.equal(r.changed,true);assert.equal(r.state.isLike,true);assert.equal(h.state.writes.length,0);
});
test('I3 concurrent clicks are rejected, failed and uncertain writes are never automatically retried',async()=>{
  const h=setup(),{token}=h.register();let release;h.env.readReview=()=>new Promise(resolve=>release=resolve);
  const first=h.execute(token,'refresh');await assert.rejects(h.execute(token,'like'),/OPERATION_BUSY/);
  release({reviewId:'first',review:{reviewId:'first',bookId:'123',chapterUid:12,isLike:0}});await first;
  for(const response of [{data:{succ:0}},new Error('network')]){
    const x=setup(),{token}=x.register();x.reader.$store.dispatch=async()=>{x.state.writes.push('attempt');return response};
    await assert.rejects(x.execute(token,'like'),response instanceof Error?/LIKE_RESULT_UNKNOWN/:/LIKE_REJECTED/);
    assert.equal(x.state.writes.length,1);
  }
});
test('I3 successful writes followed by failed calibration or chapter changes are explicitly distinguished',async()=>{
  const h=setup(),{token}=h.register();h.reader.$store.dispatch=async()=>{h.state.readFailure=true;h.state.writes.push('applied');return{data:{succ:1}}};
  await assert.rejects(h.execute(token,'like'),/LIKE_APPLIED_STATE_UNKNOWN/);assert.equal(h.state.writes.length,1);
  const x=setup(),t=x.register().token;const original=x.reader.$store.dispatch;
  x.reader.$store.dispatch=async(...args)=>{const result=await original(...args);x.reader.currentChapterUid=13;return result};
  const result=await x.execute(t,'like');assert.equal(result.applied,true);assert.equal(result.stale,true);assert.equal(result.state.isLike,true);
});
test('I3 reply opens only the native editor for the verified target and returns focus metadata on close',async()=>{
  const h=setup(),{token}=h.register();const result=await h.execute(token,'reply','second');assert.equal(result.opened,true);
  assert.equal(h.panel.options.showComment,true);assert.equal(h.panel.review.reviewId,'second');assert.equal(h.state.writes.length,0);
  h.panel.hide();h.operations.poll();assert.deepEqual(h.state.closed,[{token,reviewId:'second',restoreFocus:true}]);
  await h.execute(token,'reply');h.state.mode='horizontal';h.operations.poll();assert.equal(h.panel.showing,false);
});
test('I3 ambiguous actions and unrelated panels degrade individually without calling them',()=>{
  const h=setup();h.reader.$store._actions={'a/FETCH_REVIEW_LIKE':[], 'b/FETCH_REVIEW_LIKE':[]};
  assert.equal(h.register().capabilities.like,false);assert.equal(h.register().capabilities.reply,true);
  h.panel.$options.name='UnrelatedPanel';assert.equal(inspectReviewRuntime(h.reader).panel,null);
  assert.equal(h.state.writes.length,0);
});
