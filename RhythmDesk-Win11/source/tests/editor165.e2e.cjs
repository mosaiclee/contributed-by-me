// 1.65 editor checks in a real Chromium page (Playwright): every hold menu opens after 0.2 s (score
// menus and the rhythm-card menu), while locking a note key, and opening the beat menu from a stem
// while a note is locked, keep 0.5 s so ordinary taps still enter notes. Run once per built page:
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
      await page.waitForTimeout(ms);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    } else { await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); }
    await page.waitForTimeout(450);
    return {x, y};
  };
  const menuOpen = () => page.evaluate(() => !el.menu.hidden);
  const beatMenuOpen = () => page.evaluate(() => !el.beatMenu.hidden);
  const reset = () => page.evaluate(() => { closePopups(); document.querySelector('dialog[open]')?.close(); });

  await page.evaluate(() => { openNewScore(demoProject(), ''); });
  await page.waitForSelector('.staff');
  assert.deepEqual(await page.evaluate(() => [MENU_HOLD_MS, NOTE_LOCK_HOLD_MS, LONG_PRESS_MS]), [200, 500, 200]);
  const id = await page.evaluate(() => doc.tracks[2].id);
  const row = page.locator(`.staff[data-track-id="${id}"]`);
  const cells = () => page.evaluate(id => doc.tracks.find(track => track.id === id).cells.slice(0, 12), id);

  // Score menus: 0.08 s opens nothing, 0.3 s opens, clear of the point.
  const barline = row.locator('.barline').nth(1);
  await press(barline, 80);
  assert.equal(await menuOpen(), false, 'a 0.08 s press opens no barline menu');
  const point = await press(barline, 300);
  assert.equal(await menuOpen(), true, 'a 0.3 s hold opens the barline menu');
  const rect = await page.$eval('#menu', node => node.getBoundingClientRect().toJSON());
  assert(!(point.x > rect.left - CLEARANCE && point.x < rect.right + CLEARANCE && point.y > rect.top - CLEARANCE && point.y < rect.bottom + CLEARANCE),
    'menu clear of the held point');
  await reset();
  await press(row.locator('.slot').nth(4), 300);
  assert.equal(await beatMenuOpen(), true, 'a 0.3 s hold on a stem opens the beat menu');
  await reset();

  // Note keys: a 0.3 s press still enters the note; 0.6 s locks.
  await row.locator('.slot').nth(1).click();
  await page.waitForTimeout(250);
  await press(page.locator('#keys .key[data-stroke="B"]'), 300);
  assert.equal(await page.evaluate(() => noteLock), undefined, 'a 0.3 s key press does not lock');
  assert.equal((await cells())[1], 'B', 'a 0.3 s key press enters the note');
  assert.deepEqual(await page.evaluate(() => [cursor.beat, cursor.slot]), [0, 2], 'and moves on');
  await press(page.locator('#keys .key[data-stroke="T"]'), 650);
  assert.deepEqual(await page.evaluate(() => noteLock?.stroke), 'T', 'a 0.65 s hold locks the key');

  // Locked: a 0.3 s press on a stem enters the note (no beat menu); 0.65 s opens the beat menu.
  await press(row.locator('.slot').nth(4), 300);
  assert.equal(await beatMenuOpen(), false, 'tap entry with a 0.3 s press opens no menu while locked');
  assert.equal((await cells())[4], 'T', 'the locked note is entered');
  const before = await cells();
  await press(row.locator('.slot').nth(7), 650);
  assert.equal(await beatMenuOpen(), true, 'a 0.65 s hold still opens the beat menu while locked');
  assert.deepEqual(await cells(), before, 'and enters nothing');
  await reset();
  await page.evaluate(() => unlockNote());

  // Home page: a 0.3 s hold on a rhythm card opens its menu and keeps the library open.
  await page.evaluate(() => showBrowser());
  const card = page.locator('.rhythm-card:not(#createDocument)').first();
  await card.waitFor();
  await press(card, 300);
  assert.equal(await menuOpen(), true, 'a 0.3 s hold opens the card menu');
  assert(await card.evaluate(node => node.classList.contains('menu-open')));
  assert.equal(await page.evaluate(() => browsing), true, 'the rhythm stays closed');
  await reset();
  console.log(`  PASS ${touch ? 'touch' : 'mouse'}: menus open at 0.2 s (barline, stem, rhythm card; not at 0.08 s); key lock and locked-stem menu keep 0.5 s, 0.3 s presses enter notes.`);
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
  console.log('PASS 1.65 editor checks on ' + pages.length + ' page(s).');
})().catch(error => { console.error(error); process.exitCode = 1; });
