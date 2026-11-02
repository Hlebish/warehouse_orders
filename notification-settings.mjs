export const NOTIFICATION_CATEGORIES = Object.freeze({
  orders: 'Новые заказы',
  assembly: 'Сборка',
  defects: 'Дефекты',
  status: 'Изменения статуса',
  editing: 'Редактирование',
  comments: 'Комментарии',
  questions: 'Вопросы',
  decisions: 'Решения',
  chat: 'Общий чат',
  replies: 'Ответы и упоминания',
  likes: 'Лайки'
});

export const NOTIFICATION_CATEGORY_KEYS = Object.freeze(Object.keys(NOTIFICATION_CATEGORIES));

export function normalizeNotificationSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const settings = {};
  for (const key of NOTIFICATION_CATEGORY_KEYS) {
    const followsOrderPreference = ['assembly', 'defects', 'status', 'editing', 'comments', 'questions', 'decisions'].includes(key);
    const fallback = followsOrderPreference && Object.prototype.hasOwnProperty.call(source, 'orders')
      ? source.orders !== false
      : true;
    settings[key] = Object.prototype.hasOwnProperty.call(source, key) ? source[key] !== false : fallback;
  }
  return settings;
}

export function groupNotifications(notices, { search = '', category = '', unreadOnly = false, toDateKey = () => '' } = {}) {
  const query = String(search || '').trim().toLocaleLowerCase('ru');
  const groups = new Map();
  for (const notice of Array.isArray(notices) ? notices : []) {
    const noticeCategory = notice.category || (notice.target === 'chat' ? 'chat' : 'orders');
    const text = `${notice.title || ''} ${notice.message || ''} ${notice.body || ''}`.toLocaleLowerCase('ru');
    if (query && !text.includes(query)) continue;
    if (category && noticeCategory !== category) continue;
    if (unreadOnly && notice.read) continue;

    const target = notice.target === 'chat' ? 'chat' : 'site';
    const scope = notice.orderId ? `order:${notice.orderId}` : target === 'chat' ? 'chat' : `single:${notice.id}`;
    const day = toDateKey(notice.createdAt || notice.at);
    const key = [scope, target, noticeCategory, day].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(notice);
  }
  return [...groups.values()].map(entries => ({
    entries,
    latest: entries[0],
    category: entries[0]?.category || (entries[0]?.target === 'chat' ? 'chat' : 'orders'),
    unreadCount: entries.filter(notice => !notice.read).length
  }));
}
