import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOrderHistory, getOrderCreator, getLatestOrderEvent, orderHistoryMillis} from '../order-history.mjs';

const t = hour => `2026-11-17T${String(hour).padStart(2, '0')}:00:00.000Z`;
const order = patch => ({id: 'order-1', status: 'Создан', createdAt: t(8), createdBy: 'creator',
  createdByName: 'Ирина', entries: [], ...patch});
const ofKind = (events, kind) => events.filter(event => event.kind === kind);

test('creator uses the saved name or UID directory, never the latest editor or current user', () => {
  const directory = new Map([['creator', {displayName: 'Ирина'}], ['editor', {displayName: 'Галина'}]]);
  assert.equal(getOrderCreator(order({author: 'Старое имя'}), {staffDirectory: directory}), 'Ирина');
  assert.equal(getOrderCreator(order({createdByName: '', author: 'Сотрудник'}), {staffDirectory: directory}), 'Ирина');
  assert.equal(getOrderCreator(order({createdByName: '', createdBy: 'missing', updatedByName: 'Редактор'})), 'Автор не указан');
  assert.equal(getOrderCreator({author: 'Нина'}), 'Нина');
  assert.equal(getOrderCreator(null), 'Автор не указан');
  assert.equal(getOrderCreator({createdBy: 'u'}, {staffDirectory: [{uid: 'u', displayName: 'Ольга'}]}), 'Ольга');
});

test('creation is mandatory and merged with an existing creation entry exactly once', () => {
  const entry = {id: 'created', kind: 'system', text: 'Заказ создан.', author: 'Ирина', createdAt: t(8), photos: ['photo']};
  const events = buildOrderHistory(order({entries: [entry]}));
  assert.equal(ofKind(events, 'created').length, 1);
  assert.equal(events[0].entry, entry);
  assert.equal(events[0].id, 'created');
  assert.equal(events[0].author, 'Ирина');
  assert.equal(events[0].createdAt.toISOString(), t(8));
  const fallback = buildOrderHistory({});
  assert.equal(fallback[0].kind, 'created');
  assert.equal(fallback[0].author, 'Автор не указан');
  assert.equal(fallback[0].createdAt, null);
  assert.equal(getLatestOrderEvent(fallback), null);
  assert.equal(getOrderCreator({entries: [{...entry, author: 'Автор записи'}]}), 'Автор записи');
});

test('all original entries retain their rich data, including viewed events and repeated status cycles', () => {
  const one = {id: 'assembled-1', kind: 'system', text: 'Кладовщик отметил заказ как собран.', author: 'Сергей', createdAt: t(9)};
  const two = {...one, id: 'assembled-2', createdAt: t(11)};
  const comment = {id: 'comment', kind: 'comment', text: 'Заказ собран?', createdAt: t(10), photos: ['url'], replyToEntryId: 'defect'};
  const viewed = {id: 'viewed', kind: 'viewed', text: 'Просмотрено', authorId: 'viewer', author: 'Сотрудник', createdAt: t(12)};
  const events = buildOrderHistory(order({assembledAt: t(11), entries: [two, viewed, one, comment]}),
    {staffDirectory: new Map([['viewer', {displayName: 'Елена'}]])});
  assert.deepEqual(events.map(event => event.id), ['milestone:created', 'assembled-1', 'comment', 'assembled-2', 'viewed']);
  assert.equal(ofKind(events, 'assembled').length, 2);
  assert.equal(events.find(event => event.id === 'comment').entry, comment);
  assert.equal(events.find(event => event.id === 'comment').kind, 'comment');
  assert.equal(events.at(-1).author, 'Елена');
  assert.equal(getLatestOrderEvent(events), events.at(-1));
});

test('duplicate real IDs collapse to their updated version without collapsing separate records', () => {
  const entry = {id: 'c', kind: 'comment', text: 'До изменения', createdAt: t(9)};
  const updated = {...entry, text: 'После изменения'};
  const separate = {...updated, id: 'other'};
  const events = buildOrderHistory(order({entries: [entry, separate, updated]}));
  assert.equal(events.length, 3);
  assert.equal(events.find(event => event.id === 'c').entry, updated);
  assert.equal(events.find(event => event.id === 'other').entry, separate);
});

