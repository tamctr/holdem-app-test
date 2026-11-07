const puppeteer = require('/tmp/pup/node_modules/puppeteer-core');
const fs = require('fs');

(async () => {
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
});
const fails = [];
function expect(cond, msg) { if (!cond) fails.push(msg); }

async function boot(width, height) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const where = (msg.location() && msg.location().url) || '';
    if (/favicon\.ico/.test(where) || msg.text() === 'Failed to load resource: the server responded with a status of 404 (File not found)') return;
    errors.push(msg.text() + ' @ ' + where);
  });
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  return { page, errors };
}

const mobile = await boot(390, 844);
const page = mobile.page;
expect(await page.$eval('html', el => el.dataset.holdemVersion), '2', 'version attribute');
await page.click('#tabs button[data-tab="equity"]');
await page.waitForSelector('#players .player');

const layout = await page.evaluate(() => {
  const players = [...document.querySelectorAll('#players .player')];
  const clear = players[0].querySelector('[data-act="clearcards"]').getBoundingClientRect();
  const rnd = players[0].querySelector('[data-act="randcards"]').getBoundingClientRect();
  const slot = players[0].querySelector('.slot').getBoundingClientRect();
  const eq = players[0].querySelector('.eqmini').getBoundingClientRect();
  const labels = [...players[0].querySelectorAll('.eqmini span')].map(el => el.textContent);
  return {
    version: document.querySelector('.eqver').textContent,
    modes: document.querySelectorAll('#players [data-act="mode"]').length,
    clearText: players[0].querySelector('[data-act="clearcards"]').textContent,
    rndText: players[0].querySelector('[data-act="randcards"]').textContent,
    rowText: players[0].textContent,
    rangeLine: document.querySelector('.range-line') && document.querySelector('.range-line').textContent,
    clearBottom: clear.bottom, rndBottom: rnd.bottom, slotTop: slot.top,
    eqTop: eq.top, eqBottom: eq.bottom, slotBottom: slot.bottom, eqLeft: eq.left, slotRight: slot.right,
    labels,
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    players: players.length
  };
});
expect(layout.version === 'v2', 'badge ' + layout.version);
expect(layout.modes === 0, 'card/range mode toggle still present');
expect(layout.clearText === 'Clear' && layout.rndText === 'RND', 'button labels ' + layout.clearText + '/' + layout.rndText);
expect(!/Random hand/.test(layout.rowText), 'per-row random hand status came back');
expect(layout.clearBottom <= layout.slotTop + 1 && layout.rndBottom <= layout.slotTop + 1, 'Clear/RND not above cards ' + JSON.stringify(layout));
expect(layout.eqLeft >= layout.slotRight - 2, 'equity not beside cards');
expect(Math.abs((layout.eqTop + layout.eqBottom) / 2 - (layout.slotTop + layout.slotBottom) / 2) < 24, 'equity not vertically aligned with cards');
expect(layout.labels.join(',') === 'Equity,Win,Tie', 'labels ' + layout.labels.join(','));
expect(/QQ\+/.test(layout.rangeLine || ''), 'villain range summary missing ' + layout.rangeLine);
expect(layout.scroll <= layout.client + 1, 'horizontal overflow ' + layout.scroll + '>' + layout.client);
await page.screenshot({ path: '/opt/cursor/artifacts/equity-polish-after-mobile-390.png', fullPage: true });

await page.click('#players .flop-btn');
await page.waitForFunction(() => /19,600/.test(document.querySelector('.flop-body').textContent), { timeout: 5000 });
const flopText = await page.$eval('.flop-body', el => el.textContent);
expect(/Set/.test(flopText) && /Trips/.test(flopText) && /Two pair/.test(flopText) && /One pair/.test(flopText) && /No pair/.test(flopText), 'made rows missing');
expect(/Flush draw/.test(flopText) && /Open-ended straight draw/.test(flopText) && /Double gutshot/.test(flopText) && /Gutshot/.test(flopText), 'draw rows missing');
expect(/Board pair/.test(flopText) && /Board trips/.test(flopText), 'board-only labels missing');
expect(/both ends live/.test(flopText) && /not one open-ended/.test(flopText), 'oesd vs double gutshot copy missing');
expect(/100%/.test(flopText), 'made-hand total missing');
const flopOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
expect(flopOverflow, 'flopability horizontal overflow');
await page.screenshot({ path: '/opt/cursor/artifacts/equity-polish-after-mobile-flop.png', fullPage: true });

