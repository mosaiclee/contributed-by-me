"""RhythmDesk 1.66 -> 1.67: apply the same editor changes to the Win11 sources and the Android page.

Usage: python3 patch167.py WIN11_UI_DIR ANDROID_INDEX_HTML

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
    'hold': '需求 1：所有长按激活的菜单和音符锁定改为长按 0.3 秒',
    'double': '需求 2：双击激活改为两次点按间隔 0.5 秒内',
    'entry': '需求 3：缩短「休止」键，新增「点按输入」键（先点它再点音符键进入点按输入，再点该音符或此键取消）',
    'common': '说明书同步（关于页文字；功能说明随上面的修改一并列出）',
}


def section(tag):
    global SECTION
    SECTION = tag


def edit(kind, old, new, count=1):
    EDITS.append((kind, old, new, SECTION, count))


# ================================================================ 1. 0.3-second holds
section('hold')
edit('app', """// 1.66: as requested, every hold takes 0.1 s, the note lock included, so a press held longer than 0.1 s
// counts as a hold. NOTE_LOCK_HOLD_MS stays separate so the lock can be tuned on its own again.
const MENU_HOLD_MS = 100;
const NOTE_LOCK_HOLD_MS = 100;""", """// 1.66: every hold took 0.1 s, the note lock included.
// 1.67: every hold takes 0.3 s (menus, the note lock, and a stem's beat menu while a note is locked).
// NOTE_LOCK_HOLD_MS stays separate so the lock can be tuned on its own.
const MENU_HOLD_MS = 300;
const NOTE_LOCK_HOLD_MS = 300;""")
edit('app', """// 1.65: the card menu opened after 0.2 s (was 0.5 s); 1.66: 0.1 s, like the editor menus.
const LONG_PRESS_MS = 100;""", """// 1.65: the card menu opened after 0.2 s (was 0.5 s); 1.66: 0.1 s; 1.67: 0.3 s, like the editor menus.
const LONG_PRESS_MS = 300;""")
edit('i18n', """快速双击或长按 0.1 秒更换',""", """快速双击或长按 0.3 秒更换',""")
edit('i18n', """'Measure {bar}, group {group}: {meter}. Double-tap or hold for 0.1 seconds to change the group meter.',""",
     """'Measure {bar}, group {group}: {meter}. Double-tap or hold for 0.3 seconds to change the group meter.',""")
edit('i18n', """    'bar.pickEnd': '请快速双击或长按 0.1 秒同一音轨后面的小节线，设置循环终点。',""",
     """    'bar.pickEnd': '请快速双击或长按 0.3 秒同一音轨后面的小节线，设置循环终点。',""")
edit('i18n', """    'bar.pickEnd': 'Double-tap a later barline on the same track, or hold it for 0.1 seconds, to set the loop end.',""",
     """    'bar.pickEnd': 'Double-tap a later barline on the same track, or hold it for 0.3 seconds, to set the loop end.',""")
edit('i18n', """    'keys.lockHint': '长按 0.1 秒锁定，之后点按谱面符杆即可连续输入该音符',""",
     """    'keys.lockHint': '长按 0.3 秒锁定，之后点按谱面符杆即可连续输入该音符',""")
edit('i18n', """    'keys.lockHint': 'Hold for 0.1 seconds to lock, then tap stems to enter this note repeatedly',""",
     """    'keys.lockHint': 'Hold for 0.3 seconds to lock, then tap stems to enter this note repeatedly',""")
edit('guide', """长按 0.1 秒或右键打开重命名、分享、复制、删除菜单。""", """长按 0.3 秒或右键打开重命名、分享、复制、删除菜单。""")
edit('guide', """或按住 0.1 秒打开拍菜单（按住超过 0.1 秒即算长按，单击请轻点）。双击或长按 0.1 秒符杆上方蓝点""",
     """或按住 0.3 秒打开拍菜单（按住 0.3 秒以上即算长按）。双击或长按 0.3 秒符杆上方蓝点""")
edit('guide', """同样可双击或长按 0.1 秒打开；""", """同样可双击或长按 0.3 秒打开；""")
edit('guide', """或双击／长按 0.1 秒谱面边界线""", """或双击／长按 0.3 秒谱面边界线""")
edit('guide', """双击或长按 0.1 秒小节边界设置轨道循环起点与终点。""", """双击或长按 0.3 秒小节边界设置轨道循环起点与终点。""")
edit('guide', """双击或长按 0.1 秒横线组拍号旁的速度""", """双击或长按 0.3 秒横线组拍号旁的速度""")
edit('guide', """长按任一鼓音键或「休止」0.1 秒可锁定该键（键变为蓝色；输入音符时请轻点，按住超过 0.1 秒会锁定）""",
     """长按任一鼓音键或「休止」0.3 秒可锁定该键（键变为蓝色）""")
edit('guide', """长按符杆 0.1 秒仍可打开（点按输入时请轻点）；""", """长按符杆 0.3 秒仍可打开；""")
edit('guide_en', """Long-press (0.1 seconds) or right-click for Rename, Share, Duplicate and Delete.""",
     """Long-press (0.3 seconds) or right-click for Rename, Share, Duplicate and Delete.""")
edit('guide_en', """or hold it for 0.1 seconds, to open its beat menu (a press longer than 0.1 seconds counts as a hold, so tap lightly to select).""",
     """or hold it for 0.3 seconds, to open its beat menu (a press of 0.3 seconds or longer counts as a hold).""")
edit('guide_en', """Barline, group-meter and group-tempo menus also open with a double-tap or a 0.1-second hold.""",
     """Barline, group-meter and group-tempo menus also open with a double-tap or a 0.3-second hold.""")
edit('guide_en', """or double-tap or hold a barline for 0.1 seconds for measure actions.""",
     """or double-tap or hold a barline for 0.3 seconds for measure actions.""")
edit('guide_en', """Double-tap barlines, or hold them for 0.1 seconds, to set a track loop start and end.""",
     """Double-tap barlines, or hold them for 0.3 seconds, to set a track loop start and end.""")
edit('guide_en', """double-tap or hold for 0.1 seconds the tempo beside a group meter""",
     """double-tap or hold for 0.3 seconds the tempo beside a group meter""")
edit('guide_en', """Hold any stroke key or Rest for 0.1 seconds to lock it (the key turns blue; tap keys lightly when entering notes, since a press longer than 0.1 seconds locks)""",
     """Hold any stroke key or Rest for 0.3 seconds to lock it (the key turns blue)""")
edit('guide_en', """but a 0.1-second hold on a stem still does (tap lightly when entering notes).""",
     """but a 0.3-second hold on a stem still does.""")

# ================================================================ 2. Double-tap within 0.5 s
section('double')
edit('app', """let quickTap = null;
function quickDoubleTap(event, kind = '') {
  const now = performance.now(), target = event.currentTarget;
  const hit = quickTap && quickTap.target === target && quickTap.kind === kind && now - quickTap.time < 250;""",
     """let quickTap = null;
const DOUBLE_TAP_MS = 500; // 1.67: two taps on the same control within 0.5 s (was 0.25 s)
function quickDoubleTap(event, kind = '') {
  const now = performance.now(), target = event.currentTarget;
  const hit = quickTap && quickTap.target === target && quickTap.kind === kind && now - quickTap.time < DOUBLE_TAP_MS;""")
edit('guide', """（间隔小于 0.25 秒）""", """（间隔小于 0.5 秒）""")
edit('guide_en', """Tap the same stem twice within 0.25 seconds,""", """Tap the same stem twice within 0.5 seconds,""")

# ================================================================ 3. Shorter Rest key and a 点按输入 key
section('entry')
edit('app', """let noteLock; // 1.61: {stroke, type} while a note key (or Rest, stroke null) is locked for tap entry""",
     """let noteLock; // 1.61: {stroke, type} while a note key (or Rest, stroke null) is locked for tap entry
let tapEntryArmed = false; // 1.67: 点按输入 was pressed and the next note key chosen locks that note""")
edit('app', """  if (!keysOpen) { if (noteLock) setNoteLock(); return; }""",
     """  if (!keysOpen) { if (noteLock || tapEntryArmed) setNoteLock(); return; }""")
edit('app', """    lockableKey(key(t('keys.rest'), () => tapNoteKey(null), 'silence'), null), key('←', () => moveCursor(-1), 'aux'), key('→', () => moveCursor(1), 'aux'));""",
     """    lockableKey(key(t('keys.rest'), () => tapNoteKey(null), 'silence'), null), tapEntryKey(key), key('←', () => moveCursor(-1), 'aux'), key('→', () => moveCursor(1), 'aux'));""")
edit('app', """function setNoteLock(stroke) {
  noteLock = stroke === undefined ? undefined""", """// 1.67: the 点按输入 key is a second way into tap entry: press it, then a note key (or Rest) to lock that
// note; press the locked note key or 点按输入 again to leave. Holding a note key still locks it directly.
function tapEntryKey(key) {
  const node = key(t('keys.tapEntry'), toggleTapEntry, 'tap-entry');
  node.title = t('keys.tapEntryTitle');
  node.setAttribute('aria-label', node.title);
  return node;
}

function toggleTapEntry() {
  if (noteLock) { unlockNote(); return; }
  tapEntryArmed = !tapEntryArmed;
  paintNoteLock();
  notify(t(tapEntryArmed ? 'lock.pick' : 'lock.pickCancelled'));
}

function setNoteLock(stroke) {
  tapEntryArmed = false;
  noteLock = stroke === undefined ? undefined""")
edit('app', """    node.classList.toggle('locked', locked);
    node.setAttribute('aria-pressed', String(locked));
  }
  el.paper.classList.toggle('note-lock', Boolean(noteLock));""", """    node.classList.toggle('locked', locked);
    node.setAttribute('aria-pressed', String(locked));
  }
  const entry = el.keys.querySelector('.key.tap-entry');
  entry?.classList.toggle('armed', tapEntryArmed);
  entry?.classList.toggle('active', Boolean(noteLock));
  entry?.setAttribute('aria-pressed', String(tapEntryArmed || Boolean(noteLock)));
  el.keys.classList.toggle('picking', tapEntryArmed);
  el.paper.classList.toggle('note-lock', Boolean(noteLock));""")
edit('app', """function tapNoteKey(stroke) {
  if (noteLock && noteLock.stroke === stroke) unlockNote();
  else writeStroke(stroke);
}""", """function tapNoteKey(stroke) {
  if (noteLock && noteLock.stroke === stroke) unlockNote();
  else if (tapEntryArmed) toggleNoteLock(stroke); // 1.67: chosen after 点按输入
  else writeStroke(stroke);
}""")
edit('app', """    else if (noteLock) unlockNote();
    else if (multiGroups) finishMultiGroups();""", """    else if (noteLock) unlockNote();
    else if (tapEntryArmed) toggleTapEntry();
    else if (multiGroups) finishMultiGroups();""")
edit('style', """.key-row.navigation { grid-template-columns: 1fr 1fr minmax(110px, 3.8fr) 1fr 1fr; }""",
     """/* 1.67: Rest is half as wide and 点按输入 takes the other half (was 1fr 1fr minmax(110px, 3.8fr) 1fr 1fr). */
.key-row.navigation { grid-template-columns: 1fr 1fr minmax(56px, 1.9fr) minmax(56px, 1.9fr) 1fr 1fr; }""")
edit('style', """.key.silence { font-size: 13px; color: #666a72; }""", """.key.silence { font-size: 13px; color: #666a72; }
/* 1.67: 点按输入 key: outlined while waiting for a note key, filled while a note is locked. */
.key.tap-entry { font-size: 13px; font-weight: 600; color: var(--blue); }
.key.tap-entry.armed, .key.tap-entry.armed:hover:not(:disabled) { background: #e8f1ff; box-shadow: inset 0 0 0 2px var(--blue); }
.key.tap-entry.active, .key.tap-entry.active:hover:not(:disabled) { background: var(--blue); color: #fff; }
#keys.picking .key[data-stroke] { box-shadow: inset 0 0 0 2px #98bde9; }""")
edit('i18n', """    'keys.rest': '休止',""", """    'keys.rest': '休止',
    'keys.tapEntry': '点按输入',
    'keys.tapEntryTitle': '点按输入：先点此键，再点一个音符键（或「休止」），之后点按谱面符杆即可连续输入该音符；再点该音符键或此键取消',
    'lock.pick': '请点一个音符键（或「休止」），之后点按谱面符杆即可连续输入该音符。',
    'lock.pickCancelled': '已取消点按输入。',""")
edit('i18n', """    'keys.rest': 'Rest',""", """    'keys.rest': 'Rest',
    'keys.tapEntry': 'Tap entry',
    'keys.tapEntryTitle': 'Tap entry: press this key, then a note key (or Rest); tapping stems then enters that note. Press that note key or this key again to stop',
    'lock.pick': 'Choose a note key (or Rest); tapping stems then enters that note.',
    'lock.pickCancelled': 'Tap entry cancelled.',""")
edit('i18n', """    'lock.on': '已锁定「{note}」：点按谱面符杆即写入该音符，再点同一位置可清除。轻点该键或按 Esc 解锁。',
    'lock.onRest': '已锁定「休止」：点按谱面符杆即清除该位置的音符。轻点该键或按 Esc 解锁。',""",
     """    'lock.on': '已锁定「{note}」：点按谱面符杆即写入该音符，再点同一位置可清除。轻点该键、「点按输入」键或按 Esc 解锁。',
    'lock.onRest': '已锁定「休止」：点按谱面符杆即清除该位置的音符。轻点该键、「点按输入」键或按 Esc 解锁。',""")
edit('i18n', """    'lock.on': 'Locked “{note}”: tap stems to enter it; tap the same stem again to clear it. Tap the key again or press Esc to unlock.',
    'lock.onRest': 'Locked Rest: tap stems to clear their notes. Tap the key again or press Esc to unlock.',""",
     """    'lock.on': 'Locked “{note}”: tap stems to enter it; tap the same stem again to clear it. Tap the key or Tap entry again, or press Esc, to unlock.',
    'lock.onRest': 'Locked Rest: tap stems to clear their notes. Tap the key or Tap entry again, or press Esc, to unlock.',""")
edit('guide', """轻点被锁定的键或按 Esc 解锁，长按其他键可改锁该键。""",
     """也可先点键盘上的「点按输入」，再点一个音符键（或「休止」）进入同样的点按输入，此时「点按输入」变为蓝色；轻点被锁定的音符键、「点按输入」键或按 Esc 解锁，长按其他键可改锁该键。""")
edit('guide', """休止写入空拍；""", """休止写入空拍；休止键右侧的「点按输入」键：先点它、再点一个音符键即进入点按输入，再点该音符键或「点按输入」取消；""")
edit('guide_en', """Tap the locked key or press Esc to unlock; hold another key to move the lock.""",
     """You can also press Tap entry on the keyboard and then a note key (or Rest) to start the same tap entry; Tap entry then turns blue. Tap the locked note key, Tap entry or press Esc to unlock; hold another key to move the lock.""")
edit('guide_en', """Rest enters a rest;""", """Rest enters a rest; Tap entry, next to Rest, followed by a note key starts tap entry with that note, and pressing that note key or Tap entry again stops it;""")

# ================================================================ About text
section('common')
edit('i18n', """    'help.aboutUpdate': '本版：所有长按打开的菜单（谱面各菜单与首页鼓谱卡片菜单）以及长按音符键锁定，都改为长按 0.1 秒即生效；单击和输入音符时请轻点。',""",
     """    'help.aboutUpdate': '本版：所有长按菜单与音符锁定改为长按 0.3 秒；双击改为两次点按间隔 0.5 秒内即可；音符键盘新增「点按输入」键（先点它再点音符键即可点按输入，再点该音符或此键取消），「休止」键相应缩短。',""")
edit('i18n', """    'help.aboutUpdate': 'This release makes every hold take 0.1 seconds: score menus, the rhythm-card menu and locking a note key. Tap lightly to select or to enter notes.',""",
     """    'help.aboutUpdate': 'This release makes every hold menu and the note lock take 0.3 seconds, accepts double-taps up to 0.5 seconds apart, and adds a Tap entry key (press it, then a note key, to enter that note by tapping stems; press either again to stop) beside a shorter Rest key.',""")

# ---------------------------------------------------------------- Version 1.66 -> 1.67 (same date)
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
    # Version strings only ("1.66 ·", '1.66', -1.66.json); code comments such as "// 1.66: ..." keep the
    # version that introduced them. The release date stays 2026-11-22.
    text, found = re.subn(r"1\.66(?= ·|'|\.json)", '1.67', text)
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
