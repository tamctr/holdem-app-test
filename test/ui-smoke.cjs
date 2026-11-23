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
    clearTop: clear.top, clearBottom: clear.bottom, clearLeft: clear.left,
    rndTop: rnd.top, rndLeft: rnd.left, slotTop: slot.top, slotRight: slot.right,
    eqTop: eq.top, eqBottom: eq.bottom, slotBottom: slot.bottom, eqLeft: eq.left,
    labelAbove: (() => {
      const lab = players[0].querySelector('.eqmini span').getBoundingClientRect();
      const num = players[0].querySelector('.eqmini b').getBoundingClientRect();
      return lab.bottom <= num.top + 1;
    })(),
    flopBadge: players[0].querySelector('.foh b').textContent,
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
expect(layout.clearLeft >= layout.slotRight - 2 && layout.rndLeft >= layout.slotRight - 2, 'Clear/RND not beside the cards ' + JSON.stringify(layout));
expect(layout.clearBottom <= layout.rndTop + 2, 'Clear is not stacked above RND');
expect(layout.eqLeft >= layout.slotRight - 2, 'equity not beside cards');
expect(Math.abs((layout.eqTop + layout.eqBottom) / 2 - (layout.slotTop + layout.slotBottom) / 2) < 28, 'equity not vertically aligned with cards');
expect(layout.labels.join(',') === 'Equity %,Win %,Tie %', 'labels ' + layout.labels.join(','));
expect(layout.labelAbove, 'percent label is not above the number');
expect(layout.flopBadge === 'Flopability', 'flopability title ' + layout.flopBadge);
expect(/2 pair\+/.test(layout.rowText) && /draws/.test(layout.rowText), 'collapsed flopability summary missing');
expect(/QQ\+/.test(layout.rangeLine || ''), 'villain range summary missing ' + layout.rangeLine);
expect(layout.scroll <= layout.client + 1, 'horizontal overflow ' + layout.scroll + '>' + layout.client);
await page.screenshot({ path: '/opt/cursor/artifacts/equity-polish-after-mobile-390.png', fullPage: true });

await page.click('#players .foh');
await page.waitForFunction(() => /19,600/.test(document.querySelector('.fob').textContent), { timeout: 5000 });
const flopText = await page.$eval('.fob', el => el.textContent);
expect(/Set/.test(flopText) && /Trips/.test(flopText) && /Two pair/.test(flopText) && /One pair/.test(flopText) && /High card/.test(flopText), 'made rows missing');
expect(/Nut flush draw/.test(flopText) && /Flush draw/.test(flopText) && /Open-ended/.test(flopText) && /Gutshot/.test(flopText) && /Combo draw/.test(flopText) && /Any draw/.test(flopText), 'draw rows missing');
expect(/pocket pair \+ flop card/.test(flopText) && /or double gutshot/.test(flopText), 'sub-labels missing');
expect(/Exact over all 19,600 flops/.test(flopText), 'footnote missing');
expect(!/Wrap/.test(flopText), 'wrap row should not be in Hold\'em');
await page.evaluate(() => {
  const app = window.__holdemApp, pc = window.HoldemCore.parseCard;
  app.eq.board = [pc('Kd'), pc('4d'), pc('7d'), null, null];
  app.eq.boardOn = true;
  app.eq.players[0].flopOpen = true;
  app.noteCardsChanged();
});
await page.waitForFunction(() => /by the turn|% on turn|next card/i.test(document.querySelector('.fob').textContent) && !/19,600/.test(document.querySelector('.fob').textContent), { timeout: 5000 });
await page.evaluate(() => { window.__holdemApp.eq.boardOn = false; window.__holdemApp.noteCardsChanged(); });
await page.waitForFunction(() => /19,600/.test(document.querySelector('.fob').textContent), { timeout: 5000 });
await page.evaluate(() => { const app = window.__holdemApp; app.eq.boardOn = true; app.eq.board = [null, null, null, null, null]; app.noteCardsChanged(); });
const flopOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
expect(flopOverflow, 'flopability horizontal overflow');
await page.screenshot({ path: '/opt/cursor/artifacts/equity-polish-after-mobile-flop.png', fullPage: true });

