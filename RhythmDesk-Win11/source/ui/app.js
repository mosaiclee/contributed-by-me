const el = Object.fromEntries(Array.from(document.querySelectorAll('[id]'), node => [node.id, node]));
const meterButtons = document.querySelectorAll('[data-meter]');
const DRAFT_KEY = 'rhythm-desk.draft.v1';
const FOLLOW_KEY = 'rhythm-desk.follow-playback';
const DOCUMENT_PREFIX = 'rhythm-desk.document.v1.';
const BASE_MEASURE_GLYPH_WIDTH = 440;
const STEM_SPACING_SCALE = 1.44;
const IPHONE_SCORE = /iPhone/.test(navigator.userAgent);
el.paper.classList.toggle('iphone-score', IPHONE_SCORE);

function updateScoreVerticalThumb() {
  const {clientHeight, scrollHeight, scrollTop} = el.paper;
  const thumb = el.scoreVerticalThumb;
  thumb.hidden = clientHeight <= 8 || scrollHeight <= clientHeight;
  if (thumb.hidden) return;
  const rail = clientHeight - 8;
  const height = Math.max(16, rail * clientHeight / scrollHeight);
  const progress = Math.max(0, Math.min(1, scrollTop / (scrollHeight - clientHeight)));
  thumb.style.height = height + 'px';
  thumb.style.transform = 'translateY(' + (rail - height) * progress + 'px)';
}

if (IPHONE_SCORE) {
  const observer = new ResizeObserver(updateScoreVerticalThumb);
  observer.observe(el.paper);
  observer.observe(el.score);
  el.paper.addEventListener('scroll', updateScoreVerticalThumb, {passive: true});
}
const DEFAULT_SCORE_ZOOM = .5;
const MIN_SCORE_ZOOM = DEFAULT_SCORE_ZOOM / 2;
const MAX_SCORE_ZOOM = DEFAULT_SCORE_ZOOM * 5;
const NOTICE_DURATION_MS = 2000;
const documents = new Map();
const memoryOnly = new Set();
const undoStack = [];
const redoStack = [];
let doc = makeProject();
let activeId = null;
let browsing = true;
let sortByName = false;

let cursor = { track: doc.tracks[0].id, beat: 0, slot: 0 };
let keysOpen = false;
let keyboardType = '';
let noteLock; // 1.61: {stroke, type} while a note key (or Rest, stroke null) is locked for tap entry
let rows = new Map();
let playingPositions = new Map();
let pending = false;
let pauseChanging = false;
let cursorAtPause;
let request = 0;
let loopMode = 'once';
let follow = true;
try { follow = localStorage.getItem(FOLLOW_KEY) !== 'off'; } catch {}
let followFrame = 0;
let followGutter = 0;
let manualFollowUntil = 0;
let editOwnsViewport = false;
let scoreTapViewport;
let appendVisibilityObserver;
let noteVisibilityObserver;
let audition = true;
let copiedBeat;
let copiedMeasures;
let measureCopyStart;
let multiGroups;
let copiedHands;
let handMenuAnchor;
let copiedLayout;
let copiedPattern;
let copiedFeel;
let toastTimer;
let mixKey = 'volume';
let feelSize = 3;
let exportFormat = 'wav';
let scoreExportBusy = false;
let scoreExportFile;
let trackBeingEdited = null;
let trackToRemove = null;
let sampleTrack = null;
let sampleBusy = false;
let presetStorageAvailable = false;
let drag;
let paperPan;
let blankTap;
let mouseLeftOnScore = false;
let paperTouch = false;
let paperPinch;
let scoreZoom = DEFAULT_SCORE_ZOOM;
let loopStart = null;
let playingLoops = [];
let designatedFollowTrack = null;
let followedLine = null;


const engine = new Transport((positions, gates, playbackStarts, jumps = new Map()) => {
  const oldGateState = playingLoops.map(g => `${g.from}/${g.to}/${g.released}/${g.repeats}`).join();
  playingLoops = gates;
  if (oldGateState !== gates.map(g => `${g.from}/${g.to}/${g.released}/${g.repeats}`).join()) refreshControls();
  positions = new Map(positions);
  for (const lane of engine.lanes) {
    const step = positions.get(lane.track.id);
    if (step < 0 && playingPositions.has(lane.track.id))
      positions.set(lane.track.id, playingPositions.get(lane.track.id));
    else if (!engine.wrap && followLimit(lane) === lane.path.end)
      positions.set(lane.track.id, Math.min(step, lastSoundingStep(lane)));
  }
  paintPlaySteps(positions);
  const track = followedTrack();
  const jump = jumps.get(track);
  if (playbackStarts.has(track) && jump?.loopReturn && canFollow(performance.now(), true)) {
    manualFollowUntil = 0;
    stopFollowing('jump');
    engine.schedule();
    placePlaybackAnchor(track, jump.loopFrom ?? jump.step, false);
    followPlayback();
  } else followPlayback();
}, () => {
  stopPlayback();
  notify(t('msg.playError'));
}, finishPlayback);

const xmlns = 'http://www.w3.org/2000/svg';
const svgNode = () => document.createElementNS(xmlns, 'svg');

// Use the same strict timing for mouse and touch instead of platform dblclick defaults.
let quickTap = null;
function quickDoubleTap(event, kind = '') {
  const now = performance.now(), target = event.currentTarget;
  const hit = quickTap && quickTap.target === target && quickTap.kind === kind && now - quickTap.time < 250;
  quickTap = hit ? null : {target, kind, time: now};
  return Boolean(hit);
}
document.addEventListener('click', event => {
  if (quickTap && !quickTap.target.contains(event.target)) quickTap = null;
}, true);

// 1.60: every control that opens a menu on a double-tap also opens it when held for one second
// (finger, pen or left mouse button). The menu then keeps clear of the held point, and the click
// that ends the hold is dropped, so lifting the finger never chooses a menu item.
const MENU_HOLD_MS = 1000;
const MENU_HOLD_SLOP = 10;
const MENU_HOLD_CLEARANCE = 40;
let menuHold = null;
let menuHoldPoint = null;
let menuHoldClickUntil = 0;
function cancelMenuHold() {
  if (menuHold) clearTimeout(menuHold.timer);
  menuHold = null;
}
function bindMenuHold(node, open, allowed = () => true) {
  node.addEventListener('pointerdown', event => {
    cancelMenuHold();
    if (!event.isPrimary || event.button !== 0 || !allowed()) return;
    const press = {node, id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target};
    press.timer = setTimeout(() => {
      if (menuHold !== press) return;
      menuHold = null;
      if (!node.isConnected || !allowed()) return;
      quickTap = null;
      menuHoldPoint = {id: press.id, x: press.x, y: press.y};
      menuHoldClickUntil = Infinity;
      open(press);
    }, MENU_HOLD_MS);
    menuHold = press;
  });
  node.addEventListener('contextmenu', event => event.preventDefault());
}
document.addEventListener('pointerdown', event => {
  // A second finger (pinch) or another pointer ends the hold.
  if (menuHold && menuHold.id !== event.pointerId) cancelMenuHold();
}, true);
document.addEventListener('pointermove', event => {
  if (menuHold?.id === event.pointerId &&
      Math.hypot(event.clientX - menuHold.x, event.clientY - menuHold.y) > MENU_HOLD_SLOP) cancelMenuHold();
}, true);
for (const name of ['pointerup', 'pointercancel']) {
  document.addEventListener(name, event => {
    if (menuHold?.id === event.pointerId) cancelMenuHold();
    if (menuHoldPoint?.id !== event.pointerId) return;
    menuHoldPoint = null;
    menuHoldClickUntil = performance.now() + 400;
  }, true);
}
window.addEventListener('click', event => {
  if (performance.now() >= menuHoldClickUntil) return;
  menuHoldClickUntil = 0;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
// Wheel zoom moves the score under a held mouse. Programmatic scrolling (playback following) does not
// cancel a hold; finger panning already ends it with pointercancel.
window.addEventListener('wheel', cancelMenuHold, {capture: true, passive: true});
window.addEventListener('blur', cancelMenuHold);

// Move a menu box {left, top, width, height} so it does not cover the point still held by a long press.
// Returns the same object when no move is needed.
function clearOfMenuHold(box, bounds) {
  const point = menuHoldPoint;
  if (!point) return box;
  const reach = MENU_HOLD_CLEARANCE;
  const covers = ({left, top}) => point.x > left - reach && point.x < left + box.width + reach &&
    point.y > top - reach && point.y < top + box.height + reach;
  if (!covers(box)) return box;
  const fit = (left, top) => ({...box,
    left: clamp(left, bounds.left, Math.max(bounds.left, bounds.right - box.width)),
    top: clamp(top, bounds.top, Math.max(bounds.top, bounds.bottom - box.height))});
  // Layout sizes are rounded to whole pixels, so place the menu with a small margin beyond the reach.
  const gap = reach + 2;
  const aboveTop = point.y - gap - box.height, belowTop = point.y + gap;
  const rightLeft = point.x + gap, leftLeft = point.x - gap - box.width;
  // Above the finger first: the hand usually covers the screen below the fingertip.
  const options = [fit(box.left, aboveTop), fit(box.left, belowTop), fit(rightLeft, box.top), fit(leftLeft, box.top),
    fit(rightLeft, aboveTop), fit(leftLeft, aboveTop), fit(rightLeft, belowTop), fit(leftLeft, belowTop)];
  const clear = options.find(option => !covers(option));
  if (clear) return clear;
  // No free side is large enough: keep as much of the menu as possible away from the finger, and tell
  // the caller so a scrollable menu can shorten itself to menuHoldRoom() and try again.
  const overlap = option =>
    Math.max(0, Math.min(point.x + reach, option.left + box.width) - Math.max(point.x - reach, option.left)) *
    Math.max(0, Math.min(point.y + reach, option.top + box.height) - Math.max(point.y - reach, option.top));
  return {...options.reduce((best, option) => overlap(option) < overlap(best) ? option : best), covered: true};
}

// The larger free height above or below the held point.
function menuHoldRoom(bounds) {
  const point = menuHoldPoint;
  if (!point) return Infinity;
  const gap = MENU_HOLD_CLEARANCE + 2;
  return Math.max(point.y - gap - bounds.top, bounds.bottom - point.y - gap);
}

function button(label, action, className = '') {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.addEventListener('click', action);
  return node;
}

function iconButton(icon, label, action) {
  const node = button('', action, 'icon');
  node.innerHTML = '<svg aria-hidden="true"><use href="#i-' + icon + '"/></svg>';
  node.setAttribute('aria-label', label);
  node.title = label;
  return node;
}

function notify(message) {
  clearTimeout(toastTimer);
  el.status.textContent = message;
  el.status.hidden = false;
  toastTimer = setTimeout(() => { el.status.hidden = true; }, NOTICE_DURATION_MS);
}

function blockOtherTrack(trackId) {
  if (!multiGroups || multiGroups.trackId === trackId) return false;
  closePopups();
  notify(t('multi.switchTrack'));
  return true;
}

function warnBeforeChangingNotes(key) {
  const warning = el.noteChangeWarning;
  if (warning.open) return;
  closePopups();
  el.noteChangeMessage.textContent = t(key);
  const {top, bottom} = el.paper.getBoundingClientRect();
  warning.style.bottom = Math.max(0, innerHeight - bottom) + Math.min(20, (bottom - top) / 4) + 'px';
  warning.showModal();
  setTimeout(() => warning.close(), NOTICE_DURATION_MS);
}

function putDocument(item) {
  documents.set(item.id, item);
  try {
    localStorage.setItem(DOCUMENT_PREFIX + item.id, JSON.stringify(item));
    memoryOnly.delete(item.id);
    return true;
  } catch {
    memoryOnly.add(item.id);
    return false;
  }
}

function readDocument(key, raw) {
  try {
    const item = JSON.parse(raw);
    if (key !== DOCUMENT_PREFIX + item.id || !Number.isFinite(item.updated) || !(item.saved || item.draft)) return;
    documents.set(item.id, {
      id: item.id, updated: item.updated,
      saved: item.saved ? readProject(item.saved) : null,
      draft: item.draft ? readProject(item.draft) : null
    });
  } catch { /* Skip an unreadable entry and keep the other documents available. */ }
}

function loadDocuments() {
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(DOCUMENT_PREFIX)) readDocument(key, localStorage.getItem(key));
    }
    const legacy = localStorage.getItem(DRAFT_KEY);
    if (!legacy || documents.has('previous-draft')) return;
    const draft = readProject(JSON.parse(legacy).doc);
    if (putDocument({id: 'previous-draft', updated: Date.now(), saved: null, draft})) {
      localStorage.removeItem(DRAFT_KEY);
    }
  } catch { /* A blank browser remains available if local storage is blocked. */ }
}

function persist() {
  if (!activeId) return;
  putDocument({id: activeId, updated: Date.now(), saved: documents.get(activeId)?.saved ?? null, draft: structuredClone(doc)});
}

function record(previous = structuredClone(doc)) {
  undoStack.push(previous);
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  refreshControls();
}

function change(action, rebuild = false, updatedTrack) {
  record();
  if (rebuild) {
    multiGroups = undefined;
    loopStart = null;
    measureCopyStart = undefined;
    stopPlayback();
  }
  action();
  syncVersion(doc);
  if (rebuild) render(updatedTrack);
  persist();
}

function historyMove(from, to) {
  if (!from.length) return;
  multiGroups = undefined;
  loopStart = null;
  measureCopyStart = undefined;
  stopPlayback();
  to.push(structuredClone(doc));
  doc = from.pop();
  render();
  persist();
}

function selectedTrack() {
  return doc.tracks.find(track => track.id === cursor.track) ?? doc.tracks[0];
}

function currentGrid() {
  return rows.get(cursor.track)?.grid ?? trackGrid(doc, selectedTrack());
}

function scoreIndex() {
  return beatStart(currentGrid(), cursor.beat) + cursor.slot;
}

function currentBar() {
  return currentGrid().beatBars[cursor.beat];
}

function refreshControls() {
  el.followPlayback.setAttribute('aria-pressed', String(follow));
  el.undo.disabled = !undoStack.length;
  el.redo.disabled = !redoStack.length;
  const playing = pending || (engine.running && !engine.paused);
  const playLabel = playing ? t('pause') : engine.paused ? t('resume') : t('play');
  el.play.disabled = pauseChanging;
  el.playGlyph.setAttribute('href', playing ? '#i-pause' : '#i-play');
  el.play.title = playLabel + ' ' + t('key.space');
  el.play.setAttribute('aria-label', playLabel);
  el.stop.disabled = !pending && !engine.running;
  const gates = engine.paused ? [] : playingLoops;
  const repeats = Math.max(0, ...gates.map(gate => gate.released ? gate.repeats || 0 : 0));
  const stopLabel = gates.length
    ? (gates.every(gate => gate.released) ? (repeats ? t('stop.repeatWait', {n: repeats}) : t('stop.releaseWait')) : t('stop.release')) : t('stop');
  el.stop.title = stopLabel;
  el.stop.setAttribute('aria-label', stopLabel);
  el.stop.classList.toggle('release-loop', gates.length > 0);
  // 1.61: during a loop, a chip above the square chooses how many more passes play before continuing.
  el.loopRepeat.hidden = !gates.length;
  if (gates.length) {
    el.loopRepeat.textContent = repeats ? t('loop.repeatLeft', {n: repeats}) : t('loop.repeatChip');
    el.loopRepeat.classList.toggle('pending', repeats > 0);
    el.loopRepeat.style.left = el.stop.offsetLeft + el.stop.offsetWidth / 2 + 'px';
  } else if (el.menu.classList.contains('transport-menu')) closePopups();
}

function syncTempo() {
  engine.setTempo(doc.bpm);
  if (el.swingBpm.valueAsNumber !== doc.bpm) el.swingBpm.value = doc.bpm;
  el.swingBpmLabel.value = doc.bpm + ' BPM';
  for (const {entries, grid} of rows.values()) for (const entry of entries) {
    const label = entry.box.querySelector('.group-tempo');
    if (label) label.textContent = Math.round(effectiveTempo(doc, entry.track, grid.measures[entry.bar], entry.group)) + ' ♩';
  }
}

function render(updatedTrack) {
  cursor.track = selectedTrack().id;
  const grid = trackGrid(doc, selectedTrack());
  cursor.beat = editableBeat(grid, cursor.beat);
  cursor.slot = clamp(cursor.slot, 0, groupSize(grid.beats[cursor.beat]) - 1);
  el.title.textContent = doc.title;
  document.title = t('doc.editor', {title: doc.title});
  meterButtons.forEach(button => button.setAttribute('aria-pressed', button.dataset.meter === doc.meter));
  renderScore(updatedTrack);
  updateKeyboard();
  refreshControls();
  syncTempo();
}

function noteLabel(stroke, type) {
  if (!stroke) return t('note.rest');
  if (stroke.length > 1) return t('note.grace', {a: t('stroke.' + stroke[0]), b: t('stroke.' + stroke[1])});
  if (stroke === 'X') return type === 'shekere' ? 'Shekere' : t('note.bell');
  return t('stroke.' + stroke);
}