await page.evaluate(() => {
  const app = window.__holdemApp;
  app.eq.dead[0] = window.HoldemCore.parseCard('2c');
  app.eq.players[0].flopOpen = true;
  app.noteCardsChanged();
  document.querySelector('details[data-fold="e-dead"]').open = true;
});
await page.waitForFunction(() => /18,424/.test(document.querySelector('.flop-body').textContent), { timeout: 5000 });
const sizes = await page.evaluate(() => {
  const box = sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; };
  return {
    hole: box('#players .slot'),
    board: box('#board-slots .slot'),
    dead: box('#dead-slots .slot'),
    sum: box('#dead-sum .pcard'),
    svg: !!document.querySelector('#players .pcard svg'),
    colors: [...document.querySelectorAll('#players .pcard')].map(el => el.className)
  };
});
expect(JSON.stringify(sizes.hole) === JSON.stringify(sizes.board), 'hole/board size ' + JSON.stringify(sizes));
expect(JSON.stringify(sizes.hole) === JSON.stringify(sizes.dead), 'hole/dead slot size ' + JSON.stringify(sizes));
expect(JSON.stringify(sizes.hole) === JSON.stringify(sizes.sum), 'hole/dead-sum size ' + JSON.stringify(sizes));
expect(sizes.svg, 'svg faces missing');
expect(sizes.hole[0] > 28 && sizes.hole[1] > 40, 'card box collapsed ' + JSON.stringify(sizes.hole));

await page.evaluate(() => {
  const app = window.__holdemApp, pc = window.HoldemCore.parseCard;
  app.eq.dead = app.eq.dead.map(() => null);
  app.eq.players[1].mode = 'cards';
  app.eq.players[1].cards = [pc('Ah'), pc('Qd')];
  app.eq.players[1].range = '';
  app.eq.players[0].flopOpen = true;
  app.noteCardsChanged();
});
await page.waitForFunction(() => /17,296/.test(document.querySelector('.flop-body').textContent), { timeout: 5000 });

await page.evaluate(() => {
  const app = window.__holdemApp, pc = window.HoldemCore.parseCard;
  app.eq.players[0].mode = 'cards';
  app.eq.players[0].cards = [pc('As'), pc('Ad')];
  app.eq.players[0].range = '';
  app.eq.players[0].flopOpen = false;
  app.eq.players[1].mode = 'cards';
  app.eq.players[1].cards = [pc('Kc'), pc('Kd')];
  app.eq.players[1].range = '';
  app.eq.board = [pc('2c'), pc('3d'), pc('4h'), pc('5s'), pc('9c')];
  app.eq.dead = app.eq.dead.map(() => null);
  app.eq.mode = 'exact';
  app.noteCardsChanged();
});
await page.click('#calc');
await page.waitForFunction(() => document.querySelector('.eqmini [data-k="eq"]').textContent.includes('%'), { timeout: 8000 });
const eqBefore = await page.$eval('.eqmini [data-k="eq"]', el => el.textContent);
expect(eqBefore === '100.00%', 'AA should win this board, got ' + eqBefore);
await page.screenshot({ path: '/opt/cursor/artifacts/equity-polish-after-mobile-results.png', fullPage: true });
const beside = await page.evaluate(() => {
  const slot = document.querySelector('#players .slot').getBoundingClientRect();
  const eq = document.querySelector('.eqmini').getBoundingClientRect();
  return eq.left >= slot.right - 2 && Math.abs(eq.top - slot.top) < 30;
});
expect(beside, 'result equity not beside the cards');
await page.click('#players [data-act="randcards"]');
const eqAfter = await page.$eval('.eqmini [data-k="eq"]', el => el.textContent);
expect(eqAfter === '—', 'stale equity after RND: ' + eqAfter);
const changed = await page.evaluate(() => {
  const app = window.__holdemApp;
  app.eq.board[0] = window.HoldemCore.parseCard('Jh');
  app.noteCardsChanged();
  return document.querySelector('.eqmini [data-k="eq"]').textContent;
});
expect(changed === '—', 'stale equity after board change');

