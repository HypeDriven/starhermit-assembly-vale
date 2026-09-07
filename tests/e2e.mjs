/**
 * Assembly Vale — end-to-end playthrough test (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome (playwright-core + system
 * Chrome) against a self-contained static server on an ephemeral port.
 * Two passes: desktop 1280x800, then a fresh mobile context 390x844 + touch.
 * A final pass exercises the shipped server.js (index at '/', no path escape).
 *
 * Run: npm run test:e2e
 *
 * The desktop pass plays a full round: it builds a belt line from the ore
 * mine to the Exchange by clicking board cells, runs the simulation, and
 * requires the contract to complete and the results screen to appear.
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ts': 'application/typescript',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT)) throw new Error('path escape');
    const data = await readFile(fp);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Benign GPU/swiftshader noise, from tools/production_game_audit.mjs
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});

const SHOT = (stage, pass) => `/tmp/assembly-vale-e2e-${stage}-${pass}.png`;

async function runPass(passName, contextOpts) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    if (browserNoise.test(String(e))) return;
    errors.push(`pageerror: ${e.message}`);
  });
  page.on('console', (m) => { if (m.type() === 'error' && !browserNoise.test(m.text())) errors.push(`console: ${m.text()}`); });

  const step = async (name, fn) => {
    await fn();
    console.log(`ok - [${passName}] ${name}`);
  };

  const btn = (name) => page.getByRole('button', { name, exact: true });

  // Click a board cell by grid coordinate (board is 6x4 for the 'ford' layout).
  const clickCell = async (x, y, cols, rows) => {
    const canvas = page.locator('canvas#board');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('board canvas has no box');
    await canvas.click({
      position: { x: box.width * ((x + 0.5) / cols), y: box.height * ((y + 0.5) / rows) },
    });
  };

  try {
    await step('load + title screen', async () => {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('#root h1', { timeout: 10000 });
      const h1 = await page.textContent('#root h1');
      if (h1 !== 'Assembly Vale') throw new Error(`unexpected title: ${h1}`);
      for (const label of ['Play', 'Daily Challenge', 'Journey', 'Lessons (Learn)', 'Challenges', 'Practice', 'Score Chase']) {
        if (!(await btn(label).isVisible())) throw new Error(`title button not visible: ${label}`);
      }
      await page.screenshot({ path: SHOT('title', passName) });
    });

    await step('mode select via Play, then back', async () => {
      await btn('Play').click();
      await page.waitForSelector('#root h2');
      const h2 = await page.textContent('#root h2');
      if (h2 !== 'Choose a mode') throw new Error(`unexpected heading: ${h2}`);
      await page.screenshot({ path: SHOT('mode-select', passName) });
      await btn('Title').click();
      await page.waitForSelector('#root h1');
    });

    await step('journey select shows 40 stages', async () => {
      await btn('Journey').click();
      await page.waitForSelector('#root h2');
      const cells = await page.locator('#root .actions button').count();
      if (cells !== 40) throw new Error(`expected 40 stages, got ${cells}`);
      await page.screenshot({ path: SHOT('journey', passName) });
    });

    await step('start journey stage 1 (First Ford)', async () => {
      await page.locator('#root .actions button').first().click();
      await page.waitForSelector('canvas#board', { timeout: 5000 });
      const head = await page.textContent('#root .head');
      if (!head.includes('First Ford')) throw new Error(`missing stage name in header: ${head}`);
      if (!head.includes('Gold: 60')) throw new Error(`missing gold in header: ${head}`);
      if (!head.includes('Tick: 0 / 120')) throw new Error(`missing tick limit in header: ${head}`);
      const panel = await page.textContent('#root .panel');
      if (!panel.includes('Contract Ore: 0 / 5')) throw new Error(`missing contract row: ${panel}`);
      for (const label of ['Rotate', 'Remove', 'Run one tick (Space)', 'Hint (H)', 'Auto-run (A)', 'Pause (P)', 'Help', 'Restart round']) {
        if (!(await btn(label).isVisible())) throw new Error(`play button not visible: ${label}`);
      }
      await page.screenshot({ path: SHOT('play', passName) });
    });

    await step('build a belt line from the mine to the Exchange', async () => {
      // 'ford' is 6x4: ore mine at (0,0) facing E, Exchange at (5,2), rock (2,1).
      await page.getByRole('button', { name: /^Belt \(place\)/ }).click();
      for (const [x, y] of [[1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [5, 1]]) {
        await clickCell(x, y, 6, 4);
      }
      const head = await page.textContent('#root .head');
      if (!head.includes('Gold: 24')) throw new Error(`6 belts should cost 36 gold, header: ${head}`);
      if (!head.includes('Tick: 6 / 120')) throw new Error(`each build costs a tick, header: ${head}`);
      await page.screenshot({ path: SHOT('built', passName) });
    });

    await step('rejects a build on rock and reports why', async () => {
      await clickCell(2, 1, 6, 4);
      const status = await page.textContent('#root .status');
      if (!/rock/i.test(status)) throw new Error(`expected a blocked-cell message, got: ${status}`);
      const head = await page.textContent('#root .head');
      if (!head.includes('Tick: 6 / 120')) throw new Error(`illegal build must not consume a tick: ${head}`);
    });

    await step('run the line until the ore contract completes', async () => {
      const tick = btn('Run one tick (Space)');
      let won = false;
      for (let i = 0; i < 80; i++) {
        if (!(await tick.isVisible().catch(() => false))) { won = true; break; }
        await tick.click();
      }
      if (!won) {
        const panel = await page.textContent('#root .panel').catch(() => '');
        throw new Error(`round did not complete within 80 ticks: ${panel}`);
      }
      const h2 = await page.textContent('#root h2');
      if (h2 !== 'Contracts complete') throw new Error(`expected results screen, got heading: ${h2}`);
      const results = await page.textContent('#root .list');
      if (!/Score: [1-9]/.test(results)) throw new Error(`expected a positive score: ${results}`);
      await page.screenshot({ path: SHOT('results', passName) });
    });

    await step('progress persisted, then back to title', async () => {
      const saved = await page.evaluate(() => localStorage.getItem('assemblyvale.save.v1'));
      if (!saved) throw new Error('save document not persisted after a round');
      const doc = JSON.parse(JSON.parse(saved).payload);
      if (doc.progress.stats.wins < 1) throw new Error('win not recorded in progress');
      if (!doc.progress.journeyBest.j01) throw new Error('journey best score not recorded');
      await btn('Title').click();
      await page.waitForSelector('#root h1');
    });

    await step('keyboard: tools, tick and pause', async () => {
      await btn('Score Chase').click();
      await page.waitForSelector('canvas#board');
      await page.locator('canvas#board').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('Space');
      let head = await page.textContent('#root .head');
      if (!head.includes('Tick: 1')) throw new Error(`Space should run a tick: ${head}`);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter'); // build with the belt tool at the selection
      head = await page.textContent('#root .head');
      if (!head.includes('Tick: 2')) throw new Error(`Enter should apply the tool: ${head}`);
      await page.keyboard.press('p');
      await page.waitForSelector('#root h2');
      if ((await page.textContent('#root h2')) !== 'Paused') throw new Error('P did not pause');
      await page.screenshot({ path: SHOT('paused', passName) });
      await btn('Resume').click();
      await page.waitForSelector('canvas#board');
      await btn('Title').click();
      await page.waitForSelector('#root h1');
    });

    await step('practice: start Relaxed round', async () => {
      await btn('Practice').click();
      await page.waitForSelector('#root h2');
      await page.screenshot({ path: SHOT('practice-select', passName) });
      await btn('Relaxed').click();
      await page.waitForSelector('canvas#board');
      const head = await page.textContent('#root .head');
      if (!head.includes('Relaxed')) throw new Error(`practice stage name missing: ${head}`);
      if (!head.includes('Gold: 300') || !head.includes('Tick: 0')) throw new Error(`bad practice header: ${head}`);
      const panel = await page.textContent('#root .panel');
      if (!panel.includes('Contract Ingot: 0 / 6')) throw new Error(`missing practice contract: ${panel}`);
      await btn('Run one tick (Space)').click();
      // undo is offered in practice rounds and rolls the last action back
      await btn('Undo (Z)').click();
      const undone = await page.textContent('#root .head');
      if (!undone.includes('Tick: 0')) throw new Error(`undo did not roll the tick back: ${undone}`);
      await page.screenshot({ path: SHOT('practice', passName) });
      await btn('Title').click();
      await page.waitForSelector('#root h1');
    });

    await step('lessons: select screen lists 5 lessons and one starts', async () => {
      await btn('Lessons (Learn)').click();
      await page.waitForSelector('#root h2');
      const lessons = await page.locator('#root .actions button').count();
      if (lessons !== 5) throw new Error(`expected 5 lessons, got ${lessons}`);
      await page.screenshot({ path: SHOT('lesson-select', passName) });
      await page.locator('#root .actions button').first().click();
      await page.waitForSelector('canvas#board', { timeout: 5000 });
      const head = await page.textContent('#root .head');
      if (!head.includes('Lesson: Lay the line')) throw new Error(`bad lesson header: ${head}`);
      const panel = await page.textContent('#root .panel');
      if (!panel.includes('Goods ride conveyor belts')) throw new Error(`lesson text missing: ${panel}`);
      await page.screenshot({ path: SHOT('lesson', passName) });
      await btn('Title').click();
      await page.waitForSelector('#root h1');
    });

    await step('challenge: start "Shoestring"', async () => {
      await btn('Challenges').click();
      await page.waitForSelector('#root h2');
      const challenges = await page.locator('#root .actions button').count();
      if (challenges !== 5) throw new Error(`expected 5 challenges, got ${challenges}`);
      await btn('Shoestring').click();
      await page.waitForSelector('canvas#board');
      const head = await page.textContent('#root .head');
      if (!head.includes('Shoestring')) throw new Error(`challenge stage name missing: ${head}`);
      if (!head.includes('Gold: 90') || !head.includes('Tick: 0 / 210')) throw new Error(`bad challenge header: ${head}`);
      await page.screenshot({ path: SHOT('challenge', passName) });
      await btn('Title').click();
      await page.waitForSelector('#root h1');
    });

    await step('daily challenge starts', async () => {
      await btn('Daily Challenge').click();
      await page.waitForSelector('canvas#board', { timeout: 5000 });
      const head = await page.textContent('#root .head');
      if (!/Daily \d{4}-\d{2}-\d{2}/.test(head)) throw new Error(`bad daily header: ${head}`);
      await page.screenshot({ path: SHOT('daily', passName) });
      await btn('Title').click();
      await page.waitForSelector('#root h1');
    });

    await step('score chase starts and auto-run advances ticks', async () => {
      await btn('Score Chase').click();
      await page.waitForSelector('canvas#board');
      let head = await page.textContent('#root .head');
      if (!head.includes('Score Chase')) throw new Error(`bad score-chase header: ${head}`);
      await btn('Auto-run (A)').click();
      await page.waitForFunction(() => /Tick: ([3-9]|\d\d)/.test(document.querySelector('#root .head').textContent), null, { timeout: 8000 });
      await btn('Stop auto-run (A)').click();
      head = await page.textContent('#root .head');
      const before = Number(head.match(/Tick: (\d+)/)[1]);
      await page.waitForTimeout(900);
      head = await page.textContent('#root .head');
      const after = Number(head.match(/Tick: (\d+)/)[1]);
      if (after !== before) throw new Error(`auto-run did not stop: ${before} -> ${after}`);
      await page.screenshot({ path: SHOT('score-chase', passName) });
      await btn('Title').click();
      await page.waitForSelector('#root h1');
    });
  } finally {
    await context.close();
  }

  if (errors.length) {
    throw new Error(`[${passName}] page errors:\n${errors.join('\n')}`);
  }
}

// The shipped server must serve the game at '/' and refuse path escapes.
async function checkShippedServer() {
  const port = 8199;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 40; i++) {
      try { await fetch(`${base}/api/v1/time`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const index = await fetch(`${base}/`);
    const body = await index.text();
    if (!index.ok || !body.includes('<title>Assembly Vale</title>')) {
      throw new Error(`server.js '/' did not serve index.html (status ${index.status})`);
    }
    // Raw request: fetch() would normalize the dot segments away.
    const escapeStatus = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/%2e%2e/%2e%2e/etc/passwd' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    if (escapeStatus === 200) throw new Error('server.js served a file outside the game root');
    const malformed = await fetch(`${base}/%ZZ`);
    if (malformed.status !== 400) throw new Error('server.js did not reject malformed URL encoding');
    const time = await (await fetch(`${base}/api/v1/time`)).json();
    if (!Number.isFinite(time.time)) throw new Error('server.js /api/v1/time did not return a time');
    console.log('ok - [server] index at /, path escape refused, malformed URL rejected without crashing, /api/v1/time works');
  } finally {
    child.kill();
  }
}

try {
  await runPass('desktop', { viewport: { width: 1280, height: 800 } });
  await runPass('mobile', { viewport: { width: 390, height: 844 }, hasTouch: true });
  await checkShippedServer();
  console.log('\nE2E PASS — both viewport passes clean, no page errors');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