function head(stroke, type) {
  if (stroke === 'B') {
    return '<path fill="currentColor" fill-rule="evenodd" d="M-12 0C-12-7-2-9 4-6S8 4 1 6-12 7-12 0ZM-7-1Q-7-5-1-5Q2-4-1-1ZM-7 1Q-8 5-3 4Q1 3-1 0Z"/>';
  }
  if (stroke === 'X' && type === 'shekere') {
    return '<g fill="currentColor">' + [0, 60, 120, 180, 240, 300].map(angle =>
      '<ellipse cx="-3" cy="-4.4" rx="1.65" ry="3" transform="rotate(' + angle + ' -3 0)"/>').join('') + '</g>';
  }
  if (stroke === 'K') {
    return '<path d="M-7 0l5-5 5 5-5 5z" fill="none" stroke="currentColor" stroke-width="2"/>';
  }
  if (stroke === 'H') {
    return '<path d="M-7-3.5 1 3.5m0-7-8 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  }
  if (stroke === 'P') {
    return '<circle cx="-3" cy="0" r="2.6" fill="currentColor"/>';
  }
  if (['S', 'G', 'M', 'X'].includes(stroke)) {
    return '<path d="M-10-6 3 6m0-12-13 12' + (['G', 'M'].includes(stroke) ? 'm0 4h12' : '') +
      '" fill="none" stroke="currentColor" stroke-width="2.35" stroke-linecap="round"/>';
  }
  return '<ellipse cx="-3.7" cy="0" rx="8.1" ry="5.35" transform="rotate(-26 -3.7 0)" fill="currentColor"/>';
}

function noteAt(stroke, type, x, y, scaleX = 1) {
  const ornament = stroke.length > 1
    ? '<g transform="translate(-13 6) scale(.58)">' + head(stroke[0], type) +
      '</g><path d="M-12 12q5 1 8-4" fill="none" stroke="currentColor" stroke-width=".85"/>'
    : '';
  const scale = scaleX < 1 ? ' scale(' + scaleX + ' 1)' : '';
  return '<g transform="translate(' + x + ' ' + y + ')' + scale + '">' + ornament + head(stroke.at(-1), type) + '</g>';
}

function staffGlyph(entry) {
  const { size, start, track, graphic, stems, width } = entry;
  let markup = size ? '<path d="M' + stems[0] + ' 15H' + stems.at(-1) + '" fill="none" stroke="currentColor" stroke-width="4.4"/>' : '';
  // 0.22 split cells keep the plain look (one beam over the whole group = one beat); the N sub-cells of a
  // split cell are marked by a small bracket under the notes with the number N, like a tuplet mark.
  const splits = [];
  if (entry.layout.steps) {
    const steps = entry.layout.steps;
    for (let first = 0; first < steps.length;) {
      const {parts, part} = steps[first];
      let count = 1;
      while (count < parts - part && steps[first + count]?.parts === parts &&
             steps[first + count].part === part + count) count++;
      if (parts > 1) splits.push({first, count, parts});
      first += count;
    }
  } else if (Array.isArray(entry.layout)) {
    let first = 0;
    for (const parts of entry.layout) {
      if (parts > 1) splits.push({first, count: parts, parts});
      first += parts;
    }
  }
  for (const {first, count, parts} of splits) {
    const left = stems[first] - 2;
    const right = stems[first + count - 1] + 2;
    const middle = (left + right) / 2;
    const gap = Math.min(5, (right - left) / 4);
    markup += '<g class="split-mark" data-parts="' + parts + '"><path d="M' + left + ' 58V62H' + (middle - gap) + 'M' + (middle + gap) + ' 62H' + right + 'V58" ' +
      'fill="none" stroke="currentColor" stroke-width="1.1"/><text x="' + middle + '" y="65.4" text-anchor="middle" ' +
      'font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="9.5" fill="currentColor">' + parts + '</text></g>';
  }
  for (let slot = 0; slot < size; slot++) {
    const x = stems[slot];
    const stroke = track.cells[start + slot];
    const hand = track.hands?.[start + slot];
    if (hand) markup += '<text x="' + x + '" y="9" text-anchor="middle" font-family="sans-serif" font-size="15.3" font-weight="700" fill="currentColor">' + hand + '</text>';
    const y = stroke?.at(-1) === 'B' ? 49 : 44;
    markup += '<path d="M' + x + ' 15V' + (stroke ? y : 39) + '" stroke="currentColor" stroke-width="1.35"/>';
    if (stroke) {
      const available = Math.min(x - (stems[slot - 1] ?? -Infinity), (stems[slot + 1] ?? width) - x);
      const scale = Math.min(1, available / (stroke.length > 1 ? 28 : 16));
      markup += noteAt(stroke, track.type, x, y, scale);
    }
    const name = t('slot.aria', {track: track.name, bar: entry.bar + 1, group: entry.group + 1, slot: slot + 1,
      note: noteLabel(stroke, track.type)});
    entry.slots[slot].classList.toggle('has-hand', Boolean(hand));
    entry.slots[slot].setAttribute('aria-label', hand ? name + ' · ' + t('hand.' + hand) : name);
    entry.slots[slot].title = noteLabel(stroke, track.type);
  }
  graphic.innerHTML = markup;
}

function boundaryAt(track, bar, measure, side = '', showPending = true) {
  const svg = svgNode();
  // side: '' normal barline, 'start' first barline of a wrapped line, 'end' last barline before a line break.
  const pendingStart = showPending && side !== 'end' && loopStart?.id === track.id && loopStart.bar === bar;
  const localStart = side !== 'end' && (pendingStart || track.loops.some(range => range.from === bar));
  const localEnd = side !== 'start' && track.loops.some(range => range.to === bar);
  const local = localStart || localEnd;
  const opening = local ? localStart : side !== 'end' && doc.repeat?.from === bar;
  const closing = local ? localEnd : side !== 'start' && doc.repeat?.to === bar;
  svg.setAttribute('viewBox', '0 0 20 56');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = opening && closing
    ? '<path d="M8 4v48m4-48v48" stroke="currentColor" stroke-width="2"/><circle cx="3" cy="23" r="1.7"/><circle cx="3" cy="33" r="1.7"/><circle cx="17" cy="23" r="1.7"/><circle cx="17" cy="33" r="1.7"/>'
    : opening
    ? '<path d="M4 4v48" stroke="currentColor" stroke-width="4"/><path d="M9 4v48" stroke="currentColor"/><circle cx="15" cy="23" r="2"/><circle cx="15" cy="33" r="2"/>'
    : closing
    ? '<path d="M16 4v48" stroke="currentColor" stroke-width="4"/><path d="M11 4v48" stroke="currentColor"/><circle cx="5" cy="23" r="2"/><circle cx="5" cy="33" r="2"/>'
    : '<path d="M10 4v48" stroke="currentColor" stroke-width="1.5"/>';
  const line = button('', event => { if (quickDoubleTap(event)) openTrackBoundary(track, bar, event.currentTarget, side); }, 'barline');
  bindMenuHold(line, () => { if (!blockOtherTrack(track.id)) openTrackBoundary(track, bar, line, side); });
  if (side === 'end') line.classList.add('line-end');
  if (pendingStart || (showPending && side !== 'end' && measureCopyStart?.track === track && measureCopyStart.bar === bar)) {
    line.classList.add('pending-repeat');
  }
  if (!local && (opening || closing)) line.classList.add('score-repeat');
  const kind = opening && closing ? t('bar.kindBoth') : opening ? t('bar.kindStart') : closing ? t('bar.kindEnd') : t('bar.kindLine');
  const meter = measure && measureLabel(measure);
  const description = side === 'end' ? t('bar.beforeBreak', {bar: bar + 1})
    : measure ? t('bar.measure', {bar: bar + 1}) + (meter ? ' · ' + meter : '') : t('bar.afterLast');
  line.title = track.name + ' · ' + (!local && (opening || closing) ? t('bar.score') : '') + kind + ' · ' + description;
  line.setAttribute('aria-label', line.title);
  line.append(svg);
  line.dataset.barBoundary = bar;
  if (measure && side !== 'end') {
    const marker = document.createElement('span');
    marker.className = 'measure-marker';
    marker.textContent = bar + 1;
    marker.setAttribute('aria-hidden', 'true');
    line.append(marker);
  }
  return line;
}

function renderScore(updatedTrack) {
  const previousRow = rows.get(updatedTrack?.id)?.row;
  const content = document.createDocumentFragment();
  if (!previousRow) rows = new Map();
  for (const track of previousRow ? [updatedTrack] : doc.tracks) {
    const grid = trackGrid(doc, track);
    const row = document.createElement('section');
    row.className = 'staff';
    row.dataset.trackId = track.id;
    for (const type of ['click', 'contextmenu']) {
      row.addEventListener(type, event => {
        if (!blockOtherTrack(track.id)) return;
        event.preventDefault();
        event.stopPropagation();
      }, {capture: true});
    }
    const header = document.createElement('div');
    header.className = 'staff-head';
    const title = document.createElement('strong');
    title.textContent = track.name;
    header.append(title);
    const detail = button(presetLabelForTrack(track), event => openPresetMenu(track, event.currentTarget));
    detail.className = 'detail';
    detail.dataset.presetTrack = track.id;
    detail.title = t('sample.switch');
    detail.setAttribute('aria-label', t('sample.trackLabel', {track: track.name, name: detail.textContent}));
    header.append(detail);
    const more = iconButton('more', t('track.menu', {track: track.name}), event => openTrackMenu(track, event.currentTarget));
    more.classList.add('blue');
    header.append(more);
    if (doc.tracks.length === 1) {
      const append = button(t('bar.addShort'), event => appendMeasure(track, event.currentTarget), 'add-measure-quick');
      append.title = t('bar.addEnd', {track: track.name});
      append.setAttribute('aria-label', append.title);
      header.append(append);
    }
    // Per-track line breaks only change layout: this track keeps one continuous grid, entries and slot
    // list, so the cursor, playhead and editing indexes are the same with or without breaks.
    const breaks = trackLineBreaks(doc, track);
    const lines = [];
    const newLine = () => {
      const node = document.createElement('div');
      node.className = 'staff-line';
      lines.push(node);
      return node;
    };
    let line = newLine();
    let measureNotes;
    const entries = [];
    const allSlots = [];
    let start = 0;
    grid.beats.forEach((layout, beat) => {
      const size = groupSize(layout);
      const bar = grid.beatBars[beat];
      const group = beat - grid.barBeats[bar];
      const measure = grid.measures[bar];
      if (group === 0) {
        const wrapped = breaks.includes(bar);
        if (wrapped) {
          line.append(boundaryAt(track, bar, measure, 'end'));
          line = newLine();
          line.classList.add('wrapped-line');
        }
        const measureBox = document.createElement('div');
        measureBox.className = 'measure';
        measureNotes = document.createElement('div');
        measureNotes.className = 'measure-notes';
        measureNotes.style.setProperty('--beat-count', measure.beats.length);
        measureBox.append(boundaryAt(track, bar, measure, wrapped ? 'start' : ''), measureNotes);
        line.append(measureBox);
      }
      const baseWidth = BASE_MEASURE_GLYPH_WIDTH / measure.beats.length;
      const originalWidth = baseWidth * STEM_SPACING_SCALE;
      const positions = cellPositions(layout);
      const span = (baseWidth - 20) * STEM_SPACING_SCALE;
      // Trim half the whitespace at each end without compressing any stem interval.
      const leading = 6.5;
      const trailing = (originalWidth - 13 - (positions.at(-1) ?? 1) * span) / 2;
      const width = originalWidth - leading - trailing;
      const stems = positions.map(position => 13 - leading + position * span);
      const hitEdges = [0, ...stems.slice(1).map((x, slot) => (stems[slot] + x) / 2), width];
      const box = document.createElement('div');
      box.className = 'beat' + (Array.isArray(layout) ? ' split' : '');
      box.style.setProperty('--beat-width-ratio', width / originalWidth);
      const graphic = svgNode();
      graphic.setAttribute('viewBox', '0 0 ' + width + ' 61');
      graphic.setAttribute('preserveAspectRatio', 'none');
      graphic.setAttribute('aria-hidden', 'true');
      const slotList = document.createElement('div');
      slotList.className = 'slots';
      slotList.style.setProperty('grid-template-columns', hitEdges.slice(0, -1)
        .map((left, slot) => (hitEdges[slot + 1] - left) / width + 'fr').join(' '));
      const slots = Array.from({length: size}, (_, slot) => {
        let press;
        let suppressClick = false;
        const item = button('', event => {
          if (multiGroups) {
            if (multiGroups.trackId === track.id && !suppressClick) {
              useMultiGroup(track, beat, slot);
            }
            suppressClick = false;
            return;
          }
          const hand = event.target.classList.contains('hand-dot');
          // 1.61: with a locked note key, a tap enters that note (the 1 s hold still opens the beat menu).
          const locked = Boolean(noteLock) && !hand;
          const activate = !locked && quickDoubleTap(event, hand ? 'hand' : 'note');
          const {scrollLeft, scrollTop} = scoreEditViewport(event.currentTarget);
          selectSlot(track.id, beat, slot);
          el.paper.scrollTo({left: scrollLeft, top: scrollTop, behavior: 'instant'});
          if (locked) writeLockedStroke();
          else if (activate) {
            if (hand) openHandMenu(event.currentTarget);
            else openBeatMenu(box);
          }
        }, 'slot');
        item.addEventListener('pointerdown', event => {
          suppressClick = false;
          if (multiGroups?.trackId !== track.id || multiGroups.clip || event.button !== 0 || !event.isPrimary) return;
          press = {id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), mode: multiGroups};
        });
        item.addEventListener('pointermove', event => {
          if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 9) {
            press = undefined;
            suppressClick = true;
          }
        });
        item.addEventListener('pointerup', event => {
          if (press?.id !== event.pointerId) return;
          const held = press.mode === multiGroups && !multiGroups.clip && performance.now() - press.time >= 500;
          press = undefined;
          if (!held) return;
          suppressClick = true;
          useMultiGroup(track, beat, null);
        });
        for (const name of ['pointerleave', 'pointercancel']) {
          item.addEventListener(name, () => { press = undefined; });
        }
        item.addEventListener('keydown', event => {
          suppressClick = false;
          if (multiGroups?.trackId !== track.id || multiGroups.clip || !event.shiftKey || event.key !== 'Enter') return;
          event.preventDefault();
          if (!event.repeat) useMultiGroup(track, beat, null);
        });
        const hitWidth = hitEdges[slot + 1] - hitEdges[slot];
        item.style.setProperty('--stem-offset', ((stems[slot] - hitEdges[slot]) / hitWidth * 100) + '%');
        const handDot = document.createElement('span');
        handDot.className = 'hand-dot';
        handDot.setAttribute('aria-hidden', 'true');
        item.append(handDot);
        item.addEventListener('contextmenu', event => event.preventDefault());
        // Multi-selection keeps its own 0.5 s hold for whole groups.
        bindMenuHold(item, press => {
          const hand = Boolean(press.target.classList?.contains('hand-dot'));
          const {scrollLeft, scrollTop} = scoreEditViewport(item);
          selectSlot(track.id, beat, slot);
          el.paper.scrollTo({left: scrollLeft, top: scrollTop, behavior: 'instant'});
          if (hand) openHandMenu(item);
          else openBeatMenu(box);
        }, () => !multiGroups);
        slotList.append(item);
        return item;
      });
      const meter = layout.steps?.length ? layout.steps[0].meter : groupMeter(measure, group);
      const meterButton = button((meter ?? '–') + ' ▾',
        event => { if (quickDoubleTap(event)) openGroupMeterMenu(event.currentTarget, track.id, beat); }, 'group-meter');
      bindMenuHold(meterButton, () => { if (!blockOtherTrack(track.id)) openGroupMeterMenu(meterButton, track.id, beat); });
      meterButton.style.left = ((stems[0] ?? leading) / width * 100) + '%';
      meterButton.title = t('meter.groupButton', {bar: bar + 1, group: group + 1, meter: meter ?? '–'});
      meterButton.setAttribute('aria-label', meterButton.title);
      meterButton.setAttribute('aria-haspopup', 'true');
      const tempoButton = button(Math.round(effectiveTempo(doc, track, measure, group)) + ' ♩',
        event => { if (quickDoubleTap(event)) openTempoEditor(track, bar, group); }, 'group-tempo');
      bindMenuHold(tempoButton, () => { if (!blockOtherTrack(track.id)) openTempoEditor(track, bar, group); });
      tempoButton.title = t('tempo.group');
      tempoButton.style.left = meterButton.style.left;
      box.append(graphic, slotList, meterButton, tempoButton);
      layout.steps?.forEach((step, slot) => {
        if (!slot || step.meter === layout.steps[slot - 1].meter) return;
        const marker = document.createElement('span');
        marker.className = 'group-meter-change';
        marker.textContent = step.meter ?? '–';
        marker.style.left = (stems[slot] / width * 100) + '%';
        box.append(marker);
      });
      const entry = { box, graphic, slots, size, layout, stems, width, originalWidth, meter: measure.meter, start, bar, group, track };
      start += size;
      entries.push(entry);
      allSlots.push(...slots);
      staffGlyph(entry);
      measureNotes.append(box);
    });
    line.append(boundaryAt(track, grid.measures.length));
    const plus = button('+', event => appendMeasure(track, event.currentTarget), 'add-measure');
    plus.title = t('bar.addEnd', {track: track.name});
    plus.setAttribute('aria-label', plus.title);
    line.append(plus);
    row.append(header);
    for (const staffLine of lines) row.append(staffLine);
    if (lines.length > 1) row.classList.add('wrapped');
    content.append(row);
    rows.set(track.id, { row, entries, allSlots, grid, lastMeasure: measureNotes.parentElement,
      addMeasureButton: plus, wrapped: lines.length > 1 });
  }
  el.addTrack.disabled = doc.tracks.length >= TRACK_LIMIT;
  if (previousRow) previousRow.replaceWith(content);
  else el.score.replaceChildren(content);
  paintMultiGroups();
  markSelection();
  updateMixRows();
  paintPlaySteps(playingPositions);
}

let selectedEntry;
let selectedSlot;

function markSelection() {
  selectedEntry?.classList.remove('selected');
  selectedSlot?.classList.remove('current');
  selectedEntry = null;
  selectedSlot = null;
  if (!keysOpen) return;
  const entry = rows.get(cursor.track)?.entries[cursor.beat];
  if (!entry) return;
  selectedEntry = entry.box;
  selectedSlot = entry.slots[cursor.slot];
  selectedEntry.classList.add('selected');
  selectedSlot.classList.add('current');
}

function clearScoreSelection() {
  if (!keysOpen) return;
  keysOpen = false;
  updateKeyboard();
  markSelection();
}

function editableBeat(grid, beat) {
  const index = clamp(beat, 0, grid.beats.length - 1);
  if (groupSize(grid.beats[index])) return index;
  const next = grid.beats.findIndex((layout, i) => i > index && groupSize(layout));
  return next >= 0 ? next : grid.beats.findLastIndex(layout => groupSize(layout));
}

function selectSlot(track, beat, slot, reveal = false) {
  cancelNoteReveal();
  closePopups();
  const { grid } = rows.get(track);
  const nextBeat = editableBeat(grid, beat);
  designatedFollowTrack = track;
  cursor = { track, beat: nextBeat, slot: clamp(slot, 0, groupSize(grid.beats[nextBeat]) - 1) };
  keysOpen = true;
  markSelection();
  updateKeyboard();
  if (reveal) revealSlot(scoreIndex(), track);
}

function moveCursor(delta) {
  const grid = currentGrid();
  const position = locateStep(grid, clamp(scoreIndex() + delta, 0, grid.barSteps.at(-1) - 1));
  selectSlot(cursor.track, position.beat, position.slot, true);
}

function writeStroke(stroke, direction = 1) {
  const track = selectedTrack();
  if (stroke && !TYPES[track.type].strokes.includes(stroke)) return;
  const index = scoreIndex();
  if (track.cells[index] !== stroke) {
    change(() => { track.cells[index] = stroke; });
    staffGlyph(rows.get(track.id).entries[cursor.beat]);
  }
  if (stroke && audition && !engine.running && !pending) {
    engine.preview(track, stroke, doc).catch(() => notify(t('msg.previewError')));
  }
  if (direction) moveCursor(direction);
}

function deletePrevious() {
  if (scoreIndex() > 0) moveCursor(-1);
  writeStroke(null, 0);
}

function clearSelectedBeat() {
  const entry = rows.get(cursor.track)?.entries[cursor.beat];
  if (!keysOpen || !entry || entry.box !== selectedEntry) return;
  const {track, start, size} = entry;
  const end = start + size;
  if (!track.cells.slice(start, end).some(Boolean)) return;
  change(() => { track.cells.fill(null, start, end); });
  staffGlyph(entry);
  notify(t('keys.beatCleared'));
}

function updateKeyboard() {
  el.keyboard.hidden = !keysOpen;
  el.showKeys.setAttribute('aria-pressed', keysOpen);
  if (!keysOpen) { if (noteLock) setNoteLock(); return; }
  const type = selectedTrack().type;
  if (keyboardType === type) return;
  keyboardType = type;
  const makeRow = (extra = '') => {
    const node = document.createElement('div');
    node.className = 'key-row ' + extra;
    return node;
  };
  const key = (text, handler, className = '') => button(text, handler, 'key ' + className);
  const strokeKey = stroke => {
    const node = lockableKey(key('', () => tapNoteKey(stroke)), stroke);
    const label = noteLabel(stroke, type);
    node.setAttribute('aria-label', label);
    node.title = label + ' · ' + t('keys.lockHint');
    node.innerHTML = '<svg viewBox="0 0 54 48" aria-hidden="true"><path d="M37 8v23" stroke="currentColor" stroke-width="1.7"/>' +
      noteAt(stroke, type, 37, 31) + '</svg>';
    return node;
  };
  const rows = [];
  if (type === 'djembe') {
    const grace = makeRow('grace-keys');
    grace.append(...GRACE.map(strokeKey));
    rows.push(grace);
  }
  const main = makeRow();
  const split = key('♫', event => openSplitMenu(event.currentTarget), 'aux split-key');
  split.title = t('keys.split');
  split.setAttribute('aria-label', split.title);
  const clear = key('', clearSelectedBeat, 'aux');
  clear.innerHTML = '<svg aria-hidden="true"><use href="#i-clear-measure"/></svg>';
  clear.title = t('keys.clearBeat');
  clear.setAttribute('aria-label', clear.title);
  const back = key('', deletePrevious, 'aux');
  back.innerHTML = '<svg aria-hidden="true"><use href="#i-backspace"/></svg>';
  back.setAttribute('aria-label', t('keys.backspace'));
  main.append(clear, split, ...TYPES[type].strokes.filter(stroke => stroke.length === 1).map(strokeKey), back);
  const nav = makeRow('navigation');
  const jump = (label, title, atEnd) => {
    const node = key(label, () => {
      const grid = currentGrid();
      const position = locateStep(grid, atEnd ? grid.barSteps.at(-1) - 1 : 0);
      selectSlot(cursor.track, position.beat, position.slot, true);
    }, 'aux');
    node.title = title;
    return node;
  };
  nav.append(jump('⇤', t('keys.start'), false), jump('⇥', t('keys.end'), true),
    lockableKey(key(t('keys.rest'), () => tapNoteKey(null), 'silence'), null), key('←', () => moveCursor(-1), 'aux'), key('→', () => moveCursor(1), 'aux'));
  el.keys.replaceChildren(...rows, main, nav);
  paintNoteLock();
}

// 1.61: hold a note key (or Rest) for 1 s to lock it. While locked, tapping a stem enters that note
// there without moving on (tapping the same note again clears it; a locked Rest clears). A tap on
// the locked key or Esc unlocks; holding another key moves the lock.
function lockableKey(node, stroke) {
  node.dataset.stroke = stroke ?? '';
  if (!stroke) node.title = t('keys.rest') + ' · ' + t('keys.lockHint');
  bindMenuHold(node, () => toggleNoteLock(stroke), () => !multiGroups);
  return node;
}

function setNoteLock(stroke) {
  noteLock = stroke === undefined ? undefined
    : {stroke, type: stroke ? Object.keys(TYPES).find(type => TYPES[type].strokes.includes(stroke)) : null};
  if (noteLock?.stroke && TYPES[selectedTrack().type].strokes.includes(noteLock.stroke)) noteLock.type = selectedTrack().type;
  paintNoteLock();
}

function paintNoteLock() {
  for (const node of el.keys.querySelectorAll('.key[data-stroke]')) {
    const locked = Boolean(noteLock) && node.dataset.stroke === (noteLock.stroke ?? '');
    node.classList.toggle('locked', locked);
    node.setAttribute('aria-pressed', String(locked));
  }
  el.paper.classList.toggle('note-lock', Boolean(noteLock));
}

function unlockNote() {
  setNoteLock();
  notify(t('lock.off'));
}

function toggleNoteLock(stroke) {
  if (noteLock && noteLock.stroke === stroke) { unlockNote(); return; }
  setNoteLock(stroke);
  notify(stroke ? t('lock.on', {note: noteLabel(stroke, noteLock.type)}) : t('lock.onRest'));
}

function tapNoteKey(stroke) {
  if (noteLock && noteLock.stroke === stroke) unlockNote();
  else writeStroke(stroke);
}

function writeLockedStroke() {
  const track = selectedTrack();
  const {stroke, type} = noteLock;
  if (stroke && !TYPES[track.type].strokes.includes(stroke)) {
    notify(t('lock.unsupported', {track: track.name, note: noteLabel(stroke, type)}));
    return;
  }
  writeStroke(stroke && track.cells[scoreIndex()] === stroke ? null : stroke, 0);
}

function setFollowGutter(active = false) {
  if (!active) el.score.style.removeProperty('--loop-tail');
  // Keep the score's original left margin; following never inserts blank space.
  if (!followGutter) return;
  const old = followGutter;
  followGutter = 0;
  el.score.style.setProperty('--follow-gutter', '0px');
  el.paper.scrollLeft = Math.max(0, el.paper.scrollLeft - old);
}