test('legacy stage timestamps stay chronological across later statuses without assigning the latest updater', () => {
  const events = buildOrderHistory(order({status: 'Возврат', assemblyStartedAt: t(9), assemblyStartedByName: 'Пётр',
    assembledAt: t(10), shippedAt: t(11), transferredAt: t(12), resumedAt: t(13),
    updatedAt: t(14), updatedByName: 'Последний редактор'}));
  assert.deepEqual(events.map(event => event.kind),
    ['created', 'assembly-started', 'assembled', 'shipment-recorded', 'transferred', 'resumed', 'updated']);
  assert.equal(ofKind(events, 'assembly-started')[0].author, 'Пётр');
  for (const kind of ['assembled', 'shipment-recorded', 'transferred', 'resumed']) {
    assert.equal(ofKind(events, kind)[0].author, 'Автор не указан', kind);
  }
  assert.equal(events.at(-1).author, 'Последний редактор');
  assert.ok(events.every(event => !('next' in event) && !('owner' in event)));
  assert.doesNotMatch(JSON.stringify(events), /Следующее действие|Менеджер должен|согласуйте/);
});

test('specific milestone actors are resolved from historical actor fields and roster', () => {
  const events = buildOrderHistory(order({assembledAt: t(9), assembledBy: 'warehouse',
    shippedAt: t(10), shippedByName: 'Владимир', status: 'Отгружен кладовщиком',
    updatedAt: t(10), updatedByName: 'Поздний редактор'}), {staffDirectory: {warehouse: {displayName: 'Сергей'}}});
  assert.equal(ofKind(events, 'assembled')[0].author, 'Сергей');
  assert.equal(ofKind(events, 'shipped')[0].author, 'Владимир');
  assert.equal(ofKind(events, 'updated').length, 0);
});

test('only a matching semantic event and exact timestamp suppress a reconstructed stage', () => {
  const instant = Date.parse(t(10));
  const assembled = {id: 'a', kind: 'system', text: 'Статус заказа изменён на «Собран».', createdAt: {seconds: instant / 1000}};
  const events = buildOrderHistory(order({assembledAt: {toMillis: () => instant}, entries: [assembled]}));
  assert.equal(ofKind(events, 'assembled').length, 1);
  assert.equal(ofKind(events, 'assembled')[0].entry, assembled);
  const nearby = buildOrderHistory(order({assembledAt: new Date(instant + 1000), entries: [assembled]}));
  assert.equal(ofKind(nearby, 'assembled').length, 2);
  const unrelated = buildOrderHistory(order({assembledAt: t(10), entries: [{...assembled, kind: 'comment'}]}));
  assert.equal(ofKind(unrelated, 'assembled').length, 1);
  assert.equal(ofKind(unrelated, 'comment').length, 1);
});

test('finishing assembly progress and marking one article collected do not assert that the order is assembled', () => {
  const events = buildOrderHistory(order({entries: [
    {id: 'start', kind: 'system', text: 'Начата сборка заказа.', createdAt: t(9)},
    {id: 'article', kind: 'system', text: 'Артикул A: собран.', createdAt: t(10)},
    {id: 'finish', kind: 'system', text: 'Сборка заказа завершена.', createdAt: t(11)},
    {id: 'complete', kind: 'system', text: 'Заказ собран. Все позиции отмечены как собранные.', createdAt: t(12)}
  ]}));
  assert.equal(ofKind(events, 'assembly-started').length, 1);
  assert.equal(ofKind(events, 'assembly-finished').length, 1);
  assert.equal(ofKind(events, 'assembled').length, 1);
  assert.equal(events.find(event => event.id === 'article').kind, 'system');
});

test('editing a description of a former status cannot turn the edit into a milestone', () => {
  const events = buildOrderHistory(order({entries: [
    {id: 'edit', kind: 'system', text: 'Данные заказа изменены: Отгружен кладовщиком → Клиент забрал самовывозом; клиент: Перенесен → Новый', createdAt: t(9)},
    {id: 'composition', kind: 'system', text: 'Состав заказа изменён: Заказ собран × 2', createdAt: t(10)},
    {id: 'question', kind: 'comment', text: 'Заказ перенесён или отгружен?', createdAt: t(11)}
  ]}));
  assert.deepEqual(events.slice(1).map(event => event.kind), ['edited', 'edited', 'comment']);
});

