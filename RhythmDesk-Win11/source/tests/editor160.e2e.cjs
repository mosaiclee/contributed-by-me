// 1.60 editor checks in a real Chromium page (Playwright): Duplicate Track, splitting cells and
// changing subdivisions with notes in place, and the one-second hold that opens every double-tap
// menu clear of the held point. Run once per built page:
//   node editor160.e2e.cjs ../../RhythmDesk.html ANDROID_ASSETS/index.html
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');

const CLEARANCE = 40;
async function rectOf(page, selector) {
  return page.$eval(selector, node => { const r = node.getBoundingClientRect(); return {left: r.left, top: r.top, right: r.right, bottom: r.bottom}; });
}
function assertClear(rect, point, label) {
  const covers = point.x > rect.left - CLEARANCE && point.x < rect.right + CLEARANCE &&
    point.y > rect.top - CLEARANCE && point.y < rect.bottom + CLEARANCE;
  assert(!covers, `${label} must keep ${CLEARANCE}px clear of the held point ${JSON.stringify(point)}; menu ${JSON.stringify(rect)}`);
}
async function centerOf(locator) {
  const box = await locator.boundingBox();
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}
async function openDemo(page) {
  await page.evaluate(() => { openNewScore(demoProject(), ''); });
  await page.waitForSelector('.staff');
}
async function mouseHold(page, point, ms) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
}
const menuOpen = page => page.evaluate(() => !el.menu.hidden);
const beatMenuOpen = page => page.evaluate(() => !el.beatMenu.hidden);

async function duplicateChecks(page) {
  await openDemo(page);
  const before = await page.evaluate(() => doc.tracks.map(track => track.id));
  const djembe = 2; // "Djembe 1" in the demo
  await page.locator('.staff').nth(djembe).locator('.staff-head button.icon').click();
  const item = page.locator('#menu button', {hasText: /复制本轨道|Duplicate Track/});
  assert.equal(await item.count(), 1, 'track menu offers Duplicate Track');
  await item.click();
  const result = await page.evaluate(index => {
    const source = doc.tracks[index], copy = doc.tracks[index + 1];
    const strip = track => { const {id, name, ...rest} = structuredClone(track); return rest; };
    return {count: doc.tracks.length, rows: document.querySelectorAll('.staff').length, source: source.name, name: copy.name,
      idUnique: new Set(doc.tracks.map(track => track.id)).size === doc.tracks.length,
      same: JSON.stringify(strip(source)) === JSON.stringify(strip(copy)), notes: copy.cells.filter(Boolean).length,
      cursor: cursor.track === copy.id, roundTrip: readProject(JSON.parse(JSON.stringify(doc))).tracks.length};
  }, djembe);
  assert.equal(result.count, before.length + 1);
  assert.equal(result.rows, before.length + 1, 'the copy is drawn');
  assert(result.idUnique, 'copy has its own id');
  assert(result.same, 'copy keeps notes, sticking, measures, loops, samples and mix');
  assert(result.notes > 0, 'notes are copied');
  assert.match(result.name, /^Djembe 1 (副本|copy)$/);
  assert(result.cursor, 'cursor moves to the copy');
  assert.equal(result.roundTrip, before.length + 1, 'saved score with the copy reopens');
  // A paired drum: the copy goes below the Bell/Drum pair and the pair stays together.
  const pair = await page.evaluate(() => {
    const drum = doc.tracks.find(track => track.type === 'kenkeni');
    duplicateTrackWithContent(drum);
    const blocks = trackBlocks(doc).map(block => block.map(track => track.name).join('+'));
    return {blocks, copy: doc.tracks[doc.tracks.findIndex(track => track === drum) + 1].name};
  });
  assert(pair.blocks.includes('Kenkeni Bell+Kenkeni'), 'original Bell/Drum pair intact: ' + pair.blocks);
  assert.match(pair.copy, /^Kenkeni (副本|copy)$/);
  // Duplicating twice numbers the names; undo removes the copy in one step.
  const names = await page.evaluate(() => {
    const drum = doc.tracks.find(track => track.name === 'Kenkeni');
    duplicateTrackWithContent(drum);
    const name = doc.tracks.filter(track => track.name.startsWith('Kenkeni ')).map(track => track.name);
    el.undo.click();
    return {name, after: doc.tracks.filter(track => track.name.startsWith('Kenkeni ')).length};
  });
  assert.deepEqual(names.name.sort(), ['Kenkeni Bell', 'Kenkeni 副本', 'Kenkeni 副本 2'].sort());
  assert.equal(names.after, 2, 'undo removes one copy');
  console.log('  PASS Duplicate Track: menu item, full content, ids, placement below pairs, naming, undo, reopen.');
}

