const UNKNOWN_AUTHOR = 'Автор не указан';
const PLACEHOLDER_NAMES = new Set(['сотрудник', 'автор не указан', 'неизвестный пользователь']);
const valueText = value => typeof value === 'string' ? value.trim() : '';
const normalizedText = value => valueText(value).toLocaleLowerCase('ru').replace(/ё/g, 'е');

/** Supports both Firestore timestamps and the dates used by older order records. */
export function orderHistoryMillis(value) {
  try {
    let time;
    if (typeof value?.toMillis === 'function') time = value.toMillis();
    else if (typeof value?.toDate === 'function') time = value.toDate().getTime();
    else if (typeof value?.seconds === 'number' || typeof value?._seconds === 'number') {
      time = (value.seconds ?? value._seconds) * 1000 + (value.nanoseconds ?? value._nanoseconds ?? 0) / 1e6;
    } else if (Object.prototype.toString.call(value) === '[object Date]') time = value.getTime();
    else if (typeof value === 'number') time = value;
    else if (valueText(value)) time = Date.parse(value);
    return Number.isFinite(time) && time > 0 ? Math.trunc(time) : 0;
  } catch { return 0; }
}

function knownName(value) {
  const name = valueText(value);
  return name && !PLACEHOLDER_NAMES.has(normalizedText(name)) ? name : '';
}

function directoryName(directory, uid) {
  if (!directory || !uid) return '';
  const record = typeof directory.get === 'function' ? directory.get(uid)
    : Array.isArray(directory) ? directory.find(person => person?.uid === uid || person?.id === uid)
      : directory[uid];
  return typeof record === 'string' ? knownName(record)
    : knownName(record?.displayName) || knownName(record?.name) || knownName(record?.authorName);
}

function actor(name, uid, directory, legacyName = '') {
  return knownName(name) || directoryName(directory, uid) || knownName(legacyName) || UNKNOWN_AUTHOR;
}

// Historical decidedBy sometimes contains a name rather than an authentication ID.
// A Cyrillic name or a name with spaces is distinguishable from an opaque UID.
function legacyDecisionName(value) {
  const name = valueText(value);
  return /[а-яё]|\s/iu.test(name) ? knownName(name) : '';
}

const STATUS_KINDS = new Map([
  ['Создан', 'resumed'], ['Собран', 'assembled'], ['Отгружен кладовщиком', 'shipped'],
  ['Клиент забрал самовывозом', 'pickup'], ['Перенесен', 'transferred'], ['Перенесён', 'transferred'],
  ['Возврат', 'return'], ['Отменён', 'cancelled'], ['Отменен', 'cancelled']
]);
const TITLES = {
  created: 'Заказ создан', 'assembly-started': 'Начата сборка заказа', 'assembly-finished': 'Сборка заказа завершена', assembled: 'Заказ собран',
  shipped: 'Заказ отгружен', pickup: 'Заказ выдан самовывозом', 'shipment-recorded': 'Отгрузка или выдача заказа отмечена',
  transferred: 'Заказ перенесён', resumed: 'Заказ возвращён в работу', cancelled: 'Заказ отменён',
  return: 'Оформлен возврат', 'return-cancelled': 'Возврат отменён', 'defect-decision': 'Решение по дефекту',
  defect: 'Добавлен дефект', comment: 'Комментарий', question: 'Вопрос по заказу', decision: 'Решение по заказу', viewed: 'Заказ просмотрен',
  edited: 'Данные заказа изменены', status: 'Статус заказа изменён', system: 'Событие заказа',
  photos: 'Добавлены фотографии', updated: 'Карточка заказа обновлена'
};

