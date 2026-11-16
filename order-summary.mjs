const TERMINAL = new Set(['Отгружен кладовщиком', 'Клиент забрал самовывозом', 'Отменён']);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const shortText = value => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 190 ? text.slice(0, 187) + '…' : text;
};
function millis(value) {
  try {
    const date = value?.toMillis?.() ?? value?.toDate?.()?.getTime()
      ?? (typeof value?.seconds === 'number' ? value.seconds * 1000 : new Date(value || 0).getTime());
    return Number.isFinite(date) && date > 0 ? date : 0;
  } catch { return 0; }
}
function latestEvent(order, entries) {
  const candidates = [];
  const add = (at, text, author = '', priority = 1) => {
    const time = millis(at);
    if (time && text) candidates.push({time, at: new Date(time), text: shortText(text), author: String(author || ''), priority});
  };
  for (const entry of entries) {
    if (entry.kind === 'viewed') continue;
    const text = entry.kind === 'defect'
      ? 'Дефект' + (entry.article ? ' ' + entry.article : '') + (entry.text ? ': ' + entry.text : '')
      : entry.text || (entry.photos?.length ? 'Добавлены фотографии к заказу' : 'Добавлена запись в историю');
    add(entry.createdAt, text, entry.author || entry.authorName);
    if (entry.kind === 'defect' && entry.decision) {
      const decision = entry.decision === 'Подтверждён' ? 'Дефект подтверждён'
        : entry.decision === 'Удалена из заказа' ? 'Позиция исключена из заказа'
        : entry.decision === 'Отменён' ? 'Заказ отменён по дефекту' : 'Решение по дефекту: ' + entry.decision;
      add(entry.decidedAt, decision + (entry.article ? ' · ' + entry.article : ''), entry.decidedByName || entry.decidedBy, 2);
    }
  }
  for (const record of Array.isArray(order.returns) ? order.returns : []) {
    add(record.createdAt, 'Оформлен возврат' + (record.reason ? ': ' + record.reason : ''), record.author);
    if (record.status === 'cancelled') add(record.cancelledAt, 'Возврат отменён', record.cancelledByName, 2);
  }
  if (order.status === 'Отгружен кладовщиком') add(order.shippedAt, 'Заказ отгружен кладовщиком', order.updatedByName, 2);
  if (order.status === 'Клиент забрал самовывозом') add(order.shippedAt, 'Клиент забрал заказ самовывозом', order.updatedByName, 2);
  if (order.status === 'Собран') add(order.assembledAt, 'Заказ собран', order.updatedByName, 2);
  if (order.status === 'Перенесен') add(order.transferredAt, 'Заказ перенесён', order.updatedByName, 2);
  add(order.createdAt, 'Заказ создан', order.author || order.createdByName, 0);
  const newest = Math.max(0, ...candidates.map(event => event.time));
  // Prefer the concrete event when its transaction also updated the order.
  if (millis(order.updatedAt) > newest + 1000) add(order.updatedAt, 'Заказ обновлён' + (order.status ? ' · ' + order.status : ''), order.updatedByName, 0);
  candidates.sort((a, b) => b.time - a.time || b.priority - a.priority);
  return candidates[0] || {text: 'История заказа пока не содержит событий', author: '', at: null};
}

