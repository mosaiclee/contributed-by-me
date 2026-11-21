"""RhythmDesk 1.59 -> 1.60: apply the same editor changes to the Win11 sources and the Android page.

Usage: python3 patch160.py WIN11_UI_DIR ANDROID_INDEX_HTML

Every edit must match exactly once in the Win11 source file it belongs to and exactly once in the
Android page (which carries the same scripts, style and guide in one file), so both platforms stay
in step. Nothing is written unless every edit applies.
"""
import sys
from pathlib import Path

FILES = {
    'app': 'app.js', 'model': 'model.js', 'i18n': 'i18n.js', 'style': 'style.css',
    'index': 'index.html', 'guide': 'help/guide.html', 'guide_en': 'help/guide.en.html',
}

EDITS = []


def edit(kind, old, new):
    EDITS.append((kind, old, new))


# ---------------------------------------------------------------- 1. Duplicate track (model)
edit('model', """function detachTrackPair(doc, track) {""", """// 1.60: an independent copy of one track with all of its content (notes, sticking, measures, group
// meters, split cells, tempo, loops, line breaks, sounds, preset and mix), placed directly below the
// track or below its Bell/Drum pair. A copied Bell is not paired with any drum.
function duplicateTrack(doc, track, name) {
  if (doc.tracks.length >= TRACK_LIMIT || !doc.tracks.includes(track)) return null;
  const copy = structuredClone(track);
  let number = 1;
  while (doc.tracks.some(item => item.id === `t${number}`)) number++;
  copy.id = `t${number}`;
  copy.name = shortText(name, 28, track.name);
  if (copy.type === 'bell') copy.bellFor = null;
  const block = trackBlocks(doc).find(items => items.includes(track));
  doc.tracks.splice(doc.tracks.indexOf(block.at(-1)) + 1, 0, copy);
  return copy;
}

function detachTrackPair(doc, track) {""")

# ---------------------------------------------------------------- 2. Split with notes in place (model)
edit('model', """    const values = emptyCells(count);
    let dropped = 0;
    for (let i = 0; i < info.count; i++) {
      const value = track.cells[start + i];
      if (!value) continue;
      const target = replacement.findIndex(step => step.at === entry.steps[part + i].at);
      if (target < 0) dropped++;
      else values[target] = value;
    }""", """    // 1.60: notes stay while the cell is split or merged; each moves to the nearest new
    // sub-cell and only notes landing on an occupied sub-cell are merged (counted as dropped).
    const values = emptyCells(count);
    let dropped = 0;
    for (let i = 0; i < info.count; i++) {
      const value = track.cells[start + i];
      if (!value) continue;
      const target = Math.min(count - 1, Math.round(i * count / info.count));
      if (values[target]) dropped++;
      else values[target] = value;
    }""")
edit('model', """  const group = emptyCells(groupSize(next));
  let dropped = 0;
  old.forEach((position, index) => {
    const stroke = track.cells[start + index];
    if (!stroke) return;
    const target = cellNear(next, position, true);
    if (target < 0 || group[target]) dropped++;
    else group[target] = stroke;
  });""", """  const group = emptyCells(groupSize(next));
  // 1.60: notes stay while the cell is split or merged. Other cells keep their exact positions;
  // inside the edited cell each note moves to the nearest new sub-cell, and only notes landing on an
  // occupied sub-cell are merged (counted as dropped).
  const oldFirst = Array.isArray(entry) ? groupSize(entry.slice(0, part)) : part;
  const newFirst = Array.isArray(next) ? groupSize(next.slice(0, part)) : part;
  let dropped = 0;
  old.forEach((position, index) => {
    const stroke = track.cells[start + index];
    if (!stroke) return;
    const inner = index - oldFirst;
    const target = inner >= 0 && inner < info.count
      ? newFirst + Math.min(count - 1, Math.round(inner * count / info.count))
      : cellNear(next, position, true);
    if (target < 0 || group[target]) dropped++;
    else group[target] = stroke;
  });""")
edit('model', """function splitTrackRange(doc, track, fromBar, toBar, parts) {
  const work = structuredClone(track);""", """// 1.60: returns the split track and how many notes merged; written notes no longer block the split.
function splitTrackRange(doc, track, fromBar, toBar, parts) {
  const work = structuredClone(track);
  let merged = 0;""")