async function splitChecks(page) {
  await openDemo(page);
  // Djembe 1, first beat holds "S.T": notes on cells 0 and 2 of a 3-cell group.
  const track = await page.evaluate(() => doc.tracks[2].id);
  const slots = page.locator(`.staff[data-track-id="${track}"] .slot`);
  await slots.nth(0).click();
  await page.waitForTimeout(300);
  // ♫ split key while notes are written: no "clear notes first" warning, note kept.
  await page.locator('.split-key').click();
  await page.locator('#menu button', {hasText: /^2 /}).click();
  let state = await page.evaluate(id => {
    const track = doc.tracks.find(item => item.id === id);
    return {warning: el.noteChangeWarning.open, beat: trackGrid(doc, track).beats[0], cells: track.cells.slice(0, 4)};
  }, track);
  assert.equal(state.warning, false, 'no clear-notes warning');
  assert.deepEqual(state.beat, [2, 1, 1]);
  assert.deepEqual(state.cells, ['S', null, null, 'T'], 'notes stay on their cells after the split');
  // Digit key 4 on the same cell: 2 -> 4 parts keeps the note.
  await page.keyboard.press('4');
  state = await page.evaluate(id => {
    const track = doc.tracks.find(item => item.id === id);
    return {beat: trackGrid(doc, track).beats[0], cells: track.cells.slice(0, 6)};
  }, track);
  assert.deepEqual(state.beat, [4, 1, 1]);
  assert.deepEqual(state.cells, ['S', null, null, null, null, 'T']);
  // Write a note on the second sub-cell, then merge back to 1 part: the overlap asks to merge.
  await page.evaluate(id => { selectSlot(id, 0, 2); writeStroke('B', 0); }, track);
  let asked = '';
  page.once('dialog', dialog => { asked = dialog.message(); dialog.accept(); });
  await page.keyboard.press('1');
  state = await page.evaluate(id => {
    const track = doc.tracks.find(item => item.id === id);
    return {beat: trackGrid(doc, track).beats[0], cells: track.cells.slice(0, 3)};
  }, track);
  assert.match(asked, /合并|merged/, 'merge confirmation');
  assert.equal(state.beat, 3);
  assert.deepEqual(state.cells, ['S', null, 'T'], 'merge keeps the first note of the cell');
  // Beat menu 3/4 switch on a beat with notes (double-tap the stem, then the menu item).
  await page.evaluate(id => selectSlot(id, 1, 0), track);
  await slots.nth(3).click(); await slots.nth(3).click();
  assert(await beatMenuOpen(page), 'double-tap still opens the beat menu');
  await page.locator('#beatMenu button', {hasText: /3\/4|Tuplet/}).click();
  state = await page.evaluate(id => {
    const track = doc.tracks.find(item => item.id === id);
    const grid = trackGrid(doc, track);
    return {warning: el.noteChangeWarning.open, sizes: grid.beats.slice(0, 2), notes: track.cells.filter(Boolean).length};
  }, track);
  assert.equal(state.warning, false);
  assert.deepEqual(state.sizes, [3, 4]);
  // Track menu: split the whole track into 2 parts with notes written.
  const notesBefore = await page.evaluate(id => doc.tracks.find(item => item.id === id).cells.filter(Boolean).length, track);
  await page.locator('.staff').nth(2).locator('.staff-head button.icon').click();
  await page.locator('#menu button', {hasText: /统一拆分本轨道|Split track/}).click();
  await page.locator('#menu button', {hasText: /^2 /}).click();
  state = await page.evaluate(id => {
    const track = doc.tracks.find(item => item.id === id);
    return {warning: el.noteChangeWarning.open, first: trackGrid(doc, track).beats[0], notes: track.cells.filter(Boolean).length};
  }, track);
  assert.equal(state.warning, false, 'bulk split does not ask to clear notes');
  assert.deepEqual(state.first, [2, 2, 2]);
  assert.equal(state.notes, notesBefore, 'bulk split keeps every note');
  // A score without per-track measures: the beat-menu 3/4 switch changes that beat on every track.
  await openDemo(page);
  const shared = await page.evaluate(() => {
    const notes = () => doc.tracks.reduce((count, track) => count + track.cells.filter(Boolean).length, 0);
    const before = notes();
    selectSlot(doc.tracks[2].id, 0, 0);
    changeTuplet();
    return {warning: el.noteChangeWarning.open, before, after: notes(), beat: doc.beats[0], measures: doc.tracks.some(track => track.measures)};
  });
  assert.deepEqual(shared, {warning: false, before: shared.before, after: shared.before, beat: 4, measures: false});
  // Score ⋯ "all groups to 4" keeps every note.
  const all = await page.evaluate(() => {
    const notes = () => doc.tracks.reduce((count, track) => count + track.cells.filter(Boolean).length, 0);
    const before = notes();
    applyBeatSizes(doc.beats.map(() => 4), 4);
    return {warning: el.noteChangeWarning.open, before, after: notes(), beats: [...new Set(doc.beats)]};
  });
  assert.deepEqual(all, {warning: false, before: all.before, after: all.before, beats: [4]});
  console.log('  PASS split with notes: ♫ key, digit keys, merge confirmation, beat-menu 3/4 switch, bulk track split, shared-grid 3/4 switch, all groups to 4.');
}