await page.evaluate(() => {
  const app = window.__holdemApp;
  app.eq.deadOn = true;
  app.eq.dead[0] = window.HoldemCore.parseCard('2c');
  app.eq.players[0].flopOpen = true;
  app.noteCardsChanged();
});
await page.waitForFunction(() => /Exact over all/.test(document.querySelector('.fob').textContent) && document.querySelector('#dead-slots .slot'), { timeout: 5000 });
const sizes = await page.evaluate(() => {
  const box = sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; };
  return {
    hole: box('#players .slot'),
    board: box('#board-slots .slot'),
    dead: box('#dead-slots .slot'),
    svg: !!document.querySelector('#players .pcard svg'),
    colors: [...document.querySelectorAll('#players .pcard')].map(el => el.className)
  };
});
expect(sizes.board[0] + 0.2 >= sizes.hole[0] && sizes.board[1] > 40, 'board cards should take the label width ' + JSON.stringify(sizes));
expect(JSON.stringify(sizes.hole) === JSON.stringify(sizes.dead), 'hole/dead slot size ' + JSON.stringify(sizes));
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
await page.waitForFunction(() => /19,600/.test(document.querySelector('.fob').textContent), { timeout: 5000 });

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

const wide = await page.evaluate(() => document.querySelector('#players .slot').getBoundingClientRect().width);
await page.evaluate(() => {
  const app = window.__holdemApp;
  while (app.eq.players.length < 6) app.eq.players.push({ mode: 'cards', cards: [null, null], range: '' });
  app.noteCardsChanged();
});
const narrow = await page.evaluate(() => document.querySelector('#players .slot').getBoundingClientRect().width);
expect(narrow < wide - 1, 'cards did not shrink for 6 players ' + narrow + ' vs ' + wide);
const boardFit = await page.evaluate(() => {
  const hole = document.querySelector('#players .slot').getBoundingClientRect();
  const board = document.querySelector('#board-slots .slot').getBoundingClientRect();
  const row = document.querySelector('.boardrow').getBoundingClientRect();
  const last = [...document.querySelectorAll('#board-slots .slot')].pop().getBoundingClientRect();
  return { hole: hole.width, board: board.width, fits: last.right <= row.right + 1 };
});
expect(boardFit.board + 0.5 >= boardFit.hole && boardFit.fits && boardFit.board > 24, 'board cards at 6 players ' + JSON.stringify(boardFit));
await page.evaluate(() => {
  const app = window.__holdemApp;
  app.eq.players = app.eq.players.slice(0, 2);
  app.noteCardsChanged();
});

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
await page.click('#setup-sum');
await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('show') && document.querySelector('#setup').classList.contains('collapsed'));

const gtoBar = await page.evaluate(() => {
  const gto = document.querySelector('#cfg-chartmode [data-cmode="gto"]');
  const heur = document.querySelector('#cfg-chartmode [data-cmode="heuristic"]');
  const bar = document.querySelector('#srcbar').getBoundingClientRect();
  const header = document.querySelector('header.top').getBoundingClientRect();
  return {
    gto: gto.classList.contains('active') && gto.getAttribute('aria-pressed') === 'true',
    heurOff: heur.getAttribute('aria-pressed') === 'false',
    pill: document.querySelector('#source-pill').textContent,
    note: document.querySelector('#srcbar-note').textContent,
    importShown: !document.querySelector('#import-gto-link').hidden,
    belowHeader: bar.top >= header.bottom - 1,
    legend: document.querySelector('#legend').textContent,
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  };
});
expect(gtoBar.gto && gtoBar.heurOff, 'default is GTO ' + JSON.stringify(gtoBar));
expect(gtoBar.pill === 'GTO Wizard reference (NL50, General)', 'gto pill ' + gtoBar.pill);
expect(/GTO Wizard reference/.test(gtoBar.note) && /replaces our model/.test(gtoBar.note), 'gto note ' + gtoBar.note);
expect(/Raise 2\.5bb/.test(gtoBar.legend), 'btn 100 size ' + gtoBar.legend);
expect(gtoBar.importShown, 'import link missing in GTO mode');
expect(gtoBar.belowHeader, 'switch is not under the header');
expect(gtoBar.scroll <= gtoBar.client + 1, 'gto mode overflow ' + gtoBar.scroll + '>' + gtoBar.client);
await page.click('#grid .cell[data-key="AKs"]');
const gtoMix = await page.$eval('#cell-info', el => el.textContent);
expect(/AKs/.test(gtoMix) && /%/.test(gtoMix), 'gto frequencies ' + gtoMix);
await page.screenshot({ path: '/opt/cursor/artifacts/charts-gto-mobile-390.png', fullPage: false });
await page.screenshot({ path: '/opt/cursor/artifacts/charts-gto-btn-100bb-mobile.png', fullPage: false });

