"""RhythmDesk 1.60 -> 1.61: apply the same editor changes to the Win11 sources and the Android page.

Usage: python3 patch161.py WIN11_UI_DIR ANDROID_INDEX_HTML

Every edit must match the stated number of times (default once) in the Win11 source file it belongs
to and in the Android page (which carries the same scripts, style and guide in one file), so both
platforms stay in step. Nothing is written unless every edit applies.
"""
import re
import sys
from pathlib import Path

FILES = {
    'app': 'app.js', 'audio': 'audio.js', 'i18n': 'i18n.js', 'style': 'style.css',
    'index': 'index.html', 'guide': 'help/guide.html', 'guide_en': 'help/guide.en.html',
}

EDITS = []
SECTION = None
SECTIONS = {  # requirement each edit belongs to (used by the handoff document)
    'repeat': '需求 1：循环区间「再循环几次后继续」按钮',
    'playing': '需求 2：所有轨道用蓝色方框标出正在播放的音符',
    'lock': '需求 3：长按音符键锁定该音符，点按谱面连续输入',
    'common': '版本说明（三项需求共用）',
}


def section(tag):
    global SECTION
    SECTION = tag


def edit(kind, old, new, count=1):
    EDITS.append((kind, old, new, SECTION, count))


# ================================================================ 1. Repeat the loop N more times
section('repeat')
edit('audio', """// Group-clock motion is independent""", """// 1.61: a loop boundary returns to the loop start until the loop is released. After a release it
// still returns for the extra passes chosen with the repeat button (gate.repeats), then continues.
function gateLoopsBack(gate) {
  return Boolean(gate) && (!gate.released || gate.repeats > 0);
}

// Group-clock motion is independent""")
edit('audio', """    this.gates = this.loops.map(range => ({...range, released: false}));""",
     """    this.gates = this.loops.map(range => ({...range, released: false, repeats: 0}));""")
edit('audio', """    return gate && this.step === gate.to && !gate.released;""",
     """    return gate && this.step === gate.to && gateLoopsBack(gate);""")
edit('audio', """    const loopReturn = Boolean(ending && this.step === ending.to && !ending.released);
    if (loopReturn) this.step = ending.from;""", """    const loopReturn = Boolean(ending && this.step === ending.to && gateLoopsBack(ending));
    if (loopReturn) {
      // One of the extra passes chosen after the release.
      if (ending.released) ending.repeats--;
      this.step = ending.from;
    }""")
edit('audio', """      loopEnd: Boolean(lane.gate && !lane.gate.released && group.to === lane.gate.to),""",
     """      loopEnd: gateLoopsBack(lane.gate) && group.to === lane.gate.to,""")
edit('audio', """    const next = lane.queue[0]?.step ?? (lane.gate && !lane.gate.released && lane.step + 1 === lane.gate.to""",
     """    const next = lane.queue[0]?.step ?? (gateLoopsBack(lane.gate) && lane.step + 1 === lane.gate.to""")
edit('audio', """    return {next, loopFrom: lane.gate && !lane.gate.released ? lane.gate.from : null,""",
     """    return {next, loopFrom: gateLoopsBack(lane.gate) ? lane.gate.from : null,""")
edit('audio', """  releaseLoop() {
    if (!this.running || this.paused) return false;
    this.advancePlayhead(this.context.currentTime);
    const gates = this.currentGates();
    for (const gate of gates) gate.released = true;
    return gates.length > 0;
  }""", """  // 1.61: `repeats` extra passes of the current loops play before playback continues (0 = this pass).
  releaseLoop(repeats = 0) {
    if (!this.running || this.paused) return false;
    this.advancePlayhead(this.context.currentTime);
    const gates = this.currentGates();
    for (const gate of gates) Object.assign(gate, {released: true, repeats});
    return gates.length > 0;
  }

  // 1.61: cancel a pending release; the current loops repeat until released again.
  keepLooping() {
    if (!this.running || this.paused) return false;
    const gates = this.currentGates();
    for (const gate of gates) Object.assign(gate, {released: false, repeats: 0});
    return gates.length > 0;
  }""")
