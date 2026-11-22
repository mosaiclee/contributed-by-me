"""RhythmDesk 1.62 -> 1.63: apply the same editor changes to the Win11 sources and the Android page.

Usage: python3 patch163.py WIN11_UI_DIR ANDROID_INDEX_HTML

Every edit must match the stated number of times (default once) in the Win11 source file it belongs
to and in the Android page (which carries the same scripts, style and guide in one file), so both
platforms stay in step. Nothing is written unless every edit applies.
"""
import re
import sys
from pathlib import Path

FILES = {
    'app': 'app.js', 'audio': 'audio.js', 'model': 'model.js', 'i18n': 'i18n.js', 'style': 'style.css',
    'index': 'index.html', 'guide': 'help/guide.html', 'guide_en': 'help/guide.en.html',
}

EDITS = []
SECTION = None
SECTIONS = {  # requirement each edit belongs to (used by the handoff document)
    'preset': '需求 1：每个循环区间预设循环次数，播完自动向后播放',
    'hold': '需求 2：所有长按激活改为 0.5 秒',
    'avoid': '需求 3：双击打开的菜单也避开点击位置',
    'common': '需求 4：说明书同步修正（关于页文字；各功能的说明随对应修改一并列出）',
}


def section(tag):
    global SECTION
    SECTION = tag


def edit(kind, old, new, count=1):
    EDITS.append((kind, old, new, SECTION, count))


# ================================================================ 1. Preset loop counts
section('preset')
edit('model', """const TRACK_LIMIT = 100;""", """const TRACK_LIMIT = 100;
const LOOP_TIMES_MAX = 999; // 1.63: most passes a loop can be preset to play""")
edit('model', """  const loops = ranges.map(range => {
    if (!range) throw new Error(t('err.loops'));
    return readRepeat(range, bars);
  }).sort((a, b) => a.from - b.from);""", """  const loops = ranges.map(range => {
    if (!range) throw new Error(t('err.loops'));
    // 1.63: keep a loop's preset `times` (total passes, 1-999); any other value means "loop until stopped".
    const loop = readRepeat(range, bars);
    if (Number.isInteger(range.times) && range.times >= 1 && range.times <= LOOP_TIMES_MAX) loop.times = range.times;
    return loop;
  }).sort((a, b) => a.from - b.from);""")
edit('model', """  const afterRemoval = range => ({
    from: range.from - Number(bar < range.from), to: range.to - Number(bar < range.to)
  });""", """  const afterRemoval = range => ({ // 1.63: ...range keeps a loop's preset times
    ...range, from: range.from - Number(bar < range.from), to: range.to - Number(bar < range.to)
  });""")
edit('model', """    const loops = track.loops.map(range => ({from: range.from + 1, to: range.to + 1}));""",
     """    const loops = track.loops.map(range => ({...range, from: range.from + 1, to: range.to + 1}));""")
edit('model', """  track.loops = track.loops.map(range => ({from: range.from - Number(bar < range.from), to: range.to - Number(bar < range.to)}))""",
     """  track.loops = track.loops.map(range => ({...range, from: range.from - Number(bar < range.from), to: range.to - Number(bar < range.to)}))""")
edit('audio', """    this.gates = this.loops.map(range => ({...range, released: false, repeats: 0}));""",
     """    // 1.63: a loop with a preset count starts released with (times - 1) extra passes, so it plays
    // `times` passes in all and then continues; the repeat chip or the square can still change that.
    this.gates = this.loops.map(range => ({...range, released: range.times > 0, repeats: Math.max(0, (range.times || 0) - 1)}));""")
edit('audio', """      const loops = track.loops.map(({from, to}) => ({from: barSteps[from], to: barSteps[to]}))""",
     """      const loops = track.loops.map(({from, to, times}) => ({from: barSteps[from], to: barSteps[to], times}))""")
