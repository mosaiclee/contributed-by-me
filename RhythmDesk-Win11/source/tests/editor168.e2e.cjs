// 1.68 editor checks in a real Chromium page (Playwright): the Rest key is longer again and the
// 点按输入 (Tap entry) key is half as wide as in 1.67, showing a tapping-finger icon instead of words.
// Widths are measured with the 1.67 and 1.68 column layouts on the same page. Run once per built page:
//   node editor168.e2e.cjs ../../RhythmDesk.html ANDROID_ASSETS/index.html
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');
const {chromium} = require('playwright');

const LAYOUT_167 = '1fr 1fr minmax(56px, 1.9fr) minmax(56px, 1.9fr) 1fr 1fr';

// Minimal PNG reader for Playwright screenshots (8-bit RGB or RGBA, no interlace).
function readPng(buffer) {
  let pos = 8, width, height, channels;
  const data = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos), type = buffer.toString('ascii', pos + 4, pos + 8);
    const chunk = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') { width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); channels = {2: 3, 6: 4}[chunk[9]]; }
    else if (type === 'IDAT') data.push(chunk);
    pos += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(data)), stride = width * channels, pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0, b = y ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      pixels[y * stride + x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]) & 255;
    }
  }
  return {width, height, channels, pixels};
}
// Blue pixels (the icon's stroke) inside a box.
async function bluePixels(page, box) {
  const png = readPng(await page.screenshot({clip: box}));
  let blue = 0;
  for (let i = 0; i < png.pixels.length; i += png.channels) {
    const [r, g, b] = [png.pixels[i], png.pixels[i + 1], png.pixels[i + 2]];
    if (b > 180 && r < 120 && g < 170) blue++;
  }
  return blue;
}

async function checks(page) {
  await page.evaluate(() => { openNewScore(demoProject(), ''); });
  await page.waitForSelector('.staff');
  await page.locator('.staff').nth(2).locator('.slot').nth(0).click();
  await page.waitForTimeout(250);
  const widths = () => page.evaluate(() => {
    const row = el.keys.querySelector('.key-row.navigation');
    const box = node => node.getBoundingClientRect();
    return {rest: box(row.querySelector('.key[data-stroke=""]')).width, entry: box(row.querySelector('.key.tap-entry')).width,
      arrow: box(row.lastElementChild).width, row: box(row).width};
  });
  const now = await widths();
  const old = await page.evaluate(layout => {
    const row = el.keys.querySelector('.key-row.navigation');
    row.style.gridTemplateColumns = layout;
    const box = node => node.getBoundingClientRect();
    const result = {rest: box(row.querySelector('.key[data-stroke=""]')).width, entry: box(row.querySelector('.key.tap-entry')).width};
    row.style.gridTemplateColumns = '';
    return result;
  }, LAYOUT_167);
  assert(Math.abs(now.entry / old.entry - 0.5) < 0.08, `点按输入 is half as wide as in 1.67 (${old.entry.toFixed(1)} → ${now.entry.toFixed(1)} px)`);
  assert(now.rest > old.rest * 1.35, `Rest is longer than in 1.67 (${old.rest.toFixed(1)} → ${now.rest.toFixed(1)} px)`);
  assert(Math.abs(now.entry - now.arrow) < 8, '点按输入 is about as wide as an arrow key');
  // Icon instead of words; the name stays in the tooltip and accessible label.
  const entry = page.locator('#keys .key.tap-entry');
  assert.equal((await entry.textContent()).trim(), '', 'no words on the key');
  assert.equal(await entry.locator('svg use').getAttribute('href'), '#i-tap-entry');
  assert.match(await entry.getAttribute('title'), /^点按输入|^Tap entry/);
  assert.match(await entry.getAttribute('aria-label'), /^点按输入|^Tap entry/);
  const box = await entry.boundingBox();
  const drawn = await bluePixels(page, box);
  assert(drawn > 40, 'the tapping-finger icon is drawn: ' + drawn + ' blue pixels');
  // The key still works: press it, then a note key → tap entry with that note.
  await entry.click();
  await page.locator('#keys .key[data-stroke="B"]').click();
  assert.equal(await page.evaluate(() => noteLock?.stroke), 'B');
  assert.equal(await entry.evaluate(node => node.classList.contains('active')), true);
  await entry.click();
  assert.equal(await page.evaluate(() => noteLock), undefined);
  console.log(`  PASS ${page.viewportSize().width}px: Rest ${old.rest.toFixed(0)}→${now.rest.toFixed(0)} px, 点按输入 ${old.entry.toFixed(0)}→${now.entry.toFixed(0)} px (arrow ${now.arrow.toFixed(0)} px), tapping-finger icon drawn (${drawn} px), key still works.`);
}

(async () => {
  const pages = process.argv.slice(2);
  if (!pages.length) throw Error('Usage: node editor168.e2e.cjs PAGE.html [PAGE.html ...]');
  const browser = await chromium.launch();
  try {
    for (const file of pages) {
      console.log('Page ' + path.resolve(file));
      for (const options of [{viewport: {width: 1280, height: 800}, deviceScaleFactor: 1},
        {viewport: {width: 390, height: 780}, hasTouch: true, isMobile: true, deviceScaleFactor: 2}]) {
        const context = await browser.newContext({...options, locale: 'zh-CN'});
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('file://' + path.resolve(file));
        await page.waitForSelector('#rhythmGrid');
        await checks(page);
        assert.deepEqual(errors, [], 'no page errors');
        await context.close();
      }
    }
  } finally { await browser.close(); }
  console.log('PASS 1.68 editor checks on ' + pages.length + ' page(s).');
})().catch(error => { console.error(error); process.exitCode = 1; });
