// Hold-time checks in a real Chromium page (Playwright). Added in 1.65 (menus 0.2 s, note lock 0.5 s),
// 1.66: every hold 0.1 s; updated for 1.67: every hold takes 0.3 s — score menus, the rhythm-card menu,
// the note-key lock and the beat menu from a stem while a note is locked. Light taps still select stems,
// enter notes and open rhythms. Run once per built page:
//   node editor165.e2e.cjs ../../RhythmDesk.html ANDROID_ASSETS/index.html
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');

const CLEARANCE = 40;
async function centerOf(locator) {
  const box = await locator.boundingBox();
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

async function holdChecks(page, touch) {
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const press = async (locator, ms) => {
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
    await page.waitForTimeout(450);
    return {x, y};
  };
  const menuOpen = () => page.evaluate(() => !el.menu.hidden);
  const beatMenuOpen = () => page.evaluate(() => !el.beatMenu.hidden);
  const reset = () => page.evaluate(() => { closePopups(); document.querySelector('dialog[open]')?.close(); });

  await page.evaluate(() => { openNewScore(demoProject(), ''); });
  await page.waitForSelector('.staff');
  assert.deepEqual(await page.evaluate(() => [MENU_HOLD_MS, NOTE_LOCK_HOLD_MS, LONG_PRESS_MS]), [300, 300, 300]);
  const id = await page.evaluate(() => doc.tracks[2].id);
  const row = page.locator(`.staff[data-track-id="${id}"]`);
  const cells = () => page.evaluate(id => doc.tracks.find(track => track.id === id).cells.slice(0, 12), id);

  // Score menus: a light tap (0.02 s) opens nothing, 0.3 s opens, clear of the point.
  const barline = row.locator('.barline').nth(1);
  await press(barline, 20);
  assert.equal(await menuOpen(), false, 'a 0.02 s press opens no barline menu');
  const point = await press(barline, 500);
  assert.equal(await menuOpen(), true, 'a 0.5 s hold opens the barline menu');
  const rect = await page.$eval('#menu', node => node.getBoundingClientRect().toJSON());
  assert(!(point.x > rect.left - CLEARANCE && point.x < rect.right + CLEARANCE && point.y > rect.top - CLEARANCE && point.y < rect.bottom + CLEARANCE),
    'menu clear of the held point');
  await reset();
  await press(row.locator('.slot').nth(4), 20);
  assert.equal(await beatMenuOpen(), false, 'a light tap on a stem only selects it');
  assert.deepEqual(await page.evaluate(() => [cursor.beat, cursor.slot]), [1, 1]);
  await press(row.locator('.slot').nth(4), 500);
  assert.equal(await beatMenuOpen(), true, 'a 0.5 s hold on a stem opens the beat menu');
  await reset();

  // Note keys: a light tap enters the note and moves on; a 0.5 s hold locks (and enters nothing).
  await press(row.locator('.slot').nth(1), 20);
  await press(page.locator('#keys .key[data-stroke="B"]'), 20);
  assert.equal(await page.evaluate(() => noteLock), undefined, 'a light tap does not lock');
  assert.equal((await cells())[1], 'B', 'a light tap enters the note');
  assert.deepEqual(await page.evaluate(() => [cursor.beat, cursor.slot]), [0, 2], 'and moves on');
  const beforeLock = await cells();
  await press(page.locator('#keys .key[data-stroke="T"]'), 500);
  assert.deepEqual(await page.evaluate(() => noteLock?.stroke), 'T', 'a 0.5 s hold locks the key');
  assert.deepEqual(await cells(), beforeLock, 'locking enters nothing');

  // Locked: a light tap on a stem enters the note; a 0.5 s hold opens the beat menu and enters nothing.
  await press(row.locator('.slot').nth(4), 20);
  assert.equal(await beatMenuOpen(), false);
  assert.equal((await cells())[4], 'T', 'the locked note is entered by a light tap');
  const before = await cells();
  await press(row.locator('.slot').nth(7), 500);
  assert.equal(await beatMenuOpen(), true, 'a 0.5 s hold opens the beat menu while locked');
  assert.deepEqual(await cells(), before, 'and enters nothing');
  await reset();
  await page.evaluate(() => unlockNote());

  // Home page: a 0.5 s hold on a rhythm card opens its menu; a light tap opens the rhythm.
  await page.evaluate(() => showBrowser());
  const card = page.locator('.rhythm-card:not(#createDocument)').first();
  await card.waitFor();
  await press(card, 500);
  assert.equal(await menuOpen(), true, 'a 0.5 s hold opens the card menu');
  assert(await card.evaluate(node => node.classList.contains('menu-open')));
  assert.equal(await page.evaluate(() => browsing), true, 'the rhythm stays closed');
  await reset();
  await press(card, 20);
  assert.equal(await page.evaluate(() => browsing), false, 'a light tap opens the rhythm');
  console.log(`  PASS ${touch ? 'touch' : 'mouse'}: 0.3 s holds (tested at 0.5 s) open menus (barline, stem, locked stem, rhythm card) and lock note keys; light taps select, enter notes and open rhythms.`);
}

(async () => {
  const pages = process.argv.slice(2);
  if (!pages.length) throw Error('Usage: node editor165.e2e.cjs PAGE.html [PAGE.html ...]');
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
        await holdChecks(page, touch);
        assert.deepEqual(errors, [], 'no page errors');
        await context.close();
      }
    }
  } finally { await browser.close(); }
  console.log('PASS hold-time checks (1.67) on ' + pages.length + ' page(s).');
})().catch(error => { console.error(error); process.exitCode = 1; });