edit('app', """g => `${g.from}/${g.to}/${g.released}`""", """g => `${g.from}/${g.to}/${g.released}/${g.repeats}`""", count=2)
edit('app', """    ? (gates.every(gate => gate.released) ? t('stop.releaseWait') : t('stop.release')) : t('stop');
  el.stop.title = stopLabel;
  el.stop.setAttribute('aria-label', stopLabel);
  el.stop.classList.toggle('release-loop', gates.length > 0);
""", """    ? (gates.every(gate => gate.released) ? (repeats ? t('stop.repeatWait', {n: repeats}) : t('stop.releaseWait')) : t('stop.release')) : t('stop');
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
""")
edit('app', """  const gates = engine.paused ? [] : playingLoops;
  const stopLabel = gates.length""", """  const gates = engine.paused ? [] : playingLoops;
  const repeats = Math.max(0, ...gates.map(gate => gate.released ? gate.repeats || 0 : 0));
  const stopLabel = gates.length""")
edit('app', """    ...lane.path.gates.filter(gate => !gate.released && gate.to > lane.step).map(gate => gate.to));""",
     """    ...lane.path.gates.filter(gate => gateLoopsBack(gate) && gate.to > lane.step).map(gate => gate.to));""")
edit('app', """async function playScore() {""", """// 1.61: repeat the playing loop 1-8 more times, then continue; or cancel a pending continue.
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

async function playScore() {""")
edit('app', """function closePopups() {
  beatMenuAnchor = null;""", """function closePopups() {
  el.menu.classList.remove('transport-menu');
  beatMenuAnchor = null;""")
edit('app', """  if (!el.menu.hidden && handMenuAnchor?.isConnected) positionPopup(handMenuAnchor, true);
  else el.menu.hidden = true;""", """  if (!el.menu.hidden && handMenuAnchor?.isConnected) positionPopup(handMenuAnchor, true);
  // The loop-repeat menu belongs to the transport, so following the playhead does not close it.
  else if (!el.menu.classList.contains('transport-menu')) el.menu.hidden = true;""")
edit('app', """el.stop.addEventListener('click', useSquareButton);""",
     """el.stop.addEventListener('click', useSquareButton);
el.loopRepeat.addEventListener('click', event => openLoopRepeatMenu(event.currentTarget));""")
edit('index', """      <button type="button" id="stop" class="icon" title="停止" aria-label="停止" disabled><svg><use href="#i-stop"/></svg></button>
""", """      <button type="button" id="stop" class="icon" title="停止" aria-label="停止" disabled><svg><use href="#i-stop"/></svg></button>
      <button type="button" id="loopRepeat" class="loop-repeat" data-i18n-title="loop.repeatButton" title="再循环几次后继续向后播放" aria-haspopup="true" hidden>↻ 再循环…</button>
""")
edit('style', """.transport-inner { max-width: 620px; min-height: 52px; margin: auto; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); place-items: center; }""",
     """.transport-inner { max-width: 620px; min-height: 52px; margin: auto; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); place-items: center; position: relative; }
/* 1.61: loop-repeat chip, shown above the square only while a loop plays. */
.loop-repeat { position: absolute; bottom: calc(100% + 6px); transform: translateX(-50%); z-index: 4; min-height: 32px; padding: 4px 12px; border: 1px solid #98bde9; border-radius: 16px; background: #fff; color: var(--blue); font-size: 13px; font-weight: 600; white-space: nowrap; box-shadow: 0 2px 8px #0002; touch-action: manipulation; }
.loop-repeat.pending { background: var(--blue); border-color: var(--blue); color: #fff; }""")
edit('i18n', """    'stop.released': '播完本轮后继续向后播放。',""", """    'stop.released': '播完本轮后继续向后播放。',
    'stop.repeatWait': '将再循环 {n} 次后继续播放',
    'loop.repeatButton': '再循环几次后继续向后播放',
    'loop.repeatChip': '↻ 再循环…',
    'loop.repeatLeft': '↻ 再循环 {n} 次',
    'loop.repeatTimes': '再循环 {n} 次后继续',
    'loop.keepLooping': '取消继续，保持循环',
    'loop.repeatSet': '将再循环 {n} 次，然后向后继续播放。',
    'loop.keptLooping': '已取消继续，当前区间保持循环。',""")
