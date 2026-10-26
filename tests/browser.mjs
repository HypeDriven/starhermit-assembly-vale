// The packaged game in headless Chrome (playwright-core) at a desktop and a
// phone viewport: the loader starts the pinned engine, the title shows, the
// keyboard plays (Tab to Play, Enter; Tab to Lessons, Enter; Tab to the
// first lesson, Enter; then Space runs a tick, H a hint, an arrow and Enter
// build a belt), with no console errors or warnings and no error screen. Run after
// `npm run package` (the web runtime refuses files the index does not list).
//   node tests/browser.mjs [--shots DIR]
// The same server and environment filter as ~/games/tools/engine-web-smoke.mjs.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shots = args.includes('--shots') ? resolve(args[args.indexOf('--shots') + 1]) : null;

function findPlaywright() {
  for (const r of [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))]) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ts': 'text/plain', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.opus': 'audio/ogg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-features=Vulkan'] });
let failed = false;
const views = [
  { name: 'desktop', viewport: { width: 1366, height: 768 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];
try {
  for (const v of views) {
    const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
    const page = await ctx.newPage();
    const problems = [];
    const environment = /^No available adapters\.$|GL Driver Message/;
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text())) problems.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
    await page.goto(url, { waitUntil: 'load' });
    const started = await page.waitForFunction(() => {
      const s = document.getElementById('starhermit-status');
      return document.documentElement.dataset.starhermit === 'error' || (s && s.hidden);
    }, null, { timeout: 60000 }).then(() => true, () => false);
    await page.waitForTimeout(5000);
    const shot = async (name) => { if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${name}.png`) }); } };
    await shot('title');
    // Play by keyboard: Play (the first focus stop) opens the modes, Lessons
    // (their first) the lessons, the first lesson starts; then the board.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab'); await page.waitForTimeout(300);
      await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
    }
    await page.keyboard.press('Space'); await page.waitForTimeout(500);
    await page.keyboard.press('KeyH'); await page.waitForTimeout(500);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
    await page.keyboard.press('Enter'); await page.waitForTimeout(1000);
    await shot('game');
    const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
    const errorText = state === 'error' ? await page.evaluate(() => document.querySelector('[role=alert]')?.textContent ?? '') : '';
    const ok = started && state !== 'error' && problems.length === 0;
    failed ||= !ok;
    console.log(`${ok ? 'ok' : 'not ok'} - ${v.name}: started=${started} state=${state || '-'}${errorText ? ` error="${errorText.trim()}"` : ''}`);
    for (const p of problems) console.log(`  ${p}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