edit('model', """        if (result.dropped || hands?.dropped) throw new Error(t('beat.clearBeforeSplit'));
        work.measures = result.measures; work.cells = result.cells;
        if (hands) work.hands = hands.cells;
      }
      slot -= info.count;
    }
  }
  return work;
}""", """        merged += result.dropped + (hands?.dropped ?? 0);
        work.measures = result.measures; work.cells = result.cells;
        if (hands) work.hands = hands.cells;
      }
      slot -= info.count;
    }
  }
  return {track: work, merged};
}""")

# ---------------------------------------------------------------- 3. One-second hold opens every double-tap menu
edit('app', """document.addEventListener('click', event => {
  if (quickTap && !quickTap.target.contains(event.target)) quickTap = null;
}, true);
""", """document.addEventListener('click', event => {
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
""")
edit('app', """function blockSubdivisionChange(key = 'beat.clearBeforeSplit') {
  const entry = rows.get(cursor.track)?.entries[cursor.beat];
  if (!entry || !entry.track.cells.slice(entry.start, entry.start + entry.size).some(Boolean)) return false;
  warnBeforeChangingNotes(key);
  return true;
}

""", "")
edit('app', """  const line = button('', event => { if (quickDoubleTap(event)) openTrackBoundary(track, bar, event.currentTarget, side); }, 'barline');
""", """  const line = button('', event => { if (quickDoubleTap(event)) openTrackBoundary(track, bar, event.currentTarget, side); }, 'barline');
  bindMenuHold(line, () => { if (!blockOtherTrack(track.id)) openTrackBoundary(track, bar, line, side); });
""")
edit('app', """        item.addEventListener('contextmenu', event => event.preventDefault());
""", """        item.addEventListener('contextmenu', event => event.preventDefault());
        // Multi-selection keeps its own 0.5 s hold for whole groups.
        bindMenuHold(item, press => {
          const hand = Boolean(press.target.classList?.contains('hand-dot'));
          const {scrollLeft, scrollTop} = scoreEditViewport(item);
          selectSlot(track.id, beat, slot);
          el.paper.scrollTo({left: scrollLeft, top: scrollTop, behavior: 'instant'});
          if (hand) openHandMenu(item);
          else openBeatMenu(box);
        }, () => !multiGroups);
""")
edit('app', """        event => { if (quickDoubleTap(event)) openGroupMeterMenu(event.currentTarget, track.id, beat); }, 'group-meter');
""", """        event => { if (quickDoubleTap(event)) openGroupMeterMenu(event.currentTarget, track.id, beat); }, 'group-meter');
      bindMenuHold(meterButton, () => { if (!blockOtherTrack(track.id)) openGroupMeterMenu(meterButton, track.id, beat); });
""")
edit('app', """        event => { if (quickDoubleTap(event)) openTempoEditor(track, bar, group); }, 'group-tempo');
""", """        event => { if (quickDoubleTap(event)) openTempoEditor(track, bar, group); }, 'group-tempo');
      bindMenuHold(tempoButton, () => { if (!blockOtherTrack(track.id)) openTempoEditor(track, bar, group); });
""")
edit('app', """function positionPopup(anchor, handMenu = false) {
  const rect = anchor.getBoundingClientRect();
  const left = clamp(rect.left, 7, innerWidth - el.menu.offsetWidth - 7);
  const below = handMenu ? rect.top + Math.min(rect.height * .19, 28) + 4 : rect.bottom + 4;
  el.menu.style.left = left + 'px';
  el.menu.style.top = clamp(below, 6, innerHeight - el.menu.offsetHeight - 7) + 'px';
}""", """function positionPopup(anchor, handMenu = false) {
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
}""")
edit('app', """  const above = rect.top - height - 9;
  const below = above < topEdge;
  el.beatMenu.classList.toggle('below', below);
  el.beatMenu.style.left = clamp((rect.left + rect.right - width) / 2, leftEdge, rightEdge - width) + 'px';
  el.beatMenu.style.top = clamp(below ? rect.bottom + 9 : above, topEdge, Math.max(topEdge, bottomEdge - height)) + 'px';
}""", """  const above = rect.top - height - 9;
  const below = above < topEdge;
  const placed = {width, height, left: clamp((rect.left + rect.right - width) / 2, leftEdge, rightEdge - width),
    top: clamp(below ? rect.bottom + 9 : above, topEdge, Math.max(topEdge, bottomEdge - height))};
  const box = clearOfMenuHold(placed, {left: leftEdge, top: topEdge, right: rightEdge, bottom: Math.max(topEdge + height, bottomEdge)});
  el.beatMenu.classList.toggle('below', below);
  // Moved clear of a held finger, the menu no longer sits next to its beat and hides the pointer arrow.
  el.beatMenu.classList.toggle('clear-of-hold', box !== placed);
  el.beatMenu.style.left = box.left + 'px';
  el.beatMenu.style.top = box.top + 'px';
}""")
edit('app', """  document.body.append(panel); panel.showModal();
}""", """  document.body.append(panel); panel.showModal();
  // Opened by a one-second hold: keep the dialog's buttons away from the finger that is still down.
  const frame = panel.getBoundingClientRect();
  const placed = {left: frame.left, top: frame.top, width: frame.width, height: frame.height};
  const box = clearOfMenuHold(placed, {left: 8, top: 8, right: innerWidth - 8, bottom: innerHeight - 8});
  if (box !== placed) Object.assign(panel.style, {position: 'fixed', inset: 'auto', margin: '0', left: box.left + 'px', top: box.top + 'px'});
}""")

