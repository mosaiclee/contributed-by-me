# RhythmDesk · 鼓谱工作台

- `RhythmDesk-Win11/` — Windows 11 edition: `RhythmDesk.exe` opens `RhythmDesk.html` in Edge. Readable sources in `RhythmDesk-Win11/source/ui`; `source/build_ui.py` rebuilds the page.
- `android/` — Android edition: the signed APK and `index.html`, the editor page packed as `assets/index.html` in the APK.
- `tools/` — the 1.60 patch, APK repack, signing and verification scripts.

The Android signing key is kept outside this repository (`*.pem` is ignored).

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
python3 tools/repack_apk.py RhythmDesk-Android-1.59.apk android/index.html unsigned.apk
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \
     --add-exports java.base/sun.security.util=ALL-UNNAMED -cp apksig-2.3.0.jar tools/SignApk.java \
     RhythmDesk-Android-signing.pem unsigned.apk RhythmDesk-Android-1.60.apk
python3 tools/verify_v2.py RhythmDesk-Android-1.60.apk
```

`tools/patch160.py` is the exact edit set applied to the 1.59 sources and the 1.59 Android page; every edit had to match once in each, so both editions received identical changes. `apksig-2.3.0.jar` is `com.android.tools.build:apksig:2.3.0` from Maven Central.

## Tests

```sh
cd RhythmDesk-Win11/source/tests
node interaction160.cjs
node playback160.cjs ../../../android/index.html ../../RhythmDesk.html
node editor160.e2e.cjs ../../RhythmDesk.html ../../../android/index.html   # needs Playwright + Chromium
```
