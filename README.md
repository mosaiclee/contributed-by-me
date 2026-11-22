# RhythmDesk · 鼓谱工作台

- `RhythmDesk-Win11/` — Windows 11 edition: `RhythmDesk.exe` opens `RhythmDesk.html` in Edge. Readable sources in `RhythmDesk-Win11/source/ui`; `source/build_ui.py` rebuilds the page.
- `android/` — Android edition: the signed APK and `index.html`, the editor page packed as `assets/index.html` in the APK.
- `tools/` — the per-release patch lists (`patch160.py` … `patch163.py`), APK repack, signing, verification and handoff-document scripts.
- `docs/RhythmDesk-交接文档-1.59至1.63.txt` — developer handoff (Chinese): every request so far, what changed for each, and before/after code for every changed passage.

The Android signing key is kept outside this repository (`*.pem` is ignored).

## 1.63

1. **Preset loop counts**: every track loop can store how many times it plays in total (1–999, including the first pass) — *Times for Loop Starting/Ending Here…* in the barline menu, or *Loop Times for This Measure…* in the track ⋯ menu. Playback plays that many passes and continues by itself; several loops on one track keep their own counts. A preset loop shows ×N beside its closing barline, and counts are saved in the score (`loops[].times`). Blank means loop until stopped, as before. The ↻ Repeat… chip and the square still override a preset for the current playback.
2. **0.5-second hold**: every hold (menus and the note-key lock) takes 0.5 s instead of 1 s.
3. **Double-tap menus keep clear of the tap**: menus and the tempo box opened by a double-tap are placed away from the tapped point, like those opened by a hold.
4. Guide, about text, readmes and the handoff document updated.

## 1.62

1. **Free repeat count**: the ↻ Repeat… chip opens a box where any count from 1 to 999 is typed (−/+ adjust, Enter or Done confirms, Cancel changes nothing; Keep looping cancels a pending continue). The chip and the Stop tooltip count down at every pass (fixes a 1.61 display bug).
2. **Docs checked against the editor**: the selection frame is called the blue selection frame, and the English guide states that a group's notes must be cleared before changing its meter.
3. **Tall playing box**: the playing note of every track is covered by a 22 px wide blue box from the beam down past the note head, covering the stem.

## 1.61

1. **↻ 再循环… / Repeat…**: while a track loop plays, a chip above the Stop square plays the loop more times before continuing (a 1–8 menu in 1.61; a typed count since 1.62), shows the passes left, and can cancel a pending continue. The square alone still continues after the current pass.
2. **Playing position on every track**: the playing note of each track is marked in blue (a 28 px square in 1.61; a tall box over the stem since 1.62). Pausing keeps the marks; stopping clears them.
3. **Note lock**: hold a stroke key (or Rest) to lock it (1 s in 1.61, 0.5 s since 1.63); tapping stems then enters that note in place without moving on (tap again to clear; locked Rest clears). Tap the locked key or press Esc to unlock. While locked, a hold on a stem still opens the beat menu.

## 1.60

1. **复制本轨道 / Duplicate Track** in the track ⋯ menu: copies the track with all of its content — notes, sticking (L/R), measures and group meters, split cells, tempo, loops, line breaks, custom sounds, preset and mix — into a new track named “… 副本” directly below the track (below its Bell/Drum pair for paired drums). One undo step.
2. **Split with notes written**: the ♫ key, digit keys 1–4, the beat menu’s 拆分为… and 切换 3/4 细分, the measure/track/score 统一拆分 menus and the score “all groups to 3/4” no longer ask you to clear notes first. Notes move to the nearest new cell; if two notes land on one cell you are asked before they are merged.
3. **Hold to open double-tap menus** (1 s in 1.60–1.62, 0.5 s since 1.63): stem → beat menu, blue dot → sticking, barline → measure menu, group meter, group tempo, with finger, pen or mouse. The menu keeps at least 40 px clear of the held point (shortening and scrolling a tall menu if needed), and the release that ends the hold never activates a menu item. Moving more than 10 px or adding a second finger cancels the hold; multi-selection keeps its own 0.5 s whole-group hold.

## Rebuild

```sh
# Windows 11 page from the readable sources
python3 RhythmDesk-Win11/source/build_ui.py

# Android: replace the page and version in the previous APK, then sign with the release key (APK Signature Scheme v2)
python3 tools/repack_apk.py RhythmDesk-Android-1.62.apk android/index.html unsigned.apk 1.63
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \
     --add-exports java.base/sun.security.util=ALL-UNNAMED -cp apksig-2.3.0.jar tools/SignApk.java \
     RhythmDesk-Android-signing.pem unsigned.apk RhythmDesk-Android-1.63.apk
python3 tools/verify_v2.py RhythmDesk-Android-1.63.apk
```

`tools/patch160.py` (1.59 → 1.60), `patch161.py` (→ 1.61), `patch162.py` (→ 1.62) and `patch163.py` (→ 1.63) are the exact edit sets applied to the Win11 sources and the Android page; every edit had to match in both, so both editions received identical changes. `tools/make_handoff.py` builds the handoff document from them. `apksig-2.3.0.jar` is `com.android.tools.build:apksig:2.3.0` from Maven Central.

## Tests

```sh
cd RhythmDesk-Win11/source/tests
node interaction163.cjs
node playback163.cjs ../../../android/index.html ../../RhythmDesk.html
node editor160.e2e.cjs ../../RhythmDesk.html ../../../android/index.html   # 1.60 features; needs Playwright + Chromium
node editor161.e2e.cjs ../../RhythmDesk.html ../../../android/index.html   # 1.61/1.62 features
node editor163.e2e.cjs ../../RhythmDesk.html ../../../android/index.html   # 1.63 features
```
