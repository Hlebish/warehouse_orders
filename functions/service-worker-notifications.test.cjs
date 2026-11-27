const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function worker(showNotification) {
  let onBackgroundMessage;
  const messaging = { onBackgroundMessage(handler) { onBackgroundMessage = handler; } };
  vm.runInNewContext(source, {
    importScripts() {},
    firebase: { initializeApp() {}, messaging: () => messaging },
    self: { addEventListener() {}, registration: { showNotification } },
    URL,
  });
  return {
    // Model Firebase's push listener: waitUntil(onPush(...)) keeps the event
    // alive while onPush awaits the registered background-message handler.
    push(data) {
      let lifetime;
      const event = { waitUntil(promise) { lifetime = promise; } };
      event.waitUntil((async () => { await onBackgroundMessage({ data }); })());
      return lifetime;
    },
  };
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('background push stays alive until the browser finishes showing its notification', async () => {
  const display = deferred(), shown = [];
  const sw = worker((title, options) => { shown.push({ title, options }); return display.promise; });
  let settled = false;
  const lifetime = sw.push({
    title: 'Заказ № 3188', body: 'Готов к отгрузке', eventId: 'order-3188',
    link: 'https://hlebish.github.io/warehouse_orders/?order=3188', expiresAt: Date.now() + 60000,
  });
  lifetime.then(() => { settled = true; });
  try {
    await nextTurn();
    assert.equal(shown.length, 1);
    assert.equal(shown[0].title, 'Заказ № 3188');
    assert.equal(shown[0].options.body, 'Готов к отгрузке');
    assert.equal(shown[0].options.data.eventId, 'order-3188');
    assert.equal(settled, false, 'the push event must not finish while showNotification is pending');
  } finally {
    display.resolve();
    await lifetime;
  }
  assert.equal(settled, true);
});

test('background push reports a browser notification failure to its event lifetime', async () => {
  const display = deferred();
  // A broken handler must fail this assertion without an unhandled rejection.
  display.promise.catch(() => {});
  const sw = worker(() => display.promise);
  const lifetime = sw.push({ eventId: 'failed-display', expiresAt: Date.now() + 60000 });
  const rejected = assert.rejects(lifetime, /notification display failed/);
  display.reject(new Error('notification display failed'));
  await rejected;
});

test('expired background pushes finish without showing a stale notification', async () => {
  let shown = 0;
  const sw = worker(async () => { shown++; });
  await sw.push({ eventId: 'expired', expiresAt: Date.now() - 10000 });
  assert.equal(shown, 0);
});