await page.click('#cfg-chartmode [data-cmode="heuristic"]');
await page.waitForFunction(() => document.querySelector('#source-pill').textContent === 'Heuristic');
const heurBar = await page.evaluate(() => {
  const b = document.querySelector('#cfg-chartmode [data-cmode="heuristic"]');
  const cell = document.querySelector('#grid .cell[data-key="AKs"]');
  return {
    on: b.classList.contains('active') && b.getAttribute('aria-pressed') === 'true',
    pill: document.querySelector('#source-pill').textContent,
    note: document.querySelector('#srcbar-note').textContent,
    importHidden: document.querySelector('#import-gto-link').hidden,
    legend: document.querySelector('#legend').textContent,
    stored: JSON.parse(localStorage.getItem('holdem.ui.v1') || '{}').chartMode,
    cells: document.querySelectorAll('#grid .cell').length,
    bg: cell.style.background,
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  };
});
expect(heurBar.on, 'heuristic toggle did not activate');
expect(heurBar.pill === 'Heuristic', 'heuristic pill ' + heurBar.pill);
expect(/heuristic/i.test(heurBar.note), 'heuristic note ' + heurBar.note);
expect(heurBar.importHidden, 'import link should hide in heuristic mode');
expect(heurBar.stored === 'heuristic', 'chart mode not saved ' + heurBar.stored);
expect(heurBar.legend !== gtoBar.legend, 'heuristic ranges match the solved chart');
expect(heurBar.cells === 169, 'heuristic cells ' + heurBar.cells);
expect(heurBar.scroll <= heurBar.client + 1, 'heuristic overflow ' + heurBar.scroll + '>' + heurBar.client);
await page.click('#grid .cell[data-key="KQo"]');
const heurMix = await page.$eval('#cell-info', el => el.textContent);
expect(/KQo/.test(heurMix) && /%/.test(heurMix), 'heuristic frequencies ' + heurMix);
await page.screenshot({ path: '/opt/cursor/artifacts/charts-heuristic-mobile-390.png', fullPage: false });

await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('#grid .cell');
const kept = await page.evaluate(() => document.querySelector('#cfg-chartmode [data-cmode="heuristic"]').classList.contains('active') && document.querySelector('#source-pill').textContent === 'Heuristic');
expect(kept, 'heuristic choice did not survive reload');

await page.click('#cfg-chartmode [data-cmode="gto"]');
await page.waitForFunction(() => document.querySelector('#source-pill').textContent === 'GTO Wizard reference (NL50, General)');
await page.click('#cfg-g button[data-g="mtt"]');
await page.waitForFunction(() => document.querySelector('#source-pill').textContent === 'Heuristic');
const fallback = await page.evaluate(() => ({
  gtoOn: document.querySelector('#cfg-chartmode [data-cmode="gto"]').classList.contains('active'),
  pill: document.querySelector('#source-pill').textContent,
  note: document.querySelector('#srcbar-note').textContent
}));
expect(fallback.gtoOn && fallback.pill === 'Heuristic' && /showing the heuristic/i.test(fallback.note), 'mtt fallback ' + JSON.stringify(fallback));