edit('i18n', """    'stop.released': 'Finishing this pass, then continuing.',""", """    'stop.released': 'Finishing this pass, then continuing.',
    'stop.repeatWait': 'Continues after {n} more loop pass(es)',
    'loop.repeatButton': 'Repeat the loop a few more times, then continue',
    'loop.repeatChip': '↻ Repeat…',
    'loop.repeatLeft': '↻ {n} more',
    'loop.repeatTimes': 'Loop {n} more time(s), then continue',
    'loop.keepLooping': 'Keep looping (cancel continue)',
    'loop.repeatSet': 'The loop plays {n} more time(s), then playback continues.',
    'loop.keptLooping': 'Continue cancelled; the section keeps looping.',""")
edit('guide', """方块在轨道循环中先释放循环并继续往后走，其余情况下停止。""",
     """方块在轨道循环中先释放循环并继续往后走，其余情况下停止。循环播放时，方块上方出现「↻ 再循环…」按钮：可选再循环 1–8 次后自动向后继续，按钮显示剩余次数；选「取消继续，保持循环」可撤回；直接按方块仍为播完本轮后继续。""")
edit('guide', """播放时按停止方块，会在本轮终点释放当前循环并继续后面的内容。""",
     """播放时按停止方块，会在本轮终点释放当前循环并继续后面的内容；也可用方块上方的「↻ 再循环…」先再循环 1–8 次再继续。""")
edit('guide_en', """During a track loop, the square button releases the loop and lets playback continue; otherwise it stops.""",
     """During a track loop, the square button releases the loop and lets playback continue; otherwise it stops. While a loop plays, a ↻ Repeat… chip above the square plays the loop 1–8 more times before continuing and shows the passes left; Keep looping cancels a pending continue. The square alone still continues after the current pass.""")
edit('guide_en', """During playback, the Stop square releases the active loop at the end of its current pass and continues into the following section.""",
     """During playback, the Stop square releases the active loop at the end of its current pass and continues into the following section; the ↻ Repeat… chip above it first plays the loop 1–8 more times.""")

# ================================================================ 2. Blue box on the playing note of every track
section('playing')
edit('style', """.slot.playing::after { content: ""; position: absolute; top: 5px; bottom: 5px; left: var(--stem-offset, 50%); width: 2px; background: var(--blue); opacity: .75; pointer-events: none; }""",
     """/* 1.61: every track marks its playing note with a blue box over the note head (was a 2px line). */
.slot.playing::after { content: ""; position: absolute; top: calc(72% - 14px); left: var(--stem-offset, 50%); width: 28px; max-width: calc(100% + 6px); height: 28px; box-sizing: border-box; transform: translateX(-50%); border: 3px solid var(--blue); border-radius: 4px; background: #2876e824; pointer-events: none; }""")
edit('guide', """<dt>跟随按钮与画面拖动</dt><dd>""", """<dt>播放位置</dt><dd>播放时每条轨道都用蓝色方框框住正在播放的音符（休止处框住该位置），各轨道按自己的速度与循环独立移动；暂停时方框停在原处，停止后消失。</dd>
        <dt>跟随按钮与画面拖动</dt><dd>""")
edit('guide_en', """<dt>Follow and panning</dt><dd>""", """<dt>Playback position</dt><dd>During playback every track frames its playing note (or rest position) with a blue box. Each track moves with its own tempo and loops. Pausing keeps the boxes in place; stopping removes them.</dd>
    <dt>Follow and panning</dt><dd>""")

