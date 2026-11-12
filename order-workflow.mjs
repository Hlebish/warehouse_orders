// UI-side mirror of the order status rules in firestore.rules.
// Firestore rules remain authoritative; this prevents invalid actions from
// producing confusing permission errors in the interface.
export const ORDER_STATUSES = Object.freeze([
  'Создан', 'Камянское', 'Собран', 'Отгружен кладовщиком', 'Под вопросом', 'Дефект',
  'Ожидает оплаты', 'На согласовании', 'Одобрен на отгрузку клиенту',
  'Ожидает самовывоза', 'Клиент забрал самовывозом', 'Самовывоз', 'Перенесен', 'Отменён', 'Возврат'
]);

const SHIPMENT_LOCKED_STATUSES = new Set(['Отгружен кладовщиком', 'Клиент забрал самовывозом']);
const MANAGER_STATUSES = new Set([
  'Создан', 'Под вопросом', 'Дефект', 'Ожидает оплаты', 'На согласовании',
  'Одобрен на отгрузку клиенту', 'Ожидает самовывоза', 'Перенесен', 'Отменён'
]);
const WAREHOUSE_STATUSES = new Set([
  'Создан', 'Камянское', 'Собран', 'Отгружен кладовщиком', 'Под вопросом', 'Дефект',
  'Ожидает самовывоза', 'Клиент забрал самовывозом'
]);

export function canTransitionOrderStatus({ role, isAdmin = false, currentStatus, nextStatus }) {
  if (!ORDER_STATUSES.includes(nextStatus)) return false;
  if (currentStatus === nextStatus) return false;
  if (SHIPMENT_LOCKED_STATUSES.has(currentStatus) && !isAdmin) return false;
  if (isAdmin) return true;
  if (['manager', 'chief_accountant', 'accountant'].includes(role)) return MANAGER_STATUSES.has(nextStatus);
  if (role === 'warehouse') return WAREHOUSE_STATUSES.has(nextStatus);
  return false;
}

// A manager's defect decision also approves that position for shipment.
export function statusAfterDefectDecision(order) {
  const defects = (order.entries || []).filter(entry => entry.kind === 'defect');
  if (defects.some(entry => !entry.decision)) return 'Дефект';
  const matching = (entry, line, index) => Number.isInteger(entry.articleIndex)
    ? entry.articleIndex === index : entry.article === line.article;
  const active = (order.articles || []).map((line, index) => ({ line, index }))
    .filter(({ line, index }) => !defects.some(entry => entry.decision === 'Удалена из заказа' && matching(entry, line, index)));
  const ready = active.length > 0 && active.every(({ line, index }) => line.collected === true
    || defects.some(entry => entry.decision === 'Подтверждён' && matching(entry, line, index)));
  return ready ? 'Одобрен на отгрузку клиенту' : 'Создан';
}
