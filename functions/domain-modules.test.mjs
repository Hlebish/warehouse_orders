import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransitionOrderStatus } from '../order-workflow.mjs';
import { normalizeNotificationSettings, groupNotifications } from '../notification-settings.mjs';
import { searchClients, searchProducts } from '../client-directory.mjs';
import { shipmentItemsForDate, shipmentOrderDateKey } from '../warehouse-operations.mjs';

test('manager group can use manager transitions but cannot ship or edit shipped orders', () => {
  const actor = { role: 'chief_accountant', currentStatus: 'Создан' };
  assert.equal(canTransitionOrderStatus({ ...actor, nextStatus: 'На согласовании' }), true);
  assert.equal(canTransitionOrderStatus({ ...actor, nextStatus: 'Отгружен кладовщиком' }), false);
  assert.equal(canTransitionOrderStatus({ ...actor, nextStatus: 'Клиент забрал самовывозом' }), false);
  assert.equal(canTransitionOrderStatus({ ...actor, currentStatus: 'Отгружен кладовщиком', nextStatus: 'Создан' }), false);
});

test('warehouse can use warehouse transitions but cannot set manager-only states', () => {
  const actor = { role: 'warehouse', currentStatus: 'Создан' };
  assert.equal(canTransitionOrderStatus({ ...actor, nextStatus: 'Собран' }), true);
  assert.equal(canTransitionOrderStatus({ ...actor, nextStatus: 'Дефект' }), true);
  assert.equal(canTransitionOrderStatus({ ...actor, nextStatus: 'Камянское' }), true);
  assert.equal(canTransitionOrderStatus({ ...actor, nextStatus: 'Отгружен кладовщиком' }), true);
  assert.equal(canTransitionOrderStatus({ ...actor, nextStatus: 'На согласовании' }), false);
  assert.equal(canTransitionOrderStatus({ ...actor, nextStatus: 'Клиент забрал самовывозом' }), true);
  assert.equal(canTransitionOrderStatus({ ...actor, nextStatus: 'not-a-status' }), false);
});

test('directors and administrators can repair locked orders', () => {
  assert.equal(canTransitionOrderStatus({
    role: 'director', isAdmin: true, currentStatus: 'Отгружен кладовщиком', nextStatus: 'Создан'
  }), true);
});

test('unsupported roles cannot change status', () => {
  assert.equal(canTransitionOrderStatus({
    role: 'viewer', currentStatus: 'Создан', nextStatus: 'Под вопросом'
  }), false);
});

test('same-status requests are treated as no-op', () => {
  assert.equal(canTransitionOrderStatus({
    role: 'warehouse', currentStatus: 'Создан', nextStatus: 'Создан'
  }), false);
});

test('notification preferences preserve legacy order-wide settings', () => {
  const settings = normalizeNotificationSettings({ orders: false, chat: true, comments: true });
  assert.equal(settings.assembly, false);
  assert.equal(settings.defects, false);
  assert.equal(settings.comments, true);
  assert.equal(settings.chat, true);
  assert.equal(settings.likes, true);
});

test('notifications group by order, category, target, and local day', () => {
  const toDateKey = value => String(value || '').slice(0, 10);
  const notices = [
    { id: 'new', orderId: 'o1', target: 'site', category: 'status', title: 'Статус изменён', createdAt: '2026-11-02T12:00:00Z', read: false },
    { id: 'old', orderId: 'o1', target: 'site', category: 'status', title: 'Статус обновлён', createdAt: '2026-11-02T10:00:00Z', read: true },
    { id: 'other-order', orderId: 'o2', target: 'site', category: 'status', title: 'Статус изменён', createdAt: '2026-11-02T11:00:00Z', read: false },
    { id: 'chat', target: 'chat', category: 'chat', title: 'Новое сообщение', createdAt: '2026-11-02T11:00:00Z', read: false },
    { id: 'next-day', orderId: 'o1', target: 'site', category: 'status', title: 'Статус обновлён', createdAt: '2026-11-03T09:00:00Z', read: false }
  ];
  const groups = groupNotifications(notices, { toDateKey });
  assert.equal(groups.length, 4);
  const groupedOrder = groups.find(group => group.entries.some(notice => notice.id === 'old'));
  assert.equal(groupedOrder.entries.length, 2);
  assert.equal(groupedOrder.latest.id, 'new');
  assert.equal(groupedOrder.unreadCount, 1);
  assert.equal(groupNotifications(notices, { category: 'status', unreadOnly: true, toDateKey }).length, 3);
});

