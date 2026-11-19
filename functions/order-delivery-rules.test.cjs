const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');

test('order delivery fields respect role and status rules, including legacy orders', async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-warehouse-order-delivery',
    firestore: { rules: readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8') }
  });
  const now = '2026-11-19T08:00:00Z';
  const legacy = { number: '101', client: 'Клиент', createdAt: now, createdBy: 'warehouse', status: 'Создан', deliveryType: 'city', articles: [] };
  const details = { paymentType: 'unknown', deliveryAddress: 'Центральная, 12', mainComment: 'Позвонить перед приездом' };
  const order = (actor, id) => doc(env.authenticatedContext(actor).firestore(), 'orders', id);
  const patch = (actor, fields) => ({ updatedBy: actor, updatedByName: actor, updatedAt: now, ...fields });
  try {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      for (const role of ['warehouse', 'manager', 'director', 'inactive']) {
        await setDoc(doc(db, 'users', role), { role, active: role !== 'inactive', admin: role === 'director' });
      }
      for (const [id, status] of [['legacy', 'Создан'], ['dispatched', 'Отгружен кладовщиком']]) {
        await setDoc(doc(db, 'orders', id), { ...legacy, status });
      }
    });
    await assertSucceeds(setDoc(order('warehouse', 'new'), { ...legacy, ...details }));
    await assertSucceeds(setDoc(order('warehouse', 'cashless'), { ...legacy, ...details, paymentType: 'cashless' }));
    await assertSucceeds(setDoc(order('warehouse', 'old-app'), legacy));
    await assertSucceeds(updateDoc(order('manager', 'legacy'), patch('manager', { ...details, deliveryType: 'kamyanske' })));
    await assertSucceeds(updateDoc(order('manager', 'legacy'), patch('manager', { paymentType: 'cashless' })));
    await assertSucceeds(updateDoc(order('warehouse', 'legacy'), patch('warehouse', { paymentType: 'bank_transfer', mainComment: '' })));
    await assertSucceeds(updateDoc(order('director', 'dispatched'), patch('director', details)));
    await assertFails(updateDoc(order('warehouse', 'dispatched'), patch('warehouse', details)));
    await assertFails(updateDoc(order('inactive', 'new'), patch('inactive', details)));
    await assertFails(getDoc(order('inactive', 'new')));
    for (const invalid of [{ paymentType: 'cash' }, { deliveryAddress: [] }, { mainComment: 'x'.repeat(2001) }]) {
      await assertFails(setDoc(order('warehouse', 'invalid'), { ...legacy, ...invalid }));
      await assertFails(updateDoc(order('director', 'new'), patch('director', invalid)));
    }
    await assertFails(updateDoc(order('warehouse', 'new'), patch('manager', { ...details })));
  } finally {
    await env.cleanup();
  }
});
