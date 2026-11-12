function stable(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
  return value;
}
export function orderEditSnapshot(order = {}) {
  return stable({
    number: String(order.number || ''), client: String(order.client || ''), clientId: String(order.clientId || ''),
    deliveryType: order.deliveryType || 'city', status: order.status || '', updatedAt: order.updatedAt || order.createdAt || '',
    articles: (order.articles || []).map(line => ({article: String(line.article || '').trim(), quantity: Math.max(1, Number(line.quantity) || 1), collected: line.collected === true, shipmentChecked: line.shipmentChecked === true})),
    returns: order.returns || [], assemblyInProgress: order.assemblyInProgress === true
  });
}
export function assertOrderUnchanged(expected, current) {
  if (JSON.stringify(orderEditSnapshot(expected)) !== JSON.stringify(orderEditSnapshot(current))) {
    const error = new Error('Заказ уже изменил другой сотрудник' + (current.updatedByName ? ': ' + current.updatedByName : '') + '. Ваши данные остались в форме. Откройте актуальную карточку и сверите изменения.');
    error.code = 'order-conflict';
    throw error;
  }
}