await page.click('#cfg-g button[data-g="cash"]');
await page.waitForFunction(() => document.querySelector('#source-pill').textContent === 'GTO Wizard reference (NL50, General)');

async function setSetup(open) {
  const isOpen = await page.$eval('#setup-sum', el => el.getAttribute('aria-expanded') === 'true');
  if (isOpen !== open) await page.click('#setup-sum');
}
async function pickStack(bb) {
  await setSetup(true);
  await page.click('#cfg-ticks .tk[data-s="' + bb + '"]');
  await page.waitForFunction(n => new RegExp('(?:^|\\D)' + n + 'bb').test(document.querySelector('#headline').textContent), {}, String(bb));
}
await pickStack(75);
const bb75 = await page.evaluate(() => ({
  pill: document.querySelector('#source-pill').textContent,
  note: document.querySelector('#srcbar-note').textContent,
  head: document.querySelector('#headline').textContent,
  legend: document.querySelector('#legend').textContent,
  gto: document.querySelector('#cfg-chartmode [data-cmode="gto"]').classList.contains('active'),
  scroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
}));
expect(bb75.gto && /75bb/.test(bb75.head) && bb75.pill === 'GTO Wizard reference (NL50, General)', '75bb rfi ' + JSON.stringify(bb75));
expect(/replaces our model/.test(bb75.note), '75 note ' + bb75.note);
expect(/Raise 2\.5bb/.test(bb75.legend), '75 btn size ' + bb75.legend);
expect(bb75.scroll, '75bb overflow');
await page.click('#sitbar [data-hero="UTG"]');
await page.waitForFunction(() => /UTG open/.test(document.querySelector('#headline').textContent));
const utg75 = await page.$eval('#legend', el => el.textContent);
expect(/Raise 2bb/.test(utg75), '75 utg size ' + utg75);
await page.click('#sitbar [data-hero="SB"]');
await page.waitForFunction(() => /SB open/.test(document.querySelector('#headline').textContent));
const sb75 = await page.evaluate(() => ({
  legend: document.querySelector('#legend').textContent,
  note: document.querySelector('#srcbar-note').textContent,
  limp: [...document.querySelectorAll('#grid .cell')].filter(c => /22b8cf|34,\s*184,\s*207/i.test(c.style.background)).length
}));
expect(/Limp/.test(sb75.legend) && /Raise/.test(sb75.legend), '75 sb legend ' + sb75.legend);
expect(sb75.limp > 10, '75 sb limp colour ' + sb75.limp);
expect(/assumed 3bb/.test(sb75.note), '75 sb size note ' + sb75.note);

await pickStack(50);
await page.click('#sit-slot [data-type="rfi"]');
await page.click('#sitbar [data-hero="SB"]');
await page.waitForFunction(() => /SB open/.test(document.querySelector('#headline').textContent) && /50bb/.test(document.querySelector('#headline').textContent));
await setSetup(false);
const sb50 = await page.evaluate(() => ({
  pill: document.querySelector('#source-pill').textContent,
  note: document.querySelector('#srcbar-note').textContent,
  legend: document.querySelector('#legend').textContent,
  head: document.querySelector('#headline').textContent,
  limp: [...document.querySelectorAll('#grid .cell')].filter(c => /22b8cf|34,\s*184,\s*207/i.test(c.style.background)).length,
  scroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
}));
expect(sb50.pill === 'GTO Wizard reference (NL50, General)', '50 sb pill ' + sb50.pill);
expect(/50bb/.test(sb50.head), '50 sb head ' + sb50.head);
expect(/Limp/.test(sb50.legend) && /Raise 3bb/.test(sb50.legend), '50 sb legend ' + sb50.legend);
expect(sb50.limp > 10, '50 sb limp cells ' + sb50.limp);
expect(!/assumed 3bb/.test(sb50.note), '50 sb size is confirmed ' + sb50.note);
expect(sb50.scroll, '50 sb overflow');
await page.screenshot({ path: '/opt/cursor/artifacts/charts-gto-sb-50bb-mobile.png', fullPage: false });

