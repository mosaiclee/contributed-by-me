const vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
const {webcrypto}=require('node:crypto');
const assert=require('node:assert/strict');
const dir=process.argv[2];
if(!dir)throw Error('Supply an extracted PWA directory');
const root='https://example.invalid/score/offline/';
const separate='rhythmdesk-iphone-offline:https://example.invalid/another/:old';
const predecessor='rhythmdesk-iphone-offline:'+root+':old';
const records=new Map([[separate,new Map()],[predecessor,new Map()]]);
const handlers={};let mode='bad';
const env={URL,Map,Response,crypto:webcrypto,self:{registration:{scope:root},clients:{claim:async()=>{}},skipWaiting:async()=>{},
  addEventListener:(name,fn)=>handlers[name]=fn}, caches:{async open(n) {
    if(!records.has(n))records.set(n,new Map()); const data=records.get(n);
    return {async put(k,r){data.set(k,r.clone())},async match(k){return data.get(k)?.clone()}};
  },keys:async()=>[...records.keys()],delete:async n=>records.delete(n)},
  fetch:async url=>{if(mode==='offline')throw Error('unexpected network fetch');const f=new URL(url).pathname.split('/').pop();
    return new Response(mode==='bad'&&f==='offline-shell.html'?'truncated cache':fs.readFileSync(path.join(dir,f)));}};
vm.createContext(env); vm.runInContext(fs.readFileSync(path.join(dir,'sw.js'),'utf8'),env);
function lifecycle(name){let result;handlers[name]({waitUntil(p){result=p}});return result;}
function navigate(suffix,mode='navigate') {let response;handlers.fetch({request:{method:'GET',mode,url:new URL(suffix,root).href},respondWith(p){response=p}});return response;}
(async()=>{
  await assert.rejects(lifecycle('install'),/Incomplete offline page/);assert(records.has(predecessor)&&records.has(separate)&&records.size===2);
  mode='online';await lifecycle('install');await lifecycle('activate');assert(!records.has(predecessor)&&records.has(separate));
  mode='offline';
  for(const dest of ['./','index.html?rhythm-offline-test=1','RhythmDesk-iPhone-Offline.html']) {
    const response=await navigate(dest); assert.equal(response.status,200);
    const data=Buffer.from(await response.arrayBuffer());
    assert.deepEqual(data,fs.readFileSync(path.join(dir,dest.endsWith('Offline.html')?'RhythmDesk-iPhone-Offline.html':'index.html')));
  }
  const check=await navigate('./?rhythm-cache-check=1','same-origin');
  assert.deepEqual(await check.json(),{version:'1.65',ready:true});
  console.log('PASS service-worker install, corrupt cache rejection, scope-safe upgrade, offline launch, standalone HTML and 1.65 integrity check.');
})().catch(e=>{console.error(e);process.exitCode=1});
