const assert=require('node:assert/strict'),test=require('node:test'),path=require('node:path'),Module=require('node:module'),babel=require('@babel/core');
const filename=path.resolve(__dirname,'../src/pages/Content/commentBrowsing.js'),helper=new Module(filename,module);
helper._compile(babel.transformFileSync(filename,{configFile:false,babelrc:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,filename);
const {createPopupBrowsingMemory,isLongComment,POPUP_PAGE_SIZE}=helper.exports;
test('U1 long comments are detected without truncating or modifying source text',()=>{
 assert.equal(isLongComment('short'),false);assert.equal(isLongComment('x'.repeat(601)),true);assert.equal(isLongComment('line\n'.repeat(9)),true);assert.equal(isLongComment('<b>short</b>'),false);
});
test('U1 popup browsing state is copied, group-scoped and bounded',()=>{
 const memory=createPopupBrowsingMemory(2),state={loaded:60,scrollTop:125,expanded:new Set(['first'])};
 memory.save('12:range-a',state);state.expanded.clear();const restored=memory.read('12:range-a');assert.equal(restored.expanded.has('first'),true);restored.expanded.clear();assert.equal(memory.read('12:range-a').expanded.size,1);
 assert.equal(memory.read('12:range-b').loaded,POPUP_PAGE_SIZE);memory.save('12:range-b',state);memory.save('12:range-c',state);assert.equal(memory.read('12:range-a').scrollTop,0);
 memory.clear();assert.equal(memory.read('12:range-c').loaded,POPUP_PAGE_SIZE);
});