edit('app', """  line.dataset.barBoundary = bar;
""", """  line.dataset.barBoundary = bar;
  // 1.63: a loop with a preset count shows ×N beside its closing barline.
  const timed = side !== 'start' && track.loops.find(range => range.to === bar && range.times);
  if (timed) {
    const mark = document.createElement('span');
    mark.className = 'loop-times';
    mark.textContent = '×' + timed.times;
    mark.setAttribute('aria-hidden', 'true');
    line.append(mark);
    line.title += ' · ' + t('loop.timesState', {n: timed.times});
    line.setAttribute('aria-label', line.title);
  }
""")
edit('app', """    ...(incoming ? [[t('loop.editEnd'), () => { loopStart = {id: track.id, bar: incoming.from}; notify(t('bar.pickEnd')); }]] : []),
""", """    ...(incoming ? [[t('loop.editEnd'), () => { loopStart = {id: track.id, bar: incoming.from}; notify(t('bar.pickEnd')); }]] : []),
    ...(incoming ? [[t('loop.timesIncoming', {state: loopTimesState(incoming)}), () => openLoopTimesDialog(track, incoming)]] : []),
    ...(outgoing ? [[t('loop.timesOutgoing', {state: loopTimesState(outgoing)}), () => openLoopTimesDialog(track, outgoing)]] : []),
""")
edit('app', """    [range ? t('track.loopOff') : t('track.loopOn'), () => {
      if (range) removeTrackLoop(track, range);
      else addTrackLoop(track, bar, bar + 1);
    }],
""", """    [range ? t('track.loopOff') : t('track.loopOn'), () => {
      if (range) removeTrackLoop(track, range);
      else addTrackLoop(track, bar, bar + 1);
    }],
    ...(range ? [[t('track.loopTimes', {state: loopTimesState(range)}), () => openLoopTimesDialog(track, range)]] : []),
""")
edit('app', """function removeTrackLoop(track, range) {""", """// 1.63: preset how many times a track loop plays in total (1-999, including the first pass) before
// playback continues by itself. Blank or "Loop until stopped" keeps looping until the square is pressed.
function loopTimesState(range) {
  return range.times ? t('loop.timesState', {n: range.times}) : t('loop.timesUnset');
}

function openLoopTimesDialog(source, range) {
  closePopups();
  const panel = document.createElement('dialog'); panel.className = 'tempo-editor loop-times-editor';
  const form = document.createElement('form'); form.className = 'tempo-form';
  const title = document.createElement('h3');
  const bars = range.to - range.from > 1 ? t('loop.bars', {from: range.from + 1, to: range.to}) : t('bar.measure', {bar: range.to});
  title.textContent = t('loop.timesTitle', {track: source.name, bars});
  const controls = document.createElement('div'); controls.className = 'tempo-controls';
  const input = document.createElement('input'); input.type = 'number'; input.min = 1; input.max = LOOP_TIMES_MAX;
  input.step = 1; input.inputMode = 'numeric'; input.value = range.times ?? ''; input.placeholder = t('loop.timesUnset');
  input.setAttribute('aria-label', title.textContent);
  const bump = n => { input.value = clamp(Math.round(Number(input.value) || 1) + n, 1, LOOP_TIMES_MAX); };
  controls.append(button('−', () => bump(-1)), input, button('+', () => bump(1)));
  const hint = document.createElement('p'); hint.className = 'loop-repeat-hint'; hint.textContent = t('loop.timesHint');
  const actions = document.createElement('div'); actions.className = 'tempo-actions';
  const confirm = document.createElement('button'); confirm.type = 'submit'; confirm.className = 'tempo-confirm';
  confirm.textContent = t('dialog.done');
  actions.append(button(t('dialog.cancel'), () => panel.close(), 'tempo-cancel'), confirm);
  form.append(title, controls, hint, actions);
  if (range.times) form.append(button(t('loop.timesClear'), () => { panel.close(); setLoopTimes(source, range, null); }, 'loop-keep'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (input.value.trim() === '' && !input.validity.badInput) { panel.close(); setLoopTimes(source, range, null); return; }
    const times = Number(input.value);
    if (!Number.isInteger(times) || times < 1 || times > LOOP_TIMES_MAX) { input.reportValidity(); return; }
    panel.close();
    setLoopTimes(source, range, times);
  });
  panel.append(form);
  panel.addEventListener('close', () => panel.remove(), {once: true});
  document.body.append(panel); panel.showModal();
  input.select();
}

function setLoopTimes(source, range, times) {
  const track = doc.tracks.find(item => item.id === source.id);
  const loop = track?.loops.find(item => item.from === range.from && item.to === range.to);
  if (!loop || (loop.times ?? null) === times) return;
  change(() => { if (times) loop.times = times; else delete loop.times; }, true);
  notify(times ? t('loop.timesSet', {n: times}) : t('loop.timesCleared'));
}

function removeTrackLoop(track, range) {""")
edit('style', """.loop-keep { display: block; width: 100%; min-height: 44px; margin-top: 12px; border-radius: 9px; background: #f0f5fc; color: var(--blue); font-size: 15px; font-weight: 600; }""",
     """.loop-keep { display: block; width: 100%; min-height: 44px; margin-top: 12px; border-radius: 9px; background: #f0f5fc; color: var(--blue); font-size: 15px; font-weight: 600; }
/* 1.63: preset loop count beside a loop's closing barline. */
.loop-times { position: absolute; right: calc(100% - 4px); top: -19px; padding: 0 2px; color: var(--blue); font-size: 17px; font-weight: 800; line-height: 1; white-space: nowrap; pointer-events: none; }""")
edit('i18n', """    'loop.repeatGone': '循环已经结束，未作更改。',""", """    'loop.repeatGone': '循环已经结束，未作更改。',
    'loop.timesIncoming': '设置结束于此的循环次数…（{state}）',
    'loop.timesOutgoing': '设置起始于此的循环次数…（{state}）',
    'track.loopTimes': '设置本小节循环次数…（{state}）',
    'loop.timesState': '共 {n} 遍',
    'loop.timesUnset': '一直循环',
    'loop.bars': '第 {from}–{to} 小节',
    'loop.timesTitle': '「{track}」{bars}循环次数',
    'loop.timesHint': '填写该循环一共播放几遍（含第一遍，1–999），播放到这里时播完这些遍数自动向后继续。留空表示一直循环，直到按方块。',
    'loop.timesClear': '一直循环（清除次数）',
    'loop.timesSet': '该循环将共播放 {n} 遍，然后自动向后继续。',
    'loop.timesCleared': '该循环已改为一直循环，按方块才向后继续。',""")
