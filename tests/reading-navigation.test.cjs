const assert=require('node:assert/strict'),test=require('node:test'),path=require('node:path'),Module=require('node:module'),babel=require('@babel/core');
const filename=path.resolve(__dirname,'../src/pages/Content/readingNavigation.js'),helper=new Module(filename,module);
helper._compile(babel.transformFileSync(filename,{configFile:false,babelrc:false,presets:[['@babel/preset-env',{targets:{node:'current'}}]]}).code,filename);
const {chooseReadingAnchor,anchorScrollTop,shortcutOperation}=helper.exports;
test('U2 only chooses visible cached ranges and restores the same rect viewport offset',()=>{
 const ranges=new Map([['a',{rects:[{y:900,h:20}]}],['b',{rects:[{y:120,h:20},{y:145,h:20}]}]]);
 const anchor=chooseReadingAnchor(ranges,0,800);assert.equal(anchor.key,'b');assert.equal(anchor.offset,120);
 ranges.get('b').rects[0].y=400;assert.equal(anchorScrollTop(anchor,ranges,80),360);
 ranges.delete('b');assert.equal(anchorScrollTop(anchor,ranges,80),null);assert.equal(chooseReadingAnchor(new Map(),0,800),null);
});
test('U2 shortcuts require exact modifiers and never react to repetition or composition',()=>{
 const event={altKey:true,shiftKey:true,code:'KeyC'};assert.equal(shortcutOperation(event),'nearby');assert.equal(shortcutOperation({...event,code:'KeyY'}),'copy');
 for(const change of [{repeat:true},{isComposing:true},{defaultPrevented:true},{ctrlKey:true},{metaKey:true},{altKey:false},{shiftKey:false}])assert.equal(shortcutOperation({...event,...change}),null);
});
test('U2 native-panel position restoration respects layout changes and deliberate navigation',()=>{
 const {capturePanelPosition,restorePanelPosition,installNavigationTracking}=helper.exports;
 const events=new Map(),sidebar={scrollTop:80,isConnected:true},popup={scrollTop:120,isConnected:true},wrapper={dataset:{layoutVersion:'one'}};
 global.window={scrollY:200,innerWidth:1000,addEventListener:(name,fn)=>events.set(name,fn),scrollTo:({top})=>{window.scrollY=top}};
 global.document={documentElement:{},addEventListener:()=>{},querySelector:selector=>selector==='.comment-react-wrapper'?sidebar:selector==='.wxrc_public_review_popup'?popup:wrapper};
 try{
  installNavigationTracking();const position=capturePanelPosition();window.scrollY=0;popup.scrollTop=0;restorePanelPosition(position);assert.equal(window.scrollY,200);assert.equal(popup.scrollTop,120);
  wrapper.dataset.layoutVersion='two';window.scrollY=300;restorePanelPosition(position);assert.equal(window.scrollY,300);
  events.get('wheel')({target:null});popup.scrollTop=500;restorePanelPosition(position);assert.equal(popup.scrollTop,500);
 }finally{delete global.window;delete global.document}
});
