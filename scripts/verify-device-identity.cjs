// Isolated browser acceptance with synthetic devices; this is not tablet lifecycle evidence.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.DEVICE_TEST_URL || 'http://127.0.0.1:5197';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Use a disposable local deployment');
(async () => {
  const request = async (path, payload, token) => {
    const r = await fetch(`${base}/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
    assert(r.ok, `Seed request failed: ${r.status}`); return r.json();
  };
  const { token } = await request('/auth/register', { email: `devices-${Date.now()}@example.com`, password: 'test-password' });
  const { app } = await request('/apps', { name: 'Device acceptance demo', type: 'flutter' }, token);
  const now = Date.now();
  const event = { appKey: app.appKey, type: 'error', platform: 'flutter', timestamp: now, sessionId: 'test-session', anonymousId: 'test-install', sdkVersion: '0.3.0-flutter', errorType: 'native', message: 'Device test failure', fingerprint: 'native:device-test', breadcrumbs: [], deviceInfo: { model: 'Same tablet', system: 'Android 12' }, release: '1.0.1' };
  const id = char => ({ deviceId: `hgd1_${char.repeat(64)}`, deviceIdStatus: 'available', deviceIdSource: 'android_id', deviceIdScope: 'android_user_signing_key_app' });
  await request('/events/batch', { appKey: app.appKey, events: [
    { ...event, ...id('a'), eventId: `a-old-${now}`, timestamp: now - 1000 },
    { ...event, ...id('a'), eventId: `a-new-${now}`, anonymousId: 'reinstalled', release: '1.0.2' },
    { ...event, ...id('b'), eventId: `b-${now}` },
    { ...event, eventId: `legacy-${now}` },
    { ...event, eventId: `unknown-${now}`, anonymousId: 'unknown' },
    { ...event, eventId: `unavailable-${now}`, anonymousId: 'failed-install', deviceIdStatus: 'unavailable', deviceIdReason: 'timeout' },
  ] });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(token => { localStorage.setItem('healthguard_token', token); if (!localStorage.getItem('healthguard_locale')) localStorage.setItem('healthguard_locale', 'zh-CN'); }, token);
    await page.goto(`${base}/projects/${encodeURIComponent(app.appKey)}`);
    const panel = page.getByTestId('device-panel');
    await panel.locator('.device-row').first().waitFor();
    assert((await panel.innerText()).includes('稳定设备: 2'));
    assert((await panel.innerText()).includes('仅安装标识: 2'));
    assert((await panel.innerText()).includes('无法识别记录: 1'));
    assert.equal(await panel.locator('.device-row[data-kind="stable"]').count(), 2);
    await panel.locator('.device-row').filter({ hasText: 'HG-AAAAAAAAAAAA' }).click();
    await panel.locator('.device-history .event-card').nth(1).waitFor();
    assert((await panel.locator('.device-history').innerText()).includes('1.0.1'));
    assert((await panel.locator('.device-history').innerText()).includes('1.0.2'));
    assert.equal(await panel.locator('.device-history .event-card').count(), 2);
    const screenshotDir = process.env.DEVICE_SCREENSHOT_DIR;
    if (screenshotDir) { fs.mkdirSync(screenshotDir, { recursive: true }); await page.screenshot({ path: `${screenshotDir}/devices-desktop.png`, fullPage: true }); }
    await panel.getByRole('searchbox').fill('HG-BBBBBBBBBBBB');
    await page.waitForFunction(() => document.querySelectorAll('.device-row').length === 1 && document.querySelector('.device-row').textContent.includes('HG-BBBBBBBBBBBB'));
    await panel.getByRole('searchbox').fill('no-such-device');
    await panel.getByText('暂无匹配的异常记录', { exact: true }).waitFor();
    await panel.getByRole('searchbox').fill('');
    await panel.getByRole('button', { name: '安装标识', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.device-row[data-kind="installation"]').length === 2);
    assert.equal(await panel.locator('.device-row[data-kind="stable"]').count(), 0);
    await panel.getByRole('button', { name: '全部', exact: true }).click();
    await panel.locator('.device-row').filter({ hasText: 'HG-AAAAAAAAAAAA' }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.locator('.device-row').filter({ hasText: 'HG-AAAAAAAAAAAA' }).click();
    await panel.locator('.device-history .event-card').nth(1).waitFor();
    assert(await panel.evaluate(el => el.getBoundingClientRect().right <= window.innerWidth + 1));
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/devices-mobile.png`, fullPage: true });
    await page.evaluate(() => localStorage.setItem('healthguard_locale', 'en-US'));
    await page.reload(); await page.getByRole('heading', { name: 'Device anomalies', exact: true }).waitFor();
    await panel.locator('.device-row').first().waitFor();
    assert((await panel.innerText()).includes('Stable devices: 2'));
    assert.deepEqual(errors, []);
    console.log('Browser device acceptance passed: same-model separation, version history, categories, shortcode search, empty state, mobile layout and English.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
