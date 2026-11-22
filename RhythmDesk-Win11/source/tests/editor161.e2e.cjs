// 1.61 editor checks in a real Chromium page (Playwright), updated for 1.62: the loop-repeat chip (type
// how many more passes, then continue; or keep looping), the tall blue box over the playing note of
// every track, and the note-key lock for tap entry. Run once per built page:
//   node editor161.e2e.cjs ../../RhythmDesk.html ANDROID_ASSETS/index.html
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');

async function openDemo(page, loops = false) {
  await page.evaluate(loops => {
    const project = demoProject();
    project.bpm = 200;
    if (loops) for (const track of project.tracks) track.loops = [{from: 0, to: 1}];
    openNewScore(project, '');
  }, loops);
  await page.waitForSelector('.staff');
}
// Record the playing step of one track every animation frame until `until` returns true.
async function watchSteps(page, trackIndex, ms) {
  return page.evaluate(([index, ms]) => new Promise(resolve => {
    const id = doc.tracks[index].id, steps = [];
    const started = performance.now();
    const tick = () => {
      const step = playingPositions.get(id);
      if (steps.at(-1) !== step) steps.push(step);
      if (performance.now() - started < ms && engine.running) requestAnimationFrame(tick);
      else resolve(steps);
    };
    tick();
  }), [trackIndex, ms]);
}
const earlyInPass = page => page.waitForFunction(() => {
  const step = playingPositions.get(doc.tracks[2].id);
  return step >= 1 && step <= 3;
}, null, {timeout: 5000, polling: 'raf'});
const returns = steps => steps.filter((step, i) => i && step >= 0 && step < steps[i - 1]).length;

async function repeatChecks(page) {
  await openDemo(page, true);
  await page.click('#play');
  await page.waitForFunction(() => !el.loopRepeat.hidden, null, {timeout: 5000});
  assert.match(await page.textContent('#loopRepeat'), /再循环…|Repeat…/, 'chip appears during the loop');
  const chip = await page.locator('#loopRepeat').boundingBox(), stop = await page.locator('#stop').boundingBox();
  assert(Math.abs(chip.x + chip.width / 2 - (stop.x + stop.width / 2)) < 2 && chip.y + chip.height <= stop.y,
    'chip sits above the square');
  // Wait for a loop return, then choose "2 more" early in a pass: a choice in the last ~0.12 s before
  // the loop end applies from the next pass, exactly like the square button.
  let steps = await watchSteps(page, 2, 1500);
  assert(returns(steps) >= 1, 'the section loops: ' + steps);
  await earlyInPass(page);
  await page.click('#loopRepeat');
  const box = page.locator('dialog.loop-repeat-editor[open]');
  assert.equal(await box.count(), 1, 'the chip opens the repeat-count box');
  assert.equal(await box.locator('input').inputValue(), '1');
  assert.equal(await box.locator('.loop-keep').count(), 0, 'keep looping appears only once a continue is pending');
  await box.locator('input').fill('2');
  await box.locator('.tempo-confirm').click();
  assert.equal(await box.count(), 0);
  assert.match(await page.textContent('#loopRepeat'), /再循环 2 次|2 more/);
  assert.match(await page.getAttribute('#stop', 'title'), /再循环 2 次|2 more/);
  // The chip and the Stop tooltip count down at each return to the loop start.
  await page.waitForFunction(() => /再循环 1 次|1 more/.test(el.loopRepeat.textContent) && /1/.test(el.stop.title), null, {timeout: 3000});
  // Exactly two more returns to the loop start, then playback continues into measure 2 (step 12+).
  steps = await watchSteps(page, 2, 6000);
  const pastLoop = steps.findIndex(step => step >= 12);
  assert(pastLoop > 0, 'playback continued past the loop: ' + steps);
  assert.equal(returns(steps.slice(0, pastLoop)), 2, 'two more passes before continuing: ' + steps);
  assert(await page.evaluate(() => el.loopRepeat.hidden || !engine.running), 'chip hides after the loop');
  await page.evaluate(() => stopPlayback());

  // Any count: values outside 1–999, fractions and blanks are refused; Cancel changes nothing;
  // 37 is accepted with Enter; −/+ adjust; Keep looping cancels the pending continue.
  await page.click('#play');
  await page.waitForFunction(() => !el.loopRepeat.hidden, null, {timeout: 5000});
  await page.click('#loopRepeat');
  await box.locator('input').fill('5');
  await box.locator('.tempo-cancel').click();
  assert.equal(await box.count(), 0);
  assert.match(await page.textContent('#loopRepeat'), /再循环…|Repeat…/, 'Cancel changes nothing');
  assert(await page.evaluate(() => playingLoops.every(gate => !gate.released)));
  await page.click('#loopRepeat');
  for (const bad of ['0', '1000', '2.5', '']) {
    await box.locator('input').fill(bad);
    await box.locator('.tempo-confirm').click();
    assert.equal(await box.count(), 1, 'refuses ' + JSON.stringify(bad));
  }
  await box.locator('input').fill('37');
  await box.locator('input').press('Enter');
  assert.equal(await box.count(), 0, 'Enter confirms');
  assert.match(await page.textContent('#loopRepeat'), /再循环 3[67] 次|3[67] more/);
  await page.click('#loopRepeat');
  assert.match(await box.locator('input').inputValue(), /^3[67]$/, 'the box shows the passes left');
  const shown = Number(await box.locator('input').inputValue());
  await box.locator('.tempo-controls button').nth(1).click();
  assert.equal(await box.locator('input').inputValue(), String(shown + 1), '+ adds one');
  await box.locator('.tempo-controls button').nth(0).click();
  await box.locator('.tempo-controls button').nth(0).click();
  assert.equal(await box.locator('input').inputValue(), String(shown - 1), '− removes one');
  await box.locator('.loop-keep').click();
  assert.equal(await box.count(), 0);
  assert.match(await page.textContent('#loopRepeat'), /再循环…|Repeat…/);
  steps = await watchSteps(page, 2, 3500);
  assert(returns(steps) >= 2 && steps.every(step => step < 12), 'keeps looping after cancel: ' + steps);
  await earlyInPass(page);
  await page.click('#stop');
  steps = await watchSteps(page, 2, 3000);
  const after = steps.findIndex(step => step >= 12);
  assert(after > 0 && returns(steps.slice(0, after)) <= 1, 'square continues after the current pass: ' + steps);
  await page.evaluate(() => stopPlayback());
  console.log('  PASS loop repeat: chip above square, typed count (2 → exactly 2 passes, chip counts down; 37 accepted; 0/1000/2.5/blank refused), −/+, Cancel, keep looping, square unchanged.');
}