test('client and product search modules normalize and rank matches', () => {
  const clients = [{ name: 'АМП Киев', phone: '+380 67 100' }, { name: 'Другой', phone: '123' }];
  assert.deepEqual(searchClients(clients, 'КИЕВ').map(client => client.name), ['АМП Киев']);
  assert.deepEqual(searchClients(clients, '').length, 0);

  const products = [
    { a: 'APHD43070', o: '', n: 'Long part' },
    { a: 'APHD4307', o: '4307,HONDA4307', n: 'Hood' },
    { a: 'OTHER', o: '', n: 'APHD4307 compatible' }
  ];
  assert.deepEqual(searchProducts(products, 'APHD4307').map(product => product.a), ['APHD4307', 'APHD43070', 'OTHER']);
});

test('shipment list aggregation excludes removed defect lines and uses shipment dates', () => {
  const toDateKey = value => String(value || '').slice(0, 10);
  const orders = [{
    number: 'A-1', status: 'Отгружен кладовщиком', shippedAt: '2026-11-02T09:00:00Z',
    articles: [{ article: 'APHD4307', quantity: 2 }, { article: 'APBM1203', quantity: 1 }],
    entries: [{ kind: 'defect', decision: 'Удалена из заказа', articleIndex: 1, article: 'APBM1203' }]
  }];
  const normalize = lines => lines;
  const category = article => article.startsWith('APHD') ? 'body' : 'other';
  assert.equal(shipmentOrderDateKey(orders[0], toDateKey), '2026-11-02');
  assert.deepEqual(shipmentItemsForDate(orders, '2026-11-02', '', normalize, category, toDateKey), [
    { article: 'APHD4307', quantity: 2, type: 'body', orders: ['A-1'] }
  ]);
});

test('direct conversations never merge with each other or public replies', () => {
  const notices = [
    { id: 'a', target: 'chat', category: 'replies', directChatThreadId: 'alice' },
    { id: 'b', target: 'chat', category: 'replies', directChatThreadId: 'bob' },
    { id: 'c', target: 'chat', category: 'replies', isMention: true },
    { id: 'd', target: 'chat', category: 'replies', directChatThreadId: 'alice' }
  ];
  const groups = groupNotifications(notices);
  assert.equal(groups.length, 3);
  assert.equal(groups.find(g => g.latest.id === 'a').entries.length, 2);
  assert.equal(groupNotifications(notices, { category: 'direct' }).length, 2);
  assert.equal(groupNotifications(notices, { search: 'личные' }).length, 2);
});

test('newest event is selected even when input arrives out of order', () => {
  const groups = groupNotifications([
    { id: 'old', orderId: 'o', createdAt: { seconds: 100 } },
    { id: 'new', orderId: 'o', createdAt: '2026-11-12T12:00:00Z' }
  ]);
  assert.equal(groups[0].latest.id, 'new');
});

test('urgent requests and mentions stay separate from ordinary messages', () => {
  const base = { target: 'chat', category: 'chat' };
  const groups = groupNotifications([
    { ...base, id: 'normal' },
    { ...base, id: 'mention', isMention: 'true' },
    { ...base, id: 'urgent-a', isUrgent: true },
    { ...base, id: 'urgent-b', isUrgent: true }
  ]);
  assert.equal(groups.length, 4);
  assert.equal(groups.find(g => g.latest.id === 'mention').section, 'attention');
});