// One camera owns both the steady compositor movement and transport transitions.
// Geometry predicts four groups; one persistent compositor timeline displays
// up to 800 ms ahead without cancelling at ordinary segment/group boundaries.
const supportsFollowAnimation = typeof el.score.animate === 'function' &&
  Boolean(document.timeline) &&
  typeof globalThis.KeyframeEffect?.prototype.setKeyframes === 'function' &&
  typeof globalThis.KeyframeEffect?.prototype.updateTiming === 'function';
let followPlan = null;
let followCamera = null;
const followEvents = [];
function logFollow(event, detail = {}) {
  const camera = followCamera;
  followEvents.push({event, audioTime:engine.context?.currentTime ?? 0,
    zoom:scoreZoom, lanes:engine.lanes?.map(l=>({step:l.step,loopFrom:l.gate?.from,loopTo:l.gate?.to,released:Boolean(l.gate?.released)})),
    left:camera?.left ?? el.paper.scrollLeft,
    target:camera?.target ?? null, nativeLeft:el.paper.scrollLeft,
    base:camera?.base ?? null, motionScale:camera?.motionScale ?? null,
    maximum:followPlan?.maximum ?? null,
    animationPending:Boolean(camera?.animation?.pending),
    animationTime:camera?.animation?.currentTime ?? null,
    segmentOffset:camera?.segment?.timelineOffset ?? null, ...detail});
  if (followEvents.length > 400) followEvents.shift();
}

function ensureFollowCamera() {
  if (!followCamera) {
    const left = el.paper.scrollLeft;
    followCamera = {base:left, left, anchor:left, target:left,
      motionScale:measureMotionScale(), animation:null, segment:null};
    logFollow('anchor');
  }
  return followCamera;
}

function displayedFollowPosition() {
  const c = followCamera;
  if (!c) return el.paper.scrollLeft;
  if (!c.animation || !c.segment) return c.left;
  const elapsed = (Number(c.animation.currentTime) || 0) - c.segment.timelineOffset;
  return followPositionAt(c.segment, c.segment.startTime + elapsed/1000);
}

function cameraTransform(left, camera = followCamera) {
  return `translate3d(${-(left-camera.base)/camera.motionScale}px,0,0)`;
}

function freezeFollowCamera() {
  const c = followCamera;
  if (!c) return;
  c.animation?.pause();
  c.left = displayedFollowPosition();
  // Set the frozen transform before cancelling the compositor effect; neither
  // an untransformed frame nor a theoretical audio position is exposed.
  el.score.style.transform = cameraTransform(c.left, c);
  c.animation?.cancel();
  c.animation = null;
  c.segment = null;
}

function finishFollowMotion(reason = 'interaction') {
  freezeFollowCamera();
  logFollow(reason);
  followPlan = null;
  const c = followCamera;
  if (!c) return;
  if (['pause','release','finish','retarget','suspended'].includes(reason)) return;
  // Jump discards the old trajectory; its native anchor is applied in the same
  // JS task. Manual pan/zoom instead hand off the displayed position exactly.
  el.score.style.transform = 'none';
  if (reason !== 'jump') el.paper.scrollLeft = c.left;
  followCamera = null;
  el.score.style.removeProperty('will-change');
}

function renderFollowSegment(force = false) {
  const plan = followPlan;
  if (!plan) return;
  const c = ensureFollowCamera();
  const now = engine.context.currentTime;
  if (engine.paused || (engine.context.state && engine.context.state !== 'running')) {
    if (c.animation) { freezeFollowCamera(); logFollow('audio-suspended'); }
    return;
  }
  if (!supportsFollowAnimation) {
    c.target = followPositionAt(plan, now);
    c.left = Math.max(c.left, c.target);
    el.score.style.transform = cameraTransform(c.left, c);
    return;
  }
  const planEnd = plan.startTime + plan.duration;
  const elapsed = Number(c.animation?.currentTime) || 0;
  const remaining = c.segment ? c.segment.duration-(elapsed-c.segment.timelineOffset)/1000 : 0;
  // Let the final segment reach its boundary. Replacing a <120 ms tail on
  // every frame can keep a pending animation at its first frame indefinitely.
  const coversEnd = c.segment?.plan === plan &&
    c.segment.startTime + c.segment.duration >= planEnd - .001;
  if (!force && c.animation && (remaining > .12 || coversEnd)) return;
  // Sample while the existing timeline keeps running. Pause/cancel belongs to
  // actual transport/viewport handoffs, never an ordinary segment renewal.
  c.left = displayedFollowPosition();
  const end = Math.min(now+.8, planEnd);
  if (end <= now+.001) return;
  const duration = end-now;
  const ideal = followPositionAt(plan, now);
  c.target = ideal;
  const error = c.left-ideal;
  // Correct clock/display error gradually. Never seek animation.currentTime.
  const correction = Math.max(-120*duration,Math.min(120*duration,error));
  const times = [now,end];
  for (const p of plan.positions) {
    const time = plan.startTime+p.offset*plan.duration;
    if (time > now && time < end) times.push(time);
  }
  // Sample the smooth correction; keep exact group/threshold keyframes too.
  for (let i=1;i<8;i++) times.push(now+duration*i/8);
  times.sort((a,b)=>a-b);
  const positions=[];
  let last=c.left;
  for (const time of times) {
    const progress=(time-now)/duration;
    const smooth=progress*progress*(3-2*progress);
    const wanted=followPositionAt(plan,time)+error-correction*smooth;
    const left=Math.max(last,wanted);
    positions.push({offset:progress,left});
    last=left;
  }
  positions[0].left=c.left;
  const keyframes = positions.map(p=>({offset:p.offset,transform:cameraTransform(p.left,c)}));
  el.score.style.willChange='transform';
  let timelineOffset = 0;
  if (c.animation) {
    // Retain startTime/currentTime and the compositor layer. Both effect edits
    // are committed in this task, with the new first keyframe at the exact
    // displayed position on the same document-timeline tick.
    // A finished animation reports a clamped currentTime. When extending a
    // filled tail after a delayed frame, use its unconstrained timeline time
    // so releasing that clamp cannot skip into the new segment.
    const timelineTime = document.timeline.currentTime;
    const startTime = c.animation.startTime;
    timelineOffset = Number.isFinite(timelineTime) && Number.isFinite(startTime)
      ? Math.max(0, timelineTime - startTime) : elapsed;
    c.animation.effect.setKeyframes(keyframes);
    c.animation.effect.updateTiming({delay:timelineOffset,duration:duration*1000});
  } else {
    c.animation = el.score.animate(keyframes,
      {duration:duration*1000,easing:'linear',fill:'forwards'});
    // Avoid the implicit pending-play frame on WebView: the next display tick
    // must advance from this tick, rather than start the segment at zero again.
    c.animation.startTime = document.timeline.currentTime;
  }
  c.segment={positions,startTime:now,duration,timelineOffset,plan};
  if (Math.abs(error)>2) logFollow('soft-correction',{error,remaining});
}

async function exportFollowDiagnostics() {
  // Request file access in the button gesture; AudioContext.suspend may settle later on Safari.
  const pause = engine.running && !engine.paused ? togglePlayback() : Promise.resolve();
  logFollow('export');
  const data = {
    version: '1.61', userAgent: navigator.userAgent,
    viewport: {width: el.paper.clientWidth, height: el.paper.clientHeight},
    events: followEvents.slice()
  };
  const file = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  try {
    const [, name] = await Promise.all([pause, saveScoreExport(file, 'RhythmDesk-follow-diagnostics-1.61.json')]);
    if (name) notify(t('msg.download', {name}));
  } catch (error) {
    if (error.name !== 'AbortError') notify(t('scoreExport.failed'));
  }
}

function measureMotionScale() {
  // CSS zoom multiplies a transform on current desktop Chrome, but not on the
  // Android 14 WebView/Chrome 113 used here. Measure the real screen pixels
  // moved by one transform pixel instead of assuming scoreZoom.
  try {
    const marker = el.score.querySelector('.slot') || el.score.firstElementChild;
    if (!marker || typeof marker.getBoundingClientRect !== 'function') return scoreZoom;
    const before = marker.getBoundingClientRect().left;
    const previous = el.score.style.transform;
    el.score.style.transform = 'translate3d(-100px,0,0)';
    const moved = before - marker.getBoundingClientRect().left;
    el.score.style.transform = previous;
    if (moved > 0.5 && moved < 1000) {
      const paper = el.paper, frame = paper.getBoundingClientRect();
      const scale = frame.width / paper.offsetWidth || 1;
      return moved / (100 * scale);
    }
  } catch (error) {}
  return scoreZoom;
}

function followPositionAt(state, time) {
  const progress = Math.max(0, Math.min(1, (time - state.startTime) / state.duration));
  const frames = state.positions;
  let i = 1;
  while (i < frames.length - 1 && frames[i].offset < progress) i++;
  const a = frames[i - 1], b = frames[i];
  const span = b.offset - a.offset;
  return a.left + (b.left - a.left) * (span > 0 ? Math.max(0, Math.min(1, (progress-a.offset)/span)) : 1);
}

function lastSoundingStep(lane) {
  if (!lane || engine.wrap) return lane ? lane.path.end - 1 : -1;
  for (let step = lane.path.end - 1; step >= lane.path.first; step--) {
    if (lane.track.cells[step]) return step;
  }
  return lane.path.end - 1;
}

function followLimit(lane) {
  return Math.min(lane.path.end,
    ...lane.path.gates.filter(gate => gateLoopsBack(gate) && gate.to > lane.step).map(gate => gate.to));
}


function planFollow(row, lane, line) {
  const camera = ensureFollowCamera();
  camera.left = displayedFollowPosition();
  const motionScale = camera.motionScale;
  const paper = el.paper, width = paper.clientWidth;
  const group = lane.visualGroup;
  const now = engine.context.currentTime;
  const originTick = group.firstTick - lane.ticks[group.from];
  const origin = engine.tempos.at(-1);
  // Scheduler pruning must not rewrite the beginning of the visible group.
  const timingOrigins = group.tempos?.length ? group.tempos : engine.tempos;
  const timeAt = tick => {
    let i = timingOrigins.length - 1;
    while (i > 0 && tick < timingOrigins[i].tick) i--;
    const o = timingOrigins[i];
    return o.time + (tick-o.tick)*60/(o.bpm*TICKS_PER_PULSE);
  };
  const limit = followLimit(lane);
  const terminal = limit === lane.path.end && !engine.wrap ? lastSoundingStep(lane) : null;
  const frame = paper.getBoundingClientRect();
  const scale = frame.width / paper.offsetWidth || 1;
  const base = camera.base;
  // Some Android WebViews report native scroll extents in
  // different units from CSS-zoomed compositor movement. Measure the right
  // edge in the same camera space as contentX; a native scrollWidth cap can
  // otherwise stop the first pass through a later loop before its playhead.
  const maximum = Math.max(camera.anchor,
    camera.left + (el.score.getBoundingClientRect().right - frame.left) / scale - width);
  const contentX = element => {
    const bounds = element.getBoundingClientRect();
    const stem = parseFloat(element.style.getPropertyValue('--stem-offset')) || 0;
    return camera.left + (bounds.left + bounds.width * stem / 100 - frame.left) / scale;
  };
  const points = [];
  let endStep = group.from;
  let groups = 0;
  for (let from = group.from; from < limit;) {
    if (terminal !== null && from > terminal) break;
    const slot = row.allSlots[from];
    if (!slot || slot.closest('.staff-line') !== line) break;
    const to = Math.min(lane.stepGroups[from].to, limit);
    const finalSegment = terminal !== null && to > terminal;
    const horizonEnd = ++groups >= 4;
    if (!(to > from)) break;
    points.push({time: timeAt(originTick + lane.ticks[from]), x: contentX(slot)});
    endStep = to;
    const next = row.allSlots[to];
    if (horizonEnd || finalSegment || to === limit || !next || next.closest('.staff-line') !== line) {
      // Land on the playhead at this time. The beat's far edge is ahead of a
      // loop boundary that falls inside the group, and committing it parks
      // the view there until the cursor catches up.
      const finalSlot = finalSegment ? row.allSlots[terminal] : null;
      const landing = finalSlot || (next && next.closest('.staff-line') === line ? next : null);
      const bar = row.grid.barSteps.indexOf(to);
      const boundary = !landing && bar >= 0 ? line.querySelector(`.barline[data-bar-boundary="${bar}"]`) : null;
      const x = landing ? contentX(landing) : boundary ? contentX(boundary) : contentX(slot);
      const endTime = timeAt(originTick + lane.ticks[to]);
      if (finalSegment) {
        // Reach the last note at its onset, then hold through rests/audio tails.
        const onset = timeAt(originTick + lane.ticks[terminal]);
        if (onset > points.at(-1).time) points.push({time: onset, x});
        else points[points.length - 1].x = x;
      }
      points.push({time: endTime, x});
      break;
    }
    from = to;
  }
  if (points.length < 2 || points.at(-1).time <= now) {
    const current = row.allSlots[lane.step];
    if (current && current.closest('.staff-line') === line)
      camera.target = Math.min(maximum, Math.max(camera.anchor, contentX(current) - width * .70));
    return;
  }
  // Include tempo boundaries so changing speed does not bend audio/visual timing.
  for (const tempo of timingOrigins) {
    const i = points.findIndex((p, i) => i && p.time > tempo.time && points[i-1].time < tempo.time);
    if (i > 0) {
      const a = points[i-1], b = points[i];
      // Rebuild on tempo changes; use the boundary's actual tick fraction.
      const tickAt = time => {
        let j = timingOrigins.length - 1;
        while (j > 0 && time < timingOrigins[j].time) j--;
        const o = timingOrigins[j];
        return o.tick + (time - o.time) * o.bpm * TICKS_PER_PULSE / 60;
      };
      const f = (tempo.tick - tickAt(a.time)) / (tickAt(b.time) - tickAt(a.time));
      points.splice(i, 0, {time: tempo.time, x: a.x + (b.x-a.x)*f});
    }
  }
  const end = points.at(-1).time;
  // A loop return first sets the scroll anchor at its left edge. Preserve that
  // anchor until the cursor crosses 70%; never recenter it after the snap.
  // Resume/release use the current committed position, not a new loop anchor.
  const target = x => Math.min(maximum, Math.max(camera.anchor, x - width * .70));
  const positions = [];
  const add = (time, x) => {
    if (time < now) return;
    positions.push({offset: (time-now)/(end-now), left: target(x)});
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1], b = points[i];
    if (a.time <= now && now < b.time) add(now, a.x+(b.x-a.x)*(now-a.time)/(b.time-a.time));
    if (a.time > now) add(a.time, a.x);
    // Explicit threshold/cap crossings avoid spreading a stationary interval
    // across the whole group and starting the follow too early.
    for (const x of [camera.anchor + width*.70, maximum + width*.70]) {
      if (b.x > a.x && x > a.x && x < b.x) add(a.time+(b.time-a.time)*(x-a.x)/(b.x-a.x), x);
    }
  }
  add(end, points.at(-1).x);
  positions.sort((a,b) => a.offset-b.offset);
  followPlan = {positions, startTime: now, duration:end-now, base, zoom:scoreZoom,
    motionScale, row, line, width, height:paper.clientHeight, endStep, from:group.from, originTick,
    tempoKey:`${origin.tick}/${origin.time}/${origin.bpm}`, limit, maximum};
  renderFollowSegment(true);
}


function animateFollow(now) {
  followFrame=0;
  if (!canFollow(now)) { stopFollowing(engine.paused?'pause':'interaction'); return; }
  const track=followedTrack(),row=rows.get(track);
  const lane=engine.lanes.find(l=>l.track.id===track);
  const slot=row?.allSlots[lane?.step];
  if (!slot || !lane.visualGroup) { stopFollowing('finish'); return; }
  if (lane.step>lastSoundingStep(lane) && followLimit(lane)===lane.path.end && !engine.wrap) {
    stopFollowing('finish');return;
  }
  const line=slot.closest('.staff-line');
  if (followedLine && line!==followedLine) {
    finishFollowMotion('jump');
    placePlaybackAnchor(track,lane.step,true,false);
  }
  followedLine=line;
  const origin=engine.tempos.at(-1);
  const key=`${origin.tick}/${origin.time}/${origin.bpm}`;
  const state=followPlan;
  const previewExpired=state && lane.visualGroup.from>state.from && state.endStep<state.limit &&
    row.allSlots[state.endStep]?.closest('.staff-line')===line &&
    state.startTime+state.duration-engine.context.currentTime<.3;
  if (!state || state.row!==row || state.line!==line || state.zoom!==scoreZoom ||
      state.width!==el.paper.clientWidth || state.height!==el.paper.clientHeight ||
      state.tempoKey!==key || state.limit!==followLimit(lane) || lane.step>=state.endStep || previewExpired ||
      Math.abs(state.originTick-(lane.visualGroup.firstTick-lane.ticks[lane.visualGroup.from]))>1e-7) {
    planFollow(row,lane,line);
  } else renderFollowSegment();
  followFrame=requestAnimationFrame(animateFollow);
}

function stopFollowing(reason = 'interaction') {
  finishFollowMotion(reason);
  if (followFrame) cancelAnimationFrame(followFrame);
  followFrame = 0;
}

function holdFollowing() {
  manualFollowUntil = performance.now() + 900;
  stopFollowing();
}

function canFollow(now = performance.now(), atStart = false) {
  return follow && engine.running && !engine.paused && !editOwnsViewport &&
    !paperPan && !paperTouch && (atStart || now >= manualFollowUntil);
}

function followedTrack() {
  // Never switch lanes because another instrument is active or loops sooner.
  return doc.tracks.some(track => track.id === designatedFollowTrack)
    ? designatedFollowTrack : doc.tracks[0]?.id;
}

function placePlaybackAnchor(trackId, step, vertical = false, useBoundary = true) {
  const row = rows.get(trackId);
  const slot = row?.allSlots[step];
  if (!slot) return;
  finishFollowMotion('jump');
  const bar = useBoundary ? row.grid.barSteps.findIndex(value => value === step) : -1;
  const anchor = bar >= 0 ? row.row.querySelector(`.barline[data-bar-boundary="${bar}"]:not(.line-end)`) : slot;
  if (!anchor) return;
  followedLine = slot.closest('.staff-line');
  const paper = el.paper;
  const top = paper.scrollTop;
  // Native alignment handles WebView's CSS zoom coordinates without mixing scroll units.
  el.score.style.setProperty('--loop-tail', (paper.clientWidth / scoreZoom) + 'px');
  const previousMargin = anchor.style.scrollMarginLeft;
  anchor.style.scrollMarginLeft = '0px';
  anchor.scrollIntoView({inline: 'start', block: vertical ? 'center' : 'nearest', behavior: 'instant'});
  anchor.style.scrollMarginLeft = previousMargin;
  if (!vertical) paper.scrollTop = top;
}

async function preparePlaybackView(trackId, step) {
  if (!follow) return;
  stopFollowing();
  placePlaybackAnchor(trackId, step, true, false);
  // Finish layout and painting before the audio clock and first note are scheduled.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function followPlayback() {
  if (!followFrame && canFollow()) {
    setFollowGutter(true);
    followFrame = requestAnimationFrame(animateFollow);
  }
}

function toggleFollowPlayback() {
  editOwnsViewport = false;
  follow = !follow;
  try { localStorage.setItem(FOLLOW_KEY, follow ? 'on' : 'off'); } catch {}
  refreshControls();
  if (!follow) { stopFollowing(); setFollowGutter(false); }
  else {
    manualFollowUntil = 0;
    if (engine.running && !engine.paused) {
      engine.schedule();
      placePlaybackAnchor(followedTrack(), playingPositions.get(followedTrack()), true, false);
    }
    followPlayback();
  }
}

function scoreHorizontalViewport(paper) {
  const bounds = paper.getBoundingClientRect();
  const scale = paper.offsetWidth ? bounds.width / paper.offsetWidth : 1;
  const left = bounds.left + paper.clientLeft * scale;
  return {left, right: left + paper.clientWidth * scale};
}

function scoreEditViewport(control) {
  const paper = el.paper;
  const tap = scoreTapViewport;
  scoreTapViewport = undefined;
  editOwnsViewport = true;
  stopFollowing();
  return tap?.control === control ? tap : paper;
}

function cancelNoteReveal() {
  noteVisibilityObserver?.disconnect();
  noteVisibilityObserver = undefined;
}

function revealSlot(step, track, vertical = Boolean(track)) {
  holdFollowing();
  const row = rows.get(track) ?? rows.values().next().value;
  const slot = row?.allSlots[step];
  if (!slot) return;
    cancelNoteReveal();
    editOwnsViewport = true;
    const paper = el.paper;
    const top = paper.scrollTop;
    const observer = new IntersectionObserver(entries => {
      observer.disconnect();
      if (noteVisibilityObserver !== observer) return;
      noteVisibilityObserver = undefined;
      const entry = entries[0];
      if (!slot.isConnected || !entry || entry.intersectionRatio >= 1) return;
      // The enlarged vertical root ignores vertical clipping: only horizontal
      // visibility decides whether note entry may move the score.
      slot.scrollIntoView({inline: 'center', block: 'nearest', behavior: 'instant'});
      paper.scrollTop = top;
    }, {root: paper, rootMargin: '100000px 0px', threshold: [0, 1]});
    noteVisibilityObserver = observer;
    observer.observe(slot);
}