await setSetup(true);
await page.click('#sit-slot [data-type="vs"]');
await page.waitForFunction(() => /showing the heuristic/i.test(document.querySelector('#srcbar-note').textContent));
const vs50 = await page.evaluate(() => ({
  gto: document.querySelector('#cfg-chartmode [data-cmode="gto"]').classList.contains('active'),
  pill: document.querySelector('#source-pill').textContent,
  note: document.querySelector('#srcbar-note').textContent,
  head: document.querySelector('#headline').textContent
}));
expect(vs50.gto && vs50.pill === 'Heuristic' && /50bb/.test(vs50.head) && /showing the heuristic/i.test(vs50.note), '50 vs fallback ' + JSON.stringify(vs50));

await page.click('#sit-slot [data-type="rfi"]');
await page.click('#sitbar [data-hero="BTN"]');
await pickStack(100);
await setSetup(false);
await page.waitForFunction(() => document.querySelector('#source-pill').textContent === 'GTO Wizard reference (NL50, General)' && /BTN open/.test(document.querySelector('#headline').textContent));

await page.click('#import-gto-link');
await page.waitForSelector('#modal h2');
const importTitle = await page.$eval('#modal h2', el => el.textContent);
expect(/Import/.test(importTitle), 'import modal ' + importTitle);
await page.$eval('#modal textarea', el => { el.value = '# id: cash|6|100|rfi:BTN\n# action: raise\nAA:1, 72o:1\n'; });
await page.click('#m-apply');
await page.waitForFunction(() => document.querySelector('#source-pill').textContent === 'Imported reference');
const imported = await page.evaluate(() => ({
  pill: document.querySelector('#source-pill').textContent,
  note: document.querySelector('#srcbar-note').textContent,
  offsuit: document.querySelector('#grid .cell[data-key="72o"]').classList.contains('isfold'),
  scroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
}));
expect(imported.pill === 'Imported reference', 'import pill ' + imported.pill);
expect(/Imported reference/.test(imported.note), 'import note ' + imported.note);
expect(!imported.offsuit, 'imported 72o should be a raise');
expect(imported.scroll, 'import overflow');
await page.click('#cfg-chartmode [data-cmode="heuristic"]');
await page.waitForFunction(() => document.querySelector('#source-pill').textContent === 'Heuristic');
const heurIgnoresImport = await page.evaluate(() => document.querySelector('#grid .cell[data-key="72o"]').classList.contains('isfold'));
expect(heurIgnoresImport, 'heuristic mode still showed the import');
await page.click('#cfg-chartmode [data-cmode="gto"]');
await page.waitForFunction(() => document.querySelector('#source-pill').textContent === 'Imported reference');

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
await desktop.page.click('#players .foh');
await desktop.page.waitForFunction(() => /19,600/.test(document.querySelector('.fob').textContent), { timeout: 5000 });
const deskOverflow = await desktop.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
expect(deskOverflow, 'desktop flop overflow');
await desktop.page.screenshot({ path: '/opt/cursor/artifacts/equity-polish-after-desktop-flop.png', fullPage: true });

await desktop.page.click('#tabs button[data-tab="charts"]');
await desktop.page.waitForSelector('#cfg-chartmode [data-cmode="gto"].active');
const deskGto = await desktop.page.evaluate(() => ({
  pill: document.querySelector('#source-pill').textContent,
  scroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  wide: document.querySelector('#srcbar').getBoundingClientRect().width > 400
}));
expect(deskGto.pill === 'GTO Wizard reference (NL50, General)' && deskGto.scroll && deskGto.wide, 'desktop GTO toggle ' + JSON.stringify(deskGto));
await desktop.page.click('#cfg-chartmode [data-cmode="heuristic"]');
await desktop.page.waitForFunction(() => document.querySelector('#source-pill').textContent === 'Heuristic');
const deskHeur = await desktop.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.querySelector('#import-gto-link').hidden);
expect(deskHeur, 'desktop heuristic toggle overflow or import link still visible');

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