edit('i18n', """    'loop.repeatGone': 'The loop has already ended; nothing changed.',""", """    'loop.repeatGone': 'The loop has already ended; nothing changed.',
    'loop.timesIncoming': 'Times for Loop Ending Here… ({state})',
    'loop.timesOutgoing': 'Times for Loop Starting Here… ({state})',
    'track.loopTimes': 'Loop Times for This Measure… ({state})',
    'loop.timesState': '{n}×',
    'loop.timesUnset': 'until stopped',
    'loop.bars': 'Measures {from}–{to}',
    'loop.timesTitle': '“{track}” {bars} loop times',
    'loop.timesHint': 'How many times the loop plays in total (including the first pass, 1–999); after that many passes playback continues by itself. Leave blank to loop until the square is pressed.',
    'loop.timesClear': 'Loop until stopped (clear count)',
    'loop.timesSet': 'This loop plays {n} times in total, then playback continues.',
    'loop.timesCleared': 'This loop now repeats until the square is pressed.',""")
edit('guide', """已设终点可再次修改。""", """已设终点可再次修改。每个循环都可预设循环次数：在小节边界菜单的「设置起始／结束于此的循环次数…」或轨道「⋯」的「设置本小节循环次数…」中填写共播放几遍（1–999，含第一遍），播放到该循环时播完这些遍数便自动向后继续；同一轨道的多个循环各自独立设定。有预设次数的循环在结束竖线左上方显示「×N」；留空或选「一直循环（清除次数）」则一直循环，直到按方块。次数随鼓谱保存。""")
edit('guide', """直接按方块仍为播完本轮后继续。""", """直接按方块仍为播完本轮后继续。有预设次数的循环从进入时起就显示剩余次数，也可用此按钮临时改写或取消（只影响本次播放）。""")
edit('guide_en', """Existing loop ends can be changed.""", """Existing loop ends can be changed. Each loop can preset how many times it plays in total (1–999, including the first pass) from Times for Loop Starting/Ending Here… in the barline menu or Loop Times for This Measure… in the track ⋯ menu; when playback reaches the loop it plays that many passes and then continues by itself. Several loops on one track keep their own counts. A loop with a preset count shows ×N above its closing barline; leave the count blank, or choose Loop until stopped, to loop until the square is pressed. Counts are saved with the score.""")
edit('guide_en', """The square alone still continues after the current pass.""", """The square alone still continues after the current pass. A loop with a preset count shows its remaining passes as soon as it starts; the chip can change or cancel them for the current playback only.""")