function applyScoreZoom(value) {
  scoreZoom = value;
  el.score.style.setProperty('--score-zoom', String(value));
  el.score.style.setProperty('--follow-gutter', (followGutter / value) + 'px');
  el.scoreZoomValue.textContent = Math.round(value / DEFAULT_SCORE_ZOOM * 100) + '%';
}

let queuedScoreZoom = null;
let zoomFrame = 0;
function requestedScoreZoom() { return queuedScoreZoom?.value ?? scoreZoom; }
function setScoreZoom(value, clientX, clientY, panX = 0, panY = 0) {
  const previous = queuedScoreZoom;
  queuedScoreZoom = {value: clamp(value, MIN_SCORE_ZOOM, MAX_SCORE_ZOOM), clientX, clientY,
    panX: (previous?.panX ?? 0) + panX, panY: (previous?.panY ?? 0) + panY};
  if (zoomFrame) return;
  zoomFrame = requestAnimationFrame(() => {
    zoomFrame = 0;
    const update = queuedScoreZoom;
    queuedScoreZoom = null;
    if (!update) return;
    if (engine.running && !engine.paused) engine.schedule();
    applyQueuedScoreZoom(update.value, update.clientX, update.clientY);
    el.paper.scrollLeft += update.panX;
    el.paper.scrollTop += update.panY;
    if (paperPan) Object.assign(paperPan, {left: el.paper.scrollLeft, top: el.paper.scrollTop});
    positionBeatMenu();
  });
}
function applyQueuedScoreZoom(value, clientX, clientY) {
  cancelNoteReveal();
  appendVisibilityObserver?.disconnect();
  appendVisibilityObserver = undefined;
  const next = clamp(value, MIN_SCORE_ZOOM, MAX_SCORE_ZOOM);
  if (next === scoreZoom) return;
  stopFollowing();
  if (follow && engine.running && !engine.paused) {
    const frame = el.paper.getBoundingClientRect();
    clientX = frame.left + el.paper.clientWidth / 2;
    manualFollowUntil = 0;
    followPlayback();
  }
  const before = el.score.getBoundingClientRect();
  const ratio = next / scoreZoom;
  applyScoreZoom(next);
  const after = el.score.getBoundingClientRect();
  el.paper.scrollLeft += after.left + followGutter + (clientX - before.left - followGutter) * ratio - clientX;
  el.paper.scrollTop += after.top + (clientY - before.top) * ratio - clientY;
}

function zoomScoreAtCenter(value) {
  const rect = el.paper.getBoundingClientRect();
  setScoreZoom(value, rect.left + el.paper.clientWidth / 2, rect.top + el.paper.clientHeight / 2);
}

function paintPlaySteps(positions) {
  for (const [id, row] of rows) {
    const slot = row.allSlots[positions.get(id)];
    if (slot === row.playingSlot) continue;
    row.playingSlot?.classList.remove('playing');
    row.playingSlot = slot;
    slot?.classList.add('playing');
  }
  playingPositions = positions;
}

let beatMenuAnchor = null;
function closePopups() {
  el.menu.classList.remove('transport-menu');
  beatMenuAnchor = null;
  handMenuAnchor = undefined;
  el.menu.hidden = el.beatMenu.hidden = true;
  document.querySelector('.rhythm-card.menu-open')?.classList.remove('menu-open');
}

function popup(anchor, items) {
  closePopups();
  el.menu.replaceChildren(...items.map(([label, action, disabled]) => {
    const item = button(label, () => { closePopups(); action(); });
    item.disabled = Boolean(disabled);
    return item;
  }));
  el.menu.hidden = false;
  positionPopup(anchor);
}

function positionPopup(anchor, handMenu = false) {
  const rect = anchor.getBoundingClientRect();
  const bounds = {left: 7, top: 6, right: innerWidth - 7, bottom: innerHeight - 7};
  const place = () => {
    const width = el.menu.offsetWidth, height = el.menu.offsetHeight;
    const left = clamp(rect.left, 7, innerWidth - width - 7);
    const below = handMenu ? rect.top + Math.min(rect.height * .19, 28) + 4 : rect.bottom + 4;
    return clearOfMenuHold({left, top: clamp(below, 6, innerHeight - height - 7), width, height}, bounds);
  };
  el.menu.style.maxHeight = '';
  let box = place();
  if (box.covered) {
    // Too tall for the space beside a held finger: shorten the scrollable menu to the larger free side.
    el.menu.style.maxHeight = Math.max(48, Math.floor(menuHoldRoom(bounds))) + 'px';
    box = place();
  }
  el.menu.style.left = box.left + 'px';
  el.menu.style.top = box.top + 'px';
}

function openHandMenu(anchor) {
  const track = selectedTrack();
  const index = scoreIndex();
  const items = [...HAND_MARKS, null].map(hand => [
    t(hand ? 'hand.' + hand : 'hand.clear'), () => {
      change(() => {
        track.hands ??= emptyCells(track.cells.length);
        track.hands[index] = hand;
      });
      staffGlyph(rows.get(track.id).entries[cursor.beat]);
      if (hand && index + 1 < currentGrid().barSteps.at(-1)) {
        moveCursor(1);
        openHandMenu(rows.get(track.id).entries[cursor.beat].slots[cursor.slot]);
      }
    }, !hand && !track.hands?.[index]
  ]);
  if (copiedMeasures) items.unshift([t('bar.pasteMeasures'), pasteMeasures]);
  popup(anchor, items);
  handMenuAnchor = anchor;
  positionPopup(anchor, true);
}

function openBeatMenu(anchor) {
  const track = selectedTrack();
  const paste = button(t('beat.paste'), () => { closePopups(); pasteAtCursor(); });
  paste.disabled = !copiedMeasures && !canPaste(track);
  const info = beatSplitInfo(doc, track, cursor.beat, cursor.slot);
  const split = button(t('beat.split') + (info.count > 1 ? ' (' + info.count + ')' : ''), () => openSplitMenu(anchor));
  split.title = t('beat.splitTitle');
  el.beatMenu.replaceChildren(button(t('beat.copy'), () => { copyBeat(); closePopups(); }), paste,
    button(t('beat.tuplet'), () => { closePopups(); changeTuplet(); }), split,
    button(t('meter.group'), () => openGroupMeterMenu(anchor)),
    button(t('hand.menu'), () => openHandMenu(rows.get(track.id).entries[cursor.beat].slots[cursor.slot])));
  el.beatMenu.hidden = false;
  beatMenuAnchor = anchor;
  positionBeatMenu();
}

function positionBeatMenu() {
  if (el.beatMenu.hidden || !beatMenuAnchor?.isConnected) return;
  const rect = beatMenuAnchor.getBoundingClientRect();
  const viewport = window.visualViewport;
  const leftEdge = (viewport?.offsetLeft ?? 0) + 7;
  const topEdge = (viewport?.offsetTop ?? 0) + 7;
  const rightEdge = leftEdge + (viewport?.width ?? innerWidth) - 14;
  const screenBottom = topEdge + (viewport?.height ?? innerHeight) - 14;
  const toolbarTop = el.editorTransport.hidden ? screenBottom : el.editorTransport.getBoundingClientRect().top - 7;
  const bottomEdge = toolbarTop > topEdge + 60 ? Math.min(screenBottom, toolbarTop) : screenBottom;
  el.beatMenu.style.maxHeight = Math.max(24, bottomEdge - topEdge) + 'px';
  const menuScale = Math.min(1, (rightEdge - leftEdge) / el.beatMenu.offsetWidth);
  el.beatMenu.style.transformOrigin = 'top left';
  el.beatMenu.style.transform = `scale(${menuScale})`;
  const width = el.beatMenu.offsetWidth * menuScale;
  const height = el.beatMenu.offsetHeight * menuScale;
  const above = rect.top - height - 9;
  const below = above < topEdge;
  const placed = {width, height, left: clamp((rect.left + rect.right - width) / 2, leftEdge, rightEdge - width),
    top: clamp(below ? rect.bottom + 9 : above, topEdge, Math.max(topEdge, bottomEdge - height))};
  const box = clearOfMenuHold(placed, {left: leftEdge, top: topEdge, right: rightEdge, bottom: Math.max(topEdge + height, bottomEdge)});
  el.beatMenu.classList.toggle('below', below);
  // Moved clear of a held finger, the menu no longer sits next to its beat and hides the pointer arrow.
  el.beatMenu.classList.toggle('clear-of-hold', box !== placed);
  el.beatMenu.style.left = box.left + 'px';
  el.beatMenu.style.top = box.top + 'px';
}

function copyBeat() {
  copiedMeasures = undefined;
  const grid = currentGrid();
  const start = beatStart(grid, cursor.beat);
  copiedBeat = selectedTrack().cells.slice(start, start + groupSize(grid.beats[cursor.beat]));
  copiedHands = selectedTrack().hands?.slice(start, start + copiedBeat.length) ?? emptyCells(copiedBeat.length);
  copiedLayout = JSON.stringify(grid.beats[cursor.beat]);
  notify(t('beat.copied'));
}

function canPaste(track) {
  const layout = currentGrid().beats[cursor.beat];
  return copiedBeat?.length === groupSize(layout) && (Number.isInteger(layout) && /^\d+$/.test(copiedLayout) || copiedLayout === JSON.stringify(layout)) &&
    copiedBeat.every(stroke => !stroke || TYPES[track.type].strokes.includes(stroke));
}

function pasteBeat() {
  const track = selectedTrack();
  if (!canPaste(track)) { notify(t('beat.pasteBad')); return; }
  const start = beatStart(currentGrid(), cursor.beat);
  change(() => {
    track.cells.splice(start, copiedBeat.length, ...copiedBeat);
    if (track.hands || copiedHands.some(Boolean)) {
      track.hands ??= emptyCells(track.cells.length);
      track.hands.splice(start, copiedBeat.length, ...copiedHands);
    }
  });
  staffGlyph(rows.get(track.id).entries[cursor.beat]);
}

function copyMeasures(track, from, to) {
  copiedMeasures = copyTrackMeasures(doc, track, from, to);
  if (measureCopyStart) {
    measureCopyStart = undefined;
    renderScore();
  }
  notify(t('bar.measuresCopied', {count: to - from}));
}

function pasteMeasures() {
  const track = selectedTrack();
  if (!copiedMeasures.cells.every(stroke => !stroke || TYPES[track.type].strokes.includes(stroke))) {
    notify(t('bar.pasteIncompatible'));
    return;
  }
  const bar = currentBar();
  const start = scoreIndex();
  change(() => pasteTrackMeasures(doc, track, bar, start, copiedMeasures), true);
  revealSlot(scoreIndex(), track.id);
  notify(t('bar.measuresPasted'));
}

function pasteAtCursor() {
  if (copiedMeasures) pasteMeasures();
  else pasteBeat();
}

function setTrackBeatSizes(track, grid, sizes, cells) {
  if (track.hands) track.hands = convertCells(track.hands, grid.beats, sizes).converted;
  track.cells = cells;
  track.measures = grid.measures.map((measure, bar) => ({
    ...measure, beats: sizes.slice(grid.barBeats[bar], grid.barBeats[bar + 1])
  }));
  markVersion(doc, 4);
}

function confirmBeatSizes(collisions) {
  return !collisions || confirm(t('beat.confirmMerge', {count: collisions}));
}

// 1.60: written notes stay while subdivisions change; notes landing on one cell merge after confirmation.
function applyBeatSizes(sizes, subdivision) {
  const edits = doc.tracks.map(track => {
    const grid = trackGrid(doc, track);
    const next = track.measures ? grid.beats.map(() => subdivision) : sizes;
    const edit = convertCells(track.cells, grid.beats, next);
    if (track.hands) edit.collisions += convertCells(track.hands, grid.beats, next).collisions;
    return {track, grid, next, ...edit};
  });
  const same = (a, b) => a.every((size, index) => size === b[index]);
  if (subdivision === doc.subdivision && same(sizes, doc.beats) && edits.every(edit => same(edit.next, edit.grid.beats))) return;
  if (!confirmBeatSizes(edits.reduce((count, edit) => count + edit.collisions, 0))) return;
  change(() => {
    for (const {track, grid, next, converted} of edits) {
      if (track.measures) setTrackBeatSizes(track, grid, next, converted);
      else {
        if (track.hands) track.hands = convertCells(track.hands, grid.beats, next).converted;
        track.cells = converted;
      }
    }
    doc.beats = sizes;
    doc.subdivision = subdivision;
  }, true);
  revealSlot(scoreIndex(), cursor.track);
}

function changeTuplet() {
  const grid = currentGrid();
  const sizes = grid.beats.slice();
  const current = sizes[cursor.beat];
  if (Array.isArray(current)) { notify(t('beat.tupletSplit')); return; }
  // Only groups with 3 or 4 cells can switch subdivision here.
  if (current !== 3 && current !== 4) { notify(t('beat.tupletOdd')); return; }
  sizes[cursor.beat] = current === 3 ? 4 : 3;
  if (!doc.tracks.some(track => track.measures)) { applyBeatSizes(sizes, doc.subdivision); return; }
  const track = selectedTrack();
  const {converted, collisions} = convertCells(track.cells, grid.beats, sizes);
  if (!confirmBeatSizes(collisions + (track.hands ? convertCells(track.hands, grid.beats, sizes).collisions : 0))) return;
  change(() => setTrackBeatSizes(track, grid, sizes, converted), true);
  revealSlot(scoreIndex(), cursor.track);
}

// 0.22: choose 1-4 equal parts for the cell under the cursor (1 = not split).
// 1.60: also while the cell holds notes; they move to the nearest new sub-cell.
function openSplitMenu(anchor) {
  const info = beatSplitInfo(doc, selectedTrack(), cursor.beat, cursor.slot);
  const cell = rows.get(cursor.track)?.entries[cursor.beat]?.slots[cursor.slot];
  popup(anchor?.isConnected && anchor.offsetParent ? anchor : cell ?? el.score, [1, 2, 3, 4].map(parts => [
    (parts === info.count ? '✓ ' : '') + (parts === 1 ? t('split.one') : t('split.option', {n: parts})),
    () => splitBeat(parts), parts === info.count || info.canEdit === false
  ]));
}

// Split the cell under the cursor into `parts` equal sub-cells (1 = merge back). One track only.
function splitBeat(parts) {
  if (parts === true) parts = SPLIT;
  if (parts === false) parts = 1;
  const track = selectedTrack();
  const info = beatSplitInfo(doc, track, cursor.beat, cursor.slot);
  const result = splitTrackBeat(doc, track, cursor.beat, cursor.slot, parts);
  if (!result) { notify(t('beat.alreadySplit', {n: info.count})); return; }
  const hands = track.hands && splitTrackBeat(doc, {...track, cells: track.hands}, cursor.beat, cursor.slot, parts);
  const dropped = result.dropped + (hands?.dropped ?? 0);
  if (dropped && !confirm(t('beat.confirmSplitMerge', {n: parts, count: dropped}))) return;
  change(() => {
    if (hands) track.hands = hands.cells;
    track.measures = result.measures;
    track.cells = result.cells;
    markVersion(doc, 4);
    cursor = {track: track.id, beat: cursor.beat, slot: result.slot};
  }, true);
  notify(parts > 1 ? t('beat.splitDone', {n: parts}) : t('beat.mergeDone'));
  revealSlot(scoreIndex(), cursor.track);
}

function appendMeasure(track, control) {
  cancelNoteReveal();
  const paper = el.paper;
  const grid = trackGrid(doc, track);
  const {scrollLeft, scrollTop} = scoreEditViewport(control);
  const left = Math.max(0, scrollLeft - followGutter);
  change(() => {
    insertTrackBar(doc, track, grid.measures.length - 1);
    cursor = {track: track.id, beat: grid.beats.length, slot: 0};
  }, true, track);
    // Rebuilding the track or removing the playback gutter can shift the viewport.
    // Restore the pre-tap view before checking the new button.
    if (paper.scrollLeft !== left || paper.scrollTop !== scrollTop) {
      paper.scrollTo({left, top: scrollTop, behavior: 'instant'});
    }
    const {lastMeasure, addMeasureButton} = rows.get(track.id);
    appendVisibilityObserver?.disconnect();
    const observer = new IntersectionObserver(entries => {
      observer.disconnect();
      if (appendVisibilityObserver !== observer) return;
      appendVisibilityObserver = undefined;
      const entry = entries[0];
      if (!entry?.rootBounds || !lastMeasure.isConnected) return;
      // Ignore vertical clipping (especially while the note keyboard is open).
      // A fully visible measure must never trigger alignment, even if an older
      // WebView reports different zoom units for the target and root rectangles.
      if (entry.intersectionRatio >= 1) return;
      const bounds = entry.boundingClientRect;
      const visible = entry.intersectionRect;
      const clippedOnRight = entry.isIntersecting
        ? visible.width > 0 && visible.right < bounds.right - .5
        : bounds.right > entry.rootBounds.right + .5;
      if (clippedOnRight) {
        addMeasureButton.scrollIntoView({inline: 'end', block: 'nearest', behavior: 'instant'});
        paper.scrollTop = scrollTop;
      }
    }, {root: paper, rootMargin: '100000px 0px', threshold: [0, 1]});
    appendVisibilityObserver = observer;
    observer.observe(lastMeasure);
}

function openGroupMeterMenu(anchor, trackId = cursor.track, beat = cursor.beat) {
  const row = rows.get(trackId);
  const entry = row?.entries[beat];
  if (!entry) return;
  const selected = entry.layout.steps ? null : groupMeter(row.grid.measures[entry.bar], entry.group);
  popup(anchor, Object.keys(TIME_SIGNATURES).map(meter => [
    (meter === selected ? '✓ ' : '') + meter, () => setGroupMeter(trackId, beat, meter), meter === selected
  ]));
}

function setGroupMeter(trackId, beat, meter) {
  const row = rows.get(trackId);
  const entry = row?.entries[beat];
  if (!entry) return;
  const {grid} = row;
  const {track, bar, group, start, size: count} = entry;
  const measure = grid.measures[bar];
  if (!measure.beats[group].steps && groupMeter(measure, group) === meter) return;
  const slot = cursor.track === trackId && cursor.beat === beat ? cursor.slot : 0;
  selectSlot(trackId, beat, slot);
  if (track.cells.slice(start, start + count).some(Boolean)) {
    warnBeforeChangingNotes('meter.clearBeforeGroup');
    return;
  }
  const oldSize = measure.beats[group];
  const size = plainGroup(meter);
  const hands = track.hands && convertCells(track.hands.slice(start, start + count), [oldSize], [size]);
  if (hands && !confirmBeatSizes(hands.collisions)) return;
  change(() => {
    const next = structuredClone(measure);
    next.beats[group] = size;
    next.groupMeters ??= emptyCells(next.beats.length);
    next.groupMeters[group] = meter === measure.meter ? null : meter;
    if (!next.groupMeters.some(Boolean)) delete next.groupMeters;
    track.measures = grid.measures.slice();
    track.measures[bar] = next;
    track.cells.splice(start, count, ...emptyCells(size));
    if (hands) track.hands.splice(start, count, ...hands.converted);
    cursor.slot = Math.min(cursor.slot, size - 1);
  }, true);
  notify(t('meter.groupChanged', {meter}));
}

function setTrackMeasureMeter(track, bar, meter) {
  const grid = trackGrid(doc, track);
  if (grid.measures[bar].meter === meter && !grid.measures[bar].groupMeters) return;
  const start = grid.barSteps[bar];
  const count = grid.barSteps[bar + 1] - start;
  if (track.cells.slice(start, start + count).some(Boolean)) {
    warnBeforeChangingNotes('beat.clearBeforeMeter');
    return;
  }
  const {measure, cells, dropped} = measureMeterChange(track, grid, bar, meter);
  const hands = track.hands && measureMeterChange({...track, cells: track.hands}, grid, bar, meter);
  const lost = dropped + (hands?.dropped ?? 0);
  if (lost && !confirm(t('beat.confirmMeter', {meter, count: lost}))) return;
  change(() => {
    track.measures = grid.measures.slice();
    track.measures[bar] = measure;
    track.cells.splice(start, count, ...cells);
    if (hands) track.hands.splice(start, count, ...hands.cells);
    markVersion(doc, 4);
    cursor = {track: track.id, beat: grid.barBeats[bar], slot: 0};
  }, true);
  revealSlot(scoreIndex(), track.id);
}

function confirmMeasureDeletion(message, remove) {
  const panel = el.deleteMeasurePanel;
  el.deleteMeasureMessage.textContent = message;
  el.confirmDeleteMeasure.onclick = () => {
    if (!panel.open) return;
    panel.close();
    remove();
  };
  panel.showModal();
}

function measureHasNotes(track, grid, bar) {
  const start = grid.barSteps[bar];
  const end = grid.barSteps[bar + 1];
  return track.cells.slice(start, end).some(Boolean) || track.hands?.slice(start, end).some(Boolean);
}

function measureHasStrokes(track, grid, bar) {
  return track.cells.slice(grid.barSteps[bar], grid.barSteps[bar + 1]).some(Boolean);
}

function editBar(action, bar = currentBar()) {
  const track = selectedTrack();
  const deleting = action === 'delete';
  const apply = () => {
    change(() => {
      if (deleting) deleteBar(doc, bar);
      else insertBar(doc, bar, action === 'copy');
      const grid = trackGrid(doc, track);
      const nextBar = deleting ? bar : bar + 1;
      cursor = {track: track.id, beat: grid.barBeats[Math.min(nextBar, grid.measures.length - 1)], slot: 0};
    }, true);
    revealSlot(scoreIndex(), cursor.track);
  };
  if (deleting) {
    if (scoreBars(doc) < 2) return;
    const hasNotes = doc.tracks.some(track =>
      trackBars(doc, track) >= 2 && bar < trackBars(doc, track) && measureHasNotes(track, trackGrid(doc, track), bar));
    if (hasNotes) {
      confirmMeasureDeletion(t('measure.confirmDelete', {bar: bar + 1}), apply);
      return;
    }
  }
  apply();
}

