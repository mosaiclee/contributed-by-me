"""RhythmDesk 1.61 -> 1.62: apply the same editor changes to the Win11 sources and the Android page.

Usage: python3 patch162.py WIN11_UI_DIR ANDROID_INDEX_HTML

Every edit must match the stated number of times (default once) in the Win11 source file it belongs
to and in the Android page (which carries the same scripts, style and guide in one file), so both
platforms stay in step. Nothing is written unless every edit applies.
"""
import re
import sys
from pathlib import Path

FILES = {
    'app': 'app.js', 'i18n': 'i18n.js', 'style': 'style.css',
    'index': 'index.html', 'guide': 'help/guide.html', 'guide_en': 'help/guide.en.html',
}

EDITS = []
SECTION = None
SECTIONS = {  # requirement each edit belongs to (used by the handoff document)
    'count': '需求 1：循环次数自由填写（取代固定的 1–8 次菜单）',
    'docs': '需求 2：核对说明文件，不一致处同步更新',
    'box': '需求 3：播放位置改为竖向蓝色长方框，覆盖符杆',
    'common': '版本说明（三项修改共用）',
}


def section(tag):
    global SECTION
    SECTION = tag


def edit(kind, old, new, count=1):
    EDITS.append((kind, old, new, SECTION, count))


# ================================================================ 1. Type any repeat count
section('count')
edit('app', """// 1.61: repeat the playing loop 1-8 more times, then continue; or cancel a pending continue.
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
}""", """// 1.62: type how many more passes (1-999) the playing loop plays before continuing, instead of
// choosing from a fixed list; the same box can cancel a pending continue. Playback keeps running.
const LOOP_REPEAT_MAX = 999;
function openLoopRepeatDialog() {
  const gates = engine.paused ? [] : playingLoops;
  if (!gates.length) return;
  closePopups();
  const released = gates.every(gate => gate.released);
  const left = Math.max(0, ...gates.map(gate => gate.released ? gate.repeats || 0 : 0));
  const panel = document.createElement('dialog'); panel.className = 'tempo-editor loop-repeat-editor';
  const form = document.createElement('form'); form.className = 'tempo-form';
  const title = document.createElement('h3'); title.textContent = t('loop.repeatTitle');
  const controls = document.createElement('div'); controls.className = 'tempo-controls';
  const input = document.createElement('input'); input.type = 'number'; input.min = 1; input.max = LOOP_REPEAT_MAX;
  input.step = 1; input.required = true; input.inputMode = 'numeric'; input.value = left || 1;
  input.setAttribute('aria-label', t('loop.repeatTitle'));
  const bump = n => { input.value = clamp(Math.round(Number(input.value) || 1) + n, 1, LOOP_REPEAT_MAX); };
  controls.append(button('−', () => bump(-1)), input, button('+', () => bump(1)));
  const hint = document.createElement('p'); hint.className = 'loop-repeat-hint'; hint.textContent = t('loop.repeatHint');
  const actions = document.createElement('div'); actions.className = 'tempo-actions';
  const confirm = document.createElement('button'); confirm.type = 'submit'; confirm.className = 'tempo-confirm';
  confirm.textContent = t('dialog.done');
  actions.append(button(t('dialog.cancel'), () => panel.close(), 'tempo-cancel'), confirm);
  form.append(title, controls, hint, actions);
  if (released) form.append(button(t('loop.keepLooping'), () => { panel.close(); changeLoopRelease(null); }, 'loop-keep'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const times = Number(input.value);
    if (!Number.isInteger(times) || times < 1 || times > LOOP_REPEAT_MAX) { input.reportValidity(); return; }
    panel.close();
    changeLoopRelease(times);
  });
  panel.append(form);
  panel.addEventListener('close', () => panel.remove(), {once: true});
  document.body.append(panel); panel.showModal();
  input.select();
}""")
edit('app', """  if (!(times === null ? engine.keepLooping() : engine.releaseLoop(times))) return;""",
     """  if (!(times === null ? engine.keepLooping() : engine.releaseLoop(times))) { notify(t('loop.repeatGone')); return; }""")
