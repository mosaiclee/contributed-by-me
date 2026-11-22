// 1.67 editor checks in a real Chromium page (Playwright): double-taps up to 0.5 s apart, 0.3 s holds,
// the shorter Rest key with the 点按输入 (Tap entry) key beside it, and tap entry started with that key.
// Run once per built page:
//   node editor167.e2e.cjs ../../RhythmDesk.html ANDROID_ASSETS/index.html
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');

async function centerOf(locator) {
  const box = await locator.boundingBox();
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

async function checks(page, touch) {
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const press = async (locator, ms = 0) => {
    const {x, y} = await centerOf(locator);
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
      if (ms) await page.waitForTimeout(ms);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    } else {
      await page.mouse.move(x, y); await page.mouse.down();
      if (ms) await page.waitForTimeout(ms);
      await page.mouse.up();
    }
  };
  const settle = () => page.waitForTimeout(450);
  const beatMenuOpen = () => page.evaluate(() => !el.beatMenu.hidden);
  const reset = () => page.evaluate(() => { closePopups(); document.querySelector('dialog[open]')?.close(); });

  await page.evaluate(() => { openNewScore(demoProject(), ''); });
  await page.waitForSelector('.staff');
  assert.deepEqual(await page.evaluate(() => [MENU_HOLD_MS, NOTE_LOCK_HOLD_MS, LONG_PRESS_MS, DOUBLE_TAP_MS]), [300, 300, 300, 500]);
  const id = await page.evaluate(() => doc.tracks[2].id);
  const row = page.locator(`.staff[data-track-id="${id}"]`);
  const cells = () => page.evaluate(id => doc.tracks.find(track => track.id === id).cells.slice(0, 12), id);

  // Double-tap: 0.4 s apart opens the beat menu; 0.6 s apart does not.
  const stem = row.locator('.slot').nth(4);
  await press(stem); await page.waitForTimeout(400); await press(stem); await settle();
  assert.equal(await beatMenuOpen(), true, 'two taps 0.4 s apart open the beat menu');
  await reset();
  await press(stem); await page.waitForTimeout(600); await press(stem); await settle();
  assert.equal(await beatMenuOpen(), false, 'two taps 0.6 s apart do not');
  await reset();
  // Hold: 0.15 s opens nothing, 0.5 s opens.
  await press(stem, 150); await settle();
  assert.equal(await beatMenuOpen(), false, 'a 0.15 s press opens nothing');
  await press(stem, 500); await settle();
  assert.equal(await beatMenuOpen(), true, 'a 0.5 s hold opens the beat menu');
  await reset();
  // Note keys: a 0.15 s press enters the note; a 0.5 s hold locks.
  await press(row.locator('.slot').nth(1)); await settle();
  await press(page.locator('#keys .key[data-stroke="B"]'), 150); await settle();
  assert.equal(await page.evaluate(() => noteLock), undefined);
  assert.equal((await cells())[1], 'B', 'a 0.15 s key press enters the note');
  await press(page.locator('#keys .key[data-stroke="T"]'), 500); await settle();
  assert.equal(await page.evaluate(() => noteLock?.stroke), 'T', 'a 0.5 s hold locks the key');
  await page.evaluate(() => unlockNote());

  // Keyboard layout: 点按输入 sits right of Rest (1.68: Rest about three times as wide; 1.67 had equal widths).
  const rest = await page.locator('#keys .key[data-stroke=""]').boundingBox();
  const entry = page.locator('#keys .key.tap-entry');
  const entryBox = await entry.boundingBox();
  const row3 = await page.locator('#keys .key-row.navigation').boundingBox();
  assert.match(await entry.getAttribute('aria-label'), /点按输入|Tap entry/);
  assert(rest.width > entryBox.width * 2.5, 'Rest is about three times as wide as 点按输入');
  assert(Math.abs(rest.y - entryBox.y) < 1 && entryBox.x > rest.x, '点按输入 sits right of Rest');
  assert(row3.x >= 0 && row3.x + row3.width <= page.viewportSize().width + 0.5, 'the row fits the screen');

  // Tap entry with the key: press 点按输入, then a note key → locked; tapping stems enters it.
  await press(row.locator('.slot').nth(6)); await settle();
  const before = await cells();
  await press(entry); await settle();
  assert.equal(await entry.evaluate(node => node.classList.contains('armed')), true, '点按输入 waits for a note key');
  assert.match(await page.textContent('#status'), /请点一个音符键|Choose a note key/);
  assert.equal(await page.evaluate(() => el.keys.classList.contains('picking')), true);
  await press(page.locator('#keys .key[data-stroke="S"]')); await settle();
  assert.equal(await page.evaluate(() => noteLock?.stroke), 'S', 'the chosen note is locked');
  assert.deepEqual(await cells(), before, 'choosing the note enters nothing');
  assert.equal(await entry.evaluate(node => node.classList.contains('active') && !node.classList.contains('armed')), true);
  assert.equal(await page.locator('#keys .key[data-stroke="S"]').evaluate(node => node.classList.contains('locked')), true);
  await press(row.locator('.slot').nth(7)); await settle();
  assert.equal((await cells())[7], 'S', 'tapping a stem enters the locked note');
  // Press the locked note key again: tap entry ends.
  await press(page.locator('#keys .key[data-stroke="S"]')); await settle();
  assert.equal(await page.evaluate(() => noteLock), undefined, 'pressing the locked note again ends tap entry');
  assert.equal(await entry.evaluate(node => node.classList.contains('active') || node.classList.contains('armed')), false);
  // 点按输入 → note → 点按输入 again ends it as well.
  await press(entry); await settle();
  await press(page.locator('#keys .key[data-stroke=""]')); await settle();
  assert.deepEqual(await page.evaluate(() => noteLock && {stroke: noteLock.stroke}), {stroke: null}, 'Rest can be chosen too');
  await press(entry); await settle();
  assert.equal(await page.evaluate(() => noteLock), undefined, 'pressing 点按输入 again ends tap entry');
  // Pressing 点按输入 twice without choosing a note cancels; Esc cancels too.
  await press(entry); await settle(); await press(entry); await settle();
  assert.equal(await page.evaluate(() => tapEntryArmed || Boolean(noteLock)), false, 'a second press cancels the wait');
  assert.match(await page.textContent('#status'), /已取消点按输入|Tap entry cancelled/);
  if (!touch) {
    await press(entry); await settle();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => tapEntryArmed), false, 'Esc cancels the wait');
  }
  // After a cancelled wait, note keys enter notes again.
  await press(row.locator('.slot').nth(9)); await settle();
  await press(page.locator('#keys .key[data-stroke="T"]')); await settle();
  assert.equal((await cells())[9], 'T');
  console.log(`  PASS ${touch ? 'touch' : 'mouse'}: double-tap within 0.5 s, 0.3 s holds, Rest with 点按输入 beside it, tap entry started, used and ended with the key.`);
}

(async () => {
  const pages = process.argv.slice(2);
  if (!pages.length) throw Error('Usage: node editor167.e2e.cjs PAGE.html [PAGE.html ...]');
  const browser = await chromium.launch();
  try {
    for (const file of pages) {
      console.log('Page ' + path.resolve(file));
      for (const [touch, options] of [[false, {viewport: {width: 1280, height: 800}}],
        [true, {viewport: {width: 390, height: 780}, hasTouch: true, isMobile: true, deviceScaleFactor: 1}]]) {
        const context = await browser.newContext({...options, locale: 'zh-CN'});
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('file://' + path.resolve(file));
        await page.waitForSelector('#rhythmGrid');
        await checks(page, touch);
        assert.deepEqual(errors, [], 'no page errors');
        await context.close();
      }
    }
  } finally { await browser.close(); }
  console.log('PASS 1.67 editor checks on ' + pages.length + ' page(s).');
})().catch(error => { console.error(error); process.exitCode = 1; });