function entryKind(entry) {
  const kind = valueText(entry.kind), text = normalizedText(entry.text);
  const explicit = valueText(entry.eventType);
  if (TITLES[explicit]) return explicit;
  if (['created', 'order-created', 'creation'].includes(kind)) return 'created';
  if (['assembly-started', 'assembly-finished', 'assembled', 'shipped', 'pickup', 'transferred', 'resumed', 'return-cancelled', 'defect-decision'].includes(kind)) return kind;
  if (kind === 'defect' || kind === 'comment' || kind === 'viewed' || kind === 'return') return kind;
  // Only system/status records describe workflow milestones. A customer's comment
  // containing “заказ собран” remains a comment.
  if (!['system', 'status', 'decision', ''].includes(kind)) return kind;
  if (/возврат\S*\s+отмен|отмен\S*\s+возврат/.test(text)) return 'return-cancelled';
  if (/оформлен\S*\s+возврат|создан\S*\s+возврат/.test(text)) return 'return';
  if (/решени[ея]\s+по\s+дефект|дефект\S*\s+подтвержден|позици\S*\s+исключен|заказ отменен по дефекту/.test(text)) return 'defect-decision';
  if (/^(?:данные заказа изменены|состав заказа изменен)/.test(text)) return 'edited';
  if (/(?:заказ(?:\s+№?\s*[\w-]+)?\s+создан|создан\s+(?:новый\s+)?заказ)/u.test(text)) return 'created';
  const statedStatus = /статус заказа изменен на\s+[«"']([^»"']+)[»"']/.exec(text)?.[1];
  const status = valueText(entry.newStatus || entry.status || entry.meta?.newStatus)
    || [...STATUS_KINDS.keys()].find(name => normalizedText(name) === statedStatus);
  if (STATUS_KINDS.has(status)) return STATUS_KINDS.get(status);
  if (/возобнов|возвращен\s+в\s+(?:работу|сборку)|вернул\S*\s+заказ\s+в\s+статус\s+[«"']?создан/.test(text)) return 'resumed';
  if (/перенес/.test(text)) return 'transferred';
  if (/клиент\s+забрал|(?:выдан|выдача\s+завершена).*самовывоз/.test(text)) return 'pickup';
  if (/отгруж/.test(text)) return 'shipped';
  if (/начата\s+сборка|начал\S*\s+сборку|сборка\s+заказа\s+начата/.test(text)) return 'assembly-started';
  if (/сборк[аиу]\s+(?:заказа\s+)?заверш|завершил\S*\s+сборку/.test(text)) return 'assembly-finished';
  if (/заказ\s+(?:как\s+)?собран|заказ\S*\s+отмечен\S*\s+как\s+собран|отметил\S*\s+заказ\s+как\s+собран/.test(text)) return 'assembled';
  if (/заказ\s+отмен/.test(text)) return 'cancelled';
  if (/статус|ожидающ\S*\s+самовывоз|согласован|согласовани/.test(text)) return 'status';
  return kind || (entry.photos?.length && !text ? 'photos' : 'system');
}

function uniqueEntries(order) {
  const entries = [], positions = new Map();
  for (const entry of Array.isArray(order?.entries) ? order.entries : []) {
    if (!entry || typeof entry !== 'object') continue;
    const id = valueText(entry.id);
    if (id && positions.has(id)) entries[positions.get(id)] = entry;
    else {
      if (id) positions.set(id, entries.length);
      entries.push(entry);
    }
  }
  return entries;
}

export function getOrderCreator(order = {}, {staffDirectory} = {}) {
  order ||= {};
  const entries = uniqueEntries(order);
  const creation = entries.filter(entry => entryKind(entry) === 'created')
    .sort((a, b) => (orderHistoryMillis(a.createdAt) || Infinity) - (orderHistoryMillis(b.createdAt) || Infinity))[0];
  return knownName(order.createdByName) || knownName(order.author)
    || directoryName(staffDirectory, order.createdBy || order.authorId)
    || knownName(creation?.authorName) || knownName(creation?.author)
    || directoryName(staffDirectory, creation?.authorId) || UNKNOWN_AUTHOR;
}

function decisionTitle(decision) {
  if (decision === 'Подтверждён' || decision === 'Подтвержден') return 'Дефект подтверждён';
  if (decision === 'Удалена из заказа') return 'Позиция исключена из заказа';
  if (decision === 'Отменён' || decision === 'Отменен') return 'Заказ отменён по дефекту';
  return 'Решение по дефекту: ' + decision;
}

function returnText(record) {
  const items = (Array.isArray(record.items) ? record.items : []).map(item => {
    const article = valueText(item?.article);
    return article ? article + (Number(item.quantity) > 0 ? ' × ' + Number(item.quantity) : '') : '';
  }).filter(Boolean).join(', ');
  return [items, valueText(record.reason)].filter(Boolean).join(' · ');
}

/**
 * Facts only, in chronological order. Real records remain available as `entry`
 * for photos, replies and defect controls. Missing stages are reconstructed only
 * after the entry subscription has loaded; a current status is never a history.
 */
export function buildOrderHistory(order = {}, {historyLoaded = true, staffDirectory} = {}) {
  order ||= {};
  const entries = uniqueEntries(order), events = [], consumed = new Set();
  const creator = getOrderCreator(order, {staffDirectory});
  const add = event => {
    const time = orderHistoryMillis(event.createdAt);
    events.push({...event, createdAt: time ? new Date(time) : null});
  };
  entries.forEach((entry, index) => {
    const kind = entryKind(entry);
    add({id: valueText(entry.id) || 'entry:' + index, kind, title: TITLES[kind] || 'Запись в истории',
      text: valueText(entry.text), author: actor(knownName(entry.authorName) || knownName(entry.author), entry.authorId, staffDirectory),
      createdAt: entry.createdAt, entry, source: 'entry'});
  });
  const creation = events.filter(event => event.kind === 'created')
    .sort((a, b) => (orderHistoryMillis(a.createdAt) || Infinity) - (orderHistoryMillis(b.createdAt) || Infinity))[0];
  if (creation) {
    if (!creation.createdAt) {
      const time = orderHistoryMillis(order.createdAt);
      creation.createdAt = time ? new Date(time) : null;
    }
    if (creation.author === UNKNOWN_AUTHOR) creation.author = creator;
  } else add({id: 'milestone:created', kind: 'created', title: TITLES.created, text: '', author: creator,
    createdAt: order.createdAt, synthetic: true, source: 'order'});

  const hasConcrete = (kind, at, article = '') => {
    const time = orderHistoryMillis(at);
    const matching = events.find(event => event.entry && !consumed.has(event) && event.kind === kind
      && orderHistoryMillis(event.createdAt) === time
      && (!article || !event.entry.article || event.entry.article === article));
    if (matching) consumed.add(matching);
    return matching;
  };
  const reconstruct = event => {
    if (!orderHistoryMillis(event.createdAt)) return;
    const concrete = hasConcrete(event.kind, event.createdAt, event.article);
    if (concrete) {
      if (event.returnRecord) Object.assign(concrete, {returnRecord: event.returnRecord, returnId: event.returnId});
      return;
    }
    add({...event, title: event.title || TITLES[event.kind] || 'Событие заказа', text: event.text || '',
      author: event.author || UNKNOWN_AUTHOR, synthetic: true});
  };
  if (historyLoaded) {
    const milestone = (field, kind, byField = field.replace(/At$/, 'By'), byNameField = byField + 'Name') => {
      reconstruct({id: 'milestone:' + field, kind, createdAt: order[field], source: 'order',
        author: actor(order[byNameField], order[byField], staffDirectory)});
    };
    milestone('assemblyStartedAt', 'assembly-started');
    milestone('assembledAt', 'assembled');
    milestone('transferredAt', 'transferred');
    milestone('resumedAt', 'resumed');
    // shippedAt is shared by postal/city shipping and self pickup in legacy data.
    // Prefer a matching actual event; a later delivery setting cannot rewrite it.
    const shippingTime = orderHistoryMillis(order.shippedAt);
    const concreteShipping = events.find(event => ['shipped', 'pickup'].includes(event.kind)
      && orderHistoryMillis(event.createdAt) === shippingTime);
    if (!concreteShipping && shippingTime) {
      const kind = order.status === 'Клиент забрал самовывозом' ? 'pickup'
        : order.status === 'Отгружен кладовщиком' ? 'shipped' : 'shipment-recorded';
      milestone('shippedAt', kind);
    }
    for (const [index, entry] of entries.entries()) {
      if (entry.kind !== 'defect' || !valueText(entry.decision)) continue;
      const title = decisionTitle(entry.decision), article = valueText(entry.article);
      reconstruct({id: 'decision:' + (entry.id || index), kind: 'defect-decision', title,
        text: [article, valueText(entry.decisionText)].filter(Boolean).join(' · '), article,
        author: actor(entry.decidedByName, entry.decidedBy, staffDirectory, legacyDecisionName(entry.decidedBy)),
        createdAt: entry.decidedAt, source: 'defect-decision', sourceEntryId: valueText(entry.id)});
    }
    for (const [index, record] of (Array.isArray(order.returns) ? order.returns : []).entries()) {
      if (!record || typeof record !== 'object') continue;
      const id = valueText(record.id) || String(index);
      reconstruct({id: 'return:' + id, kind: 'return', text: returnText(record), returnRecord: record, returnId: id,
        author: actor(knownName(record.authorName) || knownName(record.author), record.authorId || record.createdBy, staffDirectory),
        createdAt: record.createdAt, source: 'return'});
      if (record.status === 'cancelled' || record.cancelledAt) reconstruct({id: 'return-cancelled:' + id,
        kind: 'return-cancelled', text: returnText(record), returnRecord: record, returnId: id,
        author: actor(record.cancelledByName, record.cancelledBy, staffDirectory),
        createdAt: record.cancelledAt, source: 'return'});
    }
    // updatedBy belongs only to the latest update. It must never become the
    // author of an older assembledAt/shippedAt milestone.
    const updated = orderHistoryMillis(order.updatedAt);
    const newestKnown = Math.max(0, ...events.map(event => orderHistoryMillis(event.createdAt)));
    if (updated > newestKnown) reconstruct({id: 'milestone:updated', kind: 'updated',
      createdAt: order.updatedAt, source: 'order', author: actor(order.updatedByName, order.updatedBy, staffDirectory)});
  }
  return events.map((event, index) => ({event, index})).sort((a, b) => {
    const at = orderHistoryMillis(a.event.createdAt), bt = orderHistoryMillis(b.event.createdAt);
    if (!at && a.event.kind === 'created') return -1;
    if (!bt && b.event.kind === 'created') return 1;
    return (at || Infinity) - (bt || Infinity)
      || (a.event.kind === 'created' ? -1 : b.event.kind === 'created' ? 1 : 0) || a.index - b.index;
  }).map(item => item.event);
}

export function getLatestOrderEvent(history) {
  return (Array.isArray(history) ? history : []).reduce((latest, event) => {
    const time = orderHistoryMillis(event?.createdAt);
    return time && time >= orderHistoryMillis(latest?.createdAt) ? event : latest;
  }, null);
}
