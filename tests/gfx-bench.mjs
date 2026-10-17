// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts Journey stage 1 (First Ford), lays the belt line from the mine to the Exchange by clicking cells
// and keeps running ticks with the visible button so goods glide, rollers turn and sale coins burst.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

const btn = (page, name) => page.getByRole('button', { name, exact: true });

export async function setPreset(page, preset) {
  await page.waitForSelector('#root h1');
  await btn(page, 'Settings').click();
  await page.waitForSelector('#gfx-panel');
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.getAttribute('data-gfx-preset') === p, preset);
  await btn(page, 'Back').click();
  await page.waitForSelector('#root h1');
}

export async function start(page, { mobile }) {
  await btn(page, 'Journey').click();
  await page.waitForSelector('#root h2');
  await page.locator('#root .actions button').first().click();
  await page.waitForSelector('canvas#board');
  await page.getByRole('button', { name: /^Belt \(place\)/ }).click();
  const canvas = page.locator('canvas#board');
  const box = await canvas.boundingBox();
  for (const [x, y] of [[1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [5, 1]]) {
    const pos = { x: box.x + box.width * ((x + 0.5) / 6), y: box.y + box.height * ((y + 0.5) / 4) };
    if (mobile) await page.touchscreen.tap(pos.x, pos.y); else await page.mouse.click(pos.x, pos.y);
  }
  let stopped = false;
  page.once('close', () => { stopped = true; });
  (async () => {
    while (!stopped) {
      await btn(page, 'Run one tick (Space)').click({ timeout: 1000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 350));
    }
  })();
  await page.waitForTimeout(500);
}
