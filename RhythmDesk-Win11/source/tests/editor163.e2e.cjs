// 1.63 editor checks in a real Chromium page (Playwright): a preset count on each loop region (two
// loops on one track play their own number of passes and then continue by themselves), the 0.5 s
// hold, and menus opened by a double-tap keeping clear of the tapped point. Run once per built page:
//   node editor163.e2e.cjs ../../RhythmDesk.html ANDROID_ASSETS/index.html
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');

const CLEARANCE = 40;
function assertClear(rect, point, label) {
  const covers = point.x > rect.left - CLEARANCE && point.x < rect.right + CLEARANCE &&
    point.y > rect.top - CLEARANCE && point.y < rect.bottom + CLEARANCE;
  assert(!covers, `${label} must keep ${CLEARANCE}px clear of the tapped point ${JSON.stringify(point)}; menu ${JSON.stringify(rect)}`);
}
const rectOf = (page, selector) => page.$eval(selector, node => {
  const r = node.getBoundingClientRect(); return {left: r.left, top: r.top, right: r.right, bottom: r.bottom};
});
async function centerOf(locator) {
  const box = await locator.boundingBox();
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}
async function openDemo(page, setup = '') {
  await page.evaluate(setup => {
    const project = demoProject();
    project.bpm = 300;
    new Function('project', setup)(project);
    openNewScore(project, '');
  }, setup);
  await page.waitForSelector('.staff');
}
const menuItems = page => page.locator('#menu button').allTextContents();