# ---------------------------------------------------------------- 2. Split with notes in place (editor)
edit('app', """function applyBeatSizes(sizes, subdivision) {
  let occupied = false;
  const edits = doc.tracks.map(track => {
    const grid = trackGrid(doc, track);
    const next = track.measures ? grid.beats.map(() => subdivision) : sizes;
    let offset = 0;
    grid.beats.forEach((size, beat) => {
      const end = offset + groupSize(size);
      if (size !== next[beat] && track.cells.slice(offset, end).some(Boolean)) occupied = true;
      offset = end;
    });
    const edit = convertCells(track.cells, grid.beats, next);
    if (track.hands) edit.collisions += convertCells(track.hands, grid.beats, next).collisions;
    return {track, grid, next, ...edit};
  });
  if (occupied) { warnBeforeChangingNotes('beat.clearBeforeBulkSplit'); return; }
""", """// 1.60: written notes stay while subdivisions change; notes landing on one cell merge after confirmation.
function applyBeatSizes(sizes, subdivision) {
  const edits = doc.tracks.map(track => {
    const grid = trackGrid(doc, track);
    const next = track.measures ? grid.beats.map(() => subdivision) : sizes;
    const edit = convertCells(track.cells, grid.beats, next);
    if (track.hands) edit.collisions += convertCells(track.hands, grid.beats, next).collisions;
    return {track, grid, next, ...edit};
  });
""")
edit('app', """function changeTuplet() {
  if (blockSubdivisionChange()) return;
""", """function changeTuplet() {
""")
edit('app', """// 0.22: choose 1-4 equal parts for the cell under the cursor (1 = not split).
function openSplitMenu(anchor) {
  if (blockSubdivisionChange()) return;
""", """// 0.22: choose 1-4 equal parts for the cell under the cursor (1 = not split).
// 1.60: also while the cell holds notes; they move to the nearest new sub-cell.
function openSplitMenu(anchor) {
""")
edit('app', """  if (parts !== info.count && blockSubdivisionChange()) return;
""", "")
edit('app', """    const targets = tracks.map(track => ({track, grid: trackGrid(doc, track)}));
    if (targets.some(({track, grid}) => track.cells.slice(grid.barSteps[fromBar], grid.barSteps[toBar ?? grid.measures.length]).some(Boolean))) {
      warnBeforeChangingNotes('bulk.clearFirst'); return;
    }
    try {
      const results = targets.map(({track, grid}) => splitTrackRange(doc, track, fromBar, toBar ?? grid.measures.length, parts));
      change(() => results.forEach((result, i) => Object.assign(targets[i].track, result)), true);
    } catch (error) { notify(error.message); }""", """    const targets = tracks.map(track => ({track, grid: trackGrid(doc, track)}));
    try {
      // 1.60: written notes stay; notes landing on one cell merge only after confirmation.
      const results = targets.map(({track, grid}) => splitTrackRange(doc, track, fromBar, toBar ?? grid.measures.length, parts));
      if (!confirmBeatSizes(results.reduce((count, result) => count + result.merged, 0))) return;
      change(() => results.forEach((result, i) => Object.assign(targets[i].track, result.track)), true);
    } catch (error) { notify(error.message); }""")

