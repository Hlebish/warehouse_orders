export function shipmentOrderDateKey(order, toDateKey) {
  if (order?.shippedAt) return toDateKey(order.shippedAt);
  // Older orders predate shippedAt; retain the existing best-effort date order.
  return toDateKey(order?.assembledAt || order?.updatedAt || order?.createdAt);
}

export function shipmentItemsForDate(orders, dateKey, categoryFilter, normalizeArticles, shipmentPartType, toDateKey) {
  const itemsByArticle = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    if (order.status !== 'Отгружен кладовщиком' || shipmentOrderDateKey(order, toDateKey) !== dateKey) continue;

    const removedEntries = (Array.isArray(order.entries) ? order.entries : [])
      .filter(entry => entry.kind === 'defect' && entry.decision === 'Удалена из заказа');
    const removedIndexes = new Set(removedEntries.map(entry => Number.isInteger(entry.articleIndex) ? entry.articleIndex : -1));
    const legacyRemovedArticles = new Set(removedEntries.filter(entry => !Number.isInteger(entry.articleIndex)).map(entry => entry.article));

    for (const [index, line] of normalizeArticles(order.articles || []).entries()) {
      if (removedIndexes.has(index)) continue;
      const article = String(line.article || '').trim().toUpperCase();
      if (!article || (removedIndexes.has(-1) && legacyRemovedArticles.has(line.article))) continue;

      const current = itemsByArticle.get(article) || {
        article,
        quantity: 0,
        type: shipmentPartType(article),
        orders: []
      };
      current.quantity += Number(line.quantity) || 1;
      if (!current.orders.includes(order.number)) current.orders.push(order.number);
      itemsByArticle.set(article, current);
    }
  }

  const items = [...itemsByArticle.values()].sort((a, b) =>
    a.article.localeCompare(b.article, 'ru', { numeric: true, sensitivity: 'base' })
  );
  return categoryFilter ? items.filter(item => item.type === categoryFilter) : items;
}
