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

export const NOTIFICATION_SECTIONS = Object.freeze({
  direct: 'Личные сообщения',
  attention: 'Ответы и упоминания',
  chat: 'Общий чат',
  comments: 'Комментарии к заказам',
  orders: 'События заказов'
});

export function notificationSection(notice) {
  if (notice.directChatThreadId) return 'direct';
  const on = key => [true, 'true', 1].includes(notice[key]);
  if (on('isMention') || on('isReply') || ['replies', 'mention'].includes(notice.category)) return 'attention';
  if (notice.target === 'chat') return 'chat';
  if (notice.category === 'comments') return 'comments';
  return 'orders';
}

function noticeTime(notice) {
  const value = notice.createdAt || notice.at;
  const date = value?.toDate ? value.toDate() : value?.seconds != null ? new Date(value.seconds * 1000) : new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

export function groupNotifications(notices, { search = '', category = '', unreadOnly = false, toDateKey = () => '' } = {}) {
  const query = String(search || '').trim().toLocaleLowerCase('ru');
  const groups = new Map();
  const sorted = [...(Array.isArray(notices) ? notices : [])].sort((a, b) => noticeTime(b) - noticeTime(a));
  for (const notice of sorted) {
    const noticeCategory = notice.category || (notice.target === 'chat' ? 'chat' : 'orders');
    const section = notificationSection(notice);
    const text = `${NOTIFICATION_SECTIONS[section]} ${NOTIFICATION_CATEGORIES[noticeCategory] || ''} ${notice.title || ''} ${notice.message || ''} ${notice.body || ''}`.toLocaleLowerCase('ru');
    if (query && !text.includes(query)) continue;
    if (category && (category === 'direct' ? section !== 'direct' : noticeCategory !== category)) continue;
    if (unreadOnly && notice.read) continue;

    const target = notice.target === 'chat' ? 'chat' : 'site';
    const scope = notice.directChatThreadId ? `direct:${notice.directChatThreadId}` : notice.orderId ? `order:${notice.orderId}` : target === 'chat' ? 'chat' : `single:${notice.id}`;
    const day = toDateKey(notice.createdAt || notice.at);
    // Urgent requests must remain individually visible and actionable.
    const urgent = [true, 'true', 1].includes(notice.isUrgent) ? notice.id : '';
    const key = JSON.stringify([scope, target, noticeCategory, section, day, urgent]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(notice);
  }
  return [...groups.values()].map(entries => ({
    entries,
    latest: entries[0],
    section: notificationSection(entries[0]),
    category: entries[0]?.category || (entries[0]?.target === 'chat' ? 'chat' : 'orders'),
    unreadCount: entries.filter(notice => !notice.read).length
  }));
}
