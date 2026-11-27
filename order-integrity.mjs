const articleKey = value => String(value || '').trim().toUpperCase();

// sourceIndex belongs to the editor/draft only. Persisted order lines keep the
// existing schema, while defect references are moved in the same transaction.
export function prepareArticleEdit(previous, rows) {
  const used = new Set();
  return rows.map(row => {
    const article = String(row.article || '').trim();
    const quantity = Math.max(1, Number(row.quantity) || 1);
    const sourceIndex = Number.isInteger(row.sourceIndex) ? row.sourceIndex : -1;
    if (sourceIndex >= 0 && (used.has(sourceIndex) || !previous[sourceIndex])) {
      throw new Error('Не удалось сопоставить строки заказа. Откройте редактор заново.');
    }
    if (sourceIndex >= 0) used.add(sourceIndex);
    const old = previous[sourceIndex];
    const unchanged = old && old.article === article && old.quantity === quantity;
    return {article, quantity, collected: unchanged && old.collected === true,
      shipmentChecked: unchanged && old.shipmentChecked === true, sourceIndex};
  }).filter(line => line.article);
}

export function remapDefectIndex(entry, previous, edited) {
  if (!Number.isInteger(entry.articleIndex)) return null; // Legacy links use the article code.
  const old = previous[entry.articleIndex];
  const index = old && old.article === entry.article
    ? edited.findIndex(line => line.sourceIndex === entry.articleIndex && line.article === entry.article) : -1;
  return index === entry.articleIndex ? null : index;
}

export function availableReturnItems(order) {
  const totals = new Map();
  for (const line of order.articles || []) {
    const key = articleKey(line.article);
    if (!key) continue;
    const item = totals.get(key) || {article: String(line.article).trim(), ordered: 0, returned: 0};
    item.ordered += Math.max(1, Number(line.quantity) || 1);
    totals.set(key, item);
  }
  for (const record of order.returns || []) {
    if (record.status === 'cancelled') continue;
    for (const line of record.items || []) {
      const item = totals.get(articleKey(line.article));
      if (item) item.returned += Math.max(0, Number(line.quantity) || 0);
    }
  }
  return [...totals.values()].map(item => ({...item, available: Math.max(0, item.ordered - item.returned)}));
}

export function appendOrderReturn(order, entry) {
  const existing = (order.returns || []).find(record => record.id === entry.id);
  if (existing) return null;
  if ((order.returns || []).length >= 500) throw new Error('Достигнут лимит возвратов этого заказа.');
  const available = new Map(availableReturnItems(order).map(item => [articleKey(item.article), item.available]));
  const requested = new Map();
  for (const item of entry.items || []) {
    const key = articleKey(item.article);
    if (!key || !Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('Проверьте количество для возврата.');
    requested.set(key, (requested.get(key) || 0) + item.quantity);
  }
  if (!requested.size) throw new Error('Выберите позиции для возврата.');
  for (const [key, quantity] of requested) {
    if (quantity > (available.get(key) || 0)) throw new Error('Доступное количество изменилось. Откройте возврат заново и проверьте позиции.');
  }
  return [...(order.returns || []), {...entry, previousStatus: order.status}];
}

export function cancelOrderReturn(order, returnId, cancellation) {
  const record = (order.returns || []).find(item => item.id === returnId);
  if (!record) throw new Error('Возврат уже удалён или недоступен.');
  if (record.status === 'cancelled') return null;
  const returns = order.returns.map(item => item.id === returnId ? {...item, status: 'cancelled', ...cancellation} : item);
  const hasOtherActive = returns.some(item => item.status !== 'cancelled');
  const originalStatus = record.previousStatus !== 'Возврат' && record.previousStatus
    || order.returns.find(item => item.previousStatus && item.previousStatus !== 'Возврат')?.previousStatus || 'Собран';
  const status = !hasOtherActive && order.status === 'Возврат' ? originalStatus : order.status;
  return {returns, status, returnCancelled: true};
}