# ================================================================ 2. 0.5-second hold
section('hold')
edit('app', """// 1.60: every control that opens a menu on a double-tap also opens it when held for one second
// (finger, pen or left mouse button). The menu then keeps clear of the held point, and the click
// that ends the hold is dropped, so lifting the finger never chooses a menu item.
const MENU_HOLD_MS = 1000;""", """// 1.60: every control that opens a menu on a double-tap also opens it when held (finger, pen or left
// mouse button). The menu then keeps clear of the held point, and the click that ends the hold is
// dropped, so lifting the finger never chooses a menu item.
// 1.63: the hold takes 0.5 s (was 1 s), and a menu opened by a double-tap keeps clear of the tap too.
const MENU_HOLD_MS = 500;""")
edit('i18n', """快速双击或长按 1 秒更换',""", """快速双击或长按 0.5 秒更换',""")
edit('i18n', """'Measure {bar}, group {group}: {meter}. Double-tap or hold for 1 second to change the group meter.',""",
     """'Measure {bar}, group {group}: {meter}. Double-tap or hold for 0.5 seconds to change the group meter.',""")
edit('i18n', """    'keys.lockHint': '长按 1 秒锁定，之后点按谱面符杆即可连续输入该音符',""",
     """    'keys.lockHint': '长按 0.5 秒锁定，之后点按谱面符杆即可连续输入该音符',""")
edit('i18n', """    'keys.lockHint': 'Hold for 1 second to lock, then tap stems to enter this note repeatedly',""",
     """    'keys.lockHint': 'Hold for 0.5 seconds to lock, then tap stems to enter this note repeatedly',""")
edit('i18n', """    'bar.pickEnd': '请快速双击或长按 1 秒同一音轨后面的小节线，设置循环终点。',""",
     """    'bar.pickEnd': '请快速双击或长按 0.5 秒同一音轨后面的小节线，设置循环终点。',""")
edit('i18n', """    'bar.pickEnd': 'Double-tap a later barline on the same track, or hold it for 1 second, to set the loop end.',""",
     """    'bar.pickEnd': 'Double-tap a later barline on the same track, or hold it for 0.5 seconds, to set the loop end.',""")
edit('guide', """（间隔小于 0.25 秒）或按住 1 秒打开拍菜单。双击或长按 1 秒符杆上方蓝点""",
     """（间隔小于 0.25 秒）或按住 0.5 秒打开拍菜单。双击或长按 0.5 秒符杆上方蓝点""")
edit('guide', """同样可双击或长按 1 秒打开；""", """同样可双击或长按 0.5 秒打开；""")
edit('guide_en', """Barline, group-meter and group-tempo menus also open with a double-tap or a 1-second hold.""",
     """Barline, group-meter and group-tempo menus also open with a double-tap or a 0.5-second hold.""")
edit('guide', """长按任一鼓音键或「休止」1 秒可锁定该键""", """长按任一鼓音键或「休止」0.5 秒可锁定该键""")
edit('guide', """长按符杆 1 秒仍可打开""", """长按符杆 0.5 秒仍可打开""")
edit('guide', """或双击／长按 1 秒谱面边界线""", """或双击／长按 0.5 秒谱面边界线""")
edit('guide', """双击或长按 1 秒小节边界设置轨道循环起点与终点。""", """双击或长按 0.5 秒小节边界设置轨道循环起点与终点。""")
edit('guide', """双击或长按 1 秒横线组拍号旁的速度""", """双击或长按 0.5 秒横线组拍号旁的速度""")
edit('guide_en', """Tap the same stem twice within 0.25 seconds, or hold it for 1 second, to open its beat menu.""",
     """Tap the same stem twice within 0.25 seconds, or hold it for 0.5 seconds, to open its beat menu.""")