# ================================================================ 3. Hold a note key to lock it for tap entry
section('lock')
edit('app', """let keyboardType = '';""", """let keyboardType = '';
let noteLock; // 1.61: {stroke, type} while a note key (or Rest, stroke null) is locked for tap entry""")
edit('app', """  el.showKeys.setAttribute('aria-pressed', keysOpen);
  if (!keysOpen) return;""", """  el.showKeys.setAttribute('aria-pressed', keysOpen);
  if (!keysOpen) { if (noteLock) setNoteLock(); return; }""")
edit('app', """  const strokeKey = stroke => {
    const node = key('', () => writeStroke(stroke));
    const label = noteLabel(stroke, type);
    node.setAttribute('aria-label', label);
    node.title = label;""", """  const strokeKey = stroke => {
    const node = lockableKey(key('', () => tapNoteKey(stroke)), stroke);
    const label = noteLabel(stroke, type);
    node.setAttribute('aria-label', label);
    node.title = label + ' · ' + t('keys.lockHint');""")
edit('app', """    key(t('keys.rest'), () => writeStroke(null), 'silence'), key('←', () => moveCursor(-1), 'aux'), key('→', () => moveCursor(1), 'aux'));
  el.keys.replaceChildren(...rows, main, nav);
}""", """    lockableKey(key(t('keys.rest'), () => tapNoteKey(null), 'silence'), null), key('←', () => moveCursor(-1), 'aux'), key('→', () => moveCursor(1), 'aux'));
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
}""")
edit('app', """          const hand = event.target.classList.contains('hand-dot');
          const activate = quickDoubleTap(event, hand ? 'hand' : 'note');
          const {scrollLeft, scrollTop} = scoreEditViewport(event.currentTarget);
          selectSlot(track.id, beat, slot);
          el.paper.scrollTo({left: scrollLeft, top: scrollTop, behavior: 'instant'});
          if (activate) {""", """          const hand = event.target.classList.contains('hand-dot');
          // 1.61: with a locked note key, a tap enters that note (the 1 s hold still opens the beat menu).
          const locked = Boolean(noteLock) && !hand;
          const activate = !locked && quickDoubleTap(event, hand ? 'hand' : 'note');
          const {scrollLeft, scrollTop} = scoreEditViewport(event.currentTarget);
          selectSlot(track.id, beat, slot);
          el.paper.scrollTo({left: scrollLeft, top: scrollTop, behavior: 'instant'});
          if (locked) writeLockedStroke();
          else if (activate) {""")
edit('app', """    if (!el.menu.hidden || !el.beatMenu.hidden) closePopups();
    else if (multiGroups) finishMultiGroups();""", """    if (!el.menu.hidden || !el.beatMenu.hidden) closePopups();
    else if (noteLock) unlockNote();
    else if (multiGroups) finishMultiGroups();""")
edit('style', """.key.aux svg { width: 25px; height: 25px; fill: none; stroke: currentColor; stroke-width: 1.7; }""",
     """.key.aux svg { width: 25px; height: 25px; fill: none; stroke: currentColor; stroke-width: 1.7; }
/* 1.61: a note key locked for tap entry (hold 1 s). */
.key { position: relative; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
.key.locked, .key.locked:hover:not(:disabled) { background: var(--blue); color: #fff; box-shadow: inset 0 0 0 2px #0b3f7f; }
.key.locked::after { content: ""; position: absolute; top: 5px; right: 6px; width: 8px; height: 8px; border-radius: 50%; background: #fff; }
#paper.note-lock .slot { cursor: copy; }""")
edit('i18n', """    'keys.beatCleared': '已清空蓝框内的音符',""", """    'keys.beatCleared': '已清空蓝框内的音符',
    'keys.lockHint': '长按 1 秒锁定，之后点按谱面符杆即可连续输入该音符',
    'lock.on': '已锁定「{note}」：点按谱面符杆即写入该音符，再点同一位置可清除。轻点该键或按 Esc 解锁。',
    'lock.onRest': '已锁定「休止」：点按谱面符杆即清除该位置的音符。轻点该键或按 Esc 解锁。',
    'lock.off': '已解除音符锁定。',
    'lock.unsupported': '「{track}」没有锁定的音符「{note}」，仅选中该位置。',""")
