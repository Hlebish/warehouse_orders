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