function scoreHasNotes() {
  return doc.tracks.some(track => track.cells.some(Boolean));
}

function clearScoreNotes() {
  if (!scoreHasNotes()) return;
  change(() => {
    for (const track of doc.tracks) track.cells.fill(null);
  }, true);
  notify(t('meter.scoreCleared'));
}

function chooseMeter(meter) {
  if (scoreHasNotes()) {
    warnBeforeChangingNotes('meter.clearBeforeReset');
    return;
  }
  change(() => {
    resetScoreMeter(doc, meter);
    cursor = {track: doc.tracks[0].id, beat: 0, slot: 0};
    keysOpen = false;
    loopMode = 'once';
    el.paper.scrollTo(0, 0);
  }, true);
  notify(t('meter.reset', {meter}));
}

function finishPlayback(finalPositions) {
  // Natural completion preserves the final cursor and its viewport.
  stopPlayback(finalPositions);
}

function stopPlayback(finalPositions) {
  cancelNoteReveal();
  stopFollowing(finalPositions instanceof Map ? 'finish' : 'interaction');
  if (!(finalPositions instanceof Map)) setFollowGutter(false);
  manualFollowUntil = 0;
  request++;
  pending = false;
  pauseChanging = false;
  engine.stop();
  playingLoops = [];
  paintPlaySteps(finalPositions instanceof Map ? finalPositions : new Map());
  refreshControls();
}

function useSquareButton() {
  if (!engine.releaseLoop()) {
    stopPlayback(engine.running ? new Map(playingPositions) : undefined);
    return;
  }
  if (canFollow()) {
    // Extend this trajectory now, without reanchoring or waiting at the old end.
    stopFollowing('release');
    animateFollow(performance.now());
  }
  refreshControls();
  notify(t('stop.released'));
}

// 1.61: repeat the playing loop 1-8 more times, then continue; or cancel a pending continue.
function openLoopRepeatMenu(anchor) {
  const gates = engine.paused ? [] : playingLoops;
  if (!gates.length) return;
  const released = gates.every(gate => gate.released);
  const left = Math.max(0, ...gates.map(gate => gate.released ? gate.repeats || 0 : 0));
  popup(anchor, [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(times =>
      [(released && left === times ? '✓ ' : '') + t('loop.repeatTimes', {n: times}), () => changeLoopRelease(times)]),
    [t('loop.keepLooping'), () => changeLoopRelease(null), !released]
  ]);
  el.menu.classList.add('transport-menu');
}

function changeLoopRelease(times) {
  if (!(times === null ? engine.keepLooping() : engine.releaseLoop(times))) return;
  if (canFollow()) {
    // Re-plan the camera for the new loop end, as the square button does.
    stopFollowing('release');
    animateFollow(performance.now());
  }
  refreshControls();
  notify(times === null ? t('loop.keptLooping') : t('loop.repeatSet', {n: times}));
}

async function playScore() {
  if (pending || engine.running) return;
  const token = ++request;
  editOwnsViewport = false;
  pending = true;
  refreshControls();
  const bar = currentBar();
  const repeat = doc.repeat;
  const range = loopMode === 'bar' ? {from: bar, to: bar + 1}
    : loopMode === 'repeat' && repeat && bar >= repeat.from && bar < repeat.to ? repeat : null;
  const targetTrack = followedTrack();
  const position = {track: targetTrack, step: targetTrack === cursor.track ? scoreIndex() : 0};
  try {
    await preparePlaybackView(position.track, position.step);
    if (request !== token) return;
    await engine.start(doc, range, Boolean(range) || loopMode === 'score', position);
    if (request !== token) return;
    pending = false;
    refreshControls();
  } catch {
    if (request !== token) return;
    stopPlayback();
    notify(t('msg.cannotPlay'));
  }
}

async function togglePlayback() {
  if (pauseChanging) return;
  if (pending) { stopPlayback(); return; }
  if (!engine.running) { await playScore(); return; }
  if (engine.paused && cursor !== cursorAtPause) {
    stopPlayback();
    await playScore();
    return;
  }
  const token = request;
  const pausing = !engine.paused;
  if (!pausing) editOwnsViewport = false;
  if (pausing) cursorAtPause = cursor;
  pauseChanging = true;
  try {
    if (pausing) {
      engine.advancePlayhead(engine.context.currentTime);
      stopFollowing('pause');
    }
    const transition = engine.setPaused(pausing);
    refreshControls();
    await transition;
    if (request === token && !pausing) {
      manualFollowUntil = 0;
      stopFollowing('retarget');
      followPlayback();
    }
  } catch {
    if (request !== token) return;
    stopPlayback();
    notify(t('msg.pauseError'));
  } finally {
    if (request === token) {
      pauseChanging = false;
      refreshControls();
    }
  }
}

function bindRange(input, apply) {
  let previous;
  input.addEventListener('input', () => {
    previous ??= structuredClone(doc);
    apply(input.valueAsNumber);
  });
  input.addEventListener('change', () => {
    if (!previous) return;
    record(previous);
    previous = undefined;
    persist();
  });
}

function updateMixRows() {
  const soloed = doc.tracks.some(track => track.solo);
  for (const track of doc.tracks) {
    rows.get(track.id)?.row.classList.toggle('silent', track.mute || (soloed && !track.solo));
  }
}

function refreshMix() {
  engine.refreshMix();
  updateMixRows();
}

function showMixer() {
  drawMixer();
  el.mixerPanel.showModal();
}

function drawMixer() {
  el.volTab.setAttribute('aria-pressed', mixKey === 'volume');
  el.panTab.setAttribute('aria-pressed', mixKey === 'pan');
  const range = (target, label) => {
    const input = document.createElement('input');
    const key = mixKey;
    input.type = 'range';
    input.min = key === 'pan' ? -1 : 0;
    input.max = 1;
    input.step = '.01';
    input.value = target[key];
    input.setAttribute('aria-label', t(key === 'volume' ? 'mix.volumeOf' : 'mix.panOf', {name: label}));
    bindRange(input, value => { target[key] = value; refreshMix(); });
    return input;
  };
  const master = document.createElement('div');
  master.className = 'mix-all';
  const all = document.createElement('strong');
  all.textContent = t('mix.all');
  master.append(all, range(doc, t('mix.all')));
  const sections = [master];
  let group;
  let family;
  for (const track of doc.tracks) {
    const isBell = track.type === 'bell' && family &&
      ((track.name === 'Bell' && track.detail === family) ||
        (track.name === family + ' Bell' && track.detail === 'Bell'));
    if (!isBell) {
      group = document.createElement('section');
      group.className = 'mix-section';
      const heading = document.createElement('h3');
      heading.textContent = track.name;
      group.append(heading);
      sections.push(group);
      family = track.detail === 'Drum' ? track.name : '';
    }
    if (isBell || track.detail === 'Drum') {
      const label = document.createElement('div');
      label.className = 'mix-caption';
      label.textContent = isBell ? t('mix.bell') : track.detail;
      group.append(label);
    }
    const line = document.createElement('div');
    line.className = 'mix-line';
    line.append(range(track, track.name));
    if (mixKey === 'volume') {
      for (const [flag, label] of [['solo', t('mix.solo')], ['mute', t('mix.muteFlag')]]) {
        const node = iconButton(flag, track.name + ' ' + label, () => {
          change(() => { track[flag] = !track[flag]; });
          node.setAttribute('aria-pressed', track[flag]);
          refreshMix();
        });
        node.setAttribute('aria-pressed', track[flag]);
        line.append(node);
      }
    }
    group.append(line);
  }
  el.mixRows.replaceChildren(...sections);
}

function resetMixer() {
  change(() => {
    doc[mixKey] = mixKey === 'volume' ? 1 : 0;
    for (const track of doc.tracks) {
      track[mixKey] = mixKey === 'volume' ? TYPES[track.type].volume : 0;
      if (mixKey === 'volume') track.mute = track.solo = false;
    }
  });
  refreshMix();
  drawMixer();
}

function showSwing() {
  const layout = currentGrid().beats[cursor.beat];
  if (layout === 3 || layout === 4) feelSize = layout;
  drawFeel();
  el.swingPanel.showModal();
}

function updateSwingPlayback() {
  if (!engine.running && !pending) return;
  stopPlayback();
  notify(t('msg.swingUpdated'));
}

function paintPattern() {
  const pattern = doc.feel[feelSize];
  const x = [30];
  for (const value of pattern) x.push(x.at(-1) + value * 3.8);
  let markup = '<path d="M30 68H' + x[feelSize - 1] + '" stroke="currentColor" stroke-width="7"/>';
  for (let i = 0; i <= feelSize; i++) {
    const style = i === feelSize ? 'color="#888"' : '';
    markup += '<g ' + style + '><path d="M' + x[i] + ' 65v47" stroke="currentColor" stroke-width="2"/>' +
      noteAt('T', 'djembe', x[i], 112) + '</g>';
    if (i === feelSize) break;
    const midpoint = (x[i] + x[i + 1]) / 2;
    const label = Math.round(pattern[i] * 10) / 10 + '%';
    markup += '<path d="M' + x[i] + ' 48H' + x[i + 1] + '" stroke="#999"/>' +
      '<path d="M' + x[i] + ' 42v17m' + (x[i + 1] - x[i]) + ' 0v-17" stroke="#999"/>' +
      '<text x="' + midpoint + '" y="35" text-anchor="middle" font-size="15">' + label + '</text>';
  }
  for (let i = 1; i < feelSize; i++) {
    markup += '<rect data-boundary="' + i + '" x="' + (x[i] - 9) + '" y="41" width="18" height="82" fill="transparent"/>';
  }
  el.diagram.innerHTML = markup;
  Array.from(el.ratios.querySelectorAll('input')).forEach((input, i) => {
    input.value = Math.round(pattern[i] * 100) / 100;
  });
  el.strength.value = doc.feel.strength;
  el.strengthValue.value = doc.feel.strength + '%';
}

function drawFeel() {
  document.querySelectorAll('[data-feel-size]').forEach(node => node.setAttribute('aria-pressed', Number(node.dataset.feelSize) === feelSize));
  el.pasteFeel.disabled = !copiedFeel;
  el.pastePattern.disabled = copiedPattern?.length !== feelSize;
  el.compoundSwing.checked = doc.feel.compoundSwing === true;
  const inputs = Array.from({length: feelSize}, (_, index) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 3; input.max = 94; input.step = '.01';
    input.setAttribute('aria-label', t('swing.ratio', {index: index + 1}));
    input.addEventListener('change', () => {
      const pattern = doc.feel[feelSize];
      const neighbor = index === feelSize - 1 ? index - 1 : index + 1;
      if (Number.isFinite(input.valueAsNumber)) {
        const value = clamp(input.valueAsNumber, 3, pattern[index] + pattern[neighbor] - 3);
        if (value !== pattern[index]) {
          updateSwingPlayback();
          change(() => { pattern[neighbor] += pattern[index] - value; pattern[index] = value; });
        }
      }
      paintPattern();
    });
    label.append(input, '%');
    return label;
  });
  el.ratios.replaceChildren(...inputs);
  paintPattern();
  syncTempo();
}

function openInfo() {
  el.infoTitle.value = doc.title;
  el.infoRegion.value = doc.region;
  el.infoEthnic.value = doc.ethnic;
  el.infoNotes.value = doc.notes;
  el.infoPanel.showModal();
}

function openAddTrackMenu(anchor, fullCopy = false, allowFullCopy = true) {
  const items = ADD_TYPES.map(type => [(fullCopy ? t('track.fullCopy') + ' · ' : '') + typeName(type), () => {
    if (!canAddInstrument(doc, type)) return;
    change(() => { cursor = {track: (fullCopy ? addInstrumentWithLayout(doc, type) : addInstrumentTracks(doc, type)).id, beat: 0, slot: 0}; }, true);
    revealSlot(scoreIndex(), cursor.track);
  }, !canAddInstrument(doc, type)]);
  if (!fullCopy && allowFullCopy) items.unshift([t('track.fullCopy'), () => openAddTrackMenu(anchor, true)]);
  popup(anchor, items);
}

function openTrackEditor(track) {
  trackBeingEdited = track.id;
  el.trackName.value = track.name;
  el.trackDetail.value = track.detail;
  el.trackType.value = track.type;
  el.trackPanel.showModal();
}

function slotLabel(type, slot) {
  const first = TYPES[type].strokes.map(stroke => presetSample(type, slot, stroke)).find(Boolean);
  const label = t('sample.numbered', {slot});
  return first ? label + ' · ' + shortText(first.name.replace(/\.(wav|wave)$/i, ''), 32) : label;
}

function presetLabelForTrack(track) {
  if (track.preset > 0) {
    return hasPreset(track.type, track.preset) ? slotLabel(track.type, track.preset)
      : t('sample.missingSlot', {slot: track.preset});
  }
  if (track.preset !== -1 && Object.keys(track.samples).length) return t('sample.trackCustom');
  return track.type === 'djembe' ? builtinPresetLabel(track.type) : track.detail || typeName(track.type);
}

function refreshPresetLabels() {
  for (const node of el.score.querySelectorAll('[data-preset-track]')) {
    const track = doc.tracks.find(item => item.id === node.dataset.presetTrack);
    if (!track) continue;
    node.textContent = presetLabelForTrack(track);
    node.setAttribute('aria-label', t('sample.trackLabel', {track: track.name, name: node.textContent}));
  }
}

function applyTrackPreset(track, slot) {
  if (slot === (track.preset ?? 0)) return;
  change(() => { if (slot) track.preset = slot; else delete track.preset; });
  refreshPresetLabels();
}

function builtinPresetLabel(type) {
  return type === 'djembe' ? TYPES[type].name + ' 1' : t('sample.default');
}

function openPresetMenu(track, anchor) {
  const current = track.preset ?? 0;
  const legacy = Object.keys(track.samples).length > 0;
  const entry = (slot, label) => [(current === slot ? '✓ ' : '') + label, () => applyTrackPreset(track, slot)];
  popup(anchor, [
    entry(legacy || current === -1 ? -1 : 0, builtinPresetLabel(track.type)),
    ...(legacy ? [entry(0, t('sample.trackCustom'))] : []),
    ...presetSlots.filter(slot => hasPreset(track.type, slot)).map(slot => entry(slot, slotLabel(track.type, slot))),
    [t('sample.manage'), () => openSamplePanel(track)]
  ]);
}

function fillSampleOptions(type, slot, stroke) {
  el.sampleInstrument.replaceChildren(...Object.keys(TYPES).map(item => new Option(typeName(item), item)));
  el.sampleInstrument.value = type;
  const slots = presetSlots.map(number => new Option(slotLabel(type, number) +
    (hasPreset(type, number) ? '' : ' · ' + t('sample.empty')), number));
  if (sampleTrack.type === type) slots.unshift(new Option(t('sample.trackCustom'), 'track'));
  el.sampleSlot.replaceChildren(...slots);
  el.sampleSlot.value = slot === 'track' && sampleTrack.type !== type ? '1' : slot;
  el.sampleStroke.replaceChildren(...TYPES[type].strokes.filter(item => item.length === 1)
    .map(item => new Option(noteLabel(item, type) + ' (' + item + ')', item)));
  if (Array.from(el.sampleStroke.options).some(option => option.value === stroke)) el.sampleStroke.value = stroke;
}

function sampleDestination() {
  const {value: type} = el.sampleInstrument;
  const {value: stroke} = el.sampleStroke;
  const slot = el.sampleSlot.value === 'track' ? 'track' : Number(el.sampleSlot.value);
  const sample = slot === 'track' ? sampleTrack.samples[stroke] : presetSample(type, slot, stroke);
  return {type, slot, stroke, sample};
}

function paintSamplePanel() {
  const {type, slot, sample} = sampleDestination();
  el.sampleCurrent.textContent = sample
    ? t('sample.current', {name: sample.name, seconds: (sampleBytes(sample) / (sample.rate * 2)).toFixed(2)})
    : t('sample.builtin') + (type === 'djembe' ? ' · ' + builtinPresetLabel(type) : '');
  for (const select of [el.sampleInstrument, el.sampleSlot, el.sampleStroke]) select.disabled = sampleBusy;
  el.sampleImport.disabled = sampleBusy || (slot !== 'track' && !presetStorageAvailable);
  el.sampleReset.disabled = sampleBusy || !sample;
  el.samplePreview.disabled = sampleBusy;
  el.sampleApply.disabled = sampleBusy || type !== sampleTrack.type ||
    (slot !== 'track' && !hasPreset(type, slot));
}

function openSamplePanel(track) {
  if (pending || engine.running) stopPlayback();
  sampleTrack = track;
  el.sampleTrackName.textContent = track.name;
  const slot = track.preset > 0 ? track.preset : Object.keys(track.samples).length ? 'track' : 1;
  fillSampleOptions(track.type, slot);
  el.sampleMessage.textContent = presetStorageAvailable ? '' : t('sample.storage');
  paintSamplePanel();
  el.samplePanel.showModal();
}

function paintMultiGroups() {
  for (const [id, {row, entries}] of rows) {
    const active = multiGroups?.trackId === id;
    if (!active && !row.classList.contains('multi-groups')) continue;
    row.classList.toggle('multi-groups', active);
    const picking = active && !multiGroups.clip;
    const selected = new Set();
    if (picking) {
      for (const {beat, slot} of multiGroups.picks) selected.add(beat + ':' + slot);
    }
    const span = active && (multiGroups.clip || multiGroups.meterMenu)
      ? multiGroupBounds(entries, multiGroups.picks) : null;
    row.classList.toggle('multi-paste', active && !picking);
    entries.forEach(({box, slots, start}, beat) => {
      const wholeGroup = selected.has(beat + ':null');
      box.classList.toggle('group-picked', wholeGroup);
      slots.forEach((slot, index) => {
        const picked = wholeGroup || selected.has(beat + ':' + index);
        slot.classList.toggle('slot-picked', picked && !wholeGroup);
        slot.classList.toggle('selection-span', Boolean(span && start + index >= span.start && start + index < span.end));
        if (picking) slot.setAttribute('aria-pressed', picked);
        else slot.removeAttribute('aria-pressed');
      });
    });
    for (const control of row.querySelectorAll('.group-meter, .barline, .add-measure, .add-measure-quick')) {
      const boundary = control.dataset.barBoundary;
      control.disabled = active && (boundary === undefined || !picking || multiGroups.meterMenu);
      if (boundary !== undefined) {
        control.classList.toggle('selection-range-start', active && multiGroups.rangeStart === Number(boundary));
      }
    }
  }
  refreshSelectionBar();
}

function selectionPosition(row, index) {
  const {beat, slot} = locateStep(row.grid, index);
  const entry = row.entries[beat];
  return t('multi.position', {bar: entry.bar + 1, group: entry.group + 1, slot: slot + 1});
}

function refreshSelectionBar() {
  el.selectionBar.hidden = !multiGroups;
  el.showKeys.disabled = Boolean(multiGroups);
  if (!multiGroups) return;
  const {picks, trackId, clip, meterMenu, rangeStart} = multiGroups;
  const row = rows.get(trackId);
  el.selectionActions.hidden = Boolean(clip || meterMenu);
  el.selectionMeters.hidden = !meterMenu;
  el.selectionBack.hidden = !(clip || meterMenu);
  el.selectionActions.querySelectorAll('button').forEach(node => { node.disabled = !picks.length; });
  if (!picks.length) {
    el.selectionSummary.textContent = rangeStart === undefined ? t('multi.pickHint')
      : t('multi.pickRangeEnd');
    return;
  }
  const {start, end} = multiGroupBounds(row.entries, picks);
  const count = picks.reduce((total, {beat, slot}) => total + (slot === null ? row.entries[beat].size : 1), 0);
  const range = t('multi.range', {start: selectionPosition(row, start), end: selectionPosition(row, end - 1), count});
  const instruction = clip ? t('multi.pasteHint') : meterMenu ? t('multi.chooseMeter') : '';
  el.selectionSummary.textContent = instruction ? instruction + ' · ' + range : range;
}

function backToMultiPicks() {
  delete multiGroups.clip;
  delete multiGroups.action;
  delete multiGroups.meterMenu;
  paintMultiGroups();
}

function clearPastePreview() {
  el.score.querySelectorAll('.paste-preview, .paste-anchor').forEach(slot =>
    slot.classList.remove('paste-preview', 'paste-anchor'));
}

function previewMultiPaste(track, beat, slot, clip) {
  clearPastePreview();
  const row = rows.get(track.id);
  const {ticks} = trackTiming(doc, track);
  const first = row.entries[beat].start + slot;
  const end = ticks[first] + clip.length;
  let last = first;
  for (let i = first; i < row.allSlots.length && ticks[i] < end; i++) {
    row.allSlots[i].classList.add('paste-preview');
    last = i;
  }
  row.allSlots[first].classList.add('paste-anchor');
  const template = row.grid.measures.at(-1);
  const measureLength = groupTicks(template.meter) * template.beats.length;
  const extra = Math.max(0, Math.ceil((end - ticks.at(-1)) / measureLength));
  const range = t('multi.targetRange', {start: selectionPosition(row, first), end: selectionPosition(row, last)});
  el.multiConfirmRange.textContent = extra ? range + ' ' + t('multi.addedBars', {count: extra}) : range;
}