edit('guide_en', """Hold any stroke key or Rest for 1 second to lock it""", """Hold any stroke key or Rest for 0.5 seconds to lock it""")
edit('guide_en', """but a 1-second hold on a stem still does.""", """but a 0.5-second hold on a stem still does.""")
edit('guide_en', """or double-tap or hold a barline for 1 second for measure actions.""",
     """or double-tap or hold a barline for 0.5 seconds for measure actions.""")
edit('guide_en', """Double-tap barlines, or hold them for 1 second, to set a track loop start and end.""",
     """Double-tap barlines, or hold them for 0.5 seconds, to set a track loop start and end.""")
edit('guide_en', """double-tap or hold for 1 second the tempo beside a group meter""",
     """double-tap or hold for 0.5 seconds the tempo beside a group meter""")

# ================================================================ 3. Menus opened by a double-tap keep clear of the tap
section('avoid')
edit('app', """let menuHoldPoint = null;""",
     """let menuHoldPoint = null; // point the open menu keeps clear of; `id` is set while that finger is still down""")
edit('app', """      menuHoldPoint = {id: press.id, x: press.x, y: press.y};""",
     """      setMenuAvoidPoint(node, press.x, press.y, press.id);""")
edit('app', """document.addEventListener('pointerdown', event => {
  // A second finger (pinch) or another pointer ends the hold.""", """document.addEventListener('pointerdown', event => {
  // 1.63: a new press is a new request, so forget the point the last menu kept clear of.
  menuHoldPoint = null;
  // A second finger (pinch) or another pointer ends the hold.""")
edit('app', """    if (menuHoldPoint?.id !== event.pointerId) return;
    menuHoldPoint = null;
    menuHoldClickUntil = performance.now() + 400;""", """    if (menuHoldPoint?.id == null || menuHoldPoint.id !== event.pointerId) return;
    menuHoldPoint.id = null; // 1.63: the finger lifted; the point now moves with the control under it
    menuHoldClickUntil = performance.now() + 400;""")
edit('app', """// Move a menu box {left, top, width, height} so it does not cover the point still held by a long press.
// Returns the same object when no move is needed.
function clearOfMenuHold(box, bounds) {
  const point = menuHoldPoint;""", """// 1.63: remember where a menu was asked for, as a screen point and as a place on the control, so the
// point follows the score if it scrolls after the finger has lifted.
function setMenuAvoidPoint(node, x, y, id = null) {
  const rect = node.getBoundingClientRect();
  menuHoldPoint = {id, x, y, node, fx: rect.width ? (x - rect.left) / rect.width : .5,
    fy: rect.height ? (y - rect.top) / rect.height : .5};
}

// 1.63: call with the click that completes a double-tap. Keyboard clicks carry no point (detail 0).
function markMenuTap(event) {
  if (event.detail && Number.isFinite(event.clientX)) setMenuAvoidPoint(event.currentTarget, event.clientX, event.clientY);
}

function menuAvoidPoint() {
  const point = menuHoldPoint;
  if (!point || point.id !== null || !point.node.isConnected) return point;
  const rect = point.node.getBoundingClientRect();
  return {x: rect.left + point.fx * rect.width, y: rect.top + point.fy * rect.height};
}

// Move a menu box {left, top, width, height} so it does not cover the point of the long press or
// double-tap that opened it. Returns the same object when no move is needed.
function clearOfMenuHold(box, bounds) {
  const point = menuAvoidPoint();""")
edit('app', """// The larger free height above or below the held point.
function menuHoldRoom(bounds) {
  const point = menuHoldPoint;""", """// The larger free height above or below the held or tapped point.
function menuHoldRoom(bounds) {
  const point = menuAvoidPoint();""")
edit('app', """  const reach = MENU_HOLD_CLEARANCE;
  const covers""", """  // 1.63: 2 px allowance, because event coordinates and layout sizes are rounded to whole pixels.
  const reach = MENU_HOLD_CLEARANCE + 2;
  const covers""")
