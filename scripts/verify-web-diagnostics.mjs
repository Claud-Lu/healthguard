import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkEntry = path.join(root, 'packages/sdk-web/dist/index.js');
const sdkVersion = JSON.parse(fs.readFileSync(path.join(root, 'packages/sdk-web/package.json'), 'utf8')).version;
const chromeBinary = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
if (typeof WebSocket === 'undefined') throw new Error('The browser verifier requires Node.js 22+ and a Chrome binary.');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const batches = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/collector')) {
      let text = ''; req.on('data', chunk => text += chunk); req.on('end', () => { const batch = JSON.parse(text); batches.push(batch); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ accepted: batch.events.length })); });
    } else if (req.url.startsWith('/sdk.js')) { res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(sdkEntry)); }
    else if (req.url.startsWith('/api')) { res.setHeader('Content-Type', 'application/json'); res.end('{}'); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(`<button data-healthguard-action="example-submit">private-visible-text</button><script type="module">import {createHealthGuardClient,installVueErrorHandler} from '/sdk.js'; window.originalFetch=window.fetch;window.originalXHR=window.XMLHttpRequest;window.client=createHealthGuardClient({appKey:'demo-app',endpoint:'/collector',release:'example-release',buildRelease:'example-exact-build',autoCapture:true,flushIntervalMs:0});window.exampleApp={config:{errorHandler(){}}};window.cleanupVue=installVueErrorHandler(window.exampleApp,window.client);window.ready=true;</script>`); }
  });
  const peer = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/javascript'); res.end('throw new Error("SDK_OPAQUE_PROBE");'); });
  await Promise.all([new Promise(resolve => server.listen(0, '127.0.0.1', resolve)), new Promise(resolve => peer.listen(0, '127.0.0.1', resolve))]);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-browser-'));
  const chrome = cp.spawn(chromeBinary, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let info;
    for (let i = 0; i < 80; i++) { try { info = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n'); break; } catch {} await pause(100); }
    assert.ok(info);
    const tabs = await (await fetch('http://127.0.0.1:' + info[0] + '/json')).json();
    ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    let seq = 0; const pending = new Map();
    ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); } });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 10; ExamplePhone Build/EXAMPLE) Chrome/121.0 MQQBrowser/20.7' });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/#/download?token=page-secret` });
    for (let i = 0; i < 80 && !(await evaluate('Boolean(window.ready)')); i++) await pause(100);
    assert.equal(await evaluate('Boolean(window.ready)'), true, 'standalone SDK demo loaded');
    await evaluate(`document.querySelector('button').click();fetch('/api/items?phone=13800138000',{method:'POST',body:'request-body-secret'})`);
    await evaluate(`exampleApp.config.errorHandler(new Error('SDK_VUE_PROBE'),{$options:{name:'ExampleComponent'}},'mounted hook');setTimeout(()=>{throw new Error('SDK_GLOBAL_PROBE')},0);void Promise.reject(new Error('SDK_PROMISE_PROBE'));`);
    await pause(100);
    await evaluate(`new Promise(resolve=>{const script=document.createElement('script');script.src='http://127.0.0.1:${peer.address().port}/opaque.js?token=script-secret';script.onload=resolve;script.onerror=resolve;document.body.appendChild(script)})`);
    await evaluate(`location.hash='#/after-error'`);
    await evaluate(`client.flush()`);
    const events = batches.flatMap(batch => batch.events);
    const errors = events.filter(event => event.type === 'error');
    assert.equal(errors.length, 4);
    for (const event of errors) {
      assert.equal(event.sdkVersion, sdkVersion);
      assert.deepEqual({ model: event.deviceInfo.model, system: event.deviceInfo.system }, { model: 'ExamplePhone', system: 'Android 10' });
      assert.match(event.pageUrl, /#\/download/);
      const context = event.breadcrumbs.at(-1).data;
      assert.equal(context.integration, 'sdk-web');
      assert.equal(context.buildRelease, 'example-exact-build');
      assert.equal(context.browser, 'QQBrowser 20.7');
      assert.match(context.pageUrl, /#\/download/);
      assert.ok(event.breadcrumbs.some(item => item.type === 'click' && item.message === 'example-submit'));
      assert.ok(event.breadcrumbs.some(item => item.type === 'http' && item.data.status === 200));
      if (event.message === 'Script error.') {
        assert.equal(context.errorVisibility, 'opaque');
        assert.equal(event.stack, undefined);
        assert.ok(context.scripts.some(script => script.url.includes('/opaque.js') && script.crossOrigin === 'unset'));
      } else assert.ok(event.stack);
    }
    for (const secret of ['page-secret', 'script-secret', '13800138000', 'private-visible-text', 'request-body-secret']) assert.equal(JSON.stringify(events).includes(secret), false, secret);
    await evaluate('cleanupVue();client.dispose()');
    assert.equal(await evaluate('window.fetch===originalFetch && window.XMLHttpRequest===originalXHR'), true);
    const report = { result: 'PASS', sdkVersion, integration: 'standalone browser page with only SDK import; no business monitoring wrapper', browser: (await send('Browser.getVersion')).product, errors: errors.map(event => ({ message: event.message, stackAvailable: !!event.stack, errorVisibility: event.breadcrumbs.at(-1).data.errorVisibility })), redaction: 'PASS', hooksRestoredOnDispose: true, productionEventsSent: 0, checkedAt: new Date().toISOString() };
    fs.mkdirSync(path.join(root, 'coverage'), { recursive: true });
    fs.writeFileSync(path.join(root, 'coverage/web-diagnostics-browser.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { ws?.close(); chrome.kill('SIGTERM'); server.close(); peer.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