function resetMultiGroups(trackId) {
  multiGroups = {trackId, picks: []};
}

function startMultiGroups(track) {
  clearScoreSelection();
  resetMultiGroups(track.id);
  paintMultiGroups();
  notify(t('multi.pickHint'));
}

function finishMultiGroups() {
  const {trackId} = multiGroups;
  multiGroups = undefined;
  if (cursor.track !== trackId) {
    cursor = {track: trackId, beat: editableBeat(rows.get(trackId).grid, 0), slot: 0};
  }
  keysOpen = true;
  paintMultiGroups();
  updateKeyboard();
  markSelection();
}

function openMultiGroupBoundary(track, bar, anchor) {
  popup(anchor, [
    [t('multi.rangeStart'), () => {
      multiGroups.picks = [];
      multiGroups.rangeStart = bar;
      paintMultiGroups();
    }],
    [t('multi.rangeEnd'), () => {
      const {rangeStart} = multiGroups;
      const {grid, entries} = rows.get(track.id);
      const start = grid.barBeats[Math.min(rangeStart, bar)];
      const end = grid.barBeats[Math.max(rangeStart, bar)];
      multiGroups.picks = [];
      for (let beat = start; beat < end; beat++) {
        if (entries[beat].size) multiGroups.picks.push({beat, slot: null});
      }
      delete multiGroups.rangeStart;
      paintMultiGroups();
    }, multiGroups.rangeStart === undefined || multiGroups.rangeStart === bar]
  ]);
}

function useMultiGroup(track, beat, slot) {
  const {picks, clip, action} = multiGroups;
  if (clip) {
    const mode = multiGroups;
    previewMultiPaste(track, beat, slot, clip);
    el.multiConfirmTitle.textContent = t(action === 'cut' ? 'multi.confirmCut' : 'multi.confirmCopy');
    el.confirmMultiPaste.onclick = () => {
      if (!el.multiPastePanel.open || multiGroups !== mode) return;
      clearPastePreview();
      el.multiPastePanel.close();
      change(() => {
        if (action === 'cut') {
          track.cells.fill(null, clip.start, clip.end);
          track.hands?.fill(null, clip.start, clip.end);
        }
        cursor = {track: track.id, ...pasteTrackSpan(doc, track, beat, slot, clip)};
        resetMultiGroups(track.id);
      }, true);
      notify(t('multi.pasted', {count: clip.cells.length}));
    };
    el.multiPastePanel.showModal();
    return;
  }
  const size = rows.get(track.id).entries[beat].size;
  const groupPicks = picks.filter(item => item.beat === beat);
  const wholeGroup = groupPicks.some(item => item.slot === null);
  const cells = new Set(wholeGroup
    ? Array.from({length: size}, (_, index) => index)
    : groupPicks.map(item => item.slot));
  if (slot === null) {
    if (cells.size === size) cells.clear();
    else for (let index = 0; index < size; index++) cells.add(index);
  } else if (!cells.delete(slot)) {
    cells.add(slot);
  }
  multiGroups.picks = picks.filter(item => item.beat !== beat);
  if (cells.size === size) multiGroups.picks.push({beat, slot: null});
  else for (const cell of cells) multiGroups.picks.push({beat, slot: cell});
  paintMultiGroups();
}

function clearMultiPicks(track, picks) {
  const {entries} = rows.get(track.id);
  for (const {beat, slot} of picks) {
    const entry = entries[beat];
    const start = entry.start + (slot ?? 0);
    const end = start + (slot === null ? entry.size : 1);
    track.cells.fill(null, start, end);
  }
}

function editMultiGroups(track, action) {
  const {entries} = rows.get(track.id);
  const {picks} = multiGroups;
  if (!picks.length) return;
  if (action === 'clear') {
    change(() => clearMultiPicks(track, picks));
    for (const beat of new Set(picks.map(item => item.beat))) staffGlyph(entries[beat]);
    resetMultiGroups(track.id);
    paintMultiGroups();
    notify(t('multi.cleared'));
    return;
  }
  multiGroups.action = action;
  delete multiGroups.meterMenu;
  const {start, end} = multiGroupBounds(entries, picks);
  multiGroups.clip = copyTrackSpan(doc, track, start, end);
  paintMultiGroups();
  notify(t('multi.pasteHint'));
}

function multiGroupBounds(entries, picks) {
  let start = Infinity;
  let end = 0;
  for (const {beat, slot} of picks) {
    const entry = entries[beat];
    start = Math.min(start, entry.start + (slot ?? 0));
    end = Math.max(end, entry.start + (slot === null ? entry.size : slot + 1));
  }
  return {start, end};
}

function openMultiGroupMeter(track) {
  const {start, end} = multiGroupBounds(rows.get(track.id).entries, multiGroups.picks);
  multiGroups.meterMenu = true;
  el.selectionMeters.replaceChildren(...Object.keys(TIME_SIGNATURES).map(meter => {
    const choice = button(meter, () => {
      change(() => {
        cursor = {track: track.id, ...changeTrackSpanMeter(doc, track, start, end, meter)};
        resetMultiGroups(track.id);
      }, true);
      notify(t('multi.meterChanged', {meter}));
    });
    choice.setAttribute('aria-label', t('multi.applyMeter', {meter}));
    return choice;
  }));
  paintMultiGroups();
}

// 1.60: copy a track with everything in it (notes included) into a new track directly below.
function duplicateTrackWithContent(source) {
  const track = doc.tracks.find(item => item.id === source.id);
  if (!track) return;
  if (doc.tracks.length >= TRACK_LIMIT) { notify(t('track.duplicateLimit')); return; }
  const extra = Object.values(track.samples).reduce((size, sample) => size + sampleBytes(sample), 0);
  if (projectSampleBytes(doc) + extra > SAMPLE_BUDGET) { notify(t('track.duplicateBudget')); return; }
  const position = track.id === cursor.track ? {beat: cursor.beat, slot: cursor.slot} : {beat: 0, slot: 0};
  let copy;
  change(() => {
    copy = duplicateTrack(doc, track, duplicateTrackName(track.name));
    cursor = {track: copy.id, ...position};
  }, true);
  revealSlot(scoreIndex(), copy.id);
  notify(t('track.duplicated', {track: track.name, copy: copy.name}));
}

function duplicateTrackName(name) {
  const suffix = t('track.copySuffix');
  const taken = new Set(doc.tracks.map(track => track.name));
  for (let number = 1; ; number++) {
    const ending = suffix + (number > 1 ? ' ' + number : '');
    const candidate = (name.slice(0, Math.max(0, 28 - ending.length)).trimEnd() + ending).trim();
    if (!taken.has(candidate)) return candidate;
  }
}

function openTrackMenu(track, anchor) {
  if (multiGroups?.trackId === track.id) {
    const {picks, clip} = multiGroups;
    popup(anchor, [
      ...(!clip ? [
        [t('multi.copy'), () => editMultiGroups(track, 'copy'), !picks.length],
        [t('multi.cut'), () => editMultiGroups(track, 'cut'), !picks.length],
        [t('multi.meter'), () => openMultiGroupMeter(track), !picks.length],
        [t('multi.clear'), () => editMultiGroups(track, 'clear'), !picks.length]
      ] : []),
      [t('multi.cancel'), finishMultiGroups]
    ]);
    return;
  }
  const bar = track.id === cursor.track ? currentBar() : 0;
  const range = track.loops.find(loop => loop.from <= bar && bar < loop.to);
  const blocks = trackBlocks(doc);
  const index = blocks.findIndex(block => block.includes(track));
  function move(direction) {
    const next = index + direction;
    change(() => {
      [blocks[index], blocks[next]] = [blocks[next], blocks[index]];
      doc.tracks = blocks.flat();
    }, true);
  }
  popup(anchor, [
    [t('multi.start'), () => startMultiGroups(track)],
    [t('track.moveUp'), () => move(-1), index <= 0],
    [t('track.moveDown'), () => move(1), index >= blocks.length - 1],
    [t('track.duplicate'), () => duplicateTrackWithContent(track), doc.tracks.length >= TRACK_LIMIT],
    [range ? t('track.loopOff') : t('track.loopOn'), () => {
      if (range) removeTrackLoop(track, range);
      else addTrackLoop(track, bar, bar + 1);
    }],
    [t('bulk.track'), () => openBulkSplit(anchor, [track])],
    [t('tempo.track'), () => openTempoEditor(track)],
    [t('track.edit'), () => openTrackEditor(track)],
    [t('track.sample'), () => openSamplePanel(track)],
    [t('track.clearBreaks'), () => { change(() => setTrackLineBreaks(doc, track, [])); renderScore(); }, !trackLineBreaks(doc, track).length],
    [track.mute ? t('track.unmute') : t('track.mute'), () => { change(() => { track.mute = !track.mute; }); refreshMix(); }],
    [t('track.mix'), showMixer],
    [t('track.clearNotes'), () => confirmClearTrackNotes(track), !track.cells.some(Boolean)],
    [t('track.remove'), () => {
      trackToRemove = track;
      el.removeTrackMessage.textContent = t('track.confirmRemove', {track: track.name});
      el.removeTrackPanel.showModal();
    }, doc.tracks.length < 2]
  ]);
}

function openTrackBoundary(track, bar, anchor, side = '') {
  const {grid} = rows.get(track.id);
  const measure = grid.measures[bar];
  if (multiGroups?.trackId === track.id) {
    if (!multiGroups.clip && !multiGroups.meterMenu) {
      openMultiGroupBoundary(track, bar, anchor);
    }
    return;
  }
  const start = loopStart?.id === track.id ? loopStart.bar : null;
  const outgoing = track.loops.find(range => range.from === bar);
  const incoming = track.loops.find(range => range.to === bar);
  const bars = trackBars(doc, track);
  const broken = trackLineBreaks(doc, track).includes(bar);
  const copyingFrom = measureCopyStart?.track === track ? measureCopyStart.bar : null;
  const copyable = measure && side !== 'end';
  const copyEnd = copyBoundaryEnd(copyingFrom, bar, side, bars);
  popup(anchor, [
    ...(copyable ? [
      [t('bar.clearMeasure'), () => clearTrackMeasure(track, bar), !measureHasStrokes(track, grid, bar)],
      [t('bar.copyMeasure'), () => copyMeasures(track, bar, bar + 1)],
      [t('bar.copyStart'), () => {
        measureCopyStart = {track, bar};
        renderScore();
        notify(t('bar.copyPickEnd'));
      }],

    ] : []),
    ...(copyEnd !== null ? [[t('bar.copyThrough'), () => copyMeasures(track, copyingFrom, copyEnd)]] : []),
    ...(copyable ? [[t('bulk.measure'), () => openBulkSplit(anchor, [track], bar, bar + 1)], [t('tempo.measure'), () => openTempoEditor(track, bar)]] : []),
    ...(incoming ? [[t('loop.editEnd'), () => { loopStart = {id: track.id, bar: incoming.from}; notify(t('bar.pickEnd')); }]] : []),
    [t('bar.insert'), () => insertTrackMeasureAt(track, bar, side)],
    [broken ? t('bar.unbreak') : t('bar.break'), () => toggleTrackBreakAt(track, bar), bar <= 0 || bar >= bars],
    [t('bar.delete', {bar: bar + 1}), () => deleteTrackMeasure(track, bar), !measure || bars < 2],
    [t('bar.loopStart'), () => {
      loopStart = {id: track.id, bar};
      renderScore();
      notify(t('bar.pickEnd'));
    }, !measure || track.loops.some(range => range.from <= bar && bar < range.to)],
    [t('bar.loopEnd'), () => addTrackLoop(track, start, bar), start === null || bar <= start],
    [t('bar.loopCancel'), cancelLoopStart, start === null],
    [t('bar.removeIncoming'), () => removeTrackLoop(track, incoming), !incoming],
    [t('bar.removeOutgoing'), () => removeTrackLoop(track, outgoing), !outgoing],
    ...(measure ? Object.keys(TIME_SIGNATURES).map(meter => [
      (meter === measure.meter && !measure.groupMeters ? '✓ ' : '') + t('bar.meter', {meter}),
      () => setTrackMeasureMeter(track, bar, meter), meter === measure.meter && !measure.groupMeters
    ]) : [])
  ]);
}

function confirmClearTrackNotes(track) {
  const panel = el.clearTrackNotesPanel;
  el.clearTrackNotesMessage.textContent = t('track.confirmClearNotes', {track: track.name});
  el.confirmClearTrackNotes.onclick = () => {
    if (!panel.open) return;
    panel.close();
    const row = rows.get(track.id);
    if (row?.entries[0]?.track !== track || !track.cells.some(Boolean)) return;
    change(() => { track.cells.fill(null); });
    row.entries.forEach(staffGlyph);
    notify(t('track.notesCleared', {track: track.name}));
  };
  panel.showModal();
}

function clearTrackMeasure(track, bar) {
  const {grid, entries} = rows.get(track.id);
  if (!measureHasStrokes(track, grid, bar)) return;
  change(() => { track.cells.fill(null, grid.barSteps[bar], grid.barSteps[bar + 1]); });
  entries.slice(grid.barBeats[bar], grid.barBeats[bar + 1]).forEach(staffGlyph);
  notify(t('bar.clearedMeasure', {track: track.name, bar: bar + 1}));
}

function insertTrackMeasureAt(track, bar, side = '') {
  change(() => {
    insertTrackBarAt(doc, track, bar, side === 'start');
    cursor = {track: track.id, beat: trackGrid(doc, track).barBeats[bar], slot: 0};
  }, true);
  revealSlot(scoreIndex(), track.id);
  notify(t('bar.inserted', {track: track.name, bar: bar + 1}));
}

function deleteTrackMeasure(track, bar) {
  const grid = trackGrid(doc, track);
  if (grid.measures.length < 2 || bar >= grid.measures.length) return;
  const remove = () => {
    change(() => {
      deleteTrackBar(doc, track, bar);
      const next = trackGrid(doc, track);
      cursor = {track: track.id, beat: next.barBeats[Math.min(bar, next.measures.length - 1)], slot: 0};
    }, true);
    revealSlot(scoreIndex(), track.id);
  };
  if (measureHasNotes(track, grid, bar)) {
    confirmMeasureDeletion(t('bar.confirmDeleteTrack', {track: track.name, bar: bar + 1}), remove);
  } else remove();
}

function toggleTrackBreakAt(track, bar) {
  const adding = !trackLineBreaks(doc, track).includes(bar);
  // Display only: no playback restart, the playhead is repainted on the new layout.
  change(() => toggleTrackLineBreak(doc, track, bar));
  renderScore();
  notify(t(adding ? 'bar.breakOn' : 'bar.breakOff', {track: track.name, bar: bar + 1}));
}

function cancelLoopStart() {
  loopStart = null;
  renderScore();
}

function addTrackLoop(track, from, to) {
  if (!loopEndpointAllowed(track, from, to, trackBars(doc, track))) {
    warnBeforeChangingNotes('loop.nextLimit');
    return;
  }
  change(() => {
    const existing = track.loops.find(range => range.from === from);
    if (existing) existing.to = to;
    else track.loops.push({from, to});
    track.loops.sort((a, b) => a.from - b.from);
  }, true);
  loopStart = {id: track.id, bar: from};
}

function removeTrackLoop(track, range) {
  change(() => { track.loops = track.loops.filter(item => item !== range); }, true);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function downloadScore() {
  const name = safeFileName(doc.title) + '.rhythm.json';
  const blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], {type: 'application/json'});
  try {
    const saved = await saveScoreExport(blob, name);
    if (saved) notify(t('msg.download', {name: saved}));
  } catch (error) {
    if (error.name !== 'AbortError') notify(t('scoreExport.failed'));
  }
}

async function shareScore(project) {
  const portable = structuredClone(project);
  portable.tracks.forEach((track, index) => {
    if (!track.preset) return;
    const source = project.tracks[index];
    track.samples = Object.fromEntries(TYPES[track.type].strokes.filter(stroke => stroke.length === 1)
      .map(stroke => [stroke, customStrokeSample(source, stroke)]).filter(([, sample]) => sample));
    delete track.preset;
  });
  const tooLarge = projectSampleBytes(portable) > SAMPLE_BUDGET;
  if (tooLarge && !confirm(t('share.sampleLimit'))) return;
  if (tooLarge) portable.tracks.forEach((track, index) => {
    if (project.tracks[index].preset) track.samples = {};
  });
  const shared = portable;
  const name = safeFileName(shared.title) + '.rhythm.json';
  const file = new File([JSON.stringify(shared)], name, {type: 'application/json'});
  if (navigator.canShare?.({files: [file]})) {
    try {
      await navigator.share({files: [file]});
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  download(file, name);
  notify(t('share.fileReady'));
}

function openScoreExport() {
  if (scoreExportBusy) return;
  scoreExportFile = undefined;
  el.scoreExportStatus.textContent = '';
  el.scoreExportConfirm.textContent = t('scoreExport.prepare');
  el.scoreSaveHint.textContent = t(globalThis.showDirectoryPicker ? 'save.folderHint' : 'save.systemHint');
  el.scoreExportPanel.showModal();
}

function saveScore() {
  if (!activeId) return;
  if (putDocument({id: activeId, updated: Date.now(), saved: structuredClone(doc), draft: null})) {
    notify(t('msg.saved', {title: doc.title}));
  } else {
    downloadScore();
    notify(t('msg.saveFailed'));
  }
}

// 0.18: long press (mouse or touch, 500 ms) or right-click on a rhythm card shows 复制 / 删除.
const LONG_PRESS_MS = 500;
let cardPress = null;
let suppressCardClick = null;

function cancelCardPress() {
  if (cardPress) clearTimeout(cardPress.timer);
  cardPress = null;
}

function bindCardMenu(card, id) {
  card.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    cancelCardPress();
    suppressCardClick = null;
    cardPress = {card, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      timer: setTimeout(() => {
        cardPress = null;
        suppressCardClick = card;
        openCardMenu(card, id);
      }, LONG_PRESS_MS)};
  });
  card.addEventListener('pointermove', event => {
    if (cardPress?.card === card && Math.hypot(event.clientX - cardPress.x, event.clientY - cardPress.y) > 8) cancelCardPress();
  });
  for (const name of ['pointerup', 'pointerleave', 'pointercancel']) {
    card.addEventListener(name, () => { if (cardPress?.card === card) cancelCardPress(); });
  }
  card.addEventListener('contextmenu', event => {
    event.preventDefault();
    cancelCardPress();
    // A touch long press also fires contextmenu; the menu is then already open.
    if (!el.menu.hidden && card.classList.contains('menu-open')) return;
    suppressCardClick = card;
    openCardMenu(card, id);
  });
}

function openCardMenu(card, id) {
  if (!documents.has(id)) return;
  const item = documents.get(id);
  popup(card, [
    [t('card.rename'), () => openRenameDocument(id)],
    [t('share.menu'), () => shareScore(item.saved ?? item.draft)],
    [t('card.copy'), () => copyDocument(id)], [t('card.delete'), () => deleteDocument(id)]
  ]);
  card.classList.add('menu-open');
}

let renamingDocumentId = null;
function openRenameDocument(id) {
  const item = documents.get(id);
  if (!item) return;
  renamingDocumentId = id;
  el.renameRhythmName.value = (item.draft ?? item.saved).title;
  el.renameRhythmConfirm.disabled = false;
  el.renameRhythmPanel.showModal();
  el.renameRhythmName.focus();
  el.renameRhythmName.select();
}
function renameDocument(id, value) {
  const title = shortText(value.trim(), 64);
  const item = documents.get(id);
  if (!item || !title) return false;
  const updated = structuredClone(item);
  for (const key of ['saved', 'draft']) if (updated[key]) updated[key].title = title;
  updated.updated = Date.now();
  const stored = putDocument(updated);
  if (activeId === id) {
    doc.title = title;
    for (const snapshot of [...undoStack, ...redoStack]) if (snapshot && typeof snapshot === 'object') snapshot.title = title;
  }
  renderBrowser();
  notify(t(stored ? 'card.renamed' : 'card.renamedSession'));
  return true;
}
el.renameRhythmName.addEventListener('input', () => { el.renameRhythmConfirm.disabled = !el.renameRhythmName.value.trim(); });
el.renameRhythmForm.addEventListener('submit', event => {
  event.preventDefault();
  if (renameDocument(renamingDocumentId, el.renameRhythmName.value)) el.renameRhythmPanel.close();
});

function copyDocument(id) {
  const item = documents.get(id);
  if (!item) return;
  const base = shortText((item.draft ?? item.saved).title + t('card.copySuffix'), 64);
  const titles = new Set([...documents.values()].map(entry => (entry.draft ?? entry.saved).title));
  let title = base;
  for (let number = 2; titles.has(title); number++) title = shortText(base, 60) + ' ' + number;
  const copy = project => {
    if (!project) return null;
    const clone = structuredClone(project);
    clone.title = title;
    return clone;
  };
  const random = crypto.getRandomValues(new Uint32Array(2));
  const newId = Date.now().toString(36) + '-' + random[0].toString(36) + '-' + random[1].toString(36);
  const stored = putDocument({id: newId, updated: Date.now(), saved: copy(item.saved), draft: copy(item.draft)});
  renderBrowser();
  notify(t(stored ? 'card.copied' : 'card.copiedSession', {title}));
}

function deleteDocument(id) {
  const item = documents.get(id);
  if (!item) return;
  const title = (item.draft ?? item.saved).title;
  if (!confirm(t('card.confirmDelete', {title}))) return;
  documents.delete(id);
  memoryOnly.delete(id);
  try { localStorage.removeItem(DOCUMENT_PREFIX + id); } catch { /* Storage blocked: the entry only lived in memory. */ }
  if (activeId === id) {
    // The deleted rhythm was the last one opened: drop it so no later draft write brings it back.
    activeId = null;
    undoStack.length = redoStack.length = 0;
  }
  renderBrowser();
  notify(t('card.deleted', {title}));
}