edit('app', """  } else if (el.menu.classList.contains('transport-menu')) closePopups();
""", """  } else document.querySelector('dialog.loop-repeat-editor[open]')?.close(); // the loop ended or playback paused
""")
edit('app', """function closePopups() {
  el.menu.classList.remove('transport-menu');
  beatMenuAnchor = null;""", """function closePopups() {
  beatMenuAnchor = null;""")
edit('app', """  if (!el.menu.hidden && handMenuAnchor?.isConnected) positionPopup(handMenuAnchor, true);
  // The loop-repeat menu belongs to the transport, so following the playhead does not close it.
  else if (!el.menu.classList.contains('transport-menu')) el.menu.hidden = true;""",
     """  if (!el.menu.hidden && handMenuAnchor?.isConnected) positionPopup(handMenuAnchor, true);
  else el.menu.hidden = true;""")
edit('app', """el.loopRepeat.addEventListener('click', event => openLoopRepeatMenu(event.currentTarget));""",
     """el.loopRepeat.addEventListener('click', () => openLoopRepeatDialog());""")
# Fix of 1.61: the chip and the Stop tooltip did not count down. Gate objects are updated in place
# (repeats--), so recomputing the "old" state from them always equalled the new state.
edit('app', """let playingLoops = [];""", """let playingLoops = [];
let playingLoopState = ''; // 1.62: loop state last shown in the transport""")
edit('app', """  const oldGateState = playingLoops.map(g => `${g.from}/${g.to}/${g.released}/${g.repeats}`).join();
  playingLoops = gates;""", """  // 1.62: compare with the state last shown; gate objects change in place while repeats count down.
  const oldGateState = playingLoopState;
  playingLoops = gates;
  playingLoopState = gates.map(g => `${g.from}/${g.to}/${g.released}/${g.repeats}`).join();""")
edit('app', """  playingLoops = [];
  paintPlaySteps(finalPositions instanceof Map ? finalPositions : new Map());""", """  playingLoops = [];
  playingLoopState = '';
  paintPlaySteps(finalPositions instanceof Map ? finalPositions : new Map());""")
edit('style', """.loop-repeat.pending { background: var(--blue); border-color: var(--blue); color: #fff; }""",
     """.loop-repeat.pending { background: var(--blue); border-color: var(--blue); color: #fff; }
/* 1.62: repeat-count box (reuses the tempo dialog layout). */
.loop-repeat-hint { margin: 0; text-align: center; font-size: 13px; line-height: 1.45; color: #5a6878; }
.loop-keep { display: block; width: 100%; min-height: 44px; margin-top: 12px; border-radius: 9px; background: #f0f5fc; color: var(--blue); font-size: 15px; font-weight: 600; }""")
edit('i18n', """    'loop.repeatTimes': '再循环 {n} 次后继续',""", """    'loop.repeatTitle': '再循环次数',
    'loop.repeatHint': '输入本轮之后还要再循环的次数（1–999），播完后自动向后继续。',
    'loop.repeatGone': '循环已经结束，未作更改。',""")
edit('i18n', """    'loop.repeatTimes': 'Loop {n} more time(s), then continue',""", """    'loop.repeatTitle': 'Repeat count',
    'loop.repeatHint': 'How many more times the loop plays after this pass (1–999); then playback continues.',
    'loop.repeatGone': 'The loop has already ended; nothing changed.',""")
edit('guide', """可选再循环 1–8 次后自动向后继续，按钮显示剩余次数；选「取消继续，保持循环」可撤回；""",
     """点开后直接输入要再循环的次数（1–999，也可用 −／＋ 调整），点「完成」后先播完这些次数再自动向后继续，按钮显示剩余次数；弹窗中的「取消继续，保持循环」可撤回已设定的继续；""")
edit('guide', """也可用方块上方的「↻ 再循环…」先再循环 1–8 次再继续。""",
     """也可用方块上方的「↻ 再循环…」输入再循环次数（1–999），先播完这些次数再继续。""")