async function presetChecks(page) {
  // Djembe 1 (track 3) gets two loops: measure 1 and measure 2.
  await openDemo(page, 'project.tracks[2].loops = [{from: 0, to: 1}, {from: 1, to: 2}];');
  const djembe = await page.evaluate(() => doc.tracks[2].id);
  const row = page.locator(`.staff[data-track-id="${djembe}"]`);
  const shared = row.locator('.barline').nth(1); // ends loop 1 and starts loop 2
  await shared.dblclick();
  let items = await menuItems(page);
  assert(items.some(item => /设置结束于此的循环次数…（一直循环）|Times for Loop Ending Here… \(until stopped\)/.test(item)), items.join(' | '));
  assert(items.some(item => /设置起始于此的循环次数…（一直循环）/.test(item)));
  await page.locator('#menu button', {hasText: /结束于此的循环次数|Loop Ending Here/}).click();
  const box = page.locator('dialog.loop-times-editor[open]');
  assert.equal(await box.count(), 1);
  assert.match(await box.locator('h3').textContent(), /Djembe 1.*第 1 小节/);
  assert.equal(await box.locator('input').inputValue(), '', 'no count yet: blank means loop until stopped');
  for (const bad of ['0', '1000', '1.5']) {
    await box.locator('input').fill(bad);
    await box.locator('.tempo-confirm').click();
    assert.equal(await box.count(), 1, 'refuses ' + bad);
  }
  await box.locator('input').fill('2');
  await box.locator('input').press('Enter');
  assert.equal(await box.count(), 0);
  await shared.dblclick();
  await page.locator('#menu button', {hasText: /起始于此的循环次数/}).click();
  await box.locator('.tempo-controls button').nth(1).click(); // blank + 1 -> 2
  await box.locator('.tempo-controls button').nth(1).click(); // 3
  await box.locator('.tempo-confirm').click();
  let state = await page.evaluate(id => ({loops: doc.tracks.find(track => track.id === id).loops,
    marks: [...document.querySelectorAll(`.staff[data-track-id="${id}"] .loop-times`)].map(node => node.textContent),
    reopened: readProject(JSON.parse(JSON.stringify(doc))).tracks.find(track => track.id === id).loops}), djembe);
  assert.deepEqual(state.loops, [{from: 0, to: 1, times: 2}, {from: 1, to: 2, times: 3}]);
  assert.deepEqual(state.marks, ['×2', '×3'], 'closing barlines show the counts');
  assert.deepEqual(state.reopened, state.loops, 'counts are saved with the score');
  // Track menu: the loop of the selected measure.
  await row.locator('.slot').nth(1).click();
  await row.locator('.staff-head button.icon').click();
  items = await menuItems(page);
  assert(items.some(item => /设置本小节循环次数…（共 2 遍）|Loop Times for This Measure… \(2×\)/.test(item)), items.join(' | '));
  await page.keyboard.press('Escape');

  // Playback: 2 passes of measure 1, 3 passes of measure 2, then the score ends by itself.
  const run = await page.evaluate(id => new Promise(resolve => {
    const steps = [], chips = new Set();
    el.play.click();
    const started = performance.now();
    const tick = () => {
      const step = playingPositions.get(id);
      if (step !== undefined && steps.at(-1) !== step) steps.push(step);
      if (!el.loopRepeat.hidden) chips.add(el.loopRepeat.textContent);
      if (performance.now() - started > 12000) resolve({steps, chips: [...chips], timeout: true});
      else if (!pending && !engine.running && steps.length > 5) resolve({steps, chips: [...chips], timeout: false});
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), djembe);
  const returns = (from, to) => run.steps.filter((step, i) => i && step < run.steps[i - 1] && step >= from && step < to).length;
  assert.equal(run.timeout, false, 'playback finished without pressing anything');
  assert.equal(returns(0, 12), 1, 'measure 1 played twice: ' + run.steps);
  assert.equal(returns(12, 24), 2, 'measure 2 played three times: ' + run.steps);
  assert.equal(Math.max(...run.steps), 23);
  assert(run.chips.some(text => /再循环 1 次|1 more/.test(text)) && run.chips.some(text => /再循环 2 次|2 more/.test(text)),
    'the chip shows the preset passes left: ' + run.chips);

  // The chip still overrides a preset for this playback only: keep looping, then the square.
  await page.click('#play');
  await page.waitForFunction(() => !el.loopRepeat.hidden && /再循环 1 次|1 more/.test(el.loopRepeat.textContent), null, {timeout: 5000});
  await page.click('#loopRepeat');
  await page.locator('dialog.loop-repeat-editor .loop-keep').click();
  await page.waitForTimeout(2000); // 2.5 passes
  assert(await page.evaluate(id => engine.running && playingPositions.get(id) < 12, djembe), 'kept looping past the preset');
  await page.evaluate(() => stopPlayback());
  assert.equal(await page.evaluate(id => doc.tracks.find(track => track.id === id).loops[0].times, djembe), 2, 'the preset itself is unchanged');

  // Clear a count: back to looping until stopped; the mark disappears.
  await shared.dblclick();
  await page.locator('#menu button', {hasText: /结束于此的循环次数/}).click();
  assert.equal(await box.locator('input').inputValue(), '2');
  await box.locator('.loop-keep').click();
  state = await page.evaluate(id => ({loops: doc.tracks.find(track => track.id === id).loops,
    marks: [...document.querySelectorAll(`.staff[data-track-id="${id}"] .loop-times`)].map(node => node.textContent)}), djembe);
  assert.deepEqual(state.loops, [{from: 0, to: 1}, {from: 1, to: 2, times: 3}]);
  assert.deepEqual(state.marks, ['×3']);
  // Inserting a measure before the loops keeps their counts.
  await page.evaluate(id => { const track = doc.tracks.find(item => item.id === id); change(() => insertTrackBarAt(doc, track, 0), true); }, djembe);
  assert.deepEqual(await page.evaluate(id => doc.tracks.find(track => track.id === id).loops, djembe), [{from: 1, to: 2}, {from: 2, to: 3, times: 3}]);
  console.log('  PASS loop presets: barline and track menus, ×N marks, 2 + 3 passes then automatic continue, chip shows/overrides, save, clear, insert.');
}

async function avoidChecks(page, touch) {
  await openDemo(page);
  assert.equal(await page.evaluate(() => MENU_HOLD_MS), 100); // 0.5 s in 1.63–1.64, 0.2 s in 1.65
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const doubleTap = async point => {
    if (touch) {
      for (let i = 0; i < 2; i++) {
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: point.x, y: point.y}]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await page.waitForTimeout(60);
      }
    } else await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(250);
  };
  const press = async (point, ms) => {
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: point.x, y: point.y}]});
      await page.waitForTimeout(ms);
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    } else { await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); }
    await page.waitForTimeout(450);
  };
  const row = page.locator('.staff').nth(2);
  const reset = () => page.evaluate(() => { closePopups(); document.querySelector('dialog[open]')?.close(); });
  const checks = [
    ['barline menu', row.locator('.barline').nth(1), '#menu'],
    ['group meter menu', row.locator('.group-meter').nth(2), '#menu'],
    ['beat menu', row.locator('.slot').nth(4), '#beatMenu'],
    ['sticking menu', row.locator('.slot').nth(5).locator('.hand-dot'), '#menu'],
    ['tempo editor', row.locator('.group-tempo').nth(2), 'dialog.tempo-editor[open]'],
  ];
  for (const [label, locator, menu] of checks) {
    await reset();
    await locator.scrollIntoViewIfNeeded();
    const point = await centerOf(locator);
    await doubleTap(point);
    assert(await page.locator(menu).isVisible(), label + ' opens on a double-tap');
    assertClear(await rectOf(page, menu), point, label + ' (double-tap)');
  }
  await reset();
  // 0.02 s opens nothing; 0.7 s opens the barline menu.
  const barline = await centerOf(row.locator('.barline').nth(1));
  await press(barline, 20);
  assert.equal(await page.evaluate(() => el.menu.hidden), true, 'a 0.02 s press opens nothing');
  await press(barline, 700);
  assert.equal(await page.evaluate(() => el.menu.hidden), false, 'a 0.7 s hold opens the menu');
  assertClear(await rectOf(page, '#menu'), barline, 'barline menu (hold)');
  console.log(`  PASS ${touch ? 'touch' : 'mouse'} (${page.viewportSize().width}px): double-tap menus (barline, group meter, beat, sticking, tempo) clear of the tap; hold opens the menu (0.1 s since 1.66), a 0.02 s press does not.`);
}

(async () => {
  const pages = process.argv.slice(2);
  if (!pages.length) throw Error('Usage: node editor163.e2e.cjs PAGE.html [PAGE.html ...]');
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
        if (label === 'desktop') { await presetChecks(page); await avoidChecks(page, false); }
        else { await avoidChecks(page, true); await avoidChecks(page, false); }
        assert.deepEqual(errors, [], 'no page errors on ' + label);
        await context.close();
      }
    }
  } finally { await browser.close(); }
  console.log('PASS 1.63 editor checks on ' + pages.length + ' page(s).');
})().catch(error => { console.error(error); process.exitCode = 1; });
