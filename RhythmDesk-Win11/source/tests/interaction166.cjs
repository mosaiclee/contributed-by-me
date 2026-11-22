const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.resolve(__dirname, '../ui/app.js'), 'utf8');
function section(a, b) {
  const i = app.indexOf(a), j = app.indexOf(b, i + a.length);
  assert(i >= 0 && j > i);
  return app.slice(i, j);
}
function gestures() {
  let wall=0, held=0, resumes=0;
  const paperEvents={}, zooms=[];
  const s={performance:{now:()=>wall}, clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),
    setScoreZoom:(...args)=>zooms.push(args),requestedScoreZoom:()=>1,
    mouseLeftOnScore:false,blankTap:null,paperPan:null,scoreTapViewport:null,
    holdFollowing:()=>held++,followPlayback:()=>resumes++,resumeFollowingAfterDrag:()=>resumes++,
    paperTouch:false,paperPinch:undefined,closePopups(){},manualFollowUntil:0,canFollow:()=>false,
    el:{paper:{clientWidth:390,clientHeight:500,scrollLeft:150,scrollTop:42,contains:()=>true,
      addEventListener:(type,fn)=>paperEvents[type]=fn,classList:{remove(){}}}}};
  vm.createContext(s);
  vm.runInContext(section('let quickTap = null;', "document.addEventListener('click'"),s);
  const event={currentTarget:{}};
  assert.equal(s.quickDoubleTap(event,'note'),false);wall=249;assert.equal(s.quickDoubleTap(event,'note'),true);
  wall=300;assert.equal(s.quickDoubleTap(event,'note'),false);wall=550;assert.equal(s.quickDoubleTap(event,'note'),false);
  wall=560;assert.equal(s.quickDoubleTap(event,'hand'),false);wall=580;assert.equal(s.quickDoubleTap(event,'hand'),true);
  vm.runInContext(section("el.paper.addEventListener('wheel', event => {", "function resumeFollowingAfterDrag()"),s);
  let prevented=0;
  const wheel={deltaMode:0,deltaY:-80,deltaX:0,clientX:195,clientY:100,buttons:0,preventDefault(){prevented++}};
  paperEvents.wheel(wheel);assert.equal(zooms.length,0);assert.equal(prevented,0);
  paperEvents.wheel({...wheel,buttons:1});assert.equal(zooms.length,1);assert(zooms[0][0]>1);assert.equal(prevented,1);
  s.paperPan={id:3};paperEvents.pointerup({pointerId:3});assert.equal(s.paperPan,null);assert(resumes);
  vm.runInContext(section('function handleScoreTouch(', "for (const name of ['touchstart'"),s);
  const t=(x,y)=>({clientX:x,clientY:y,target:{}});
  const touch=(type,targets)=>s.handleScoreTouch({type,touches:targets,cancelable:true,preventDefault(){}});
  touch('touchstart',[t(20,20)]);assert(held);
  touch('touchstart',[t(20,20),t(120,20)]);
  touch('touchmove',[t(20,20),t(170,20)]);assert.equal(zooms.at(-1)[0],1.5);
  const before=resumes;touch('touchend',[]);assert(resumes>before && !s.paperTouch);
  console.log('PASS double-tap target/time guard, mouse wheel with/without left button, drag release and touch pinch.');
}
async function saves() {
  const files=new Map([['Test.rhythm.json','old'],['Test (1).rhythm.json','first']]);let choice='both',shareName,downloaded;
  const notFound=()=>Object.assign(Error('missing'),{name:'NotFoundError'});
  const folder={async getFileHandle(n,options) {
    if(!files.has(n)&&!options?.create)throw notFound();
    return {async createWritable(){return {async write(b){files.set(n,b)},async close(){},async abort(){}}}};
  }};
  const s={navigator:{canShare:()=>true,async share({files:shared}){shareName=shared[0].name}}, el:{scoreSaveHint:{}},
    showDirectoryPicker:async()=>folder, t:k=>k, notify(){},Blob,File,
    download:(blob,n)=>{downloaded=n},scoreConflictChoice:async()=>choice};
  vm.createContext(s);
  vm.runInContext(section('function scoreExtensionLength(', 'function scoreConflictChoice('),s);
  vm.runInContext(app.slice(app.indexOf('function directoryPickerBlocked(')),s);
  assert.equal(await s.saveScoreExport(new Blob(['new']),'Test.rhythm.json'),'Test (2).rhythm.json'); assert.equal(files.get('Test.rhythm.json'),'old');
  choice='overwrite'; const newer=new Blob(['newer']);await s.saveScoreExport(newer,'Test.rhythm.json');assert.equal(files.get('Test.rhythm.json'),newer);
  choice=null;assert.equal(await s.saveScoreExport(new Blob(['cancel']),'Test.rhythm.json'),null);assert.equal(files.get('Test.rhythm.json'),newer);
  delete s.showDirectoryPicker;const blob=new Blob(['safari']);assert.equal(await s.saveScoreExport(blob,'x.pdf'),'x.pdf');assert.equal(shareName,'x.pdf');
  s.navigator.share=async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'})};assert.equal(await s.saveScoreExport(blob,'x.pdf'),null);assert.equal(downloaded,undefined);
  s.navigator.canShare=()=>false;await s.saveScoreExport(blob,'x.jpg');assert.equal(downloaded,'x.jpg');
  let record, pickerSawPause=false;
  Object.assign(s,{engine:{running:true,paused:false},togglePlayback:async()=>{s.engine.paused=true},
    logFollow:event=>s.followEvents.push({event}),followEvents:[],navigator:{userAgent:'Test'},
    el:{paper:{clientWidth:390,clientHeight:338}},saveScoreExport:async(f,name)=>{pickerSawPause=s.engine.paused;record=JSON.parse(await f.text());return name}});
  vm.runInContext(section('async function exportFollowDiagnostics()', 'function measureMotionScale()'),s);
  await s.exportFollowDiagnostics();assert(pickerSawPause);assert.equal(record.version,'1.66');assert.equal(record.events.at(-1).event,'export');
  console.log('PASS Windows save/overwrite/keep-both/cancel, Safari share/Save to Files/cancel, download fallback, diagnostic JSON.');
}
gestures();saves().catch(e=>{console.error(e);process.exitCode=1});
