const assert=require('node:assert/strict'),test=require('node:test'),path=require('node:path'),Module=require('node:module'),babel=require('@babel/core');
const file=path.resolve(__dirname,'../src/pages/Content/commentOrdering.js'),helper=new Module(file,module);
helper._compile(babel.transformFileSync(file,{configFile:false,babelrc:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,file);
const {orderCommentRows,getAuthorKey,getAuthorOptions,getLoadedLikesCount,normalizeSortOrder}=helper.exports;
test('U4 likes sort handles zero and unknown counts without mutating API data',()=>{
 const entries=[null,0,9,9,'20',-1].map(likesCount=>Object.freeze({likesCount}));
 const rows=entries.map((entry,index)=>Object.freeze({entry,index,start:10-index}));
 assert.deepEqual(orderCommentRows(rows,'likes').map(r=>r.index),[2,3,1,0,4,5]);
 assert.deepEqual(orderCommentRows(rows,'api'),rows);assert.deepEqual(rows.map(r=>r.index),[0,1,2,3,4,5]);
 assert.equal(getLoadedLikesCount({review:{likesCount:2}}),2);assert.equal(getLoadedLikesCount({likesCount:NaN}),null);
});
test('U4 author identity separates equal names and includes missing authors',()=>{
 const entries=[{review:{author:{name:'同名',userVid:1}}},{author:{name:'同名',userVid:2}},{author:{name:'同名',userVid:1}},{}];
 const options=getAuthorOptions(entries);assert.deepEqual(options.map(o=>o.count),[2,1,1]);assert.notEqual(getAuthorKey(entries[0]),getAuthorKey(entries[1]));assert.match(options[0].label,/id:1/);assert.equal(getAuthorKey({author:{name:'旧数据'}}),'name:旧数据');
});
test('U4 reading fallback and stored sort values are compatible',()=>{
 assert.equal(normalizeSortOrder('likes'),'likes');assert.equal(normalizeSortOrder('bad'),'reading');
 const rows=[{index:0,start:Infinity},{index:1,start:2},{index:2,start:2}];assert.deepEqual(orderCommentRows(rows,'reading').map(r=>r.index),[1,2,0]);
});