test('questions and ordinary decisions retain descriptive factual titles', () => {
  const events = buildOrderHistory(order({entries: [
    {id: 'q', kind: 'question', text: 'Уточните размер', createdAt: t(9)},
    {id: 'd', kind: 'decision', text: 'Размер уточнён', createdAt: t(10)}
  ]}));
  assert.equal(events.find(event => event.id === 'q').title, 'Вопрос по заказу');
  assert.equal(events.find(event => event.id === 'd').title, 'Решение по заказу');
});

test('shipment and pickup use the matching real event before current delivery settings or later status', () => {
  const pickup = {id: 'pickup', kind: 'system', text: 'Клиент забрал заказ самовывозом.', createdAt: t(10)};
  const events = buildOrderHistory(order({status: 'Возврат', deliveryType: 'city', shippedAt: t(10), entries: [pickup]}));
  assert.equal(ofKind(events, 'pickup').length, 1);
  assert.equal(ofKind(events, 'shipment-recorded').length, 0);
  assert.equal(ofKind(events, 'shipped').length, 0);
  assert.equal(ofKind(buildOrderHistory(order({status: 'Клиент забрал самовывозом', shippedAt: t(10)})), 'pickup').length, 1);
  const shipped = {id: 'ship', kind: 'system', text: 'Статус заказа изменён на «Отгружен кладовщиком».', createdAt: t(10)};
  const shipping = buildOrderHistory(order({status: 'Возврат', deliveryType: 'pickup', shippedAt: t(10), entries: [shipped]}));
  assert.equal(ofKind(shipping, 'shipped').length, 1);
  assert.equal(ofKind(shipping, 'shipment-recorded').length, 0);
});

test('defect decisions are separate chronological events with their own actor and original rich defect kept intact', () => {
  const defect = {id: 'defect', kind: 'defect', article: 'A', text: 'Скол', author: 'Пётр', createdAt: t(9),
    decision: 'Подтверждён', decisionText: 'Скидка согласована', decidedBy: 'manager', decidedAt: t(11), photos: ['photo']};
  const events = buildOrderHistory(order({entries: [defect]}), {staffDirectory: new Map([['manager', {displayName: 'Елена'}]])});
  assert.equal(ofKind(events, 'defect')[0].entry, defect);
  const decision = ofKind(events, 'defect-decision')[0];
  assert.equal(decision.id, 'decision:defect');
  assert.equal(decision.sourceEntryId, 'defect');
  assert.equal(decision.title, 'Дефект подтверждён');
  assert.equal(decision.text, 'A · Скидка согласована');
  assert.equal(decision.author, 'Елена');
  assert.equal(decision.createdAt.toISOString(), t(11));
  assert.equal(getLatestOrderEvent(events), decision);
  const unknown = buildOrderHistory(order({entries: [{...defect, decidedBy: 'opaque-uid-123456789012345678'}]}));
  assert.equal(ofKind(unknown, 'defect-decision')[0].author, 'Автор не указан');
  const legacy = buildOrderHistory(order({entries: [{...defect, decidedBy: 'Галина'}]}));
  assert.equal(ofKind(legacy, 'defect-decision')[0].author, 'Галина');
});

test('a concrete defect-decision event suppresses only its matching decision', () => {
  const defect = article => ({id: article, kind: 'defect', article, text: 'Дефект', createdAt: t(9),
    decision: 'Подтверждён', decidedAt: t(10), decidedByName: 'Елена'});
  const real = {id: 'decision-a', kind: 'defect-decision', article: 'A', text: 'Дефект подтверждён · A', author: 'Елена', createdAt: t(10)};
  const events = buildOrderHistory(order({entries: [defect('A'), defect('B'), real]}));
  assert.equal(ofKind(events, 'defect-decision').length, 2);
  assert.ok(events.some(event => event.id === 'decision:B'));
  assert.ok(!events.some(event => event.id === 'decision:A'));
});