edit('guide_en', """a ↻ Repeat… chip above the square plays the loop 1–8 more times before continuing and shows the passes left; Keep looping cancels a pending continue.""",
     """a ↻ Repeat… chip above the square opens a box: type how many more times the loop plays (1–999, or use −/+), choose Done, and playback continues once those passes finish; the chip shows the passes left. Keep looping in that box cancels a pending continue.""")
edit('guide_en', """the ↻ Repeat… chip above it first plays the loop 1–8 more times.""",
     """the ↻ Repeat… chip above it lets you type how many more times (1–999) the loop plays first.""")

# ================================================================ 3. Tall playing box over the stem
section('box')
edit('style', """/* 1.61: every track marks its playing note with a blue box over the note head (was a 2px line). */
.slot.playing::after { content: ""; position: absolute; top: calc(72% - 14px); left: var(--stem-offset, 50%); width: 28px; max-width: calc(100% + 6px); height: 28px; box-sizing: border-box; transform: translateX(-50%); border: 3px solid var(--blue); border-radius: 4px; background: #2876e824; pointer-events: none; }""",
     """/* 1.62: every track marks its playing note with a tall blue box that covers the whole stem (from the beam)
   and the note head; 1.61 used a square over the note head, 1.59 a 2px line. */
.slot.playing::after { content: ""; position: absolute; top: 19%; bottom: 5%; left: var(--stem-offset, 50%); width: 22px; max-width: calc(100% + 4px); box-sizing: border-box; transform: translateX(-50%); border: 3px solid var(--blue); border-radius: 5px; background: #2876e824; pointer-events: none; }""")
edit('guide', """播放时每条轨道都用蓝色方框框住正在播放的音符（休止处框住该位置）""",
     """播放时每条轨道都用竖向的蓝色长方框罩住正在播放的音符，覆盖整根符杆和音头（休止处罩住该位置的竖线）""")
edit('guide_en', """During playback every track frames its playing note (or rest position) with a blue box.""",
     """During playback every track covers its playing note with a tall blue box spanning the stem and note head (at a rest, the stem position).""")

# ================================================================ 2. Guide wording checked against the editor
section('docs')
# The selection frame and the playing box are both blue now: call the selection the blue selection frame.
edit('guide', """回到当前轨道第一个音符并显示蓝框""", """回到当前轨道第一个音符并显示蓝色选框""")
edit('guide', """以蓝框所在轨道为跟随目标""", """以蓝色选框所在轨道为跟随目标""")
# The Chinese guide already says a group's notes must be cleared before its meter changes (unchanged rule).
edit('guide_en', """The meter button above a group changes only that group.""",
     """The meter button above a group changes only that group; clear that group’s notes first.""")

# ================================================================ About text
section('common')
edit('i18n', """    'help.aboutUpdate': '本版新增：循环播放时可用方块上方的「↻ 再循环…」选择再循环 1–8 次后继续；播放时每条轨道用蓝色方框标出正在播放的音符；长按音符键 1 秒可锁定该音符，点按谱面即可连续输入。',""",
     """    'help.aboutUpdate': '本版：循环播放时可在方块上方的「↻ 再循环…」中自由输入再循环次数（1–999），播完后继续；播放时每条轨道用竖向蓝色长方框罩住正在播放音符的符杆和音头；长按音符键 1 秒可锁定该音符，点按谱面即可连续输入。',""")
edit('i18n', """    'help.aboutUpdate': 'This release adds a ↻ Repeat… chip that plays a loop 1–8 more times before continuing, marks the playing note of every track with a blue box, and lets you hold a note key for 1 second to lock it and enter it by tapping the score.',""",
     """    'help.aboutUpdate': 'This release lets you type in the ↻ Repeat… chip how many more times (1–999) a loop plays before continuing, covers the stem and note head of every track’s playing note with a tall blue box, and lets you hold a note key for 1 second to lock it and enter it by tapping the score.',""")

# ---------------------------------------------------------------- Version 1.61 -> 1.62 (same date)
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
    # Version strings only ("1.61 ·", '1.61', -1.61.json); code comments such as "// 1.61: ..." keep the
    # version that introduced them. The release date stays 2026-11-22.
    text, found = re.subn(r"1\.61(?= ·|'|\.json)", '1.62', text)
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