# ---------------------------------------------------------------- 1. Duplicate track (editor)
edit('app', """function openTrackMenu(track, anchor) {""", """// 1.60: copy a track with everything in it (notes included) into a new track directly below.
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

function openTrackMenu(track, anchor) {""")
edit('app', """    [t('track.moveDown'), () => move(1), index >= blocks.length - 1],
""", """    [t('track.moveDown'), () => move(1), index >= blocks.length - 1],
    [t('track.duplicate'), () => duplicateTrackWithContent(track), doc.tracks.length >= TRACK_LIMIT],
""")

# ---------------------------------------------------------------- Interface text
edit('i18n', """    'bulk.clearFirst': '请先清空所选范围的音符，再统一拆分小拍子',
""", "")
edit('i18n', """    'bulk.clearFirst': 'Clear notes in the target range before splitting subdivisions.',
""", "")
edit('i18n', """    'beat.clearBeforeSplit': '请先清空蓝框内的音符，再更换切分小拍。',
    'beat.clearBeforeBulkSplit': '请先清空受影响小节的音符，再更换细分。',
""", "")
edit('i18n', """    'beat.clearBeforeSplit': 'Clear the notes in the blue selection before changing its subdivision.',
    'beat.clearBeforeBulkSplit': 'Clear the notes in the affected measures before changing their subdivision.',
""", "")
edit('i18n', """    'help.aboutUpdate': '本版整理并同步中英文说明书，更新跟随、循环、手势和文件保存操作的介绍。',""",
     """    'help.aboutUpdate': '本版新增轨道菜单「复制本轨道」（连同音符复制全部内容）；已写入音符时可直接切分或更换细分，无需先清空；所有双击打开的菜单也可长按 1 秒打开，并自动避开长按位置，防止误按。',""")
edit('i18n', """    'help.aboutUpdate': 'This release synchronizes the Chinese and English guide, updating the instructions for following, loops, gestures and file saving.',""",
     """    'help.aboutUpdate': 'This release adds Duplicate Track to the track menu (copies everything, notes included), lets you split cells or change subdivisions without clearing written notes, and opens every double-tap menu with a 1-second hold as well, placed clear of the held point to prevent mistaken taps.',""")
edit('i18n', """    'meter.groupButton': '第 {bar} 小节第 {group} 组拍号 {meter}，快速双击更换',""",
     """    'meter.groupButton': '第 {bar} 小节第 {group} 组拍号 {meter}，快速双击或长按 1 秒更换',""")
edit('i18n', """    'meter.groupButton': 'Measure {bar}, group {group}: {meter}. Change group meter.',""",
     """    'meter.groupButton': 'Measure {bar}, group {group}: {meter}. Double-tap or hold for 1 second to change the group meter.',""")
edit('i18n', """    'bar.pickEnd': '请快速双击同一音轨后面的小节线，设置循环终点。',""",
     """    'bar.pickEnd': '请快速双击或长按 1 秒同一音轨后面的小节线，设置循环终点。',""")
edit('i18n', """    'bar.pickEnd': 'Double-tap a later barline on the same track to set the loop end.',""",
     """    'bar.pickEnd': 'Double-tap a later barline on the same track, or hold it for 1 second, to set the loop end.',""")
edit('i18n', """    'track.moveDown': '↓ 下移轨道',
""", """    'track.moveDown': '↓ 下移轨道',
    'track.duplicate': '复制本轨道',
    'track.copySuffix': ' 副本',
    'track.duplicated': '已将「{track}」连同音符完整复制为「{copy}」，可用 Ctrl+Z 撤销。',
    'track.duplicateLimit': '整份谱最多 100 条轨道，无法再复制。',
    'track.duplicateBudget': '复制后采样将超过 640 KiB 上限，请先缩短或移除本轨的自定义采样。',
""")
edit('i18n', """    'track.moveDown': '↓ Move Track Down',
""", """    'track.moveDown': '↓ Move Track Down',
    'track.duplicate': 'Duplicate Track',
    'track.copySuffix': ' copy',
    'track.duplicated': 'Duplicated “{track}” with all of its notes and settings as “{copy}”. Undo with Ctrl+Z.',
    'track.duplicateLimit': 'A score can hold 100 tracks, so this track cannot be duplicated.',
    'track.duplicateBudget': 'The copy would exceed the 640 KiB sample limit. Shorten or remove this track’s custom samples first.',
""")
edit('i18n', """    'beat.confirmSplitMerge': '改成 {n} 份后有 {count} 个鼓点不在新的格位上，会被移除。继续吗？',""",
     """    'beat.confirmSplitMerge': '改成 {n} 份后有 {count} 个鼓点会与同一格的鼓点重叠并被合并。继续吗？',""")
