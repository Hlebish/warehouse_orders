const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appendOrderPush, dispatchOrderPush } = require('./order-push-batches');

function memoryDb() {
  const records = new Map();
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const snapshot = ref => ({ exists: records.has(ref.path), data: () => clone(records.get(ref.path)) });
  const ref = (name, id) => ({
    id, path: name + '/' + id,
    async create(value) {
      if (records.has(this.path)) throw Object.assign(new Error('already exists'), { code: 6 });
      records.set(this.path, clone(value));
    },
  });
  const db = {
    collection(name) {
      return {
        doc: id => ref(name, id),
        where: () => ({ get: async () => ({ docs: [{ id: 'recipient', data: () => ({}) }] }) }),
      };
    },
    async runTransaction(action) {
      const writes = [];
      const result = await action({
        get: async item => snapshot(item),
        create(item, value) {
          writes.push(() => {
            assert.equal(records.has(item.path), false);
            records.set(item.path, clone(value));
          });
        },
        set: (item, value) => writes.push(() => records.set(item.path, clone(value))),
        update: (item, patch) => writes.push(() => records.set(item.path, { ...records.get(item.path), ...clone(patch) })),
      });
      for (const write of writes) write();
      return result;
    },
  };
  return { db, records };
}

test('events arriving while dispatch waits remain one summary and never extend the window beyond ten seconds', async () => {
  const { db, records } = memoryDb();
  let now = 1000;
  const add = (eventId, category, body) => appendOrderPush({
    db, eventId, eventAt: now, now: () => now,
    data: { target: 'site', orderId: 'order', orderNumber: '3188', authorId: 'author', title: 'Заказ № 3188', category, body },
  });
  const id = await add('created', 'orders', 'Создан заказ');
  const batchRef = db.collection('orderPushBatches').doc(id), waits = [];
  const arrivals = [
    { at: 5000, id: 'edited', category: 'editing', body: 'Изменён состав заказа' },
    { at: 9500, id: 'comment', category: 'comments', body: 'Позвонить перед приездом' },
    { at: 10999, id: 'assembled', category: 'status', body: 'Статус: Собран' },
  ];
  const options = {
    db, ref: batchRef, enabled: () => true, now: () => now,
    async sleep(ms) {
      const wakeAt = now + ms, arrival = arrivals[waits.length];
      waits.push(ms);
      assert.ok(arrival.at < wakeAt, 'the new event must arrive before the pending deadline');
      now = arrival.at;
      assert.equal(await add(arrival.id, arrival.category, arrival.body), id);
      now = wakeAt;
    },
    async markDone(ref, patch) {
      records.set(ref.path, { ...records.get(ref.path), ...patch, sentAt: now });
    },
  };
  await dispatchOrderPush(options);
  assert.deepEqual(waits, [5000, 4000, 1000], 'dispatch must recheck both extensions and the fixed ten-second cap');
  const batch = records.get(batchRef.path);
  assert.equal(batch.sealedAt - batch.firstAt, 10000);
  assert.equal(batch.dueAt, 11000);
  const deliveries = () => [...records.entries()].filter(([key]) => key.startsWith('pushQueue/')).map(([, value]) => value);
  assert.equal(deliveries().length, 1);
  assert.equal(deliveries()[0].batchCount, 4);
  assert.match(deliveries()[0].body, /^4 действия:/);
  for (const body of ['Создан заказ', ...arrivals.map(item => item.body)]) assert.ok(deliveries()[0].body.includes(body));
  await dispatchOrderPush(options);
  assert.equal(deliveries().length, 1, 'a completed batch must not send another summary on retry');
});
