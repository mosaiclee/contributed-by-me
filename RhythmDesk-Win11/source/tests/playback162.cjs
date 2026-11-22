// Replay the same public controls against the supplied Android page and the built browser page.
// The real score model, Transport, button handlers, scheduling and follow calculations run.
// DOM rectangles, the document timeline and audio output are simulated deterministically.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/Abondan.rhythm.json')));
const near = (a, b, message) => assert(Math.abs(a - b) < 0.005, message + ' (' + a + ', ' + b + ')');

function editor(page) {
  return [...fs.readFileSync(page, 'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(code => code.includes('class Transport {'));
}
function part(source, from, until) {
  const i = source.indexOf(from);
  const j = source.indexOf(until, i + from.length);
  assert(i >= 0 && j > i, 'missing code block ' + from);
  return source.slice(i, j);
}
class Style {
  constructor() { this.values = new Map(); this.transform = 'none'; }
  setProperty(name, value) { this.values.set(name, value); }
  getPropertyValue(name) { return this.values.get(name) || ''; }
  removeProperty(name) { this.values.delete(name); }
}
function shift(value) { return Number(/translate3d\(([-+.\deE]+)/.exec(value)?.[1] || 0); }
class TestEffect {
  setKeyframes(frames) { this.frames = frames; }
  updateTiming(timing) { Object.assign(this.timing, timing); }
  position(time) {
    const {delay = 0, duration} = this.timing;
    const ease = Math.max(0, Math.min(1, (time - delay) / duration));
    const frames = this.frames;
    const index = frames.findIndex((f, i) => i && f.offset >= ease);
    const b = frames[index > 0 ? index : frames.length - 1];
    const a = frames[index > 0 ? index - 1 : frames.length - 2];
    const mix = b.offset > a.offset ? (ease - a.offset) / (b.offset - a.offset) : 1;
    return shift(a.transform) + (shift(b.transform) - shift(a.transform)) * mix;
  }
}
function simulate(code, {android, width, zoom, scale, compositor = true, terminalLoop = false}) {
  const doc = structuredClone(fixture);
  if (terminalLoop) {
    for (const t of doc.tracks) {
      t.measures = t.measures.slice(0, 8);
      t.cells = t.cells.slice(0, t.measures.length * (t.type === 'shekere' ? 6 : 12));
    }
  }
  const id = doc.tracks[0].id;
  const slotWidth = 38 * zoom;
  const slots = doc.tracks[0].cells.length;
  const worldEnd = slots * slotWidth + width;
  // A native cap shorter than the visual score mimics the later-loop regression.
  const paper = {clientWidth: width, clientHeight: 338, offsetWidth: width, scrollWidth: 82 * slotWidth + width,
    scrollLeft: 0, scrollTop: 79, getBoundingClientRect: () => ({left: 0, width})};
  let clock = 0, animation = null, nextId = 0, created = 0;
  const raf = new Map(), anchors = [];
  const style = new Style();
  function visibleTransform() {
    return animation?.active ? animation.effect.position(animation.currentTime) : shift(style.transform);
  }
  const x = world => world - paper.scrollLeft + visibleTransform() * scale;
  const cameraX = () => paper.scrollLeft - visibleTransform() * scale;
  const line = {querySelector() { return null; }};
  const rows = new Map();
  for (const track of doc.tracks) {
    const controls = Array.from({length: track.cells.length}, (_, step) => ({
      closest: () => line, style: new Style(), classList: {add() {}, remove() {}},
      getBoundingClientRect: () => ({left: x(step * slotWidth), width: slotWidth}),
      scrollIntoView() { paper.scrollLeft = step * slotWidth; anchors.push(step); }
    }));
    rows.set(track.id, {allSlots: controls, grid: {barSteps: []}, row: {
      querySelector(selector) {
        const bar = Number(/boundary="(\d+)"/.exec(selector)?.[1]);
        return controls[rows.get(track.id).grid.barSteps[bar]];
      }
    }});
  }
  const marker = rows.get(id).allSlots[0];
  const score = {style, firstElementChild: marker, querySelector: () => marker,
    getBoundingClientRect: () => ({left: x(0), right: x(worldEnd), width: worldEnd})};
  if (compositor) score.animate = (frames, timing) => {
    created++;
    const effect = new TestEffect();
    effect.timing = {...timing}; effect.setKeyframes(frames);
    animation = {effect, active: true, startTime: clock, hold: null, pending: false,
      get currentTime() { return this.hold ?? Math.max(0, Math.min(clock - this.startTime, (effect.timing.delay || 0) + effect.timing.duration)); },
      pause() { this.hold = this.currentTime; }, cancel() { this.active = false; }};
    return animation;
  };
  const audio = {currentTime: 0, state: 'running', async suspend() { this.state = 'suspended'; }, async resume() { this.state = 'running'; }};
  const s = {console, doc, paper, rows, structuredClone, Map, Set, ANDROID_HOST: android, KeyframeEffect: compositor ? TestEffect : undefined,
    el: {paper, score}, document: {timeline: {get currentTime() { return clock; }}},
    performance: {now: () => clock}, getComputedStyle: () => ({paddingLeft:'14px'}),
    requestAnimationFrame(cb) { const n = ++nextId; raf.set(n, cb); return n; }, cancelAnimationFrame(n) { raf.delete(n); },
    setTimeout(cb) { cb(); return 1; }, setInterval() { return 1; }, clearInterval() {},
    scoreZoom: zoom, followFrame: 0, follow: true, paperPan: null, paperTouch: false, manualFollowUntil: 0, editOwnsViewport: false,
    designatedFollowTrack: id, playingLoops: [], playingLoopState: '', followedLine: null, followGroupGeometry: null, playingPositions: new Map(),
    cursor: {track:id,beat:0,slot:0}, cursorAtPause:null, request:0, pending:false, pauseChanging:false, loopMode:'once',
    scoreIndex:()=>0, currentBar:()=>0, refreshControls(){}, notify(){}, t:k=>k, cancelNoteReveal(){}, setFollowGutter(){},
    strokeBuffer(){}, percussionBuffers(){}, makeChannel:()=>({gain:{disconnect(){}},pan:{disconnect(){}}}), applyMix(){}, strike:()=>[]};
  vm.createContext(s);
  const run = src => vm.runInContext(src, s);
  run(part(code,'const FORMAT =','const instrumentPresets ='));
  run(part(code,'class PlaybackCursor {','async function exportBacking('));
  run(part(code,'// One camera owns','function toggleFollowPlayback()'));
  run(part(code,'function paintPlaySteps(','let beatMenuAnchor'));
  run(part(code,'function finishPlayback(','function bindRange('));
  run(part(code,'const engine = new Transport','const xmlns ='));
  const engine = run('engine'); engine.context = audio; engine.mix = {input:{}}; engine.enableAudio = async () => {}; engine.readyOutput = async () => {};
  for (const t of doc.tracks) rows.get(t.id).grid.barSteps = run('trackGrid(doc,doc.tracks.find(t => t.id === ' + JSON.stringify(t.id) + ')).barSteps');
  function frame(dt = 1/60) {
    clock += dt * 1000;
    if (audio.state === 'running') audio.currentTime += dt;
    engine.schedule();
    const ready = [...raf.keys()];
    for (const key of ready) if (raf.has(key)) { const cb = raf.get(key); raf.delete(key); cb(clock); }
  }
  const step = () => engine.lanes[0]?.step;
  function until(predicate, description) {
    for (let i = 0; i < 6000; i++) { if (predicate()) return; frame(); }
    throw Error('Timed out: ' + description + ', step=' + step() + ', t=' + audio.currentTime);
  }
  async function start() {
    const p=s.togglePlayback(); frame();frame();await p; assert(engine.running);
    until(()=>step()===1, 'initial onset');
  }
  return {s, run, start, frame, until, step, x:cameraX, anchors, engine, slotWidth, paper, doc, get created(){return created;}};
}
async function scenario(code, opts) {
  const h = simulate(code, opts);
  const {s, slotWidth, anchors} = h;
  await h.start();
  const goto = step => h.until(() => h.step() === step, 'step ' + step);
  goto(46); goto(24); // actual first loop return
  near(h.x(),24 * slotWidth,'first loop aligns its left boundary');
  const afterFirstJump = anchors.length;
  goto(28);
  if (4*slotWidth + slotWidth < opts.width*.70) near(h.x(),24*slotWidth,'hold left anchor before threshold');
  goto(32);
  const releaseX = h.x(); s.useSquareButton(); near(h.x(),releaseX,'release is continuous');
  goto(50); goto(72); const entry=h.x();const traces=[];
  for(const step of [73,76,79,80,84,88,92,95]) {
    goto(step); traces.push(h.x());
    assert.equal(anchors.length, afterFirstJump, 'no new anchor on forward loop entry or resume');
    if(step===79) {
      await s.togglePlayback(); const paused=h.x(), cursor=h.step();
      for(let i=0;i<60;i++) h.frame();
      near(h.x(),paused,'viewport frozen for a full second');assert.equal(h.step(),cursor);
      await s.togglePlayback(); near(h.x(),paused,'no reanchor on Play');
    }
  }
  assert(h.x()-entry > 18*slotWidth, 'camera spans the first pass through second loop');
  for(let i=1;i<traces.length;i++) assert(traces[i]>traces[i-1], 'camera moves across subsequent groups');
  goto(72); near(h.x(),72*slotWidth,'second loop return aligns to its start');
  assert.equal(anchors.length, afterFirstJump+1);
  goto(83); s.useSquareButton();
  h.until(()=>!h.engine.running,'natural finish');
  const last = h.doc.tracks[0].cells.findLastIndex(Boolean);
  assert.equal(s.playingPositions.get(h.doc.tracks[0].id),last,'natural finish keeps final sounding note');
  const finalX=h.x(); h.frame();h.frame();near(h.x(), finalX,'viewport holds at finish');
  assert.equal(h.paper.scrollTop,79,'horizontal following preserves vertical position');
  return {entry, traces, finalX, last, animations:h.created};
}
(async()=>{
  const [apkPage,browserPage] = process.argv.slice(2);
  if(!browserPage) throw Error('Usage: node playback162.cjs ANDROID_EDITOR_HTML BUILT_BROWSER_HTML');
  const android = editor(apkPage), browser = editor(browserPage);
  for(const [width,zoom,scale] of [[360,.5,.5],[360,.5,1],[960,1,1],[960,2.5,2.5],[390,5,5]]) {
    const options={width,zoom,scale};
    const expected=await scenario(android,{...options,android:true});
    const actual=await scenario(browser,{...options,android:false});
    assert.deepEqual(actual,expected,'Android and browser traces and final note');
    console.log('PASS parity: viewport='+width+' zoom='+zoom+' transformScale='+scale+' terminalStep='+actual.last);
  }
  const terminalOpts={width:390,zoom:1,scale:1,terminalLoop:true};
  assert.deepEqual(await scenario(browser,{...terminalOpts,android:false}),await scenario(android,{...terminalOpts,android:true}));
  await scenario(browser,{width:390,zoom:1,scale:1,android:false,compositor:false});
  console.log('PASS final loop with no coda; browser without effect editing; pause/release/snap/last-note rules.');
})().catch(e=>{console.error(e);process.exitCode=1;});