export function buildOrderSummary(order = {}, {historyLoaded = true} = {}) {
  const entries = Array.isArray(order.entries) ? order.entries : [];
  const defects = entries.filter(entry => entry.kind === 'defect');
  const pending = defects.filter(entry => !entry.decision);
  const articles = Array.isArray(order.articles) ? order.articles : [];
  const removed = (line, index) => defects.some(entry => entry.decision === 'Удалена из заказа'
    && (Number.isInteger(entry.articleIndex) ? entry.articleIndex === index : entry.article === line.article));
  const active = articles.filter((line, index) => !removed(line, index));
  const progress = {
    collected: active.filter(line => line.collected === true).length,
    total: active.length,
    removed: articles.length - active.length,
    returns: (Array.isArray(order.returns) ? order.returns : []).filter(record => record.status !== 'cancelled').length
  };
  const summary = {latest: latestEvent(order, entries), historyLoaded, progress, tone: 'neutral', attention: '', next: {owner: '', text: ''}};
  if (!historyLoaded && !summary.latest.at) summary.latest.text = 'История загружается';
  const set = (attention, owner, text, tone = 'neutral') => Object.assign(summary, {attention, next: {owner, text}, tone});
  if (TERMINAL.has(order.status)) {
    if (order.status === 'Отменён') set('Заказ отменён.', '', 'Сборка и отгрузка не требуются.', 'done');
    else set(order.status === 'Клиент забрал самовывозом' ? 'Заказ выдан клиенту.' : 'Отгрузка завершена.', '', 'Работа по выдаче завершена. Новые замечания можно оставить в комментариях.', 'done');
    if (historyLoaded && pending.length) summary.attention += ' В истории остался нерассмотренный дефект.';
    return summary;
  }
  if (pending.length) {
    const names = [...new Set(pending.map(entry => String(entry.article || '').trim()).filter(Boolean))];
    return set('Ожидает решения по дефектам: ' + pending.length + (names.length ? ' · ' + names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '') : '') + '.',
      'Менеджер', 'Рассмотреть дефекты и вынести решение. Сборку можно продолжать; смена статуса пока заблокирована.', 'warning');
  }
  if (!historyLoaded) return set('Проверяем комментарии и решения по дефектам.', '', 'Дождитесь загрузки истории — сводка обновится автоматически.', 'loading');
  if (order.status === 'Ожидает оплаты') return set('Ожидается подтверждение оплаты.', 'Бухгалтер / менеджер', 'Проверить поступление оплаты и обновить статус заказа.');
  if (order.status === 'На согласовании' || order.status === 'Под вопросом') return set(order.status === 'Под вопросом' ? 'По заказу требуется уточнение.' : 'Заказ находится на согласовании.', 'Менеджер', 'Уточнить условия с клиентом и зафиксировать решение в заказе.');
  if (order.status === 'Перенесен') return set('Выполнение заказа перенесено.', 'Менеджер', 'Согласовать дальнейшую работу с клиентом и вернуть заказ в работу.');
  if (order.status === 'Возврат') return set('По заказу оформлен возврат.', 'Менеджер', 'Проверить состав и причину возврата, согласовать дальнейшие действия с клиентом.');
  if (order.status === 'Дефект') return set('Видимых нерассмотренных дефектов нет; статус заказа требует проверки.', 'Менеджер', 'Проверить решения в истории и уточнить актуальный статус заказа.');
  if (!active.length) return set(articles.length ? 'Все позиции исключены из отгрузки.' : 'В заказе не указаны артикулы.', 'Менеджер', 'Уточнить состав заказа перед сборкой и отгрузкой.', 'warning');
  if (order.status === 'Ожидает самовывоза' || order.status === 'Самовывоз') return set('Заказ ожидает получения клиентом.', 'Кладовщик', 'Проверить комплектность, выдать заказ клиенту и отметить выдачу.', 'ready');
  if (order.status === 'Одобрен на отгрузку клиенту') return set('Отгрузка согласована.', 'Кладовщик', order.deliveryType === 'pickup' ? 'Проверить комплектность и подготовить заказ к выдаче клиенту.' : 'Проверить комплектность и выполнить отгрузку заказа.', 'ready');
  if (order.status === 'Собран') return set('Сборка завершена; ожидается решение по отгрузке.', 'Менеджер', 'Проверить заказ и согласовать отгрузку или самовывоз.', 'ready');
  if (order.status === 'Камянское') return set('Заказ предназначен для доставки в Камянское.', 'Кладовщик', 'Проверить комплектность и подготовить заказ к доставке в Камянское.');
  const remaining = progress.total - progress.collected;
  return set(remaining ? 'Собрано позиций: ' + progress.collected + ' из ' + progress.total + '.' : 'Все действующие позиции отмечены собранными.',
    'Кладовщик', remaining ? (order.assemblyInProgress ? 'Продолжить' : 'Начать') + ' сборку: осталось позиций ' + remaining + '.' : 'Проверить комплектность и отметить заказ собранным.', remaining ? 'neutral' : 'ready');
}

export function renderOrderSummary(order, {historyLoaded = true, formatDateTime = value => value?.toLocaleString?.('ru-RU') || ''} = {}) {
  const summary = buildOrderSummary(order, {historyLoaded});
  const latest = summary.latest;
  const meta = [latest.author, latest.at ? formatDateTime(latest.at) : ''].filter(Boolean).join(' · ');
  const progress = historyLoaded && summary.progress.total
    ? 'Сборка: ' + summary.progress.collected + '/' + summary.progress.total
      + (summary.progress.removed ? ' · исключено позиций: ' + summary.progress.removed : '')
      + (summary.progress.returns ? ' · возвратов: ' + summary.progress.returns : '') : '';
  return '<section class="order-summary order-summary-' + summary.tone + '" aria-label="Сводка заказа">'
    + '<div class="order-summary-heading"><b>Коротко по заказу</b>' + (progress ? '<small>' + escapeHtml(progress) + '</small>' : '') + '</div>'
    + '<div class="order-summary-grid"><div class="order-summary-cell"><span>Последнее событие</span><p>' + escapeHtml(latest.text) + '</p>' + (meta ? '<small>' + escapeHtml(meta) + '</small>' : '') + '</div>'
    + '<div class="order-summary-cell"><span>Сейчас</span><p>' + escapeHtml(summary.attention) + '</p></div>'
    + '<div class="order-summary-cell order-summary-next"><span>Следующее действие</span>' + (summary.next.owner ? '<b>' + escapeHtml(summary.next.owner) + '</b>' : '') + '<p>' + escapeHtml(summary.next.text) + '</p></div></div></section>';
}