async function playingBoxChecks(page, shot) {
  await openDemo(page);
  await page.click('#play');
  await page.waitForFunction(() => document.querySelectorAll('.slot.playing').length > 0, null, {timeout: 5000});
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.staff')];
    const slot = document.querySelector('.slot.playing');
    const box = getComputedStyle(slot, '::after');
    return {rows: rows.length, marked: rows.map(row => row.querySelectorAll('.slot.playing').length),
      border: box.borderTopColor, width: parseFloat(box.width), height: parseFloat(box.height),
      top: parseFloat(box.top), slot: slot.offsetHeight, style: box.borderTopStyle};
  });
  assert(state.marked.every(count => count === 1), 'every track marks exactly one playing note: ' + state.marked);
  assert.equal(state.style, 'solid');
  // Tall rectangle: from the beam (stem top at 15/61 of the beat) to below the note head (bass head ends near 56/61).
  assert(state.height > 2 * state.width, 'the box is a tall rectangle: ' + JSON.stringify(state));
  assert(state.top <= state.slot * 15 / 61 && state.top + state.height >= state.slot * 56 / 61, 'the box covers the stem and note head: ' + JSON.stringify(state));
  assert.match(state.border, /rgb\(40, 118, 232\)|rgb\(\d+, \d+, \d+\)/);
  if (shot) await page.screenshot({path: shot});
  await page.click('#play'); // pause keeps the boxes
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.querySelectorAll('.slot.playing').length === doc.tracks.length), 'pause keeps boxes');
  await page.evaluate(() => stopPlayback());
  assert.equal(await page.evaluate(() => document.querySelectorAll('.slot.playing').length), 0, 'stop removes boxes');
  console.log(`  PASS playing box: ${state.rows} tracks each show one ${state.width}×${state.height.toFixed(1)} px tall blue box over stem and note head; pause keeps, stop clears.`);
}