edit('app', """  const gap = MENU_HOLD_CLEARANCE + 2;""", """  const gap = MENU_HOLD_CLEARANCE + 4;""")
edit('app', """  const line = button('', event => { if (quickDoubleTap(event)) openTrackBoundary(track, bar, event.currentTarget, side); }, 'barline');""",
     """  const line = button('', event => {
    if (quickDoubleTap(event)) { markMenuTap(event); openTrackBoundary(track, bar, event.currentTarget, side); }
  }, 'barline');""")
edit('app', """          else if (activate) {
            if (hand) openHandMenu(event.currentTarget);""", """          else if (activate) {
            markMenuTap(event);
            if (hand) openHandMenu(event.currentTarget);""")
edit('app', """        event => { if (quickDoubleTap(event)) openGroupMeterMenu(event.currentTarget, track.id, beat); }, 'group-meter');""",
     """        event => { if (quickDoubleTap(event)) { markMenuTap(event); openGroupMeterMenu(event.currentTarget, track.id, beat); } }, 'group-meter');""")
edit('app', """        event => { if (quickDoubleTap(event)) openTempoEditor(track, bar, group); }, 'group-tempo');""",
     """        event => { if (quickDoubleTap(event)) { markMenuTap(event); openTempoEditor(track, bar, group); } }, 'group-tempo');""")
edit('app', """  // Opened by a one-second hold: keep the dialog's buttons away from the finger that is still down.""",
     """  // Opened by a hold or a double-tap: keep the dialog's buttons away from that point.""")
edit('guide', """长按打开的菜单会避开手指所在位置，松手不会误选；""",
     """无论双击还是长按，弹出的菜单都会避开点按位置，松手或多点一下都不会误选；""")
edit('guide_en', """A menu opened by holding appears clear of your finger, so lifting it never picks an item;""",
     """Whether opened by a double-tap or a hold, the menu appears clear of the tapped point, so lifting the finger or an extra tap never picks an item;""")

# ================================================================ 4. About text
section('common')
edit('i18n', """    'help.aboutUpdate': '本版：循环播放时可在方块上方的「↻ 再循环…」中自由输入再循环次数（1–999），播完后继续；播放时每条轨道用竖向蓝色长方框罩住正在播放音符的符杆和音头；长按音符键 1 秒可锁定该音符，点按谱面即可连续输入。',""",
     """    'help.aboutUpdate': '本版：每个循环区间可预设循环次数（共播放几遍），播完自动向后播放，同一轨道的多个循环各自设定；所有长按操作改为 0.5 秒；双击打开的菜单也会避开点按位置，防止误点。',""")
edit('i18n', """    'help.aboutUpdate': 'This release lets you type in the ↻ Repeat… chip how many more times (1–999) a loop plays before continuing, covers the stem and note head of every track’s playing note with a tall blue box, and lets you hold a note key for 1 second to lock it and enter it by tapping the score.',""",
     """    'help.aboutUpdate': 'This release lets every loop preset how many times it plays before playback continues by itself (each loop on a track has its own count), shortens every hold to 0.5 seconds, and places menus opened by a double-tap clear of the tapped point as well.',""")

# ---------------------------------------------------------------- Version 1.62 -> 1.63 (same date)
VERSION_FILES = {'app': 2, 'index': 1, 'guide': 2, 'guide_en': 1}  # Win11 file: version strings
ANDROID_VERSION_COUNT = 6


def apply(text, edits, label):
    for kind, old, new, _, count in edits:
        found = text.count(old)
        if found != count:
            raise SystemExit(f'{label}: [{kind}] expected {count} match(es), found {found}: {old[:90]!r}')
        text = text.replace(old, new)
    return text


def bump(text, expected, label):
    # Version strings only ("1.62 ·", '1.62', -1.62.json); code comments such as "// 1.62: ..." keep the
    # version that introduced them. The release date stays 2026-11-22.
    text, found = re.subn(r"1\.62(?= ·|'|\.json)", '1.63', text)
    if found != expected:
        raise SystemExit(f'{label}: expected {expected} version strings, found {found}')
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
    results[android] = bump(page, ANDROID_VERSION_COUNT, 'Android index.html')
    for path, text in results.items():
        path.write_bytes(text.encode('utf-8'))
    print(f'Applied {len(EDITS)} edits to {len(FILES)} Win11 source files and the Android page.')


if __name__ == '__main__':
    main()