test('returns and cancellation remain separate facts, with original return record for actions', () => {
  const record = {id: 'r', createdAt: t(9), authorId: 'warehouse', reason: 'Не подошло', items: [{article: 'A', quantity: 2}],
    status: 'cancelled', cancelledAt: t(11), cancelledByName: 'Директор'};
  const real = {id: 'return-entry', kind: 'return', text: 'Оформлен возврат: A × 2 · Не подошло', author: 'Сергей', createdAt: t(9)};
  const events = buildOrderHistory(order({returns: [record], entries: [real]}));
  assert.equal(ofKind(events, 'return').length, 1);
  assert.equal(ofKind(events, 'return')[0].entry, real);
  assert.equal(ofKind(events, 'return')[0].returnRecord, record);
  assert.equal(ofKind(events, 'return')[0].returnId, 'r');
  const cancellation = ofKind(events, 'return-cancelled')[0];
  assert.equal(cancellation.author, 'Директор');
  assert.equal(cancellation.returnRecord, record);
  assert.equal(cancellation.text, 'A × 2 · Не подошло');
  assert.equal(getLatestOrderEvent(events), cancellation);
  const withoutReal = buildOrderHistory(order({returns: [record]}), {staffDirectory: {warehouse: {displayName: 'Сергей'}}});
  assert.equal(ofKind(withoutReal, 'return')[0].author, 'Сергей');
});

test('two returns at the same timestamp survive when only one has an entry', () => {
  const returns = [{id: 'r1', createdAt: t(9), items: [{article: 'A'}]}, {id: 'r2', createdAt: t(9), items: [{article: 'B'}]}];
  const real = {id: 'r-entry', kind: 'return', text: 'Оформлен возврат: A', createdAt: t(9)};
  const events = buildOrderHistory(order({returns, entries: [real]}));
  assert.equal(ofKind(events, 'return').length, 2);
  assert.equal(events.find(event => event.id === 'r-entry').returnId, 'r1');
  assert.equal(events.find(event => event.id === 'return:r2').returnId, 'r2');
});

test('date variants normalize to milliseconds and invalid dates never invent a dated event', () => {
  const time = Date.parse(t(9));
  for (const value of [t(9), new Date(time), time, {toMillis: () => time}, {toDate: () => new Date(time)},
    {seconds: time / 1000}, {_seconds: time / 1000, _nanoseconds: 0}]) assert.equal(orderHistoryMillis(value), time);
  assert.equal(orderHistoryMillis({seconds: time / 1000, nanoseconds: 123456789}), time + 123);
  for (const value of [null, undefined, '', 'invalid', new Date('bad'), {toMillis() { throw Error('bad'); }}]) {
    assert.equal(orderHistoryMillis(value), 0);
  }
  const unknown = {id: 'unknown', kind: 'comment', text: 'Старая запись', createdAt: 'bad'};
  const events = buildOrderHistory(order({assembledAt: 'bad', entries: [unknown]}));
  assert.equal(ofKind(events, 'assembled').length, 0);
  assert.equal(events.at(-1).entry, unknown);
  assert.equal(events.at(-1).createdAt, null);
  assert.equal(getLatestOrderEvent(events).kind, 'created');
});

test('loading retains actual cached records and creation without speculative reconstructed stages', () => {
  const cached = {id: 'c', kind: 'comment', text: 'Комментарий', createdAt: t(9)};
  const value = order({status: 'Собран', assembledAt: t(10), updatedAt: t(11), entries: [cached],
    returns: [{id: 'r', createdAt: t(12)}]});
  const events = buildOrderHistory(value, {historyLoaded: false});
  assert.deepEqual(events.map(event => event.kind), ['created', 'comment']);
  assert.equal(ofKind(buildOrderHistory(value), 'assembled').length, 1);
});

test('building history does not mutate source data and leaves escaping to the renderer', () => {
  const value = order({createdByName: '<b>Ирина</b>', entries: [{id: 'html', kind: 'comment', text: '<img onerror=bad>',
    author: '<script>name</script>', createdAt: t(9), photos: ['url']}], returns: [{id: 'r', createdAt: t(10), reason: 'Причина'}]});
  const before = JSON.stringify(value);
  const events = buildOrderHistory(value);
  assert.equal(JSON.stringify(value), before);
  assert.equal(events.find(event => event.id === 'html').text, '<img onerror=bad>');
  assert.equal(events[0].author, '<b>Ирина</b>');
});
