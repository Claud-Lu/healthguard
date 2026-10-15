// Run against an isolated in-memory Collector and Dashboard; never a deployed account.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.RENAME_TEST_URL || 'http://127.0.0.1:5198';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Use a disposable local deployment');
(async () => {
  const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `rename-${Date.now()}@example.com`, password: 'test-password' }) });
  assert.equal(response.status, 201);
  const { token } = await response.json();
  const created = await fetch(`${base}/api/apps`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'generated_driver_with_a_long_name_for_truncation', type: 'flutter' }) });
  const project = (await created.json()).app;
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(token => { localStorage.setItem('healthguard_token', token); localStorage.setItem('healthguard_locale', 'zh-CN'); }, token);
    await page.goto(`${base}/projects`);
    const row = page.locator('.project-row').filter({ hasText: 'generated_driver_with_a_long_name_for_truncation' });
    await row.locator('.project-row-title').waitFor();
    assert(await row.evaluate(el => {
      const title = el.querySelector('.project-row-title');
      const button = el.querySelector('.rename-project-button');
      const a = title.getBoundingClientRect(), b = button.getBoundingClientRect();
      return a.right <= b.left && Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) <= 4 && title.scrollWidth > title.clientWidth && getComputedStyle(title).textOverflow === 'ellipsis' && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === button;
    }), 'Long title truncates with rename aligned on its right');
    await row.getByRole('button', { name: '改名: generated_driver_with_a_long_name_for_truncation', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('   ');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    await dialog.getByRole('textbox').fill('示例校园司机端');
    await page.route('**/api/apps/*', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByRole('textbox').inputValue(), '示例校园司机端');
    await page.unroute('**/api/apps/*');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).pathname, '/projects');
    await page.getByRole('button', { name: `示例校园司机端 flutter ${project.appKey}`, exact: true }).click();
    await page.getByRole('heading', { name: '示例校园司机端', exact: true }).waitFor();
    await page.getByRole('button', { name: '改名: 示例校园司机端', exact: true }).click();
    await dialog.getByRole('textbox').fill('取消的名称');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: '示例校园司机端', exact: true }).waitFor();
    await page.getByRole('button', { name: '改名: 示例校园司机端', exact: true }).click();
    await dialog.getByRole('textbox').fill('Campus driver');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'Campus driver', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Campus driver', exact: true }).waitFor();
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: '改名: Campus driver', exact: true }).click();
      const rect = await dialog.boundingBox();
      assert(rect.x >= 0 && rect.x + rect.width <= width);
      const save = dialog.getByRole('button', { name: '保存', exact: true });
      assert(await save.evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el; }));
      if (process.env.RENAME_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.RENAME_SCREENSHOT_DIR}/rename-${width}.png`, fullPage: true });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
    }
    await page.evaluate(() => localStorage.setItem('healthguard_locale', 'en-US'));
    // addInitScript forces Chinese on navigation; remove it by using a fresh context page.
    const english = await context.newPage();
    await english.goto(`${base}/projects/${project.appKey}`);
    await english.getByRole('button', { name: 'Rename: Campus driver', exact: true }).click();
    await english.getByRole('heading', { name: 'Rename project', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Browser PASS: list/detail rename, validation, failed-save retry, Escape/cancel, refresh, English, 1440/375 geometry and clickable controls');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