function renderBrowser() {
  const term = el.rhythmSearch.value.trim().toLowerCase();
  const cards = [...documents.values()].filter(item => (item.draft ?? item.saved).title.toLowerCase().includes(term));
  cards.sort((a, b) => sortByName
    ? (a.draft ?? a.saved).title.localeCompare((b.draft ?? b.saved).title, 'zh-CN')
    : b.updated - a.updated);
  const nodes = cards.map(item => {
    const title = (item.draft ?? item.saved).title;
    const card = button('', () => {
      // 0.18: the click that ends a long press only closes the press, it does not open the rhythm.
      if (suppressCardClick === card) { suppressCardClick = null; return; }
      openDocument(item.id);
    }, 'rhythm-card');
    bindCardMenu(card, item.id);
    const icon = document.createElement('span');
    icon.className = 'rhythm-thumbnail';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '♫';
    const name = document.createElement('span');
    name.className = 'rhythm-card-name';
    name.textContent = title;
    const meta = document.createElement('span');
    meta.className = 'rhythm-card-meta';
    meta.textContent = memoryOnly.has(item.id) ? t('browse.session') : item.draft ? t('browse.draft')
      : new Date(item.updated).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB');
    card.append(icon, name, meta);
    return card;
  });
  el.rhythmGrid.replaceChildren(el.createDocument, ...nodes);
  el.rhythmSearchEmpty.hidden = !term || nodes.length > 0;
}

function showBrowser() {
  multiGroups = undefined;
  loopStart = null;
  const sessionOnly = memoryOnly.has(activeId);
  stopPlayback();
  closePopups();
  browsing = true;
  el.editorNav.hidden = el.scoreViewport.hidden = el.editorTransport.hidden = el.keyboard.hidden = true;
  refreshSelectionBar();
  el.rhythmBrowser.hidden = false;
  document.title = t('doc.browse');
  renderBrowser();
  if (sessionOnly) notify(t('browse.sessionOnly'));
}

function openDocument(id) {
  const item = documents.get(id);
  if (!item) return;
  multiGroups = undefined;
  loopStart = null;
  stopPlayback();
  closePopups();
  activeId = id;
  designatedFollowTrack = null;
  doc = structuredClone(item.draft ?? item.saved);
  cursor = { track: doc.tracks[0].id, beat: 0, slot: 0 };
  keysOpen = false;
  undoStack.length = redoStack.length = 0;
  browsing = false;
  el.rhythmBrowser.hidden = true;
  el.editorNav.hidden = el.scoreViewport.hidden = el.editorTransport.hidden = false;
  if (zoomFrame) cancelAnimationFrame(zoomFrame);
  zoomFrame = 0; queuedScoreZoom = null;
  applyScoreZoom(DEFAULT_SCORE_ZOOM);
  el.paper.scrollTo(0, 0);
  render();
}

function openNewScore(project, message) {
  const random = crypto.getRandomValues(new Uint32Array(2));
  const id = Date.now().toString(36) + '-' + random[0].toString(36) + '-' + random[1].toString(36);
  putDocument({id, updated: Date.now(), saved: null, draft: project});
  openDocument(id);
  notify(message);
}

function openNewRhythm() {
  el.newRhythmName.value = '';
  el.createRhythm.disabled = true;
  el.newRhythmPanel.showModal();
}

function selectFormat(node) {
  exportFormat = node.dataset.format;
  document.querySelectorAll('[data-format]').forEach(choice => choice.setAttribute('aria-pressed', choice === node));
}

function openExport() {
  el.exportName.value = doc.title;
  paintDuration();
  el.exportPanel.showModal();
}

function setRepeat(side) {
  const bar = currentBar();
  const current = doc.repeat ?? {from: 0, to: scoreBars(doc)};
  const range = side === 'from' ? {from: bar, to: Math.max(current.to, bar + 1)}
    : {from: Math.min(current.from, bar), to: bar + 1};
  change(() => { doc.repeat = range; }, true);
}

// 0.19 language switch: re-labels everything in place. The score, unsaved edits, undo history
// and playback are untouched; only text is redrawn.
function typeName(type) {
  return type === 'bell' ? t('type.bell') : TYPES[type].name;
}

function fillTrackTypes() {
  const value = el.trackType.value;
  el.trackType.replaceChildren(...Object.keys(TYPES).map(key => new Option(typeName(key), key)));
  if (value) el.trackType.value = value;
}

function applyLanguage() {
  applyStaticText();
  meterButtons.forEach(node => {
    node.title = t('meter.title', {meter: node.dataset.meter});
    node.setAttribute('aria-label', t('meter.aria', {meter: node.dataset.meter}));
  });
  fillTrackTypes();
  keyboardType = '';
  refreshControls();
  syncTempo();
  if (browsing) {
    document.title = t('doc.browse');
    renderBrowser();
  } else {
    render();
  }
  // Closed panels are rebuilt when they open; drop their old-language contents now.
  if (!keysOpen) el.keys.replaceChildren();
  if (el.mixerPanel.open) drawMixer(); else el.mixRows.replaceChildren();
  if (el.swingPanel.open) drawFeel(); else el.ratios.replaceChildren();
  if (!el.samplePanel.open) {
    el.sampleStroke.replaceChildren();
    el.sampleCurrent.textContent = el.sampleMessage.textContent = '';
  }
  if (el.samplePanel.open && sampleTrack) {
    fillSampleOptions(el.sampleInstrument.value, el.sampleSlot.value, el.sampleStroke.value);
    paintSamplePanel();
  }
}

function switchLanguage() {
  lang = lang === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* The choice then lasts for this session only. */ }
  closePopups();
  applyLanguage();
  notify(t('lang.switched'));
}

el.langBrowser.addEventListener('click', switchLanguage);
el.files.addEventListener('click', showBrowser);
el.createDocument.addEventListener('click', openNewRhythm);
el.browserNew.addEventListener('click', openNewRhythm);
el.rhythmSearch.addEventListener('input', renderBrowser);
function showGuideLanguage(language) {
  const english = language === 'en';
  el.guideChinese.hidden = english;
  el.guideEnglish.hidden = !english;
  el.guideTitle.textContent = I18N[language]['help.guide'];
  el.guideLanguage.textContent = english ? '中文' : 'English';
  el.guideLanguage.lang = english ? 'zh-CN' : 'en';
  el.guidePanel.querySelector('[data-close="guidePanel"]').textContent = I18N[language]['dialog.done'];
  el.guidePanel.querySelector('.guide-body').scrollTop = 0;
}

el.guideLanguage.addEventListener('click', () =>
  showGuideLanguage(el.guideEnglish.hidden ? 'en' : 'zh'));

el.browserMore.addEventListener('click', () => popup(el.browserMore, [
  [t('browse.import'), () => el.file.click()],
  [t('browse.demo'), () => openNewScore(demoProject(), t('browse.demoLoaded'))],
  [(!sortByName ? '✓ ' : '') + t('browse.sortRecent'), () => { sortByName = false; renderBrowser(); }],
  [(sortByName ? '✓ ' : '') + t('browse.sortName'), () => { sortByName = true; renderBrowser(); }],
  [t('help.guide'), () => { el.guidePanel.showModal(); showGuideLanguage(lang); }],
  [t('help.about'), () => el.aboutPanel.showModal()]
]));
el.newRhythmName.addEventListener('input', () => {
  el.createRhythm.disabled = !shortText(el.newRhythmName.value, 64);
});
el.newRhythmForm.addEventListener('submit', event => {
  event.preventDefault();
  const title = shortText(el.newRhythmName.value, 64);
  if (!title) return;
  const project = makeProject(4, 1, '4/4');
  project.title = title;
  el.newRhythmPanel.close();
  openNewScore(project, t('msg.created', {title}));
});
meterButtons.forEach(button => button.addEventListener('click', () => chooseMeter(button.dataset.meter)));
el.meterLabel.addEventListener('click', () => el.clearScorePanel.showModal());
el.confirmClearScore.addEventListener('click', () => {
  el.clearScorePanel.close();
  clearScoreNotes();
});
el.addTrack.addEventListener('click', () => openAddTrackMenu(el.addTrack));
el.more.addEventListener('click', () => popup(el.more, [
  [t('more.save'), saveScore],
  [t('more.scoreExport'), openScoreExport], [t('more.export'), openExport],
  [t('share.menu'), () => shareScore(doc)], [t('more.download'), downloadScore],
  [t('more.addInstrument'), () => openAddTrackMenu(el.more, false, false), doc.tracks.length >= TRACK_LIMIT],
  [t('bulk.score'), () => openBulkSplit(el.more, doc.tracks)],
  [t('more.addMeasure'), () => editBar('add')],
  [t('more.duplicateMeasure'), () => editBar('copy')],
  [t('more.removeMeasure'), () => editBar('delete'), scoreBars(doc) < 2],
  [t('more.clearBreaks'), () => {
    change(() => { for (const track of doc.tracks) setTrackLineBreaks(doc, track, []); });
    renderScore();
  }, !doc.tracks.some(track => trackLineBreaks(doc, track).length)],
  [(loopMode === 'once' ? '✓ ' : '') + t('more.playOnce'), () => { loopMode = 'once'; stopPlayback(); }],
  [(loopMode === 'score' ? '✓ ' : '') + t('more.loopScore'), () => { loopMode = 'score'; stopPlayback(); }],
  [t('more.beats3'), () => applyBeatSizes(doc.beats.map(() => 3), 3)],
  [t('more.beats4'), () => applyBeatSizes(doc.beats.map(() => 4), 4)],
  [(follow ? '✓ ' : '') + t('more.follow'), toggleFollowPlayback],
  [t('more.zoomIn'), () => zoomScoreAtCenter(requestedScoreZoom() * 1.5), scoreZoom >= MAX_SCORE_ZOOM],
  [t('more.zoomOut'), () => zoomScoreAtCenter(requestedScoreZoom() / 1.5), scoreZoom <= MIN_SCORE_ZOOM],
  [t('more.resetZoom'), () => zoomScoreAtCenter(DEFAULT_SCORE_ZOOM), scoreZoom === DEFAULT_SCORE_ZOOM],
  [(audition ? '✓ ' : '') + t('more.audition'), () => { audition = !audition; }],
  [t('more.followDiagnostics'), exportFollowDiagnostics],
  [t('lang.menu'), switchLanguage]
]));
el.file.addEventListener('change', async () => {
  const file = el.file.files[0];
  el.file.value = '';
  if (!file) return;
  try {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { throw new Error(t('msg.fileNotJson')); }
    const project = readProject(data);
    openNewScore(project, t('msg.opened', {title: project.title}));
  } catch (error) { notify(error.message); }
});
el.info.addEventListener('click', openInfo);
el.infoPanel.querySelector('form').addEventListener('submit', () => {
  change(() => {
    doc.title = shortText(el.infoTitle.value, 64, 'Untitled Rhythm');
    doc.region = shortText(el.infoRegion.value, 80);
    doc.ethnic = shortText(el.infoEthnic.value, 80);
    doc.notes = el.infoNotes.value.slice(0, 8000);
  });
  el.title.textContent = doc.title;
  document.title = t('doc.editor', {title: doc.title});
});
el.showKeys.addEventListener('click', () => {
  if (multiGroups) return;
  keysOpen = !keysOpen;
  updateKeyboard();
  markSelection();
  if (keysOpen) revealSlot(scoreIndex(), cursor.track);
});
el.undo.addEventListener('click', () => historyMove(undoStack, redoStack));
el.redo.addEventListener('click', () => historyMove(redoStack, undoStack));
el.play.addEventListener('click', togglePlayback);
el.stop.addEventListener('click', useSquareButton);
el.loopRepeat.addEventListener('click', event => openLoopRepeatMenu(event.currentTarget));
el.restartPlayback.addEventListener('click', () => {
  const track = selectedTrack();
  const top = el.paper.scrollTop;
  stopPlayback();
  closePopups();
  designatedFollowTrack = track.id;
  const grid = rows.get(track.id).grid;
  cursor = {track: track.id, beat: editableBeat(grid, 0), slot: 0};
  keysOpen = true;
  markSelection();
  updateKeyboard();
  el.paper.scrollTo({left: 0, top, behavior: 'instant'});
});

bindRange(el.swingBpm, value => { doc.bpm = value; syncTempo(); });
el.mixer.addEventListener('click', showMixer);
el.volTab.addEventListener('click', () => { mixKey = 'volume'; drawMixer(); });
el.panTab.addEventListener('click', () => { mixKey = 'pan'; drawMixer(); });
el.resetMix.addEventListener('click', resetMixer);
el.swing.addEventListener('click', showSwing);
el.selectionActions.addEventListener('click', event => {
  const action = event.target.closest('[data-selection-action]')?.dataset.selectionAction;
  if (!action || !multiGroups?.picks.length) return;
  const track = doc.tracks.find(item => item.id === multiGroups.trackId);
  if (action === 'meter') openMultiGroupMeter(track);
  else editMultiGroups(track, action);
});
el.selectionBack.addEventListener('click', backToMultiPicks);
el.selectionExit.addEventListener('click', finishMultiGroups);
el.multiPastePanel.addEventListener('close', () => {
  if (!el.multiPastePanel.open) clearPastePreview();
});
document.querySelectorAll('[data-feel-size]').forEach(node => node.addEventListener('click', () => { feelSize = Number(node.dataset.feelSize); drawFeel(); }));
el.copyPattern.addEventListener('click', () => {
  copiedPattern = doc.feel[feelSize].slice();
  el.pastePattern.disabled = false;
});
el.pastePattern.addEventListener('click', () => {
  if (copiedPattern?.length !== feelSize) return;
  updateSwingPlayback();
  change(() => { doc.feel[feelSize] = copiedPattern.slice(); });
  paintPattern();
});
el.copyFeel.addEventListener('click', () => { copiedFeel = structuredClone(doc.feel); el.pasteFeel.disabled = false; });
el.pasteFeel.addEventListener('click', () => {
  if (!copiedFeel) return;
  updateSwingPlayback();
  change(() => { doc.feel = structuredClone(copiedFeel); });
  drawFeel();
});
el.compoundSwing.addEventListener('change', () => {
  const enabled = el.compoundSwing.checked;
  if (enabled === (doc.feel.compoundSwing === true)) return;
  updateSwingPlayback();
  change(() => {
    if (enabled) doc.feel.compoundSwing = true;
    else delete doc.feel.compoundSwing;
  });
});
bindRange(el.strength, value => {
  if (doc.feel.strength !== value) updateSwingPlayback();
  doc.feel.strength = value;
  el.strengthValue.value = value + '%';
});
el.diagram.addEventListener('pointerdown', event => {
  const boundary = Number(event.target.dataset.boundary);
  if (!boundary) return;
  event.preventDefault();
  el.diagram.setPointerCapture(event.pointerId);
  drag = { boundary, previous: structuredClone(doc), changed: false };
});
el.diagram.addEventListener('pointermove', event => {
  if (!drag) return;
  const matrix = el.diagram.getScreenCTM();
  if (!matrix) return;
  const x = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()).x;
  const { boundary, previous } = drag;
  const original = previous.feel[feelSize];
  const start = original.slice(0, boundary - 1).reduce((sum, value) => sum + value, 0);
  const pair = original[boundary - 1] + original[boundary];
  const value = clamp(Math.round((x - 30) / 3.8 - start), 3, pair - 3);
  if (doc.feel[feelSize][boundary - 1] !== value) updateSwingPlayback();
  doc.feel[feelSize][boundary - 1] = value;
  doc.feel[feelSize][boundary] = pair - value;
  drag.changed = value !== original[boundary - 1];
  paintPattern();
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  el.diagram.addEventListener(event, () => {
    if (!drag) return;
    if (drag.changed) { record(drag.previous); persist(); }
    drag = null;
  });
}
el.guidePanel.querySelectorAll('.guide-toc a').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    el.guidePanel.querySelector(link.getAttribute('href')).scrollIntoView({block: 'start'});
  });
});
document.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => el[node.dataset.close].close()));
el.scoreExportFormat.addEventListener('change', () => {
  scoreExportFile = undefined;
  el.scoreExportStatus.textContent = '';
  el.scoreExportConfirm.textContent = t('scoreExport.prepare');
});
el.scoreExportPanel.addEventListener('close', () => { scoreExportFile = undefined; });
el.scoreExportForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (scoreExportBusy) return;
  if (scoreExportFile) {
    const {blob, name} = scoreExportFile;
    scoreExportBusy = el.scoreExportConfirm.disabled = true;
    try {
      const saved = await saveScoreExport(blob, name);
      if (saved) { el.scoreExportPanel.close(); notify(t('msg.download', {name:saved})); }
    } catch (error) { if (error.name !== 'AbortError') el.scoreExportStatus.textContent = t('scoreExport.failed'); }
    finally { scoreExportBusy = el.scoreExportConfirm.disabled = false; }
    return;
  }
  const format = el.scoreExportFormat.value;
  const title = doc.title;
  scoreExportBusy = el.scoreExportConfirm.disabled = el.scoreExportFormat.disabled = true;
  el.scoreExportStatus.textContent = t('scoreExport.rendering');
  try {
    const lines = scorePrintLines(doc, rows);
    const pages = await scoreJpegPages(title, doc.bpm, lines, () => el.scoreExportPanel.open);
    if (!pages || !el.scoreExportPanel.open) return;
    const base = safeFileName(title);
    scoreExportFile = format === 'pdf'
      ? {blob: scorePdf(pages), name: base + '.pdf'}
      : pages.length === 1
        ? {blob: pages[0], name: base + '.jpg'}
        : {blob: await scoreJpegZip(pages), name: base + '-JPG.zip'};
    if (!el.scoreExportPanel.open) { scoreExportFile = undefined; return; }
    el.scoreExportConfirm.textContent = t('scoreExport.save');
    el.scoreExportStatus.textContent = t('scoreExport.ready', {count: pages.length, name: scoreExportFile.name});
  } catch {
    if (el.scoreExportPanel.open) el.scoreExportStatus.textContent = t('scoreExport.failed');
  } finally {
    scoreExportBusy = el.scoreExportConfirm.disabled = el.scoreExportFormat.disabled = false;
  }
});
document.querySelectorAll('[data-format]').forEach(node => node.addEventListener('click', () => selectFormat(node)));
supportsM4A().then(supported => {
  if (!supported) return;
  const option = document.querySelector('[data-format="m4a"]');
  option.disabled = false;
  if (!el.exportPanel.open) selectFormat(option);
});
el.exportForm.addEventListener('submit', async event => {
  event.preventDefault();
  const duration = el.minutes.valueAsNumber * 60 + el.seconds.valueAsNumber;
  if (!Number.isInteger(duration) || !inRange(duration, 1, 1800)) {
    el.seconds.setCustomValidity(t('msg.durationInvalid'));
    el.seconds.reportValidity();
    return;
  }
  const snapshot = structuredClone(doc);
  const format = exportFormat;
  const name = safeFileName(el.exportName.value) + '.' + format;
  el.exportConfirm.disabled = true;
  el.exportPanel.close();
  notify(t('msg.rendering'));
  try {
    download(await exportBacking(snapshot, duration, format), name);
    notify(t('msg.download', {name}));
  } catch { notify(format === 'm4a' ? t('msg.aacFailed') : t('msg.exportFailed')); }
  finally { el.exportConfirm.disabled = false; }
});
function paintDuration() {
  for (const node of document.querySelectorAll('[data-time]')) {
    const input = el[node.dataset.time];
    const value = (input.valueAsNumber || 0) + Number(node.dataset.delta);
    node.disabled = value < Number(input.min) || value > Number(input.max);
    node.textContent = node.disabled ? '·' : value;
  }
}

function stepDuration(input, delta) {
  input.value = clamp((input.valueAsNumber || 0) + delta, Number(input.min), Number(input.max));
  el.seconds.setCustomValidity('');
  paintDuration();
}

document.querySelectorAll('[data-time]').forEach(node => {
  node.addEventListener('click', () => stepDuration(el[node.dataset.time], Number(node.dataset.delta)));
});
document.querySelectorAll('[data-wheel]').forEach(node => {
  node.addEventListener('wheel', event => {
    if (!event.deltaY) return;
    event.preventDefault();
    stepDuration(el[node.dataset.wheel], Math.sign(event.deltaY));
  }, {passive: false});
});
for (const input of [el.minutes, el.seconds]) input.addEventListener('input', () => {
  el.seconds.setCustomValidity('');
  paintDuration();
});
fillTrackTypes();
el.samplePanel.addEventListener('close', () => { sampleTrack = null; });
el.samplePanel.addEventListener('cancel', event => { if (sampleBusy) event.preventDefault(); });
el.sampleInstrument.addEventListener('change', () => {
  fillSampleOptions(el.sampleInstrument.value, el.sampleSlot.value);
  el.sampleMessage.textContent = '';
  paintSamplePanel();
});
for (const select of [el.sampleSlot, el.sampleStroke]) select.addEventListener('change', () => {
  el.sampleMessage.textContent = '';
  paintSamplePanel();
});
el.sampleImport.addEventListener('click', () => el.sampleFile.click());
async function updateSample(sample, destination, track) {
  const {type, slot, stroke, sample: previous} = destination;
  if (slot === 'track') {
    if (projectSampleBytes(doc) - sampleBytes(previous) + sampleBytes(sample) > SAMPLE_BUDGET) {
      throw new Error(t('sample.budget'));
    }
    change(() => { if (sample) track.samples[stroke] = sample; else delete track.samples[stroke]; });
  } else {
    await writePresetSample(type, slot, stroke, sample);
  }
  refreshPresetLabels();
  if (sampleTrack === track && el.samplePanel.open) {
    fillSampleOptions(type, slot, stroke);
    el.sampleMessage.textContent = sample ? t('sample.replaced', {stroke: noteLabel(stroke, type)}) : t('sample.restored');
  }
}

