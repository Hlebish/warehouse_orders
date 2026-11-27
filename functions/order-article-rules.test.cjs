const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, writeBatch, runTransaction } = require('firebase/firestore');

test('large imported orders remain editable and collectable up to the shared 500-line limit', async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-warehouse-order-articles', firestore: { rules: readFileSync(join(__dirname, '../firestore.rules'), 'utf8') } });
  const at = '2026-11-27T10:00:00Z';
  const articles = count => Array.from({ length: count }, (_, i) => ({ article: 'SKU-' + i, quantity: 1 }));
  const order = count => ({ number: '101', client: 'Клиент', createdAt: at, createdBy: 'warehouse', status: 'Создан', deliveryType: 'city', articles: articles(count) });
  const change = (actor, items) => ({ articles: items, updatedAt: at, updatedBy: actor, updatedByName: actor });
  try {
    await env.withSecurityRulesDisabled(async context => {
      for (const role of ['warehouse', 'manager']) await setDoc(doc(context.firestore(), 'users', role), { role, active: true, admin: false });
      for (const count of [101, 500]) await setDoc(doc(context.firestore(), 'orders', 'import-' + count), { ...order(count), createdBy: '1c', source: '1c' });
    });
    const warehouse = env.authenticatedContext('warehouse').firestore();
    const manager = env.authenticatedContext('manager').firestore();
    for (const count of [101, 500]) {
      const collected = articles(count);
      collected[0].collected = true;
      await assertSucceeds(updateDoc(doc(warehouse, 'orders', 'import-' + count), change('warehouse', collected)));
      collected[1].quantity = 2;
      await assertSucceeds(updateDoc(doc(manager, 'orders', 'import-' + count), change('manager', collected)));
    }
    await assertSucceeds(setDoc(doc(warehouse, 'orders', 'manual-500'), order(500)));
    await assertFails(setDoc(doc(warehouse, 'orders', 'manual-501'), order(501)));
    await assertFails(updateDoc(doc(warehouse, 'orders', 'manual-500'), change('warehouse', articles(501))));
    await assertFails(updateDoc(doc(manager, 'orders', 'manual-500'), change('manager', articles(501))));
  } finally {
    await env.cleanup();
  }
});

test('manager may move only a defect index to the same SKU in the same parent article edit', async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-warehouse-defect-remap', firestore: { rules: readFileSync(join(__dirname, '../firestore.rules'), 'utf8') } });
  const at = '2026-11-27T10:00:00Z';
  const original = [{ article: 'A', quantity: 1 }, { article: 'B', quantity: 1 }];
  const reversed = [...original].reverse();
  try {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', 'manager'), { role: 'manager', active: true, admin: false });
      for (const id of ['reorder', 'wrong-sku', 'metadata', 'removed', 'standalone', 'shipped']) {
        await setDoc(doc(db, 'orders', id), { number: '101', client: 'Клиент', status: id === 'shipped' ? 'Отгружен кладовщиком' : 'Создан', deliveryType: 'city', articles: original });
        await setDoc(doc(db, 'orders', id, 'entries', 'defect'), { kind: 'defect', article: 'B', articleIndex: 1, text: 'Дефект', photos: [], authorId: 'warehouse', decision: 'Подтверждён' });
      }
    });
    const db = env.authenticatedContext('manager').firestore();
    const remap = (id, nextArticles, entryPatch) => {
      const batch = writeBatch(db);
      batch.update(doc(db, 'orders', id), { articles: nextArticles, updatedAt: at, updatedBy: 'manager', updatedByName: 'Менеджер' });
      batch.update(doc(db, 'orders', id, 'entries', 'defect'), entryPatch);
      return batch.commit();
    };
    await assertSucceeds(remap('reorder', reversed, { articleIndex: 0 }));
    await assertFails(remap('wrong-sku', reversed, { articleIndex: 1 }));
    await assertFails(remap('metadata', reversed, { articleIndex: 0, text: 'Подменённое описание' }));
    await assertSucceeds(remap('removed', [original[0]], { articleIndex: -1 }));
    await assertFails(updateDoc(doc(db, 'orders', 'standalone', 'entries', 'defect'), { articleIndex: -1 }));
    await assertFails(remap('shipped', reversed, { articleIndex: 0 }));
  } finally {
    await env.cleanup();
  }
});

test('concurrent employee return transactions preserve both records and their histories under the deployed rules', async () => {
  const { appendOrderReturn, availableReturnItems } = await import('../order-integrity.mjs');
  const env = await initializeTestEnvironment({ projectId: 'demo-warehouse-return-transactions', firestore: { rules: readFileSync(join(__dirname, '../firestore.rules'), 'utf8') } });
  const at = '2026-11-27T10:00:00Z';
  try {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      for (const uid of ['worker-a', 'worker-b']) await setDoc(doc(db, 'users', uid), { role: 'warehouse', active: true, admin: false });
      await setDoc(doc(db, 'orders', 'returns'), { number: '101', client: 'Клиент', status: 'Собран', deliveryType: 'city', articles: [{ article: 'SKU-A', quantity: 4 }], returns: [] });
    });
    const save = async (uid, quantity) => {
      const db = env.authenticatedContext(uid).firestore(), ref = doc(db, 'orders', 'returns');
      await runTransaction(db, async transaction => {
        const current = (await transaction.get(ref)).data();
        const entry = { id: uid, authorId: uid, createdAt: at, items: [{ article: 'SKU-A', quantity }] };
        const returns = appendOrderReturn(current, entry);
        if (!returns) return;
        transaction.update(ref, { returns, status: 'Возврат', updatedAt: at, updatedBy: uid, updatedByName: uid });
        transaction.set(doc(db, 'orders', 'returns', 'entries', 'return_' + uid), { kind: 'return', text: 'Возврат', authorId: uid, authorName: uid, createdAt: at, photos: [] });
      });
    };
    await Promise.all([save('worker-a', 1), save('worker-b', 2)]);
    const db = env.authenticatedContext('worker-a').firestore();
    const saved = (await getDoc(doc(db, 'orders', 'returns'))).data();
    assert.deepEqual(saved.returns.map(record => record.id).sort(), ['worker-a', 'worker-b']);
    assert.equal(availableReturnItems(saved)[0].available, 1);
    for (const uid of ['worker-a', 'worker-b']) assert.equal((await getDoc(doc(db, 'orders', 'returns', 'entries', 'return_' + uid))).exists(), true);
  } finally {
    await env.cleanup();
  }
});