edit('i18n', """    'keys.beatCleared': 'Cleared notes in the selected group',""", """    'keys.beatCleared': 'Cleared notes in the selected group',
    'keys.lockHint': 'Hold for 1 second to lock, then tap stems to enter this note repeatedly',
    'lock.on': 'Locked “{note}”: tap stems to enter it; tap the same stem again to clear it. Tap the key again or press Esc to unlock.',
    'lock.onRest': 'Locked Rest: tap stems to clear their notes. Tap the key again or press Esc to unlock.',
    'lock.off': 'Note lock released.',
    'lock.unsupported': '“{track}” has no “{note}” stroke; the position is only selected.',""")
edit('guide', """Bell、Shekere 使用 X。</dd>""", """Bell、Shekere 使用 X。长按任一鼓音键或「休止」1 秒可锁定该键（键变为蓝色）：之后点按谱面符杆即在该位置写入此音符，光标不前进；再点同一位置可清除，锁定「休止」则点按即清除。锁定期间双击符杆不再打开拍菜单，长按符杆 1 秒仍可打开；轻点被锁定的键或按 Esc 解锁，长按其他键可改锁该键。</dd>""")
edit('guide_en', """Bell and Shekere use X.</dd>""", """Bell and Shekere use X. Hold any stroke key or Rest for 1 second to lock it (the key turns blue): tapping a stem then enters that note there without moving on; tap the same stem again to clear it, and a locked Rest clears what you tap. While locked, a double-tap no longer opens the beat menu, but a 1-second hold on a stem still does. Tap the locked key or press Esc to unlock; hold another key to move the lock.</dd>""")

# ================================================================ About text (all three)
section('common')
edit('i18n', """    'help.aboutUpdate': '本版新增轨道菜单「复制本轨道」（连同音符复制全部内容）；已写入音符时可直接切分或更换细分，无需先清空；所有双击打开的菜单也可长按 1 秒打开，并自动避开长按位置，防止误按。',""",
     """    'help.aboutUpdate': '本版新增：循环播放时可用方块上方的「↻ 再循环…」选择再循环 1–8 次后继续；播放时每条轨道用蓝色方框标出正在播放的音符；长按音符键 1 秒可锁定该音符，点按谱面即可连续输入。',""")
edit('i18n', """    'help.aboutUpdate': 'This release adds Duplicate Track to the track menu (copies everything, notes included), lets you split cells or change subdivisions without clearing written notes, and opens every double-tap menu with a 1-second hold as well, placed clear of the held point to prevent mistaken taps.',""",
     """    'help.aboutUpdate': 'This release adds a ↻ Repeat… chip that plays a loop 1–8 more times before continuing, marks the playing note of every track with a blue box, and lets you hold a note key for 1 second to lock it and enter it by tapping the score.',""")

# ---------------------------------------------------------------- Version 1.60 -> 1.61
VERSION_FILES = {  # Win11 file: expected count of '1.60' and '2026-11-21'
    'app': (2, 0), 'index': (1, 2), 'guide': (2, 3), 'guide_en': (1, 1),
}
ANDROID_VERSION_COUNTS = (6, 6)


def apply(text, edits, label):
    for kind, old, new, _, count in edits:
        found = text.count(old)
        if found != count:
            raise SystemExit(f'{label}: [{kind}] expected {count} match(es), found {found}: {old[:90]!r}')
        text = text.replace(old, new)
    return text


def bump(text, counts, label):
    # Version strings only ("1.60 ·", '1.60', -1.60.json). Code comments such as "// 1.60: ..." keep the
    # version that introduced them, and the synthesis constant 1.60 in the audio tables stays untouched.
    for pattern, new, expected in ((r"1\.60(?= ·|'|\.json)", '1.61', counts[0]), (r'2026-11-21', '2026-11-22', counts[1])):
        text, found = re.subn(pattern, new, text)
        if found != expected:
            raise SystemExit(f'{label}: expected {expected} × {pattern}, found {found}')
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
