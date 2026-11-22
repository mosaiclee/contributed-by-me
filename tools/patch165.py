"""RhythmDesk 1.64 -> 1.65: apply the same editor changes to the Win11 sources and the Android page.

Usage: python3 patch165.py WIN11_UI_DIR ANDROID_INDEX_HTML

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
    'hold': '需求 1：所有长按激活的菜单改为长按 0.2 秒激活',
    'common': '说明书同步（关于页文字；功能说明随上面的修改一并列出）',
}


def section(tag):
    global SECTION
    SECTION = tag


def edit(kind, old, new, count=1):
    EDITS.append((kind, old, new, SECTION, count))


# ================================================================ 1. Menus open after a 0.2-second hold
section('hold')
edit('app', """// 1.63: the hold takes 0.5 s (was 1 s), and a menu opened by a double-tap keeps clear of the tap too.
const MENU_HOLD_MS = 500;""", """// 1.63: the hold takes 0.5 s (was 1 s), and a menu opened by a double-tap keeps clear of the tap too.
// 1.65: menus open after a 0.2 s hold. Locking a note key keeps 0.5 s: ordinary key presses often last
// 0.2 s, so a shorter lock hold would lock keys while notes are being entered. For the same reason a
// stem keeps 0.5 s while a note is locked, so tapping stems to enter notes never opens the beat menu.
const MENU_HOLD_MS = 200;
const NOTE_LOCK_HOLD_MS = 500;""")
edit('app', """function bindMenuHold(node, open, allowed = () => true) {
  node.addEventListener('pointerdown', event => {
    cancelMenuHold();
    if (!event.isPrimary || event.button !== 0 || !allowed()) return;""", """function bindMenuHold(node, open, allowed = () => true, delay = MENU_HOLD_MS) {
  node.addEventListener('pointerdown', event => {
    cancelMenuHold();
    if (!event.isPrimary || event.button !== 0 || !allowed()) return;
    const ms = typeof delay === 'function' ? delay(event) : delay; // 1.65: per-control hold time""")
edit('app', """      open(press);
    }, MENU_HOLD_MS);""", """      open(press);
    }, ms);""")
edit('app', """          if (hand) openHandMenu(item);
          else openBeatMenu(box);
        }, () => !multiGroups);""", """          if (hand) openHandMenu(item);
          else openBeatMenu(box);
        }, () => !multiGroups,
        event => noteLock && !event.target.classList?.contains('hand-dot') ? NOTE_LOCK_HOLD_MS : MENU_HOLD_MS);""")
edit('app', """  bindMenuHold(node, () => toggleNoteLock(stroke), () => !multiGroups);""",
     """  bindMenuHold(node, () => toggleNoteLock(stroke), () => !multiGroups, NOTE_LOCK_HOLD_MS);""")
edit('app', """// 0.18: long press (mouse or touch, 500 ms) or right-click on a rhythm card shows 复制 / 删除.
const LONG_PRESS_MS = 500;""", """// 0.18: long press (mouse or touch) or right-click on a rhythm card shows 复制 / 删除.
// 1.65: the card menu opens after 0.2 s like the editor menus (was 0.5 s).
const LONG_PRESS_MS = 200;""")
edit('i18n', """快速双击或长按 0.5 秒更换',""", """快速双击或长按 0.2 秒更换',""")
edit('i18n', """'Measure {bar}, group {group}: {meter}. Double-tap or hold for 0.5 seconds to change the group meter.',""",
     """'Measure {bar}, group {group}: {meter}. Double-tap or hold for 0.2 seconds to change the group meter.',""")
edit('i18n', """    'bar.pickEnd': '请快速双击或长按 0.5 秒同一音轨后面的小节线，设置循环终点。',""",
     """    'bar.pickEnd': '请快速双击或长按 0.2 秒同一音轨后面的小节线，设置循环终点。',""")
edit('i18n', """    'bar.pickEnd': 'Double-tap a later barline on the same track, or hold it for 0.5 seconds, to set the loop end.',""",
     """    'bar.pickEnd': 'Double-tap a later barline on the same track, or hold it for 0.2 seconds, to set the loop end.',""")
edit('guide', """长按或右键打开重命名、分享、复制、删除菜单。""", """长按 0.2 秒或右键打开重命名、分享、复制、删除菜单。""")
edit('guide', """（间隔小于 0.25 秒）或按住 0.5 秒打开拍菜单。双击或长按 0.5 秒符杆上方蓝点""",
     """（间隔小于 0.25 秒）或按住 0.2 秒打开拍菜单。双击或长按 0.2 秒符杆上方蓝点""")
edit('guide', """同样可双击或长按 0.5 秒打开；""", """同样可双击或长按 0.2 秒打开；""")
edit('guide', """长按符杆 0.5 秒仍可打开；""", """长按符杆 0.5 秒仍可打开（锁定时保留 0.5 秒，避免点按输入时误开菜单）；""")
edit('guide', """长按任一鼓音键或「休止」0.5 秒可锁定该键（键变为蓝色）""",
     """长按任一鼓音键或「休止」0.5 秒可锁定该键（键变为蓝色；比菜单的 0.2 秒长，避免平时输入音符时误锁）""")
edit('guide', """或双击／长按 0.5 秒谱面边界线""", """或双击／长按 0.2 秒谱面边界线""")
edit('guide', """双击或长按 0.5 秒小节边界设置轨道循环起点与终点。""", """双击或长按 0.2 秒小节边界设置轨道循环起点与终点。""")
edit('guide', """双击或长按 0.5 秒横线组拍号旁的速度""", """双击或长按 0.2 秒横线组拍号旁的速度""")
edit('guide_en', """Long-press or right-click for Rename, Share, Duplicate and Delete.""",
     """Long-press (0.2 seconds) or right-click for Rename, Share, Duplicate and Delete.""")
edit('guide_en', """Tap the same stem twice within 0.25 seconds, or hold it for 0.5 seconds, to open its beat menu.""",
     """Tap the same stem twice within 0.25 seconds, or hold it for 0.2 seconds, to open its beat menu.""")
edit('guide_en', """Barline, group-meter and group-tempo menus also open with a double-tap or a 0.5-second hold.""",
     """Barline, group-meter and group-tempo menus also open with a double-tap or a 0.2-second hold.""")
edit('guide_en', """Hold any stroke key or Rest for 0.5 seconds to lock it (the key turns blue)""",
     """Hold any stroke key or Rest for 0.5 seconds to lock it (the key turns blue; longer than the 0.2-second menu hold so ordinary note entry never locks a key)""")
edit('guide_en', """but a 0.5-second hold on a stem still does.""",
     """but a 0.5-second hold on a stem still does (kept at 0.5 seconds while locked, so tap entry never opens it by accident).""")
edit('guide_en', """or double-tap or hold a barline for 0.5 seconds for measure actions.""",
     """or double-tap or hold a barline for 0.2 seconds for measure actions.""")
edit('guide_en', """Double-tap barlines, or hold them for 0.5 seconds, to set a track loop start and end.""",
     """Double-tap barlines, or hold them for 0.2 seconds, to set a track loop start and end.""")
edit('guide_en', """double-tap or hold for 0.5 seconds the tempo beside a group meter""",
     """double-tap or hold for 0.2 seconds the tempo beside a group meter""")

# ================================================================ About text
section('common')
edit('i18n', """    'help.aboutUpdate': '本版：多选模式中单个选中的符杆改为半透明蓝框，透过选框可看到竖线和音符；粘贴时的覆盖预览同样改为半透明。',""",
     """    'help.aboutUpdate': '本版：所有长按打开的菜单（谱面各菜单与首页鼓谱卡片菜单）改为长按 0.2 秒即打开；长按音符键锁定仍为 0.5 秒，避免输入音符时误锁。',""")
edit('i18n', """    'help.aboutUpdate': 'This release frames a stem picked in multi-selection in translucent blue, so its stem and note stay visible, and makes the paste preview translucent as well.',""",
     """    'help.aboutUpdate': 'This release opens every hold menu (score menus and the rhythm-card menu) after a 0.2-second hold; locking a note key still takes 0.5 seconds so note entry never locks a key by accident.',""")

# ---------------------------------------------------------------- Version 1.64 -> 1.65 (same date)
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
    # Version strings only ("1.64 ·", '1.64', -1.64.json); code comments such as "// 1.64: ..." keep the
    # version that introduced them. The release date stays 2026-11-22.
    text, found = re.subn(r"1\.64(?= ·|'|\.json)", '1.65', text)
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