edit('i18n', """    'beat.confirmSplitMerge': 'With {n} parts, {count} notes no longer sit on a cell and will be removed. Continue?',""",
     """    'beat.confirmSplitMerge': 'With {n} parts, {count} notes land on an occupied cell and will be merged. Continue?',""")

# ---------------------------------------------------------------- Style: no text selection or callout on held controls
edit('style', """#score { padding-right: calc(clamp(18px, 4vw, 44px) + var(--loop-tail, 0px)); }
""", """#score { padding-right: calc(clamp(18px, 4vw, 44px) + var(--loop-tail, 0px)); }
/* 1.60: controls that open a menu on a one-second hold never start text selection or a system callout. */
.barline, .slot, .group-meter, .group-tempo { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
.beat-menu.clear-of-hold::after { display: none; }
""")

# ---------------------------------------------------------------- Guide (Chinese)
edit('guide', """在同一符杆上连续点按两次（间隔小于 0.25 秒）打开拍菜单。双击符杆上方蓝点，设置或清除 L（左）、R（右）、LR（双手）。小节边界、横线组拍号与速度入口同样需要双击；菜单打开后，选项单击执行。""",
     """在同一符杆上连续点按两次（间隔小于 0.25 秒）或按住 1 秒打开拍菜单。双击或长按 1 秒符杆上方蓝点，设置或清除 L（左）、R（右）、LR（双手）。小节边界、横线组拍号与速度入口同样可双击或长按 1 秒打开；长按打开的菜单会避开手指所在位置，松手不会误选；菜单打开后，选项单击执行。""")
edit('guide', """♫ 可还原为一份或细分为 2、3、4 份，合并重叠音符时需确认。""",
     """♫ 可还原为一份或细分为 2、3、4 份；已写入音符时无需先清空，可直接切分，音符移到最近的新格位，合并重叠音符时需确认。拍菜单的「切换 3/4 细分」同样保留音符。""")
edit('guide', """<dt>统一细分</dt><dd>小节、轨道和整谱菜单可将目标范围统一拆分为 1–4 份；目标范围有音符时，请先清空相应音符。</dd>""",
     """<dt>统一细分</dt><dd>小节、轨道和整谱菜单可将目标范围统一拆分为 1–4 份；已有音符会保留在最近的新格位，合并重叠音符时需确认。</dd>""")
edit('guide', """点③的轨道标题「⋯」或双击谱面边界线，打开对应菜单。""",
     """点③的轨道标题「⋯」，或双击／长按 1 秒谱面边界线，打开对应菜单。""")
edit('guide', """<dt>轨道标题「⋯」</dt><dd>开始多选；向上／向下调整轨道顺序（首尾不能继续移动，配对轨道作为一组移动）；""",
     """<dt>轨道标题「⋯」</dt><dd>开始多选；向上／向下调整轨道顺序（首尾不能继续移动，配对轨道作为一组移动）；「复制本轨道」把该轨的全部内容（音符、左右手、小节与拍号、细分、速度、循环、换行、音色与混音设置）复制为新轨，副本名称加「副本」，放在该轨（或其 Bell／Drum 配对组）下方，可一次撤销；""")
edit('guide', """双击小节边界设置轨道循环起点与终点。""",
     """双击或长按 1 秒小节边界设置轨道循环起点与终点。""")
edit('guide', """统一切换每拍三／四分音（受已有音符、细分状态约束）。""",
     """统一切换每拍三／四分音（受细分状态约束；已有音符随之保留，重叠时确认合并）。""")
edit('guide', """双击横线组拍号旁的速度可设置该组速度。""",
     """双击或长按 1 秒横线组拍号旁的速度可设置该组速度。""")

