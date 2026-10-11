const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const path = require('node:path');
const babel = require('@babel/core');
const filename = path.resolve(__dirname, '../src/pages/Content/reviewInteractions.js');
const code = babel.transformFileSync(filename, { configFile:false, babelrc:false, presets:[['@babel/preset-env',{targets:{node:'current'}}]] }).code;
const setup = () => {
  const listeners=[], sent=[], timers=new Map();let sequence=0;
  const window={addEventListener:(type,fn)=>listeners.push(fn),postMessage:message=>sent.push(message)};
  const exports={};
  vm.runInNewContext(code,{exports,window,setTimeout:fn=>{timers.set(++sequence,fn);return sequence},clearTimeout:id=>timers.delete(id),
    require:name=>name==='./utils'?{getReview:e=>e.review||e}:{reviewState:e=>({isLike:!!e.review.isLike,likesCount:e.likesCount??null,commentsCount:e.commentsCount??null})}}, {filename});
  const reply=(message,result,error)=>listeners.forEach(fn=>fn({source:window,data:{source:'WXRC_PAGE',type:'REVIEW_OPERATION_RESULT',requestId:message.requestId,result,error}}));
  const last=()=>sent.filter(e=>e.type==='EXECUTE_REVIEW_OPERATION').at(-1);
  const activate=async(count=2,caps={like:true,reply:true})=>{
    const entries=Array.from({length:count},(_,i)=>Object.freeze({review:Object.freeze({reviewId:String(i),isLike:0}),likesCount:3}));
    const task=exports.activateReviewInteractions('123','12',entries);reply(sent.at(-1),{token:'test-token',capabilities:caps});await task;return entries;
  };
  return{api:exports,sent,timers,reply,last,activate};
};
test('I4 one interaction only notifies its thought, including sidebar and popup subscribers',async()=>{
  const h=setup();await h.activate(800);let target=0,unrelated=0;
  const stop=h.api.subscribeReviewInteractions('0',()=>target++);h.api.subscribeReviewInteractions('0',()=>target++);
  for(let i=1;i<800;i++)h.api.subscribeReviewInteractions(String(i),()=>unrelated++);
  const task=h.api.performReviewOperation('0','like');h.reply(h.last(),{state:{isLike:true,likesCount:4},applied:true});await task;
  assert.equal(target,4);assert.equal(unrelated,0);assert.equal(h.api.getReviewInteractionState('799').likesCount,3);
  stop();const second=h.api.performReviewOperation('0','refresh');h.reply(h.last(),{state:{isLike:true,likesCount:4}});await second;assert.equal(target,6);
});
test('I4 session cleanup clears content timers and ignores late replies without cancelling native writes',async()=>{
  const h=setup();await h.activate();const task=h.api.performReviewOperation('0','like'),old=h.last();assert.equal(h.timers.size,1);
  h.api.clearReviewInteractions();await task;assert.equal(h.timers.size,0);assert.equal(h.api.getReviewInteractionState('0').ready,false);
  await h.activate();h.reply(old,{state:{isLike:true,likesCount:99},applied:true});assert.equal(h.api.getReviewInteractionState('0').isLike,false);
  assert.equal(h.sent.filter(e=>e.type==='EXECUTE_REVIEW_OPERATION').length,1);
});
test('I4 timeout and stale results release busy state, preserve counts and never auto-retry',async()=>{
  for(const stale of [false,true]){
    const h=setup();await h.activate();const task=h.api.performReviewOperation('0','like');
    if(stale)h.reply(h.last(),{state:{isLike:true,likesCount:4},applied:true,stale:true});else [...h.timers.values()][0]();
    await task;const state=h.api.getReviewInteractionState('0');assert.equal(state.busy,false);assert.equal(state.needsRefresh,true);assert.equal(state.likesCount,3);assert.equal(state.isLike,false);
    assert.equal(h.sent.filter(e=>e.type==='EXECUTE_REVIEW_OPERATION').length,1);
  }
});
test('I4 login failure and restored native capabilities recover through a manual read-only refresh',async()=>{
  const h=setup();await h.activate();const task=h.api.performReviewOperation('0','reply');h.reply(h.last(),undefined,'LOGIN_REQUIRED');await task;
  assert.equal(h.api.getReviewInteractionState('0').capabilities.reply,false);
  const refresh=h.api.performReviewOperation('0','refresh');h.reply(h.last(),{state:{isLike:false,likesCount:3},capabilities:{like:true,reply:true}});await refresh;
  assert.equal(h.api.getReviewInteractionState('0').capabilities.reply,true);assert.equal(h.api.getReviewInteractionState('0').needsRefresh,false);
  assert.deepEqual(h.sent.filter(e=>e.type==='EXECUTE_REVIEW_OPERATION').map(e=>e.operation),['reply','refresh']);
});
