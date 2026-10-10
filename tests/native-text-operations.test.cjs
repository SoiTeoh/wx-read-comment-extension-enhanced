const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');
const load = (name, dependencies = {}) => {
  const filename = path.resolve(__dirname, '../src/pages/Content', name);
  const module = new Module(filename);
  module.require = name => dependencies[name] || require(name);
  module._compile(babel.transformFileSync(filename, { configFile:false, babelrc:false,
    presets:[['@babel/preset-env',{targets:{node:'current'}}]] }).code, filename);
  return module.exports;
};
const mode = load('readerMode.js');
const { createTextOperationSession } = load('nativeTextOperations.js', {'./readerMode':mode});
const setup = () => {
  let state = {mode:'vertical',signature:'layout1',version:1};
  const object = {chapterUid:12,getOffset:()=>10,getTextLength:()=>4,isTextOrCanvasType:()=>true};
  const calls=[];
  const reader = {$el:{isConnected:true},bookId:'123',currentChapterUid:12,hasLogin:true,isAIChatEnabled:true,
    getTextFromObjs:()=> '真实原文',getRectsByContentObjs:()=>[{x:10,y:20,w:50,h:30}],
    showSelectionToolBar:options=>calls.push(['underline',options]),
    showWriteReviewPanel:objects=>calls.push(['writeThought',objects]),
    showAiChatPanel:text=>calls.push(['askAI',text])};
  state.reader = reader;
  const session = createTextOperationSession({getReader:()=>state.reader,getMode:()=>state.mode,
    getChapterUid:r=>String(r.currentChapterUid),getSignature:()=>state.signature,
    getLayoutVersion:()=>state.version,getObjects:()=>[object],validateRects:()=>true});
  const prepare = ()=>session.prepare({bookId:'123',chapterUid:'12',range:{start:10,end:14}});
  return {state,reader,object,calls,session,prepare};
};
test('I2 preparation returns verified original text without invoking commands or exposing native objects',()=>{
  const h=setup(), c=h.prepare();
  assert.equal(c.text,'真实原文');assert.equal(h.calls.length,0);
  assert.deepEqual(c.range,{start:10,end:14});assert.equal(Object.values(c.operations).every(x=>x.enabled),true);
  assert.equal('objects' in c,false);assert.equal('reader' in c,false);
});
test('I2 incorrect range and chapter never produce usable operation handles',()=>{
  const h=setup();
  for(const input of [{chapterUid:13,range:{start:10,end:14}},{chapterUid:12,range:{start:10,end:15}},
    {chapterUid:12,range:{start:NaN,end:14}},{chapterUid:12,range:{start:-1,end:14}}])assert.throws(()=>h.session.prepare({bookId:'123',...input}));
  assert.throws(()=>h.session.prepare({bookId:'456',chapterUid:12,range:{start:10,end:14}}),/CONTEXT_EXPIRED/);
  assert.equal(h.calls.length,0);
});
test('I2 book, chapter, layout, instance, mode and destroyed context refuse native invocation',async()=>{
  for(const mutate of [h=>h.state.mode='horizontal',h=>h.reader.bookId='456',h=>h.reader.currentChapterUid=13,
    h=>h.state.signature='layout2',h=>h.state.version++,h=>h.reader._isDestroyed=true,
    h=>h.reader.$el.isConnected=false,h=>h.state.reader={...h.reader}]){
    const h=setup(),c=h.prepare();mutate(h);
    await assert.rejects(h.session.execute(c.token,'writeThought'),/CONTEXT_EXPIRED/);assert.equal(h.calls.length,0);
  }
});
test('I2 each native command receives correct original objects or text, copy never reads review content',async()=>{
  for(const operation of ['underline','writeThought','askAI','copy']){
    const h=setup(),c=h.prepare(),result=await h.session.execute(c.token,operation);
    if(operation==='copy'){assert.equal(result.text,'真实原文');assert.equal(h.calls.length,0)}
    else {assert.equal(result.opened,true);assert.equal(h.calls[0][0],operation);
      if(operation==='askAI')assert.equal(h.calls[0][1],'真实原文');
      if(operation!=='askAI')assert.equal((operation==='underline'?h.calls[0][1].objs:h.calls[0][1])[0],h.object);
      await assert.rejects(h.session.execute(c.token,operation),/OPERATION_BUSY/);}
  }
});
test('I2 per-operation degradation and login expiry do not disable copy or invoke missing entries',async()=>{
  const h=setup();h.reader.showAiChatPanel=undefined;h.reader.showWriteReviewPanel=undefined;
  const c=h.prepare();assert.equal(c.operations.copy.enabled,true);assert.equal(c.operations.underline.enabled,true);
  assert.equal(c.operations.askAI.enabled,false);assert.equal(c.operations.writeThought.enabled,false);
  h.reader.hasLogin=false;
  await assert.rejects(h.session.execute(c.token,'askAI'),/LOGIN_REQUIRED/);
  assert.equal((await h.session.execute(c.token,'copy')).text,'真实原文');assert.equal(h.calls.length,0);
});
test('I2 double click, native failure, unknown operation and replaced handle never retry side effects',async()=>{
  const h=setup();let release;
  h.reader.showWriteReviewPanel=()=>{h.calls.push('open');return new Promise(r=>release=r)};
  const c=h.prepare(),first=h.session.execute(c.token,'writeThought');
  await assert.rejects(h.session.execute(c.token,'writeThought'),/OPERATION_BUSY/);release();await first;
  assert.equal(h.calls.length,1);
  const fresh=h.prepare();await assert.rejects(h.session.execute(c.token,'copy'),/CONTEXT_EXPIRED/);
  await assert.rejects(h.session.execute(fresh.token,'like'),/UNKNOWN_OPERATION/);
  h.reader.showAiChatPanel=()=>{h.calls.push('failed');throw Error('private failure detail')};
  await assert.rejects(h.session.execute(fresh.token,'askAI'));
  await assert.rejects(h.session.execute(fresh.token,'askAI'),/OPERATION_BUSY/);
  assert.deepEqual(h.calls,['open','failed']);
  h.session.clear();await assert.rejects(h.session.execute(fresh.token,'copy'),/CONTEXT_EXPIRED/);
});
