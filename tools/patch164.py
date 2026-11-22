"""RhythmDesk 1.63 -> 1.64: apply the same editor changes to the Win11 sources and the Android page.

Usage: python3 patch164.py WIN11_UI_DIR ANDROID_INDEX_HTML

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
    'pick': '需求 1：多选模式中单个选中的符杆改为半透明蓝框，可看到竖线和音符',
    'common': '说明书同步（关于页文字；功能说明随上面的修改一并列出）',
}


def section(tag):
    global SECTION
    SECTION = tag


def edit(kind, old, new, count=1):
    EDITS.append((kind, old, new, SECTION, count))


# ================================================================ 1. Translucent pick frame in multi-selection
section('pick')
# The slot buttons lie above the drawn staff, so an opaque slot background hid the stem and the note.
edit('style', """.multi-groups .slot.slot-picked { background: #dcecff; outline: 2px solid #1d5b99; outline-offset: -2px; }""",
     """/* 1.64: a picked stem is framed in translucent blue; the slot lies above the drawn staff, so the old opaque
   fill (#dcecff) hid the stem and the note. */
.multi-groups .slot.slot-picked { background: #2876e829; outline: 2px solid #1d5b99b3; outline-offset: -2px; }""")
# Same layer, same problem: the overwrite preview while pasting hid the notes it would replace.
edit('style', """.slot.paste-preview { background: #dcecff; box-shadow: inset 0 2px #2469bd, inset 0 -2px #2469bd; }""",
     """.slot.paste-preview { background: #2876e824; box-shadow: inset 0 2px #2469bdb3, inset 0 -2px #2469bdb3; } /* 1.64: translucent like the pick frame */""")
edit('guide', """从轨道「⋯」进入多选。点符杆选择单个位置；""",
     """从轨道「⋯」进入多选。点符杆选择单个位置，选中处以半透明蓝框标出，透过选框仍可看到竖线和音符；""")
edit('guide', """复制或剪切后点目标符杆，查看覆盖预览，""",
     """复制或剪切后点目标符杆，查看覆盖预览（半透明蓝色，可看到将被覆盖的原有音符），""")
edit('guide_en', """Start multi-selection from the track ⋯ menu. Tap a stem to select a position.""",
     """Start multi-selection from the track ⋯ menu. Tap a stem to select a position; a translucent blue frame marks it, so its stem and note stay visible.""")
edit('guide_en', """review the highlighted overwrite range.""",
     """review the highlighted overwrite range (translucent, so the notes it will replace stay visible).""")

# ================================================================ About text
section('common')
edit('i18n', """    'help.aboutUpdate': '本版：每个循环区间可预设循环次数（共播放几遍），播完自动向后播放，同一轨道的多个循环各自设定；所有长按操作改为 0.5 秒；双击打开的菜单也会避开点按位置，防止误点。',""",
     """    'help.aboutUpdate': '本版：多选模式中单个选中的符杆改为半透明蓝框，透过选框可看到竖线和音符；粘贴时的覆盖预览同样改为半透明。',""")
edit('i18n', """    'help.aboutUpdate': 'This release lets every loop preset how many times it plays before playback continues by itself (each loop on a track has its own count), shortens every hold to 0.5 seconds, and places menus opened by a double-tap clear of the tapped point as well.',""",
     """    'help.aboutUpdate': 'This release frames a stem picked in multi-selection in translucent blue, so its stem and note stay visible, and makes the paste preview translucent as well.',""")

# ---------------------------------------------------------------- Version 1.63 -> 1.64 (same date)
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
    # Version strings only ("1.63 ·", '1.63', -1.63.json); code comments such as "// 1.63: ..." keep the
    # version that introduced them. The release date stays 2026-11-22.
    text, found = re.subn(r"1\.63(?= ·|'|\.json)", '1.64', text)
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