async function lockChecks(page, touch) {
  await openDemo(page);
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const hold = async (locator, ms = 1100) => {
    const box = await locator.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
      await page.waitForTimeout(ms);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    } else { await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); }
    await page.waitForTimeout(450);
  };
  const tap = async locator => {
    if (touch) await locator.tap(); else await locator.click();
    await page.waitForTimeout(300);
  };
  const djembe = await page.evaluate(() => doc.tracks[2].id);
  const slots = page.locator(`.staff[data-track-id="${djembe}"] .slot`);
  await tap(slots.nth(0));
  const cellsOf = () => page.evaluate(id => doc.tracks.find(track => track.id === id).cells.slice(0, 12), djembe);
  const before = await cellsOf();
  const undo = await page.evaluate(() => undoStack.length);
  // Hold B for 1 s: locked, nothing written at the cursor.
  await hold(page.locator('#keys .key[data-stroke="B"]'));
  assert.deepEqual(await page.evaluate(() => noteLock && {stroke: noteLock.stroke}), {stroke: 'B'});
  assert(await page.locator('#keys .key[data-stroke="B"]').evaluate(node => node.classList.contains('locked')));
  assert.deepEqual(await cellsOf(), before, 'locking writes nothing');
  assert.equal(await page.evaluate(() => undoStack.length), undo);
  // Tap empty stems: B is written there and the cursor stays.
  await tap(slots.nth(1));
  await tap(slots.nth(4));
  let cells = await cellsOf();
  assert.equal(cells[1], 'B'); assert.equal(cells[4], 'B');
  assert.deepEqual(await page.evaluate(() => [cursor.beat, cursor.slot]), [1, 1], 'cursor stays on the tapped stem');
  // Tap the same stem again: cleared. A quick double tap writes and clears without opening the beat menu.
  await tap(slots.nth(4));
  assert.equal((await cellsOf())[4], null);
  if (!touch) { await slots.nth(5).click(); await slots.nth(5).click(); await page.waitForTimeout(300); }
  assert.equal(await page.evaluate(() => el.beatMenu.hidden), true, 'double tap does not open the beat menu while locked');
  // A 1 s hold on a stem still opens the beat menu and writes nothing.
  cells = await cellsOf();
  await hold(slots.nth(7));
  assert.equal(await page.evaluate(() => el.beatMenu.hidden), false, 'hold still opens the beat menu');
  assert.deepEqual(await cellsOf(), cells);
  await page.evaluate(() => closePopups());
  // Another instrument without B: only selects.
  const kenkeni = await page.evaluate(() => doc.tracks.find(track => track.type === 'kenkeni').id);
  const kenkeniCells = await page.evaluate(id => doc.tracks.find(track => track.id === id).cells.join(), kenkeni);
  await tap(page.locator(`.staff[data-track-id="${kenkeni}"] .slot`).nth(1));
  assert.equal(await page.evaluate(id => doc.tracks.find(track => track.id === id).cells.join(), kenkeni), kenkeniCells);
  assert.match(await page.textContent('#status'), /没有锁定的音符|has no/);
  // Back on Djembe the rebuilt keyboard still shows the lock.
  await tap(slots.nth(2));
  assert.equal((await cellsOf())[2], 'B');
  assert(await page.locator('#keys .key[data-stroke="B"]').evaluate(node => node.classList.contains('locked')));
  // Hold Rest: the lock moves; tapping clears notes.
  await hold(page.locator('#keys .key[data-stroke=""]'));
  assert.deepEqual(await page.evaluate(() => noteLock && {stroke: noteLock.stroke}), {stroke: null});
  await tap(slots.nth(2));
  assert.equal((await cellsOf())[2], null);
  // Tap the locked key: unlock, nothing written.
  cells = await cellsOf();
  await tap(page.locator('#keys .key[data-stroke=""]'));
  assert.equal(await page.evaluate(() => noteLock), undefined);
  assert.deepEqual(await cellsOf(), cells, 'unlocking tap writes nothing');
  // Normal taps work again (stem selects; key writes and advances).
  await tap(slots.nth(9));
  await tap(page.locator('#keys .key[data-stroke="T"]'));
  assert.equal((await cellsOf())[9], 'T');
  assert.deepEqual(await page.evaluate(() => [cursor.beat, cursor.slot]), [3, 1], 'normal entry advances');
  if (!touch) {
    // Esc and closing the keyboard both unlock.
    await hold(page.locator('#keys .key[data-stroke="S"]'));
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => noteLock), undefined, 'Esc unlocks');
    await hold(page.locator('#keys .key[data-stroke="S"]'));
    await page.click('#showKeys');
    assert.equal(await page.evaluate(() => noteLock), undefined, 'closing the keyboard unlocks');
  }
  console.log(`  PASS ${touch ? 'touch' : 'mouse'} note lock: hold to lock, tap to enter/clear, cursor stays, beat menu by hold, other instruments, Rest lock, unlock.`);
}

(async () => {
  const pages = process.argv.slice(2);
  if (!pages.length) throw Error('Usage: node editor161.e2e.cjs PAGE.html [PAGE.html ...]');
  const browser = await chromium.launch({args: ['--autoplay-policy=no-user-gesture-required']});
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
        if (label === 'desktop') { await repeatChecks(page); await playingBoxChecks(page, process.env.SHOT); await lockChecks(page, false); }
        else { await playingBoxChecks(page, process.env.SHOT_PHONE); await lockChecks(page, true); }
        assert.deepEqual(errors, [], 'no page errors on ' + label);
        await context.close();
      }
    }
  } finally { await browser.close(); }
  console.log('PASS 1.61 editor checks on ' + pages.length + ' page(s).');
})().catch(error => { console.error(error); process.exitCode = 1; });
