const sku = value => String(value || '').normalize('NFKC').toLocaleUpperCase('ru').replace(/[^\p{L}\p{N}]/gu, '');
export function explainBuybackItem(item, inventory = [], order) {
  const same = inventory.filter(other => sku(other.article) === sku(item.article));
  const sum = statuses => same.filter(other => statuses.includes(other.status)).reduce((total, other) => total + Math.max(0, Number(other.quantity) || 0), 0);
  const orderId = item.orderId || item.soldByOrderId || item.returnedFromOrderId || '';
  const orderNumber = order?.number || item.orderNumber || item.soldByOrderNumber || item.returnedFromOrderNumber || '';
  const active = ['active', 'expired'].includes(item.status);
  let title, detail, warning = false;
  if (item.status === 'sold') {
    title = 'Продажа записана';
    detail = item.soldByOrderId ? 'Продано по заказу № ' + (orderNumber || '—') + (item.soldAt ? ' · ' + item.soldAt : '') : 'Отмечено проданным вручную' + (item.soldAt ? ' · ' + item.soldAt : '');
  } else if ((active || item.status === 'stocked') && order && ['Отгружен кладовщиком', 'Клиент забрал самовывозом'].includes(order.status)) {
    title = 'Ожидает синхронизации продажи'; warning = true;
    detail = 'Заказ № ' + orderNumber + ' уже выдан. В этой карточке пока остаётся ' + item.quantity + ' шт. в работе.';
  } else if (item.status === 'stocked') {
    title = 'Принят на собственный склад';
    detail = 'Срок возврата закрыт'+(item.stockedAt?' '+item.stockedAt:'')+'. '+item.quantity+' шт. остаётся на складе и будет списано при продаже.';
  } else if (active) {
    title = item.returnedFromOrderId ? 'Возвращено в работу' : 'Продажа не записана — товар в сроках';
    detail = orderId ? (order ? 'Заказ № ' + orderNumber + ': ' + order.status : order === null ? 'Связанный заказ удалён или недоступен.' : 'Загружаем состояние связанного заказа…') : 'К заказу не привязан. Таймер учитывает только количество этой карточки: ' + item.quantity + ' шт.';
  } else {
    title = ({returned: 'Возвращено поставщику', cancelled: 'Карточка отменена', shipped: 'Отгружено просроченным'})[item.status] || 'Срок остановлен';
    detail = 'Эта карточка не входит в количество товара в работе.';
  }
  return {title, detail, warning, orderId, orderNumber, sold: sum(['sold']), available: sum(['active', 'expired']), stocked: sum(['stocked'])};
}
