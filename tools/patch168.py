"""RhythmDesk 1.67 -> 1.68: apply the same editor changes to the Win11 sources and the Android page.

Usage: python3 patch168.py WIN11_UI_DIR ANDROID_INDEX_HTML

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
    'size': '需求 1：加长「休止」键，「点按输入」键缩短一半',
    'icon': '需求 2：「点按输入」文字改为表达其含义的符号（手指点按图标）',
    'common': '说明书同步（关于页文字；功能说明随上面的修改一并列出）',
}


def section(tag):
    global SECTION
    SECTION = tag


def edit(kind, old, new, count=1):
    EDITS.append((kind, old, new, SECTION, count))


TAP_ICON = ('<path d="M10.5 13V7.6a1.5 1.5 0 0 1 3 0V12l4.2.8a2 2 0 0 1 1.6 2.3L18.6 20h-7.2l-3.6-4.3a1.5 1.5 0 0 1 2.3-1.9l.4.5"/>'
            '<path d="M8.6 7.6a3.4 3.4 0 0 1 6.8 0M6.2 7.6a5.8 5.8 0 0 1 11.6 0"/>')

# ================================================================ 1. Longer Rest, half-width 点按输入
section('size')
edit('style', """/* 1.67: Rest is half as wide and 点按输入 takes the other half (was 1fr 1fr minmax(110px, 3.8fr) 1fr 1fr). */
.key-row.navigation { grid-template-columns: 1fr 1fr minmax(56px, 1.9fr) minmax(56px, 1.9fr) 1fr 1fr; }""",
     """/* 1.67 split the old Rest width (3.8fr) evenly between Rest and 点按输入.
   1.68: 点按输入 is half of that (0.95fr, about one arrow key) and Rest takes the rest (2.85fr). */
.key-row.navigation { grid-template-columns: 1fr 1fr minmax(84px, 2.85fr) minmax(40px, .95fr) 1fr 1fr; }""")

# ================================================================ 2. A tapping-finger icon instead of the words
section('icon')
edit('index', """    <symbol id="i-keyboard" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 10h.1m4-.1h.1m4 .1h.1m4-.1h.1M7 15h10"/></symbol>""",
     """    <symbol id="i-keyboard" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 10h.1m4-.1h.1m4 .1h.1m4-.1h.1M7 15h10"/></symbol>
    <symbol id="i-tap-entry" viewBox="0 0 24 24">""" + TAP_ICON + """</symbol>""")
edit('app', """function tapEntryKey(key) {
  const node = key(t('keys.tapEntry'), toggleTapEntry, 'tap-entry');""", """function tapEntryKey(key) {
  // 1.68: a tapping-finger icon replaces the words 点按输入; the name stays in the tooltip and label.
  const node = key('', toggleTapEntry, 'tap-entry');
  node.innerHTML = '<svg aria-hidden="true"><use href="#i-tap-entry"/></svg>';""")
edit('style', """.key.tap-entry { font-size: 13px; font-weight: 600; color: var(--blue); }""",
     """.key.tap-entry { color: var(--blue); }
.key.tap-entry svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; } /* 1.68 */""")
edit('i18n', """    'keys.tapEntry': '点按输入',
""", "")
edit('i18n', """    'keys.tapEntry': 'Tap entry',
""", "")
edit('guide', """也可先点键盘上的「点按输入」，再点一个音符键（或「休止」）进入同样的点按输入，此时「点按输入」变为蓝色；""",
     """也可先点键盘上休止键右侧的「点按输入」键（手指点按图标），再点一个音符键（或「休止」）进入同样的点按输入，此时该键变为蓝色；""")
edit('guide', """休止键右侧的「点按输入」键：先点它、再点一个音符键即进入点按输入""",
     """休止键右侧的「点按输入」键（手指点按图标）：先点它、再点一个音符键即进入点按输入""")
edit('guide_en', """You can also press Tap entry on the keyboard and then a note key (or Rest) to start the same tap entry; Tap entry then turns blue.""",
     """You can also press the Tap entry key (the tapping-finger icon right of Rest) and then a note key (or Rest) to start the same tap entry; the key then turns blue.""")
edit('guide_en', """Tap entry, next to Rest, followed by a note key starts tap entry""",
     """Tap entry (the tapping-finger icon next to Rest) followed by a note key starts tap entry""")

# ================================================================ About text
section('common')
edit('i18n', """    'help.aboutUpdate': '本版：所有长按菜单与音符锁定改为长按 0.3 秒；双击改为两次点按间隔 0.5 秒内即可；音符键盘新增「点按输入」键（先点它再点音符键即可点按输入，再点该音符或此键取消），「休止」键相应缩短。',""",
     """    'help.aboutUpdate': '本版：音符键盘的「休止」键加长；「点按输入」键缩短一半，文字改为手指点按图标（先点它再点音符键即可点按输入，再点该音符或此键取消）。',""")
edit('i18n', """    'help.aboutUpdate': 'This release makes every hold menu and the note lock take 0.3 seconds, accepts double-taps up to 0.5 seconds apart, and adds a Tap entry key (press it, then a note key, to enter that note by tapping stems; press either again to stop) beside a shorter Rest key.',""",
     """    'help.aboutUpdate': 'This release widens the Rest key again and makes the Tap entry key half as wide, showing a tapping-finger icon instead of words (press it, then a note key, to enter that note by tapping stems; press either again to stop).',""")

# ---------------------------------------------------------------- Version 1.67 -> 1.68 (same date)
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
    # Version strings only ("1.67 ·", '1.67', -1.67.json); code comments such as "// 1.67: ..." keep the
    # version that introduced them. The release date stays 2026-11-22.
    text, found = re.subn(r"1\.67(?= ·|'|\.json)", '1.68', text)
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