# ---------------------------------------------------------------- Guide (English)
edit('guide_en', """Tap the same stem twice within 0.25 seconds to open its beat menu. Double-tap the blue dot to set or clear L (left), R (right) or LR (both). Barline, group-meter and group-tempo menus also require a double-tap; choose menu items with one tap.""",
     """Tap the same stem twice within 0.25 seconds, or hold it for 1 second, to open its beat menu. Double-tap or hold the blue dot to set or clear L (left), R (right) or LR (both). Barline, group-meter and group-tempo menus also open with a double-tap or a 1-second hold. A menu opened by holding appears clear of your finger, so lifting it never picks an item; choose menu items with one tap.""")
edit('guide_en', """♫ splits a subdivision into two, three or four parts, or restores one part. Merging overlapping notes asks for confirmation.""",
     """♫ splits a subdivision into two, three or four parts, or restores one part. Written notes need not be cleared first: they move to the nearest new cell, and merging overlapping notes asks for confirmation. The beat menu’s three/four switch keeps notes the same way.""")
edit('guide_en', """<dt>Split a range</dt><dd>Measure, track and score menus can split a target range into 1–4 equal parts. Clear any notes in the target range first.</dd>""",
     """<dt>Split a range</dt><dd>Measure, track and score menus can split a target range into 1–4 equal parts. Existing notes stay on the nearest new cell; merging overlapping notes asks for confirmation.</dd>""")
edit('guide_en', """③ Open the ⋯ menu on a track header, or double-tap a barline for measure actions.""",
     """③ Open the ⋯ menu on a track header, or double-tap or hold a barline for 1 second for measure actions.""")
edit('guide_en', """<dt>Track header ⋯</dt><dd>Start multi-selection, move the track up or down, """,
     """<dt>Track header ⋯</dt><dd>Start multi-selection, move the track up or down, duplicate the track with all of its content (notes, sticking, measures and meters, splits, tempo, loops, line breaks, sounds and mix; the copy is named with “copy” and appears below the track or its Bell/Drum pair, undoable in one step), """)
edit('guide_en', """Double-tap barlines to set a track loop start and end.""",
     """Double-tap barlines, or hold them for 1 second, to set a track loop start and end.""")
edit('guide_en', """switches the score to three or four subdivisions when its existing notes and split cells allow it.""",
     """switches the score to three or four subdivisions when its split cells allow it; existing notes are kept, and merging overlapping notes asks for confirmation.""")
edit('guide_en', """double-tap the tempo beside a group meter to change that group.""",
     """double-tap or hold for 1 second the tempo beside a group meter to change that group.""")

# ---------------------------------------------------------------- Version 1.59 -> 1.60
VERSION_FILES = {  # Win11 file: expected count of '1.59' and '2026-11-17'
    'app': (2, 0), 'index': (1, 2), 'guide': (2, 3), 'guide_en': (1, 1),
}
ANDROID_VERSION_COUNTS = (6, 6)


def apply(text, edits, label):
    for kind, old, new in edits:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f'{label}: [{kind}] expected 1 match, found {count}: {old[:90]!r}')
        text = text.replace(old, new)
    return text


def bump(text, counts, label):
    for old, new, expected in (('1.59', '1.60', counts[0]), ('2026-11-17', '2026-11-21', counts[1])):
        found = text.count(old)
        if found != expected:
            raise SystemExit(f'{label}: expected {expected} × {old}, found {found}')
        text = text.replace(old, new)
    return text


def main():
    ui, android = Path(sys.argv[1]), Path(sys.argv[2])
    results = {}
    for kind, name in FILES.items():
        text = (ui / name).read_text(encoding='utf-8')
        text = apply(text, [e for e in EDITS if e[0] == kind], f'Win11 {name}')
        if kind in VERSION_FILES:
            text = bump(text, VERSION_FILES[kind], f'Win11 {name}')
        results[ui / name] = text
    page = android.read_text(encoding='utf-8')
    page = apply(page, EDITS, 'Android index.html')
    results[android] = bump(page, ANDROID_VERSION_COUNTS, 'Android index.html')
    for path, text in results.items():
        path.write_bytes(text.encode('utf-8'))
    print(f'Applied {len(EDITS)} edits to {len(FILES)} Win11 source files and the Android page.')


if __name__ == '__main__':
    main()
