'use strict';
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
      if (/favicon\.ico/.test(where)) return;
      errors.push(msg.text());
    });
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#grid .cell');
    return { page, errors };
  }

  async function chartState(page) {
    return page.evaluate(() => {
      const cells = [...document.querySelectorAll('#grid .cell')];
      const mixed = cells.filter(c => (c.style.background || '').indexOf('linear-gradient') >= 0).length;
      const info = document.querySelector('#cell-info').textContent;
      return {
        cells: cells.length,
        source: document.querySelector('#source-pill') && document.querySelector('#source-pill').textContent,
        hidden: document.querySelector('#source-pill').hidden,
        legend: document.querySelector('#legend').textContent,
        headline: document.querySelector('#headline').textContent,
        mixed,
        info,
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        side: [...document.querySelectorAll('#cfg-side .sg')].map(b => b.textContent).join(',')
      };
    });
  }

  const mobile = await boot(390, 844);
  let st = await chartState(mobile.page);
  expect(st.cells === 169, 'mobile cells ' + st.cells);
  expect(st.source === 'GTO Wizard reference (NL50, General)', 'mobile source ' + st.source);
  expect(st.side === 'Squid,Mushroom,Win 3+', 'side games ' + st.side);
  expect(/Raise 2\.5bb/.test(st.legend), 'sized raise legend ' + st.legend);
  expect(st.mixed > 5, 'mixed cells ' + st.mixed);
  expect(st.scroll <= st.client + 1, 'mobile overflow ' + st.scroll + '>' + st.client);
  await mobile.page.click('#grid .cell');
  st = await chartState(mobile.page);
  expect(/%/.test(st.info), 'tap info ' + st.info);
  await mobile.page.screenshot({ path: '/opt/cursor/artifacts/cash-solved-mobile.png', fullPage: true });

  await mobile.page.click('#sit-slot button[data-type="vj"]');
  await mobile.page.waitForFunction(() => /all-in/i.test(document.querySelector('#headline').textContent));
  await mobile.page.click('#grid .cell[data-key="KK"]');
  st = await chartState(mobile.page);
  expect(/all-in/i.test(st.headline), 'jam chart ' + st.headline);
  expect(/Call/.test(st.legend) && /Fold/.test(st.legend), 'jam legend ' + st.legend);
  expect(st.source === 'Solved (our model)', 'jam source ' + st.source);
  expect(/KK/.test(st.info) && /%/.test(st.info), 'jam hand ' + st.info);
  await mobile.page.screenshot({ path: '/opt/cursor/artifacts/cash-jam-mobile.png', fullPage: true });

  await mobile.page.click('#cfg-g button[data-g="mtt"]');
  await mobile.page.waitForFunction(() => document.querySelector('#source-pill').textContent === 'Heuristic');
  st = await chartState(mobile.page);
  expect(st.source === 'Heuristic', 'mtt source ' + st.source);
  expect(st.cells === 169, 'mtt cells');
  expect(st.scroll <= st.client + 1, 'mtt overflow ' + st.scroll);

  const desktop = await boot(1280, 900);
  st = await chartState(desktop.page);
  expect(st.cells === 169, 'desktop cells');
  expect(st.source === 'GTO Wizard reference (NL50, General)', 'desktop source ' + st.source);
  expect(st.scroll <= st.client + 1, 'desktop overflow ' + st.scroll);
  await desktop.page.click('#sitbar button[data-type="v3"]');
  await desktop.page.waitForFunction(() => /3-bet/i.test(document.querySelector('#headline').textContent));
  await desktop.page.click('#grid .cell[data-key="AA"]');
  const v3 = await desktop.page.evaluate(() => ({
    head: document.querySelector('#headline').textContent,
    info: document.querySelector('#cell-info').textContent,
    legend: document.querySelector('#legend').textContent
  }));
  expect(/3-bet/i.test(v3.head), 'v3 head ' + v3.head);
  expect(/AA/.test(v3.info) && /%/.test(v3.info), 'v3 AA ' + v3.info);
  expect(/4-Bet/.test(v3.legend), '4bet legend ' + v3.legend);
  await desktop.page.screenshot({ path: '/opt/cursor/artifacts/cash-3bet-desktop.png', fullPage: false });

  await desktop.page.click('#tabs button[data-tab="equity"]');
  await desktop.page.waitForSelector('#players .player');
  expect(await desktop.page.$eval('html', el => el.dataset.holdemVersion) === '2', 'version');
  await desktop.page.click('#tabs button[data-tab="trainer"]');
  await desktop.page.waitForSelector('#tr-actions .act');
  const trainer = await desktop.page.evaluate(() => ({
    acts: [...document.querySelectorAll('#tr-actions .act')].map(b => b.textContent),
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }));
  expect(trainer.acts.length >= 2, 'trainer actions ' + trainer.acts.join(','));
  expect(trainer.scroll <= 1, 'trainer overflow');

  const errors = mobile.errors.concat(desktop.errors);
  expect(errors.length === 0, 'page errors ' + errors.join(' | '));
  await browser.close();
  if (fails.length) {
    console.error('FAIL\n' + fails.join('\n'));
    process.exit(1);
  }
  console.log('CHART SMOKE OK');
})().catch(err => { console.error(err); process.exit(1); });
