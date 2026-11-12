const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8');
const start = source.indexOf('function createWindow()');
const end = source.indexOf('function showTestNotification()', start);
assert.ok(start > 0 && end > start);
const code = source.slice(start, end);
const APP_URL = 'https://hlebish.github.io/warehouse_orders/';
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const timers = new Map();
  let timerId = 0;
  let navigation = 'fail';
  let online = false;
  let fetchOverride;
  let calls = 0;
  class FakeWindow extends EventEmitter {
    constructor() {
      super(); this.url = ''; this.webContents = new EventEmitter();
      this.webContents.getURL = () => this.url;
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
    }
    maximize() {} isDestroyed() { return false; }
    async loadFile() {
      this.url = 'file:///app/offline.html';
      this.webContents.emit('did-start-loading'); this.webContents.emit('did-finish-load');
    }
    loadURL(url) {
      calls++; this.url = url; this.webContents.emit('did-start-loading');
      if (navigation === 'hang') return new Promise(() => {});
      if (navigation === 'fail') {
        this.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', url, true);
        return Promise.reject(new Error('offline'));
      }
      this.webContents.emit('did-finish-load'); return Promise.resolve();
    }
  }
  const context = { APP_URL, BrowserWindow: FakeWindow, path: require('node:path'), __dirname: '/app', process: { argv: [] }, console: { info() {}, error() {} },
    net: { fetch: async () => { if (fetchOverride) return fetchOverride(); if (!online) throw Error('no connection'); return { ok: true }; } },
    AbortSignal: { timeout: () => undefined },
    setInterval: (fn, ms) => { timers.set(++timerId, { fn, ms, interval: true }); return timerId; },
    clearInterval: id => timers.delete(id),
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id)
  };
  vm.createContext(context);
  vm.runInContext('let mainWindow=null, quitting=false, showingOfflinePage=false, offlineRetryTimer=null, offlineRetryInProgress=false, offlinePageLoading=false, mainPageLoadFailed=false;\n' + code + '\ncreateWindow();', context);
  return { context, timers, setOnline: value => online = value, setNavigation: value => navigation = value, setFetch: value => fetchOverride = value,
    calls: () => calls, offline: () => vm.runInContext('showingOfflinePage', context), window: () => vm.runInContext('mainWindow', context) };
}
test('desktop recovers in the same window after offline start and a failed navigation', async () => {
  const h = harness(); await tick();
  const original = h.window();
  assert.ok(h.offline()); assert.ok([...h.timers.values()].some(t => t.interval && t.ms === 5000));
  await h.context.retryAppConnection(); assert.equal(h.calls(), 1);
  h.setOnline(true); await h.context.retryAppConnection();
  assert.ok(h.offline(), 'a successful probe followed by failed navigation must keep retries armed');
  assert.match(original.url, /offline.html$/);
  h.setNavigation('success');
  await [...h.timers.values()].find(t => t.interval).fn();
  assert.equal(h.offline(), false); assert.equal(original.url, APP_URL); assert.equal(h.window(), original);
  assert.equal([...h.timers.values()].some(t => t.interval), false);
});
test('hung desktop navigation times out and permits the next retry', async () => {
  const h = harness(); await tick(); h.setOnline(true); h.setNavigation('hang');
  const retry = h.context.retryAppConnection(); await tick();
  const timeout = [...h.timers.values()].find(t => !t.interval && t.ms === 20000);
  assert.ok(timeout); timeout.fn(); await retry;
  assert.ok(h.offline()); assert.match(h.window().url, /offline.html$/);
  h.setNavigation('success'); await h.context.retryAppConnection(); assert.equal(h.offline(), false);
});
test('manual and timer retries share one in-flight connectivity check', async () => {
  const h = harness(); await tick(); let resolve;
  h.setFetch(() => new Promise(done => { resolve = done; }));
  const first = h.context.retryAppConnection(); await tick();
  await h.context.retryAppConnection(); assert.equal(h.calls(), 1);
  h.setNavigation('success'); resolve({ ok: true }); await first;
  assert.equal(h.calls(), 2); assert.equal(h.offline(), false);
});
