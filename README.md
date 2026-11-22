# RhythmDesk · 鼓谱工作台

- `RhythmDesk-Win11/` — Windows 11 edition: `RhythmDesk.exe` opens `RhythmDesk.html` in Edge. Readable sources in `RhythmDesk-Win11/source/ui`; `source/build_ui.py` rebuilds the page.
- `android/` — Android edition: the signed APK and `index.html`, the editor page packed as `assets/index.html` in the APK.
- `tools/` — the per-release patch lists (`patch160.py`, `patch161.py`), APK repack, signing, verification and handoff-document scripts.
- `docs/RhythmDesk-交接文档-1.59至1.61.txt` — developer handoff (Chinese): every request so far, what changed for each, and before/after code for every changed passage.

The Android signing key is kept outside this repository (`*.pem` is ignored).

## 1.61

1. **↻ 再循环… / Repeat…**: while a track loop plays, a chip above the Stop square plays the loop 1–8 more times before continuing, shows the passes left, and can cancel a pending continue (keep looping). The square alone still continues after the current pass.
2. **Playing position on every track**: the playing note of each track is framed by a 28 px blue box (was a 2 px line). Pausing keeps the boxes; stopping clears them.
3. **Note lock**: hold a stroke key (or Rest) for 1 second to lock it; tapping stems then enters that note in place without moving on (tap again to clear; locked Rest clears). Tap the locked key or press Esc to unlock. While locked, a 1-second hold on a stem still opens the beat menu.

## 1.60

Both editions carry the same three changes:

1. **复制本轨道 / Duplicate Track** in the track ⋯ menu: copies the track with all of its content — notes, sticking (L/R), measures and group meters, split cells, tempo, loops, line breaks, custom sounds, preset and mix — into a new track named “… 副本” directly below the track (below its Bell/Drum pair for paired drums). One undo step.
2. **Split with notes written**: the ♫ key, digit keys 1–4, the beat menu’s 拆分为… and 切换 3/4 细分, the measure/track/score 统一拆分 menus and the score “all groups to 3/4” no longer ask you to clear notes first. Notes move to the nearest new cell; if two notes land on one cell you are asked before they are merged.
3. **1-second hold** opens every menu that a double-tap opens (stem → beat menu, blue dot → sticking, barline → measure menu, group meter, group tempo), with finger, pen or mouse. The menu keeps at least 40 px clear of the held point (shortening and scrolling a tall menu if needed), and the release that ends the hold never activates a menu item. Moving more than 10 px or adding a second finger cancels the hold; multi-selection keeps its own 0.5 s whole-group hold.

## Rebuild

```sh
# Windows 11 page from the readable sources
python3 RhythmDesk-Win11/source/build_ui.py

# Android: replace the page and version in the 1.59 APK, then sign with the release key (APK Signature Scheme v2)
python3 tools/repack_apk.py RhythmDesk-Android-1.60.apk android/index.html unsigned.apk 1.61
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \
     --add-exports java.base/sun.security.util=ALL-UNNAMED -cp apksig-2.3.0.jar tools/SignApk.java \
     RhythmDesk-Android-signing.pem unsigned.apk RhythmDesk-Android-1.61.apk
python3 tools/verify_v2.py RhythmDesk-Android-1.61.apk
```

`tools/patch160.py` (1.59 → 1.60) and `tools/patch161.py` (1.60 → 1.61) are the exact edit sets applied to the Win11 sources and the Android page; every edit had to match in both, so both editions received identical changes. `tools/make_handoff.py` builds the handoff document from them. `apksig-2.3.0.jar` is `com.android.tools.build:apksig:2.3.0` from Maven Central.

## Tests

```sh
cd RhythmDesk-Win11/source/tests
node interaction161.cjs
node playback161.cjs ../../../android/index.html ../../RhythmDesk.html
node editor160.e2e.cjs ../../RhythmDesk.html ../../../android/index.html   # 1.60 features; needs Playwright + Chromium
node editor161.e2e.cjs ../../RhythmDesk.html ../../../android/index.html   # 1.61 features
```
