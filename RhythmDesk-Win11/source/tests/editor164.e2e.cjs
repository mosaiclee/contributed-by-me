// 1.64 editor checks in a real Chromium page (Playwright): a stem picked in multi-selection, and the
// paste preview, are framed in translucent blue, so the stem and the note under them stay visible.
// The check counts dark pixels (stem, beam, note head) inside a stem before and after picking it.
// Run once per built page:
//   node editor164.e2e.cjs ../../RhythmDesk.html ANDROID_ASSETS/index.html
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');
const {chromium} = require('playwright');

// Minimal PNG reader for Playwright screenshots (8-bit RGB or RGBA, no interlace).
function readPng(buffer) {
  let pos = 8, width, height, channels;
  const data = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos), type = buffer.toString('ascii', pos + 4, pos + 8);
    const chunk = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      assert.equal(chunk[8], 8, 'bit depth'); assert.equal(chunk[12], 0, 'no interlace');
      channels = {2: 3, 6: 4}[chunk[9]];
      assert(channels, 'colour type ' + chunk[9]);
    } else if (type === 'IDAT') data.push(chunk);
    pos += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(data)), stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      pixels[y * stride + x] = (line[x] + predictor) & 255;
    }
  }
  return {width, height, channels, pixels};
}
// Dark pixels (luminance < 90) inside a box, leaving out a margin for the frame's own border.
async function darkPixels(page, box, margin = 4) {
  const png = readPng(await page.screenshot({clip: box}));
  const scale = png.width / box.width;
  let dark = 0;
  for (let y = Math.ceil(margin * scale); y < png.height - margin * scale; y++) {
    for (let x = Math.ceil(margin * scale); x < png.width - margin * scale; x++) {
      const i = (y * png.width + x) * png.channels;
      if (0.299 * png.pixels[i] + 0.587 * png.pixels[i + 1] + 0.114 * png.pixels[i + 2] < 90) dark++;
    }
  }
  return dark;
}

async function pickChecks(page) {
  await page.evaluate(() => { openNewScore(demoProject(), ''); });
  await page.waitForSelector('.staff');
  await page.evaluate(() => applyScoreZoom(1));
  const row = page.locator('.staff').nth(2); // Djembe 1: notes on cells 0 and 2 of the first group
  await page.evaluate(() => startMultiGroups(doc.tracks[2]));
  const results = [];
  for (const index of [0, 2]) {
    const slot = row.locator('.slot').nth(index);
    await slot.scrollIntoViewIfNeeded();
    const box = await slot.boundingBox();
    const before = await darkPixels(page, box);
    await slot.click();
    await page.waitForTimeout(150);
    assert(await slot.evaluate(node => node.classList.contains('slot-picked')), 'the stem is picked');
    const after = await darkPixels(page, box);
    const style = await slot.evaluate(node => getComputedStyle(node).backgroundColor);
    results.push({index, before, after, style});
    assert(before > 40, 'the stem has a drawn stem and note to see: ' + before);
    assert(after >= before * 0.8, `stem ${index}: the stem and note stay visible through the pick frame (${before} → ${after} dark pixels)`);
    assert.match(style, /rgba\(40, 118, 232, 0\.1\d+\)/, 'translucent fill: ' + style);
  }
  // The paste preview is translucent as well.
  await page.evaluate(() => {
    const track = doc.tracks[2];
    previewMultiPaste(track, 1, 0, copyTrackSpan(doc, track, 0, 3));
  });
  const preview = row.locator('.slot.paste-preview').first();
  assert.match(await preview.evaluate(node => getComputedStyle(node).backgroundColor), /rgba\(40, 118, 232, 0\.1\d+\)/);
  console.log('  PASS translucent pick frame: ' + results.map(r => `stem ${r.index} ${r.before}→${r.after} dark px`).join(', ') + '; paste preview translucent.');
}

(async () => {
  const pages = process.argv.slice(2);
  if (!pages.length) throw Error('Usage: node editor164.e2e.cjs PAGE.html [PAGE.html ...]');
  const browser = await chromium.launch();
  try {
    for (const file of pages) {
      console.log('Page ' + path.resolve(file));
      for (const options of [{viewport: {width: 900, height: 600}, deviceScaleFactor: 1},
        {viewport: {width: 390, height: 780}, hasTouch: true, isMobile: true, deviceScaleFactor: 2}]) {
        const context = await browser.newContext({...options, locale: 'zh-CN'});
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('file://' + path.resolve(file));
        await page.waitForSelector('#rhythmGrid');
        await pickChecks(page);
        assert.deepEqual(errors, [], 'no page errors');
        await context.close();
      }
    }
  } finally { await browser.close(); }
  console.log('PASS 1.64 editor checks on ' + pages.length + ' page(s).');
})().catch(error => { console.error(error); process.exitCode = 1; });