await page.evaluate(() => {
  const app = window.__holdemApp, pc = window.HoldemCore.parseCard;
  app.eq.players[0].mode = 'cards';
  app.eq.players[0].cards = [pc('As'), pc('Ks')];
  app.eq.players[0].range = '';
  app.eq.board = [null, null, null, null, null];
  app.noteCardsChanged();
});
await page.click('#players .slot');
await page.waitForSelector('#rg .cell');
const picker = await page.evaluate(() => {
  const cells = document.querySelectorAll('#rg .cell').length;
  const seen = {};
  document.querySelectorAll('.picker .pcard').forEach(el => {
    const m = el.className.match(/s(\d)/);
    if (m) seen[m[1]] = getComputedStyle(el).color;
  });
  const slotSizes = [...document.querySelectorAll('#modal .slot, #eq-dock .slot')].map(el => {
    const r = el.getBoundingClientRect();
    return Math.round(r.width) + 'x' + Math.round(r.height);
  });
  return {
    cells,
    colors: Object.values(seen),
    host: document.querySelector('#eq-dock:not([hidden])') ? 'dock' : 'modal',
    rangeHeading: !!document.querySelector('.pick-range h3'),
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    slotSizes
  };
});
expect(picker.cells === 169, 'range grid ' + picker.cells);
expect(picker.rangeHeading, 'range section missing from picker');
expect(new Set(picker.colors).size === 4, 'four-colour faces ' + picker.colors.join('|'));
expect(new Set(picker.slotSizes).size === 1, 'picker slots differ ' + picker.slotSizes.join(','));
expect(picker.scroll <= picker.client + 1, 'picker overflow ' + picker.scroll);
await page.screenshot({ path: '/opt/cursor/artifacts/equity-polish-after-mobile-picker.png' });
await page.keyboard.press('Escape');

await page.click('#tabs button[data-tab="charts"]');
await page.waitForSelector('#grid .cell');
const charts = await page.evaluate(() => ({
  cells: document.querySelectorAll('#grid .cell').length,
  side: [...document.querySelectorAll('#cfg-side .sg')].map(b => b.textContent),
  icm: !!document.querySelector('#cfg-icm')
}));
expect(charts.cells === 169, 'chart cells ' + charts.cells);
expect(charts.side.join(',') === 'Squid,Mushroom,Win 3+', 'side games ' + charts.side.join(','));
expect(charts.icm, 'ICM toggle missing');
await page.click('#setup-sum');
await page.click('#cfg-side [data-sg="squid"]');
const sideOn = await page.$eval('#cfg-side [data-sg="squid"]', el => el.classList.contains('on') && el.getAttribute('aria-pressed') === 'true');
expect(sideOn, 'squid toggle did not turn on');
await page.click('#cfg-side [data-sg="squid"]');
await page.screenshot({ path: '/opt/cursor/artifacts/equity-polish-after-charts-390.png', fullPage: true });

const desktop = await boot(1280, 900);
await desktop.page.click('#tabs button[data-tab="equity"]');
await desktop.page.waitForSelector('#players .slot');
await desktop.page.click('#players .slot');
await desktop.page.waitForSelector('#eq-dock #rg .cell');
const dock = await desktop.page.evaluate(() => ({
  open: !document.querySelector('#eq-dock').hidden,
  cells: document.querySelectorAll('#eq-dock #rg .cell').length,
  scroll: document.documentElement.scrollWidth,
  client: document.documentElement.clientWidth
}));
expect(dock.open && dock.cells === 169, 'desktop dock range ' + JSON.stringify(dock));
expect(dock.scroll <= dock.client + 1, 'desktop overflow');
await desktop.page.screenshot({ path: '/opt/cursor/artifacts/equity-polish-after-desktop.png' });
await desktop.page.keyboard.press('Escape');
await desktop.page.click('#players .flop-btn');
await desktop.page.waitForFunction(() => /19,600/.test(document.querySelector('.flop-body').textContent), { timeout: 5000 });
const deskOverflow = await desktop.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
expect(deskOverflow, 'desktop flop overflow');
await desktop.page.screenshot({ path: '/opt/cursor/artifacts/equity-polish-after-desktop-flop.png', fullPage: true });

const errors = mobile.errors.concat(desktop.errors);
expect(errors.length === 0, 'page errors ' + errors.join(' | '));

await browser.close();
if (fails.length) {
  console.error('FAIL\n' + fails.join('\n'));
  process.exit(1);
}
console.log('SMOKE OK');
fs.writeFileSync('/tmp/ui-smoke-ok.txt', 'ok');
})().catch(err => { console.error(err); process.exit(1); });