async function holdChecks(page, touch) {
  await openDemo(page);
  const track = await page.evaluate(() => doc.tracks[2].id);
  const row = page.locator(`.staff[data-track-id="${track}"]`);
  const hold = touch ? touchHold : (point, ms) => mouseHold(page, point, ms);
  const release = touch ? touchEnd : () => page.mouse.up();
  async function touchHold(point, ms) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: point.x, y: point.y}]});
    await page.waitForTimeout(ms);
  }
  async function touchEnd() { await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []}); }
  const cdp = touch ? await page.context().newCDPSession(page) : null;

  // Short press (0.5 s) opens nothing.
  const slot = row.locator('.slot').nth(4);
  let point = await centerOf(slot);
  await hold(point, 500); await release(); await page.waitForTimeout(450);
  assert.equal(await beatMenuOpen(page), false, 'a 0.5 s press does not open the beat menu');
  // 1 s hold on a stem opens the beat menu clear of the finger; releasing chooses nothing.
  await page.evaluate(() => closePopups());
  point = await centerOf(slot);
  await hold(point, 1100);
  assert(await beatMenuOpen(page), 'held stem opens the beat menu');
  assertClear(await rectOf(page, '#beatMenu'), point, 'beat menu');
  const selected = await page.evaluate(() => ({beat: cursor.beat, slot: cursor.slot, undo: undoStack.length}));
  await release(); await page.waitForTimeout(450);
  assert(await beatMenuOpen(page), 'releasing the hold keeps the beat menu open');
  assert.deepEqual({beat: selected.beat, slot: selected.slot}, {beat: 1, slot: 1}, 'held stem is selected');
  assert.equal(await page.evaluate(() => undoStack.length), selected.undo, 'release does not run a menu item');
  // Movement during the hold cancels it.
  await page.evaluate(() => closePopups());
  point = await centerOf(row.locator('.slot').nth(6));
  if (touch) {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: point.x, y: point.y}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: point.x + 25, y: point.y}]});
  } else { await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 25, point.y, {steps: 3}); }
  await page.waitForTimeout(1100); await release(); await page.waitForTimeout(300);
  assert.equal(await beatMenuOpen(page), false, 'moving during the hold cancels it');
  // Blue sticking dot -> sticking menu.
  await page.evaluate(() => closePopups());
  point = await centerOf(row.locator('.slot').nth(5).locator('.hand-dot'));
  await hold(point, 1100);
  assert(await menuOpen(page), 'held sticking dot opens the sticking menu');
  assert(await page.locator('#menu button', {hasText: /左手|Left/}).count() > 0, 'it is the sticking menu');
  assertClear(await rectOf(page, '#menu'), point, 'sticking menu');
  await release(); await page.waitForTimeout(450);
  assert(await menuOpen(page), 'sticking menu stays open after release');
  // Barline -> measure menu.
  await page.evaluate(() => closePopups());
  point = await centerOf(row.locator('.barline').nth(1));
  await hold(point, 1100);
  assert(await menuOpen(page), 'held barline opens the barline menu');
  assertClear(await rectOf(page, '#menu'), point, 'barline menu');
  const items = await page.locator('#menu button').count();
  await release(); await page.waitForTimeout(450);
  assert(await menuOpen(page) && await page.locator('#menu button').count() === items, 'barline menu unchanged after release');
  // Group meter -> meter menu.
  await page.evaluate(() => closePopups());
  const meter = row.locator('.group-meter').nth(2);
  await meter.scrollIntoViewIfNeeded();
  point = await centerOf(meter);
  await hold(point, 1100);
  assert(await menuOpen(page), 'held group meter opens the meter menu');
  assertClear(await rectOf(page, '#menu'), point, 'group meter menu');
  await release(); await page.waitForTimeout(450);
  // Group tempo -> tempo dialog away from the finger.
  await page.evaluate(() => closePopups());
  point = await centerOf(row.locator('.group-tempo').nth(2));
  await hold(point, 1100);
  assert(await page.locator('dialog.tempo-editor[open]').count() === 1, 'held group tempo opens the tempo editor');
  assertClear(await rectOf(page, 'dialog.tempo-editor[open]'), point, 'tempo editor');
  await release(); await page.waitForTimeout(450);
  assert(await page.locator('dialog.tempo-editor[open]').count() === 1, 'tempo editor stays open after release');
  await page.locator('dialog.tempo-editor .tempo-cancel').click();
  // Multi-selection keeps its 0.5 s whole-group hold and opens no beat menu.
  await page.evaluate(id => startMultiGroups(doc.tracks.find(track => track.id === id)), track);
  point = await centerOf(row.locator('.slot').nth(4));
  await hold(point, 1100); await release(); await page.waitForTimeout(450);
  assert.equal(await beatMenuOpen(page), false, 'multi-selection hold opens no beat menu');
  assert(await page.evaluate(() => multiGroups?.picks.length > 0), 'multi-selection hold still picks the group');
  await page.evaluate(() => finishMultiGroups());
  console.log(`  PASS ${touch ? 'touch' : 'mouse'} 1 s hold: stem, sticking dot, barline, group meter, group tempo; menus clear of the point; release, short press, movement and multi-selection.`);
}

(async () => {
  const pages = process.argv.slice(2);
  if (!pages.length) throw Error('Usage: node editor160.e2e.cjs PAGE.html [PAGE.html ...]');
  const browser = await chromium.launch();
  try {
    for (const file of pages) {
      console.log('Page ' + path.resolve(file));
      const url = 'file://' + path.resolve(file);
      for (const [label, options] of [['desktop', {viewport: {width: 1280, height: 800}}],
        ['phone', {viewport: {width: 390, height: 780}, hasTouch: true, isMobile: true, deviceScaleFactor: 1}]]) {
        const context = await browser.newContext({...options, locale: 'zh-CN'});
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(url);
        await page.waitForSelector('#rhythmGrid');
        if (label === 'desktop') { await duplicateChecks(page); await splitChecks(page); await holdChecks(page, false); }
        else await holdChecks(page, true);
        assert.deepEqual(errors, [], 'no page errors on ' + label);
        await context.close();
      }
    }
  } finally { await browser.close(); }
  console.log('PASS 1.60 editor checks on ' + pages.length + ' page(s).');
})().catch(error => { console.error(error); process.exitCode = 1; });