async function editSample(operation) {
  if (sampleBusy || !sampleTrack) return;
  const track = sampleTrack;
  const destination = sampleDestination();
  sampleBusy = true;
  el.samplePanel.querySelector('[data-close]').disabled = true;
  paintSamplePanel();
  try { await operation(destination, track); }
  catch (error) {
    if (sampleTrack === track) el.sampleMessage.textContent = error?.message || t('sample.storage');
  } finally {
    sampleBusy = false;
    el.samplePanel.querySelector('[data-close]').disabled = false;
    if (sampleTrack) paintSamplePanel();
  }
}

el.sampleFile.addEventListener('change', async () => {
  const file = el.sampleFile.files[0];
  el.sampleFile.value = '';
  if (!file) return;
  await editSample(async (destination, track) => {
    if (file.size > FILE_LIMIT) throw new Error(t('sample.tooBig'));
    const sample = parseSampleWav(await file.arrayBuffer(), file.name);
    if (sampleTrack === track && el.samplePanel.open) await updateSample(sample, destination, track);
  });
});
el.samplePreview.addEventListener('click', () => {
  const {type, stroke, sample} = sampleDestination();
  engine.preview({type, volume: sampleTrack.volume, pan: sampleTrack.pan, mute: sampleTrack.mute, solo: sampleTrack.solo, bellFor: type === sampleTrack.type ? sampleTrack.bellFor : null,
    samples: sample ? {[stroke]: sample} : {}}, stroke, doc).catch(() => {
    if (el.samplePanel.open) el.sampleMessage.textContent = t('msg.previewError');
  });
});
el.sampleReset.addEventListener('click', () => editSample((destination, track) => updateSample(null, destination, track)));
el.sampleApply.addEventListener('click', () => {
  const {slot} = sampleDestination();
  applyTrackPreset(sampleTrack, slot === 'track' ? 0 : slot);
  el.samplePanel.close();
});
el.confirmRemoveTrack.addEventListener('click', () => {
  const track = trackToRemove;
  el.removeTrackPanel.close();
  if (doc.tracks.length < 2 || !doc.tracks.includes(track)) return;
  change(() => {
    detachTrackPair(doc, track);
    doc.tracks = doc.tracks.filter(item => item !== track);
    if (doc.repeat) {
      const to = Math.min(doc.repeat.to, scoreBars(doc));
      doc.repeat = doc.repeat.from < to ? {...doc.repeat, to} : null;
    }
  }, true);
});
el.removeTrackPanel.addEventListener('close', () => { trackToRemove = null; });
el.trackPanel.querySelector('form').addEventListener('submit', event => {
  event.preventDefault();
  const track = doc.tracks.find(item => item.id === trackBeingEdited);
  if (!track) { el.trackPanel.close(); return; }
  const type = el.trackType.value;
  const name = shortText(el.trackName.value, 28, TYPES[type].name);
  const detail = shortText(el.trackDetail.value, 28);
  const incompatible = stroke => stroke && !TYPES[type].strokes.includes(stroke);
  const changingType = track.type !== type;
  if (changingType && (Object.keys(track.samples).length || track.cells.some(incompatible)) &&
      !confirm(t('track.confirmType'))) return;
  change(() => {
    if (changingType) {
      if (!PAIRED_DRUMS.includes(track.type) || !PAIRED_DRUMS.includes(type)) {
        detachTrackPair(doc, track);
      }
      if (type === 'bell') track.bellFor = null;
      else delete track.bellFor;
      track.samples = {};
      delete track.preset;
    }
    Object.assign(track, { name, detail, type });
    track.cells = track.cells.map(stroke => incompatible(stroke) ? null : stroke);
  }, true);
  el.trackPanel.close();
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#menu, #beatMenu, #files, #more, .staff-head')) closePopups();
});
el.paper.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse' && event.button === 0) mouseLeftOnScore = true;
}, {capture: true});
for (const name of ['pointerup', 'pointercancel']) {
  document.addEventListener(name, event => {
    if (event.pointerType === 'mouse' && !(event.buttons & 1)) mouseLeftOnScore = false;
  }, {capture: true});
}
window.addEventListener('blur', () => { mouseLeftOnScore = false; });
el.followPlayback.addEventListener('click', toggleFollowPlayback);
// Pointer clicks use score geometry for positioning. Tab still focuses buttons.
el.paper.addEventListener('mousedown', event => {
  if (event.button === 0 && event.target.closest('.slot, .add-measure, .add-measure-quick')) {
    event.preventDefault();
  }
});
el.paper.addEventListener('pointerdown', event => {
  cancelNoteReveal();
  appendVisibilityObserver?.disconnect();
  appendVisibilityObserver = undefined;
  holdFollowing();
  scoreTapViewport = undefined;
  const control = event.target.closest('.slot, .add-measure, .add-measure-quick');
  if (control && event.isPrimary && event.button === 0) {
    scoreTapViewport = {control, scrollLeft: el.paper.scrollLeft, scrollTop: el.paper.scrollTop};
  }
  if (!event.isPrimary) {
    blankTap = undefined;
    return;
  }
  if (event.button !== 0 || event.target.closest('button, .staff-head')) return;
  const rect = el.paper.getBoundingClientRect();
  if (event.clientX >= rect.left + el.paper.clientWidth || event.clientY >= rect.top + el.paper.clientHeight) return;
  const point = {id: event.pointerId, x: event.clientX, y: event.clientY};
  if (keysOpen && !event.target.closest('.beat')) blankTap = point;
  if (multiGroups && event.pointerType === 'mouse') {
    const trackId = event.target.closest('.staff')?.dataset.trackId;
    if (trackId && trackId !== multiGroups.trackId) blankTap = {...point, trackId};
  }
  if (event.pointerType !== 'mouse' || paperPan) return;
  paperPan = {...point,
    left: el.paper.scrollLeft, top: el.paper.scrollTop};
  el.paper.setPointerCapture(event.pointerId);
  el.paper.classList.add('panning');
  event.preventDefault();
});
function nearBlankTap(event) {
  return Math.hypot(event.clientX - blankTap.x, event.clientY - blankTap.y) <= 6;
}

el.paper.addEventListener('pointermove', event => {
  if (blankTap?.id === event.pointerId && !nearBlankTap(event)) blankTap = undefined;
  if (paperPan?.id !== event.pointerId) return;
  holdFollowing();
  el.paper.scrollLeft = paperPan.left + paperPan.x - event.clientX;
  el.paper.scrollTop = paperPan.top + paperPan.y - event.clientY;
});
el.paper.addEventListener('wheel', event => {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.paper.clientHeight : 1;
  const zoom = mouseLeftOnScore || Boolean(event.buttons & 1) || Boolean(paperPan);
  if (zoom && event.deltaY) {
    blankTap = undefined;
    event.preventDefault();
    const pixels = clamp(event.deltaY * unit, -240, 240);
    setScoreZoom(requestedScoreZoom() * Math.exp(-pixels / 520), event.clientX, event.clientY);
    if (paperPan) Object.assign(paperPan, {x: event.clientX, y: event.clientY, left: el.paper.scrollLeft, top: el.paper.scrollTop});
  } else if (event.deltaY || event.deltaX) {
    holdFollowing();
    // The browser performs normal wheel scrolling.
  }
}, {passive: false});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  el.paper.addEventListener(name, event => {
    if (name === 'pointercancel') scoreTapViewport = undefined;
    if (blankTap?.id === event.pointerId) {
      if (name === 'pointerup' && nearBlankTap(event)) {
        if (blankTap.trackId) blockOtherTrack(blankTap.trackId);
        else clearScoreSelection();
      }
      blankTap = undefined;
    }
    if (paperPan?.id !== event.pointerId) return;
    paperPan = null;
    el.paper.classList.remove('panning');
    resumeFollowingAfterDrag();
  });
}
function resumeFollowingAfterDrag() {
  manualFollowUntil = 0;
  followPlayback();
}

function handleScoreTouch(event) {
  const touches = Array.from(event.touches).filter(touch => el.paper.contains(touch.target));
  const wasTouching = paperTouch;
  paperTouch = touches.length > 0;
  if (scoreTapViewport && event.type === 'touchend' && !paperTouch) return;
  if (touches.length !== 2 || event.type === 'touchcancel') {
    const wasPinching = Boolean(paperPinch);
    paperPinch = undefined;
    if (paperTouch && !wasPinching) holdFollowing();
    else if (!paperTouch && wasTouching) resumeFollowingAfterDrag();
    else if (wasPinching && !paperTouch) followPlayback();
    return;
  }
  if (event.cancelable) event.preventDefault();
  const [first, second] = touches;
  const pinch = {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
    distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
  };
  if (!paperPinch) {
    closePopups();
  } else if (paperPinch.distance > 0 && pinch.distance > 0) {
    setScoreZoom(requestedScoreZoom() * pinch.distance / paperPinch.distance, paperPinch.x, paperPinch.y,
      !canFollow() ? paperPinch.x - pinch.x : 0, paperPinch.y - pinch.y);
  }
  paperPinch = pinch;
  manualFollowUntil = 0;
  followPlayback();
}

for (const name of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
  el.paper.addEventListener(name, handleScoreTouch, {passive: false});
}
for (const name of ['gesturestart', 'gesturechange']) {
  el.paper.addEventListener(name, event => event.preventDefault(), {passive: false});
}
el.paper.addEventListener('scroll', () => {
  positionBeatMenu();
  if (!el.menu.hidden && handMenuAnchor?.isConnected) positionPopup(handMenuAnchor, true);
  // The loop-repeat menu belongs to the transport, so following the playhead does not close it.
  else if (!el.menu.classList.contains('transport-menu')) el.menu.hidden = true;
});
window.addEventListener('resize', () => {
  if (!el.beatMenu.hidden) positionBeatMenu();
  else closePopups();
});
window.visualViewport?.addEventListener('resize', positionBeatMenu);
window.visualViewport?.addEventListener('scroll', positionBeatMenu);
el.rhythmBrowser.addEventListener('scroll', () => { cancelCardPress(); closePopups(); });
window.addEventListener('storage', event => {
  if (event.key?.startsWith(DOCUMENT_PREFIX) && event.newValue === null && documents.delete(event.key.slice(DOCUMENT_PREFIX.length))) {
    if (browsing) renderBrowser();
    return;
  }
  if (!event.key?.startsWith(DOCUMENT_PREFIX) || !event.newValue) return;
  readDocument(event.key, event.newValue);
  if (browsing) renderBrowser();
});
for (const eventName of ['cancel', 'wheel', 'contextmenu']) {
  el.noteChangeWarning.addEventListener(eventName, event => event.preventDefault(), {passive: false});
}
document.addEventListener('keydown', event => {
  if (el.noteChangeWarning.open) { event.preventDefault(); return; }
  if (document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') {
    if (!el.menu.hidden || !el.beatMenu.hidden) closePopups();
    else if (noteLock) unlockNote();
    else if (multiGroups) finishMultiGroups();
    else if (measureCopyStart) { measureCopyStart = undefined; renderScore(); }
    else if (loopStart) cancelLoopStart();
    else clearScoreSelection();
    return;
  }
  if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
  const key = event.key.toLowerCase();
  if (browsing) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'o') {
      event.preventDefault();
      el.file.click();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const actions = {
      s: saveScore, o: () => el.file.click(),
      z: () => event.shiftKey ? historyMove(redoStack, undoStack) : historyMove(undoStack, redoStack),
      y: () => historyMove(redoStack, undoStack),
      ...(keysOpen ? { c: copyBeat, v: pasteAtCursor } : {})
    };
    if (Object.hasOwn(actions, key)) { event.preventDefault(); actions[key](); }
    return;
  }
  if (event.altKey) return;
  if (event.code === 'Space' && !event.repeat && !event.target.closest('button:not(.slot)')) {
    event.preventDefault();
    togglePlayback();
  } else if (keysOpen) {
    const type = selectedTrack().type;
    if (TYPES[type].strokes.includes(key.toUpperCase())) { event.preventDefault(); writeStroke(key.toUpperCase()); }
    else if (['1', '2', '3', '4'].includes(key) && !event.shiftKey) {
      event.preventDefault();
      if (!event.repeat) splitBeat(Number(key));
    }
    else if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      if (key === 'backspace') deletePrevious(); else writeStroke(null, 0);
    } else if (key === 'arrowleft' || key === 'arrowright') {
      event.preventDefault();
      moveCursor(key === 'arrowleft' ? -1 : 1);
    } else if (key === 'arrowup' || key === 'arrowdown') {
      event.preventDefault();
      const row = doc.tracks.findIndex(track => track.id === cursor.track);
      const next = doc.tracks[clamp(row + (key === 'arrowup' ? -1 : 1), 0, doc.tracks.length - 1)];
      selectSlot(next.id, cursor.beat, cursor.slot, true);
    }
  }
});
applyLanguage();
loadDocuments();
showBrowser();
loadInstrumentPresets().then(() => {
  presetStorageAvailable = true;
  refreshPresetLabels();
  if (sampleTrack && el.samplePanel.open && !sampleBusy) {
    fillSampleOptions(el.sampleInstrument.value, el.sampleSlot.value, el.sampleStroke.value);
    el.sampleMessage.textContent = '';
    paintSamplePanel();
  }
}).catch(() => { /* Built-in and track-local sounds remain available when preset storage is blocked. */ });

function openBulkSplit(anchor, tracks, fromBar = 0, toBar = null) {
  popup(anchor, [1, 2, 3, 4].map(parts => [parts === 1 ? t('split.one') : t('split.option', {n: parts}), () => {
    const targets = tracks.map(track => ({track, grid: trackGrid(doc, track)}));
    try {
      // 1.60: written notes stay; notes landing on one cell merge only after confirmation.
      const results = targets.map(({track, grid}) => splitTrackRange(doc, track, fromBar, toBar ?? grid.measures.length, parts));
      if (!confirmBeatSizes(results.reduce((count, result) => count + result.merged, 0))) return;
      change(() => results.forEach((result, i) => Object.assign(targets[i].track, result.track)), true);
    } catch (error) { notify(error.message); }
  }]));
}
function openTempoEditor(track = null, bar = null, group = null) {
  closePopups();
  const measure = bar === null ? null : trackGrid(doc, track).measures[bar];
  const panel = document.createElement('dialog'); panel.className = 'tempo-editor';
  const form = document.createElement('form'); form.className = 'tempo-form';
  const title = document.createElement('h3'); title.textContent = t(track ? (bar === null ? 'tempo.track' : group === null ? 'tempo.measure' : 'tempo.group') : 'tempo.score');
  const controls = document.createElement('div'); controls.className = 'tempo-controls';
  const input = document.createElement('input'); input.type = 'number'; input.min = BPM_MIN; input.max = BPM_MAX; input.step = 1; input.required = true; input.inputMode = 'numeric';
  input.value = Math.round(effectiveTempo(doc, track, measure, group)); input.setAttribute('aria-label', 'BPM');
  const bump = n => { input.value = clamp(Math.round(Number(input.value) || BPM_MIN) + n, BPM_MIN, BPM_MAX); };
  controls.append(button('−', () => bump(-1)), input, button('+', () => bump(1)));
  const apply = () => {
    const bpm = Number(input.value);
    if (!Number.isInteger(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) { input.reportValidity(); return; }
    change(() => {
      if (!track) doc.bpm = bpm;
      else if (bar === null) track.tempoRatio = bpm / doc.bpm;
      else {
        track.measures = structuredClone(trackGrid(doc, track).measures);
        const target = track.measures[bar];
        target.tempoRatios ??= Array(target.beats.length).fill(null);
        if (group === null) target.tempoRatios.fill(bpm / doc.bpm);
        else target.tempoRatios[group] = bpm / doc.bpm;
      }
    }, true);
    syncTempo(); panel.close();
  };
  const actions = document.createElement('div'); actions.className = 'tempo-actions';
  const cancel = button(t('dialog.cancel'), () => panel.close(), 'tempo-cancel');
  const confirm = document.createElement('button'); confirm.type = 'submit'; confirm.className = 'tempo-confirm';
  confirm.textContent = t('dialog.done');
  actions.append(cancel, confirm);
  form.append(title, controls, actions);
  form.addEventListener('submit', event => { event.preventDefault(); apply(); });
  panel.append(form);
  panel.addEventListener('close', () => panel.remove(), {once:true});
  document.body.append(panel); panel.showModal();
  // Opened by a one-second hold: keep the dialog's buttons away from the finger that is still down.
  const frame = panel.getBoundingClientRect();
  const placed = {left: frame.left, top: frame.top, width: frame.width, height: frame.height};
  const box = clearOfMenuHold(placed, {left: 8, top: 8, right: innerWidth - 8, bottom: innerHeight - 8});
  if (box !== placed) Object.assign(panel.style, {position: 'fixed', inset: 'auto', margin: '0', left: box.left + 'px', top: box.top + 'px'});
}

for (const [id, delta] of [['tempoMinus', -1], ['tempoPlus', 1]]) {
  el[id].addEventListener('click', () => {
    record(); doc.bpm = clamp(doc.bpm + delta, BPM_MIN, BPM_MAX); syncTempo(); persist();
  });
}

function scoreExtensionLength(name) {
  const rhythm = '.rhythm.json';
  if (name.length > rhythm.length && name.slice(-rhythm.length).toLowerCase() === rhythm) return rhythm.length;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.length - dot : 0;
}
function scoreNumberedCandidate(name, number) {
  const size = scoreExtensionLength(name);
  const base = size ? name.slice(0, -size) : name;
  const ext = size ? name.slice(-size) : '';
  return base + ' (' + number + ')' + ext;
}
function nextScoreFileName(name, occupied) {
  for (let number = 1; ; number++) {
    const candidate = scoreNumberedCandidate(name, number);
    if (!occupied.has(candidate)) return candidate;
  }
}
function planScoreSave(name, occupied, choice) {
  if (!occupied.has(name)) return {write: true, name};
  if (choice !== 'overwrite' && choice !== 'both') return {write: false, name: null};
  if (choice === 'overwrite') return {write: true, name};
  return {write: true, name: nextScoreFileName(name, occupied)};
}
async function scoreFileExists(folder, name) {
  try { await folder.getFileHandle(name); return true; }
  catch (error) { if (error.name === 'NotFoundError') return false; throw error; }
}
async function scoreNumberedName(folder, name) {
  const occupied = new Set([name]);
  for (;;) {
    const candidate = nextScoreFileName(name, occupied);
    if (!await scoreFileExists(folder, candidate)) return candidate;
    occupied.add(candidate);
  }
}
function scoreConflictChoice(name) {
  el.scoreConflictName.textContent = name;
  return new Promise(resolve => {
    let choice = null;
    el.scoreOverwrite.onclick = () => { choice = 'overwrite'; el.scoreConflictPanel.close(); };
    el.scoreKeepBoth.onclick = () => { choice = 'both'; el.scoreConflictPanel.close(); };
    el.scoreConflictPanel.addEventListener('close', () => resolve(choice), {once:true});
    el.scoreConflictPanel.showModal();
  });
}
function directoryPickerBlocked(error) {
  if (!error) return false;
  if (error.name === 'NotSupportedError') return true;
  if (error.name !== 'SecurityError') return false;
  const message = String(error.message || '');
  // "Must be handling a user gesture" means the API exists. Do not treat that as
  // a missing directory and do not write through the plain download fallback.
  if (/user gesture/i.test(message)) return false;
  return /secure|insecure|not allowed/i.test(message);
}
async function saveScoreWithSystem(blob, name) {
  // Safari does not expose sibling files. Its Files sheet owns real conflict handling.
  const file = new File([blob], name, {type: blob.type || 'application/octet-stream'});
  if (navigator.canShare?.({files: [file]}) && navigator.share) {
    try { await navigator.share({files: [file]}); return name; }
    catch (error) { if (error.name === 'AbortError') return null; throw error; }
  }
  download(blob, name);
  return name;
}
async function saveScoreExport(blob, name) {
  if (!globalThis.showDirectoryPicker) return saveScoreWithSystem(blob, name);
  let folder;
  try { folder = await globalThis.showDirectoryPicker({mode:'readwrite'}); }
  catch (error) {
    if (error.name === 'AbortError' || error.name === 'NotAllowedError') return null;
    if (directoryPickerBlocked(error)) {
      el.scoreSaveHint.textContent = t('save.systemHint');
      return saveScoreWithSystem(blob, name);
    }
    if (error.name === 'SecurityError') return null;
    throw error;
  }
  if (await scoreFileExists(folder, name)) {
    const choice = await scoreConflictChoice(name);
    const occupied = new Set([name]);
    if (choice === 'both') {
      for (;;) {
        const candidate = nextScoreFileName(name, occupied);
        if (!await scoreFileExists(folder, candidate)) break;
        occupied.add(candidate);
      }
    }
    const plan = planScoreSave(name, occupied, choice);
    if (!plan.write) return null;
    name = plan.name;
  }
  const handle = await folder.getFileHandle(name, {create:true});
  const stream = await handle.createWritable();
  try { await stream.write(blob); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
  return name;
}
