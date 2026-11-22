"""RhythmDesk 1.65 -> 1.66: apply the same editor changes to the Win11 sources and the Android page.

Usage: python3 patch166.py WIN11_UI_DIR ANDROID_INDEX_HTML

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
    'hold': '需求 1：所有长按激活的菜单改为长按 0.1 秒激活',
    'lock': '需求 2：音符锁定也改为长按 0.1 秒激活',
    'common': '说明书同步（关于页文字；功能说明随上面的修改一并列出）',
}


def section(tag):
    global SECTION
    SECTION = tag


def edit(kind, old, new, count=1):
    EDITS.append((kind, old, new, SECTION, count))


# ================================================================ 1. Menus open after a 0.1-second hold
section('hold')
edit('app', """// 1.65: menus open after a 0.2 s hold. Locking a note key keeps 0.5 s: ordinary key presses often last
// 0.2 s, so a shorter lock hold would lock keys while notes are being entered. For the same reason a
// stem keeps 0.5 s while a note is locked, so tapping stems to enter notes never opens the beat menu.
const MENU_HOLD_MS = 200;""", """// 1.65: menus opened after a 0.2 s hold, while locking a note key, and a stem's beat menu while a note
// was locked, kept 0.5 s.
// 1.66: as requested, every hold takes 0.1 s, the note lock included, so a press held longer than 0.1 s
// counts as a hold. NOTE_LOCK_HOLD_MS stays separate so the lock can be tuned on its own again.
const MENU_HOLD_MS = 100;""")
edit('app', """// 1.65: the card menu opens after 0.2 s like the editor menus (was 0.5 s).
const LONG_PRESS_MS = 200;""", """// 1.65: the card menu opened after 0.2 s (was 0.5 s); 1.66: 0.1 s, like the editor menus.
const LONG_PRESS_MS = 100;""")
edit('i18n', """快速双击或长按 0.2 秒更换',""", """快速双击或长按 0.1 秒更换',""")
edit('i18n', """'Measure {bar}, group {group}: {meter}. Double-tap or hold for 0.2 seconds to change the group meter.',""",
     """'Measure {bar}, group {group}: {meter}. Double-tap or hold for 0.1 seconds to change the group meter.',""")
edit('i18n', """    'bar.pickEnd': '请快速双击或长按 0.2 秒同一音轨后面的小节线，设置循环终点。',""",
     """    'bar.pickEnd': '请快速双击或长按 0.1 秒同一音轨后面的小节线，设置循环终点。',""")
edit('i18n', """    'bar.pickEnd': 'Double-tap a later barline on the same track, or hold it for 0.2 seconds, to set the loop end.',""",
     """    'bar.pickEnd': 'Double-tap a later barline on the same track, or hold it for 0.1 seconds, to set the loop end.',""")
edit('guide', """长按 0.2 秒或右键打开重命名、分享、复制、删除菜单。""", """长按 0.1 秒或右键打开重命名、分享、复制、删除菜单。""")
edit('guide', """（间隔小于 0.25 秒）或按住 0.2 秒打开拍菜单。双击或长按 0.2 秒符杆上方蓝点""",
     """（间隔小于 0.25 秒）或按住 0.1 秒打开拍菜单（按住超过 0.1 秒即算长按，单击请轻点）。双击或长按 0.1 秒符杆上方蓝点""")
edit('guide', """同样可双击或长按 0.2 秒打开；""", """同样可双击或长按 0.1 秒打开；""")
edit('guide', """或双击／长按 0.2 秒谱面边界线""", """或双击／长按 0.1 秒谱面边界线""")
edit('guide', """双击或长按 0.2 秒小节边界设置轨道循环起点与终点。""", """双击或长按 0.1 秒小节边界设置轨道循环起点与终点。""")
edit('guide', """双击或长按 0.2 秒横线组拍号旁的速度""", """双击或长按 0.1 秒横线组拍号旁的速度""")
edit('guide_en', """Long-press (0.2 seconds) or right-click for Rename, Share, Duplicate and Delete.""",
     """Long-press (0.1 seconds) or right-click for Rename, Share, Duplicate and Delete.""")
edit('guide_en', """Tap the same stem twice within 0.25 seconds, or hold it for 0.2 seconds, to open its beat menu.""",
     """Tap the same stem twice within 0.25 seconds, or hold it for 0.1 seconds, to open its beat menu (a press longer than 0.1 seconds counts as a hold, so tap lightly to select).""")
edit('guide_en', """Barline, group-meter and group-tempo menus also open with a double-tap or a 0.2-second hold.""",
     """Barline, group-meter and group-tempo menus also open with a double-tap or a 0.1-second hold.""")
edit('guide_en', """or double-tap or hold a barline for 0.2 seconds for measure actions.""",
     """or double-tap or hold a barline for 0.1 seconds for measure actions.""")
edit('guide_en', """Double-tap barlines, or hold them for 0.2 seconds, to set a track loop start and end.""",
     """Double-tap barlines, or hold them for 0.1 seconds, to set a track loop start and end.""")
edit('guide_en', """double-tap or hold for 0.2 seconds the tempo beside a group meter""",
     """double-tap or hold for 0.1 seconds the tempo beside a group meter""")

# ================================================================ 2. Note lock after a 0.1-second hold
section('lock')
edit('app', """const NOTE_LOCK_HOLD_MS = 500;""", """const NOTE_LOCK_HOLD_MS = 100;""")
edit('i18n', """    'keys.lockHint': '长按 0.5 秒锁定，之后点按谱面符杆即可连续输入该音符',""",
     """    'keys.lockHint': '长按 0.1 秒锁定，之后点按谱面符杆即可连续输入该音符',""")
edit('i18n', """    'keys.lockHint': 'Hold for 0.5 seconds to lock, then tap stems to enter this note repeatedly',""",
     """    'keys.lockHint': 'Hold for 0.1 seconds to lock, then tap stems to enter this note repeatedly',""")
edit('guide', """长按任一鼓音键或「休止」0.5 秒可锁定该键（键变为蓝色；比菜单的 0.2 秒长，避免平时输入音符时误锁）""",
     """长按任一鼓音键或「休止」0.1 秒可锁定该键（键变为蓝色；输入音符时请轻点，按住超过 0.1 秒会锁定）""")
edit('guide', """长按符杆 0.5 秒仍可打开（锁定时保留 0.5 秒，避免点按输入时误开菜单）；""",
     """长按符杆 0.1 秒仍可打开（点按输入时请轻点）；""")
edit('guide_en', """Hold any stroke key or Rest for 0.5 seconds to lock it (the key turns blue; longer than the 0.2-second menu hold so ordinary note entry never locks a key)""",
     """Hold any stroke key or Rest for 0.1 seconds to lock it (the key turns blue; tap keys lightly when entering notes, since a press longer than 0.1 seconds locks)""")
edit('guide_en', """but a 0.5-second hold on a stem still does (kept at 0.5 seconds while locked, so tap entry never opens it by accident).""",
     """but a 0.1-second hold on a stem still does (tap lightly when entering notes).""")

# ================================================================ About text
section('common')
edit('i18n', """    'help.aboutUpdate': '本版：所有长按打开的菜单（谱面各菜单与首页鼓谱卡片菜单）改为长按 0.2 秒即打开；长按音符键锁定仍为 0.5 秒，避免输入音符时误锁。',""",
     """    'help.aboutUpdate': '本版：所有长按打开的菜单（谱面各菜单与首页鼓谱卡片菜单）以及长按音符键锁定，都改为长按 0.1 秒即生效；单击和输入音符时请轻点。',""")
edit('i18n', """    'help.aboutUpdate': 'This release opens every hold menu (score menus and the rhythm-card menu) after a 0.2-second hold; locking a note key still takes 0.5 seconds so note entry never locks a key by accident.',""",
     """    'help.aboutUpdate': 'This release makes every hold take 0.1 seconds: score menus, the rhythm-card menu and locking a note key. Tap lightly to select or to enter notes.',""")

# ---------------------------------------------------------------- Version 1.65 -> 1.66 (same date)
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
    # Version strings only ("1.65 ·", '1.65', -1.65.json); code comments such as "// 1.65: ..." keep the
    # version that introduced them. The release date stays 2026-11-22.
    text, found = re.subn(r"1\.65(?= ·|'|\.json)", '1.66', text)
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
