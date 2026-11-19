import { shipmentOrderDateKey } from './warehouse-operations.mjs';

export const orderPaymentLabels = Object.freeze({
  on_delivery: 'По факту',
  bank_transfer: 'На счёт',
  deferred: 'Отсрочка платежа',
  unknown: 'Неизвестно'
});

export const orderDeliveryLabels = Object.freeze({
  city: 'Доставка по городу',
  kamyanske: 'Доставка в Камянское',
  post: 'Доставка почтой',
  pickup: 'Самовывоз'
});

export const deliveryAddressLimit = 500;
export const mainCommentLimit = 2000;

export function isOrderPaymentType(value) {
  return typeof value === 'string' && Object.hasOwn(orderPaymentLabels, value);
}

export function orderPaymentLabel(value) {
  return isOrderPaymentType(value) ? orderPaymentLabels[value] : orderPaymentLabels.unknown;
}

export function storedOrderDeliveryDetails(order = {}) {
  const details = {};
  if (isOrderPaymentType(order.paymentType)) details.paymentType = order.paymentType;
  if (typeof order.deliveryAddress === 'string') details.deliveryAddress = order.deliveryAddress;
  if (typeof order.mainComment === 'string') details.mainComment = order.mainComment;
  return details;
}

export function driverOrdersForDate(orders, dateKey, todayKey, toDateKey) {
  return orders.filter(order => {
    if (!['city', 'kamyanske'].includes(order.deliveryType)) return false;
    if (order.status === 'Отгружен кладовщиком') return shipmentOrderDateKey(order, toDateKey) === dateKey;
    return dateKey === todayKey && order.status === 'Одобрен на отгрузку клиенту';
  }).sort((a, b) => String(a.number ?? '').localeCompare(String(b.number ?? ''), 'ru', { numeric: true }));
}

export function driverSheetHtml(orders, dateLabel, escape, showControls = true) {
  const rows = orders.map(order => {
    const deliveryType = Object.hasOwn(orderDeliveryLabels, order.deliveryType) ? orderDeliveryLabels[order.deliveryType] : '';
    const { deliveryAddress, mainComment, paymentType } = storedOrderDeliveryDetails(order);
    return `<tr>
      <td><b>${escape(order.client || 'Клиент не указан')}</b><small>№ ${escape(order.number || '—')}</small></td>
      <td><div>${escape(deliveryAddress || (order.deliveryType === 'pickup' ? '—' : 'Адрес не указан'))}</div><small>${escape(deliveryType)}</small></td>
      <td>${escape(orderPaymentLabel(paymentType))}</td>
      <td>${escape(mainComment || '—')}</td>
    </tr>`;
  }).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Лист водителя</title>
  <style>
    @page{size:A4 portrait;margin:10mm}
    html{color-scheme:light}
    body{background:#fff;color:#141414;font:10pt/1.3 Arial,sans-serif;margin:0}
    h1{font-size:16pt;margin:0 0 2mm}p{margin:0 0 3mm}small{display:block;margin-top:1mm;color:#424242;font-size:8.5pt}
    table{width:100%;table-layout:fixed;border-collapse:collapse}thead{display:table-header-group}
    th,td{border:1px solid #aaa;padding:1.6mm;text-align:left;vertical-align:top;overflow-wrap:anywhere}
    td{white-space:pre-wrap}td:first-child{white-space:normal}tr{break-inside:avoid}
    .no-print{display:none}
    @media screen{body{max-width:900px;margin:16px auto;padding:0 12px}.no-print{display:flex;gap:8px;margin-bottom:12px}.no-print button{padding:8px 14px}}
    @media print{.no-print{display:none!important}}
  </style></head><body>
    ${showControls?'<div class="no-print"><button type="button" onclick="window.print()">Печать</button><button type="button" onclick="window.close()">Закрыть</button></div>':''}
    <h1>Лист водителя</h1><p>${escape(dateLabel)} · Заказов: ${orders.length}</p>
    <table><colgroup><col style="width:23%"><col style="width:31%"><col style="width:17%"><col style="width:29%"></colgroup>
    <thead><tr><th>Клиент и заказ</th><th>Куда доставить</th><th>Оплата</th><th>Основной комментарий</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </body></html>`;
}
