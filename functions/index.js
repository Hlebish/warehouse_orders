const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2/options');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp, FieldPath } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { createHash } = require('crypto');

initializeApp();
const db = getFirestore();
const messaging = getMessaging();
const ORDER_NOTIFICATION_CATEGORIES = new Set(['assembly', 'defects', 'status', 'editing', 'comments', 'questions', 'decisions']);
const IMMEDIATE_NOTIFICATION_CATEGORIES = new Set(['defects', 'questions', 'decisions', 'replies']);
function canAccessBuybackProfile(profile = {}) {
  return profile.active === true && (profile.admin === true || ['accountant', 'chief_accountant', 'director'].includes(profile.role));
}
function timestampKey(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value || '');
}
function orderVersionKey(order = {}) {
  return timestampKey(order.updatedAt) || `${timestampKey(order.createdAt)}|${String(order.status || '')}`;
}
function notificationTagFor(data, eventId, category, target, recipientUserId) {
  const urgent = data.forceAll === true || data.isMention === true || data.isReply === true || data.buybackItemId || IMMEDIATE_NOTIFICATION_CATEGORIES.has(category);
  if (urgent) return `event-${eventId}`;
  const scope = recipientUserId ? `recipient:${recipientUserId}` : 'broadcast';
  const digest = createHash('sha1').update(`${target}:${category}:${scope}`).digest('hex').slice(0, 24);
  return `warehouse-${digest}`;
}
async function registerNotificationBurst(notificationTag, eventId, category) {
  if (notificationTag.startsWith('event-')) return 1;
  const ref = db.collection('pushNotificationState').doc(notificationTag);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.data() || {};
    const recent = Date.now() - (Number(data.lastAt) || 0) <= 60000;
    const seenEvents = Array.isArray(data.eventIds) ? data.eventIds : [];
    const alreadyCounted = seenEvents.includes(eventId);
    const count = alreadyCounted ? Number(data.eventCount) || 1 : recent ? (Number(data.eventCount) || 0) + 1 : 1;
    tx.set(ref, {
      category,
      eventCount: count,
      eventIds: alreadyCounted ? seenEvents : [...seenEvents, eventId].slice(-50),
      lastAt: alreadyCounted ? Number(data.lastAt) || Date.now() : Date.now(),
      expiresAt: Date.now() + 60000,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return count;
  });
}
function pluralRu(value, one, few, many) {
  const n = Math.abs(Number(value) || 0) % 100;
  const last = n % 10;
  return n > 10 && n < 20 ? many : last > 1 && last < 5 ? few : last === 1 ? one : many;
}
function notificationCopy(data, count, category) {
  if (data.directChatThreadId) {
    const rawSender = String(data.title || 'Сотрудник').trim();
    const sender = rawSender.replace(/^🚨\s*СРОЧНОЕ\s+ЛИЧНОЕ\s+СООБЩЕНИЕ\s*·\s*/iu, '') || 'Сотрудник';
    const message = String(data.body || 'Новое сообщение').trim();
    return {
      title: data.isUrgent === true ? '🚨 Срочное личное сообщение' : 'Личное сообщение',
      body: `${sender}: ${message}`.slice(0, 500)
    };
  }
  const titles = { orders: 'Новые заказы', assembly: 'Сборка заказов', status: 'Изменения статусов', editing: 'Изменения заказов', comments: 'Новые комментарии', chat: 'Общий чат', likes: 'Реакции в чате' };
  const counts = {
    orders: ['новый заказ', 'новых заказа', 'новых заказов'],
    assembly: ['обновление сборки', 'обновления сборки', 'обновлений сборки'],
    status: ['изменение статуса', 'изменения статуса', 'изменений статуса'],
    editing: ['изменение заказа', 'изменения заказа', 'изменений заказа'],
    comments: ['новый комментарий', 'новых комментария', 'новых комментариев'],
    chat: ['новое сообщение', 'новых сообщения', 'новых сообщений'],
    likes: ['новая реакция', 'новых реакции', 'новых реакций']
  };
  if (count <= 1) return { title: String(data.title || 'Заказы · Склад'), body: String(data.body || 'Новое изменение в заказе.') };
  const forms = counts[category] || ['обновление', 'обновления', 'обновлений'];
  const orderNumber = String(data.orderNumber || '').trim();
  const rawBody = String(data.body || '').trim();
  const lastBody = rawBody.replace(/^За короткое время:[^.]*\.\s*/u, '').trim();
  const detail = lastBody
    ? ` Последнее: ${orderNumber ? `заказ № ${orderNumber} · ` : ''}${lastBody}`
    : orderNumber ? ` Последнее изменение — заказ № ${orderNumber}.` : '';
  return {
    title: titles[category] || 'Обновления заказов',
    body: `За последнюю минуту: ${count} ${pluralRu(count, ...forms)}.${detail}`.slice(0, 500)
  };
}
function notificationCategoryEnabled(settings = {}, category = 'orders') {
  if (settings[category] !== undefined) return settings[category] !== false;
  return !(ORDER_NOTIFICATION_CATEGORIES.has(category) && settings.orders === false);
}
const oneCImportKey = defineSecret('ONE_C_API_KEY');

setGlobalOptions({
  region: 'europe-west1',
  memory: '256MiB',
  timeoutSeconds: 60,
  maxInstances: 5
});

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

async function claimEvent(ref) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;

    const data = snap.data() || {};
    if (data.sentAt) return false;

    if (data.processingAt) {
      const started = data.processingAt instanceof Timestamp
        ? data.processingAt.toMillis()
        : Date.parse(data.processingStartedAt || '');
      if (Number.isFinite(started) && Date.now() - started < 120000) return false;
    }

    tx.update(ref, {
      processingAt: FieldValue.serverTimestamp(),
      processingStartedAt: new Date().toISOString()
    });
    return true;
  });
}

async function markDone(ref, fields) {
  await ref.update({
    ...fields,
    sentAt: FieldValue.serverTimestamp(),
    processingAt: FieldValue.delete(),
    processingStartedAt: FieldValue.delete()
  });
}

async function createNotificationHistory(data, eventId) {
  const category = ['orders', 'assembly', 'defects', 'status', 'editing', 'comments', 'questions', 'decisions', 'chat', 'replies', 'likes'].includes(data.category)
    ? data.category
    : (data.target === 'chat' ? 'chat' : 'orders');
  const recipientUserId = String(data.recipientUserId || '');
  const authorId = String(data.authorId || '');
  const mentionRecipientIds = new Set(Array.isArray(data.mentionRecipientIds)?data.mentionRecipientIds.map(String):[]);
  // For a direct notification, read only the recipient profile instead of querying
  // the full active-user collection. Broadcasts still use the active-user query.
  const users = recipientUserId
    ? await db.collection('users').doc(recipientUserId).get().then(user =>
        user.exists && user.data()?.active === true ? [user] : [])
    : (await db.collection('users').where('active', '==', true).get()).docs;

  let batch = db.batch();
  let count = 0;
  let batchWrites = 0;

  for (const user of users) {
    const profile = user.data() || {};
    const isMentionRecipient=mentionRecipientIds.has(user.id);
    if (data.buybackItemId && !canAccessBuybackProfile(profile)) continue;
    if (authorId && user.id === authorId && !(data.forceAll === true && recipientUserId === user.id)) continue;
    const settings = profile.notificationSettings || {};
    if (!notificationCategoryEnabled(settings, category) && !data.isMention && !isMentionRecipient && !data.buybackItemId && data.forceAll !== true && !data.directChatThreadId) continue;

    const notificationRef = user.ref.collection('notifications').doc(eventId);
    batch.set(notificationRef, {
      title: (isMentionRecipient&&data.target!=='chat'?`Вас упомянули в заказе № ${String(data.orderNumber||'').trim()}`:String(data.title || 'Заказы · Склад')).slice(0, 120),
      message: String(data.body || 'Новое изменение.').slice(0, 500),
      body: String(data.body || 'Новое изменение.').slice(0, 500),
      orderId: String(data.orderId || ''),
      orderNumber: String(data.orderNumber || ''),
      target: data.target === 'chat' ? 'chat' : 'site',
      category,
      isMention: data.isMention === true || data.isMention === 'true' || isMentionRecipient,
      isReply: data.isReply === true || data.isReply === 'true',
      authorId: String(data.authorId || ''),
      directChatThreadId: String(data.directChatThreadId || ''),
      directMessageId: String(data.directMessageId || ''),
      isUrgent: data.isUrgent === true,
      notificationTag: notificationTagFor(data, eventId, category, data.target === 'chat' ? 'chat' : 'site', recipientUserId),
      expiresAt: Number(data.expiresAt) || null,
      eventId,
      createdAt: FieldValue.serverTimestamp(),
      read: false
    }, { merge: true });
    count++;
    batchWrites++;

    // Firestore batches are limited to 500 writes.
    if (batchWrites === 450) {
      await batch.commit();
      batch = db.batch();
      batchWrites = 0;
    }
  }

  if (batchWrites) await batch.commit();
  return count;
}

async function collectTokens(category='orders', recipientUserId='', authorId='', forceAll=false, buybackOnly=false, directChat=false, mentionRecipientIds=[]) {
  // Direct notifications should never enumerate every employee's devices.
  const users = recipientUserId
    ? await db.collection('users').doc(recipientUserId).get().then(user =>
        user.exists && user.data()?.active === true ? [user] : [])
    : (await db.collection('users').where('active', '==', true).get()).docs;

  const mentionedUsers=new Set(Array.isArray(mentionRecipientIds)?mentionRecipientIds.map(String):[]);
  const eligibleUsers = users.filter(user => {
    const profile = user.data() || {};
    if (buybackOnly && !canAccessBuybackProfile(profile)) return false;
    if (authorId && user.id === authorId && !(forceAll && recipientUserId === user.id)) return false;
    return forceAll || buybackOnly || directChat || mentionedUsers.has(user.id) || notificationCategoryEnabled(profile.notificationSettings || {}, category);
  });

  // Only read push-token subcollections for users who can receive this event.
  const tokenGroups = await Promise.all(
    eligibleUsers.map(user => user.ref.collection('pushTokens').get())
  );

  const byInstallation = new Map();
  const byToken = new Map();

  for (let i = 0; i < tokenGroups.length; i++) {
    const user = eligibleUsers[i];

    for (const tokenDoc of tokenGroups[i].docs) {
      const data = tokenDoc.data() || {};
      const token = String(data.token || '');
      if (!token || !['warehouse_orders','warehouse_orders_android'].includes(data.appId)) continue;

      const item = {
        ref: tokenDoc.ref,
        token,
        installationId: String(data.installationId || ''),
        appId: String(data.appId || ''),
        platform: String(data.platform || (data.appId === 'warehouse_orders_android' ? 'android' : 'web')),
        updatedAt: String(data.updatedAt || ''),
        userId: user.id
      };

      if (item.installationId) {
        const key = user.id + ':' + item.installationId;
        const previous = byInstallation.get(key);
        if (!previous || item.updatedAt >= previous.updatedAt) byInstallation.set(key, item);
      } else if (!byToken.has(token)) {
        byToken.set(token, item);
      }
    }
  }

  const result = [...byInstallation.values()];
  const usedTokens = new Set(result.map(item => item.token));

  for (const item of byToken.values()) {
    if (!usedTokens.has(item.token)) {
      result.push(item);
      usedTokens.add(item.token);
    }
  }

  // With all-device notifications enabled, send to every registered installation.
  // Otherwise use only the most recently active installation for each recipient.
  const tokensByUser = new Map();
  for (const item of result) {
    if (!tokensByUser.has(item.userId)) tokensByUser.set(item.userId, []);
    tokensByUser.get(item.userId).push(item);
  }
  const selected = [];
  for (const [userId, items] of tokensByUser) {
    const profile = users.find(user => user.id === userId)?.data() || {};
    if (profile.extraPhoneNotifications === true) {
      selected.push(...items);
    } else {
      items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      if (items[0]) selected.push(items[0]);
    }
  }
  return selected;
}

exports.import1COrder = onRequest(
  { secrets: [oneCImportKey] },
  async (req, res) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'POST required' });
    }

    const apiKey = String(req.get('x-1c-api-key') || '');
    if (!apiKey || apiKey !== oneCImportKey.value()) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
      // Reject oversized payloads before processing or writing to Firestore.
      const rawBodySize = req.rawBody?.length;
      if (typeof rawBodySize === 'number' && rawBodySize > 1024 * 1024) {
        return res.status(413).json({ ok: false, error: 'Request too large' });
      }

      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};
      const number = String(body.number || '').trim();
      const client = String(body.client || '').trim();
      const sourceId = String(body.externalId || number).trim();
      const sourceType = String(body.sourceType || 'Заказ покупателя').trim();
      const rawArticles = body.articles;

      if (!number || number.length > 120) {
        return res.status(400).json({ ok: false, error: 'number is required and must be at most 120 characters' });
      }
      if (client.length > 200) {
        return res.status(400).json({ ok: false, error: 'client must be at most 200 characters' });
      }
      if (!sourceId || sourceId.length > 180) {
        return res.status(400).json({ ok: false, error: 'externalId must be at most 180 characters' });
      }
      if (sourceType.length > 100) {
        return res.status(400).json({ ok: false, error: 'sourceType must be at most 100 characters' });
      }
      if (!Array.isArray(rawArticles) || rawArticles.length === 0 || rawArticles.length > 500) {
        return res.status(400).json({ ok: false, error: 'articles must contain between 1 and 500 items' });
      }

      const articles = [];
      for (const item of rawArticles) {
        const article = String(item?.article || '').trim();
        const quantity = Number(item?.quantity ?? 1);
        if (!article || article.length > 120 || !Number.isFinite(quantity) || quantity < 1 || quantity > 1000000) {
          return res.status(400).json({ ok: false, error: 'Each article needs a valid code and quantity' });
        }
        articles.push({ article, quantity });
      }

      const orderRef = db.collection('orders').doc('1c_' + encodeURIComponent(sourceId));
      const now = new Date();
      const parsedDate = body.createdAt ? new Date(body.createdAt) : now;
      const createdAt = Number.isNaN(parsedDate.getTime()) ? now : parsedDate;

      const order = {
        number,
        client,
        status: 'Создан',
        articles,
        createdAt: Timestamp.fromDate(createdAt),
        createdBy: '1c',
        createdByName: '1С',
        updatedAt: FieldValue.serverTimestamp(),
        source: '1c',
        externalId: sourceId,
        sourceType
      };

      // Serialize concurrent retries for the same external ID. A read followed
      // by set/update outside a transaction could let two first imports race.
      const updated = await db.runTransaction(async transaction => {
        const existing = await transaction.get(orderRef);
        if (!existing.exists) {
          transaction.create(orderRef, order);
          return false;
        }
        transaction.update(orderRef, {
          number,
          client,
          articles,
          source: '1c',
          externalId: sourceId,
          sourceType,
          updatedAt: FieldValue.serverTimestamp()
        });
        return true;
      });

      logger.info('1C order imported', { number, sourceId, updated });
      return res.status(200).json({ ok: true, id: orderRef.id, number, updated });
    } catch (error) {
      logger.error('1C order import failed', { error: String(error?.message || error) });
      return res.status(500).json({ ok: false, error: 'Import failed' });
    }
  }
);


// Admin-only backfill for the safe staff directory. It imports every active warehouse
// profile regardless of the Firebase Authentication sign-in provider (Google or email/password).
exports.syncStaffDirectory = onCall(async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Требуется авторизация.');
  const actorSnap = await db.collection('users').doc(request.auth.uid).get();
  const actor = actorSnap.data() || {};
  if (!actorSnap.exists || actor.active !== true || !['warehouse', 'manager', 'chief_accountant', 'accountant', 'director'].includes(actor.role)) {
    throw new HttpsError('permission-denied', 'Активный профиль сотрудника не найден.');
  }

  const usersSnap = await db.collection('users').get();
  const activeProfiles = new Map();
  for (const userDoc of usersSnap.docs) {
    const profile = userDoc.data() || {};
    if (profile.active !== true || !['warehouse', 'manager', 'chief_accountant', 'accountant', 'director'].includes(profile.role)) continue;
    const roleLabels = { warehouse: 'Кладовщик', manager: 'Менеджер', chief_accountant: 'Главный бухгалтер', accountant: 'Бухгалтер', director: 'Директор' };
    activeProfiles.set(userDoc.id, {
      displayName: String(profile.displayName || roleLabels[profile.role]).slice(0, 100),
      role: profile.role,
      roleLabel: roleLabels[profile.role],
      active: true,
      avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl.slice(0, 1000) : ''
    });
  }

  const directorySnap = await db.collection('staffDirectory').get();
  let batch = db.batch();
  let writes = 0;
  for (const [uid, profile] of activeProfiles) {
    batch.set(db.collection('staffDirectory').doc(uid), profile, { merge: true });
    writes++;
    if (writes === 450) { await batch.commit(); batch = db.batch(); writes = 0; }
  }
  for (const staffDoc of directorySnap.docs) {
    if (activeProfiles.has(staffDoc.id)) continue;
    batch.set(staffDoc.ref, { active: false }, { merge: true });
    writes++;
    if (writes === 450) { await batch.commit(); writes = 0; }
  }
  if (writes) await batch.commit();
  const staff = [...activeProfiles.entries()].map(([uid, profile]) => ({ uid, ...profile }));
  logger.info('Staff directory synchronized', { actorUid: request.auth.uid, activeStaff: staff.length });
  // Return the sanitized directory directly. This avoids relying on a client
  // collection listener for the initial staff list while keeping presence realtime.
  return { ok: true, count: staff.length, staff };
});

// Read-only staff directory endpoint. The server is the sole source of active staff;
// clients never need direct access to the users collection or to write directory records.
exports.getStaffDirectory = onCall(async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Требуется авторизация.');
  const actorSnap = await db.collection('users').doc(request.auth.uid).get();
  const actor = actorSnap.data() || {};
  const allowedRoles = ['warehouse', 'manager', 'chief_accountant', 'accountant', 'director'];
  if (!actorSnap.exists || actor.active !== true || !allowedRoles.includes(actor.role)) {
    throw new HttpsError('permission-denied', 'Активный профиль сотрудника не найден.');
  }
  const usersSnap = await db.collection('users').get();
  const roleLabels = { warehouse: 'Кладовщик', manager: 'Менеджер', chief_accountant: 'Главный бухгалтер', accountant: 'Бухгалтер', director: 'Директор' };
  const staff = usersSnap.docs.flatMap(userDoc => {
    const profile = userDoc.data() || {};
    if (profile.active !== true || !allowedRoles.includes(profile.role)) return [];
    return [{
      uid: userDoc.id,
      displayName: String(profile.displayName || roleLabels[profile.role]).slice(0, 100),
      role: profile.role,
      roleLabel: roleLabels[profile.role],
      active: true,
      avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl.slice(0, 1000) : ''
    }];
  });
  return { ok: true, count: staff.length, staff };
});

// Read only the current employee's private conversation summaries. The client
// falls back to this endpoint if Firestore cannot authorize its inbox query.
exports.getDirectChatThreads = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Требуется авторизация.');
  const profile = await db.collection('users').doc(uid).get();
  const allowedRoles = ['warehouse', 'manager', 'chief_accountant', 'accountant', 'director'];
  if (!profile.exists || profile.data()?.active !== true || !allowedRoles.includes(profile.data()?.role)) {
    throw new HttpsError('permission-denied', 'Активный профиль сотрудника не найден.');
  }
  const snapshot = await db.collection('directChats')
    .where('participants', 'array-contains', uid)
    .limit(100)
    .get();
  const millis = value => value?.toMillis?.() || (Number.isFinite(value) ? value : null);
  return {
    threads: snapshot.docs.map(item => {
      const data = item.data() || {};
      return {
        id: item.id,
        participants: Array.isArray(data.participants) ? data.participants.filter(value => typeof value === 'string') : [],
        lastMessage: String(data.lastMessage || '').slice(0, 180),
        lastSenderId: String(data.lastSenderId || ''),
        lastMessageAt: millis(data.lastMessageAt),
        updatedAt: millis(data.updatedAt)
      };
    })
  };
});

// All client notification requests pass through this callable. Admin SDK writes
// avoid brittle client-side pushQueue rule evaluation while preserving strict
// authentication, recipient, category and administrator checks.
exports.enqueueWarehousePush = onCall(async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Требуется авторизация.');
  const uid = request.auth.uid;
  const profileSnap = await db.collection('users').doc(uid).get();
  if (!profileSnap.exists || profileSnap.data()?.active !== true) {
    throw new HttpsError('permission-denied', 'Активный профиль сотрудника не найден.');
  }

  const input = request.data || {};
  const allowedCategories = new Set(['orders', 'assembly', 'defects', 'status', 'editing', 'comments', 'questions', 'decisions', 'chat', 'replies', 'likes']);
  const target = input.target === 'chat' ? 'chat' : input.target === 'site' ? 'site' : '';
  const category = String(input.category || '');
  const title = String(input.title || 'Заказы · Склад');
  const body = String(input.body || 'Новое изменение в заказе.');
  const orderId = String(input.orderId || '');
  const recipientUserId = String(input.recipientUserId || '');
  const requestedOrderVersion = String(input.orderVersion || '').slice(0, 200);
  const isDeletedOrder = input.isDeleted === true;
  const forceAll = input.forceAll === true;
  const directChatThreadId = String(input.directChatThreadId || '');
  const directMessageId = String(input.directMessageId || '');
  const isUrgent = input.isUrgent === true;
  if (input.mentionRecipientIds !== undefined && !Array.isArray(input.mentionRecipientIds)) {
    throw new HttpsError('invalid-argument', 'Получатели упоминания должны быть списком сотрудников.');
  }
  const mentionRecipientIds = [...new Set((Array.isArray(input.mentionRecipientIds)?input.mentionRecipientIds:[]).map(value=>String(value||'')).filter(Boolean))];
  if (mentionRecipientIds.length > 20 || mentionRecipientIds.some(id=>id.length>128)) {
    throw new HttpsError('invalid-argument', 'В комментарии можно упомянуть не более 20 сотрудников.');
  }
  if (mentionRecipientIds.length && (target !== 'site' || category !== 'comments' || !orderId || recipientUserId)) {
    throw new HttpsError('invalid-argument', 'Упоминания можно отправлять только с комментарием к заказу.');
  }
  if (directChatThreadId && (!recipientUserId || category !== 'replies' || target !== 'chat' || directChatThreadId.length > 300)) {
    throw new HttpsError('invalid-argument', 'Некорректный адрес личного сообщения.');
  }
  if (directMessageId && !directChatThreadId) throw new HttpsError('invalid-argument', 'Для личного сообщения не указан чат.');

  if (!target || !allowedCategories.has(category) || title.length < 1 || title.length > 120 || body.length > 500 || recipientUserId.length > 128) {
    throw new HttpsError('invalid-argument', 'Некорректные данные уведомления.');
  }
  if (forceAll && !(profileSnap.data()?.admin === true || profileSnap.data()?.role === 'director')) {
    throw new HttpsError('permission-denied', 'Тестовые уведомления доступны только администратору.');
  }

  if (recipientUserId) {
    const recipientSnap = await db.collection('users').doc(recipientUserId).get();
    if (!recipientSnap.exists || recipientSnap.data()?.active !== true) {
      throw new HttpsError('failed-precondition', 'Получатель не найден или отключён.');
    }
  }
  if (mentionRecipientIds.length) {
    const mentionProfiles=await Promise.all(mentionRecipientIds.map(id=>db.collection('users').doc(id).get()));
    if (mentionProfiles.some((profile,index)=>!profile.exists||profile.data()?.active!==true||mentionRecipientIds[index]===uid)) {
      throw new HttpsError('failed-precondition', 'Один из сотрудников для упоминания недоступен.');
    }
  }
  if (directMessageId) {
    const thread = await db.collection('directChats').doc(directChatThreadId).get();
    const participants = thread.data()?.participants;
    if (!thread.exists || !Array.isArray(participants) || !participants.includes(uid) || !participants.includes(recipientUserId)) {
      throw new HttpsError('permission-denied', 'Получатель не входит в этот личный чат.');
    }
    const directMessage = await thread.ref.collection('messages').doc(directMessageId).get();
    if (!directMessage.exists || directMessage.data()?.authorId !== uid) {
      throw new HttpsError('permission-denied', 'Личное сообщение не найдено или не принадлежит отправителю.');
    }
  }

  const orderCategories = new Set(['orders', 'assembly', 'defects', 'status', 'editing', 'comments', 'questions', 'decisions']);
  let orderVersion = '';
  let orderNumber = '';
  if (orderCategories.has(category)) {
    if (isDeletedOrder) {
      if (category !== 'editing' || target !== 'site' || !orderId || recipientUserId
        || !(profileSnap.data()?.admin === true || profileSnap.data()?.role === 'director')) {
        throw new HttpsError('permission-denied', 'Уведомление об удалении заказа доступно только администратору.');
      }
      orderNumber = String(input.orderNumber || '').slice(0, 80);
      if (!orderNumber) throw new HttpsError('invalid-argument', 'Для уведомления об удалении нужен номер заказа.');
    } else {
      if (target !== 'site' || !orderId || recipientUserId) {
        throw new HttpsError('invalid-argument', 'Для уведомления по заказу нужны сайт и действующий заказ.');
      }
      const orderSnap = await db.collection('orders').doc(orderId).get();
      if (!orderSnap.exists) throw new HttpsError('failed-precondition', 'Заказ для уведомления не найден.');
      const orderData = orderSnap.data() || {};
      orderVersion = requestedOrderVersion || orderVersionKey(orderData);
      orderNumber = String(orderData.number || '').slice(0, 80);
    }
  } else if (category === 'replies') {
    if (!recipientUserId || (target === 'site' && !orderId) || (target === 'chat' && orderId)) {
      throw new HttpsError('invalid-argument', 'Для ответа необходимо указать получателя и корректную цель.');
    }
    if (target === 'site' && !(await db.collection('orders').doc(orderId).get()).exists) {
      throw new HttpsError('failed-precondition', 'Заказ для ответа не найден.');
    }
  } else if (category === 'chat') {
    if (target !== 'chat' || (recipientUserId && !(forceAll && recipientUserId === uid))) {
      throw new HttpsError('invalid-argument', 'Некорректная цель чат-уведомления.');
    }
  } else if (category === 'likes') {
    if (target !== 'chat' || !recipientUserId) {
      throw new HttpsError('invalid-argument', 'Для лайка необходимо указать получателя чата.');
    }
  }

  const ref = db.collection('pushQueue').doc();
  const now = Date.now();
  await ref.create({
    title,
    body,
    authorId: uid,
    orderId: isDeletedOrder ? '' : orderId,
    target,
    category,
    recipientUserId,
    mentionRecipientIds,
    orderNumber,
    isMention: input.isMention === true,
    isReply: input.isReply === true,
    directChatThreadId,
    directMessageId,
    isUrgent,
    isDeleted: isDeletedOrder,
    forceAll,
    orderVersion,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + 60000,
    sentAt: null
  });
  return { ok: true, eventId: ref.id };
});

exports.sendWarehousePush = onDocumentCreated({ document: 'pushQueue/{eventId}', retry: true }, async event => {
  const snapshot = event.data;
  if (!snapshot) return;

  const claimed = await claimEvent(snapshot.ref);
  if (!claimed) return;

  const data = snapshot.data() || {};
  const eventId = event.params.eventId;
  const siteUrl = 'https://hlebish.github.io/warehouse_orders/';
  const orderId = String(data.orderId || '');
  const target = data.target === 'chat' ? 'chat' : 'site';
  const category = ['orders', 'assembly', 'defects', 'status', 'editing', 'comments', 'questions', 'decisions', 'chat', 'replies', 'likes'].includes(data.category) ? data.category : (target === 'chat' ? 'chat' : 'orders');
  const recipientUserId = String(data.recipientUserId || '');
  const mentionRecipientIds=Array.isArray(data.mentionRecipientIds)?[...new Set(data.mentionRecipientIds.map(String))]:[];
  const mentionRecipients=new Set(mentionRecipientIds);
  const expiresAt = Number(data.expiresAt) || (Date.parse(String(data.createdAt || '')) + 60000);
  if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
    await markDone(snapshot.ref, { deliveryStatus: 'expired', acceptedCount: 0, failedCount: 0 });
    logger.info('Push skipped: expired before delivery', { eventId });
    return;
  }
  const alwaysRelevant = data.forceAll === true || data.isMention === true || data.isReply === true || mentionRecipientIds.length>0;
  if (orderId && data.orderVersion && !alwaysRelevant) {
    const currentOrder = await db.collection('orders').doc(orderId).get();
    const currentVersion = currentOrder.exists ? orderVersionKey(currentOrder.data()) : '';
    if (!currentOrder.exists || currentVersion !== String(data.orderVersion)) {
      await markDone(snapshot.ref, { deliveryStatus: 'stale', acceptedCount: 0, failedCount: 0 });
      logger.info('Push skipped: order changed after notification was queued', { eventId, orderId });
      return;
    }
  }
  const notificationTag = notificationTagFor(data, eventId, category, target, recipientUserId);
  // Start notification history immediately, but do not make push delivery wait for it.
  const historyPromise = createNotificationHistory(data, eventId).catch(error => {
    logger.error('Notification history write failed', {
      eventId,
      error: String(error?.message || error)
    });
  });
  const directChatThreadId = String(data.directChatThreadId || '');
  const senderId = String(data.authorId || '');
  const link = directChatThreadId && senderId
    ? `${siteUrl}?directChat=${encodeURIComponent(directChatThreadId)}&peer=${encodeURIComponent(senderId)}`
    : (target === 'chat'
      ? `${siteUrl}?chat=1`
      : (orderId ? `${siteUrl}?order=${encodeURIComponent(orderId)}` : siteUrl));

  try {
    const tokenDocs = await collectTokens(category, recipientUserId, String(data.authorId || ''), data.forceAll === true, Boolean(data.buybackItemId), Boolean(directChatThreadId), mentionRecipientIds);

    if (!tokenDocs.length) {
      await historyPromise;
      await markDone(snapshot.ref, {
        deliveryStatus: 'no_devices',
        acceptedCount: 0,
        failedCount: 0,
        diagnostic: 'На момент обработки не найдено ни одного активного устройства с push-токеном.'
      });
      logger.info('Push skipped: no registered devices', { eventId });
      return;
    }

    const burstCount = await registerNotificationBurst(notificationTag, eventId, category);
    const pushCopy = notificationCopy(data, burstCount, category);

    let accepted = 0;
    let failed = 0;
    const failureCodes = new Map();

    for (let i = 0; i < tokenDocs.length; i += 500) {
      const group = tokenDocs.slice(i, i + 500);

      for (const platform of ['web', 'android']) {
       for (const isMentionRecipient of [false,true]) {
        const platformGroup = group.filter(item => item.platform === platform && mentionRecipients.has(item.userId)===isMentionRecipient);
        if (!platformGroup.length) continue;

        const baseMessage = {
          tokens: platformGroup.map(item => item.token),
          data: {
            title: isMentionRecipient?`Вас упомянули в заказе № ${String(data.orderNumber||'').trim()}`.slice(0,120):pushCopy.title,
            body: pushCopy.body,
            eventId,
            link,
            orderId,
            target,
            category,
            directChatThreadId,
            directMessageId: String(data.directMessageId || ''),
            authorId: senderId,
            notificationTag,
            isMention: String(isMentionRecipient || data.isMention === true || data.isMention === 'true'),
            isReply: String(data.isReply === true || data.isReply === 'true'),
            createdAt: String(data.createdAt || ''),
            expiresAt: String(expiresAt || '')
          }
        };

        const message = platform === 'android'
          ? {
              ...baseMessage,
              android: {
                priority: 'high',
                ttl: 60000
              }
            }
          : {
              ...baseMessage,
              webpush: {
                headers: {
                  Urgency: 'high',
                  // Do not deliver stale notifications after a computer wakes up.
                  TTL: '60'
                },
                fcmOptions: {
                  link
                }
              }
            };

        const response = await messaging.sendEachForMulticast(message);

        const removals = [];

      response.responses.forEach((result, index) => {
        if (result.success) {
          accepted++;
          return;
        }

        failed++;
        const code = result.error?.code || 'unknown';
        failureCodes.set(code, (failureCodes.get(code) || 0) + 1);

        if (INVALID_TOKEN_CODES.has(code)) {
          removals.push(platformGroup[index].ref.delete());
        }
      });

        await Promise.all(removals);
      }
      }
    }

    const failures = Object.fromEntries(failureCodes);

    if (accepted > 0) {
      await historyPromise;
      await markDone(snapshot.ref, {
        deliveryStatus: failed ? 'partial' : 'sent',
        acceptedCount: accepted,
        failedCount: failed,
        failureCodes: failures
      });
      logger.info('Push sent', { eventId, accepted, failed, failureCodes: failures });
      return;
    }

    const onlyInvalidTokens =
      failed > 0 &&
      [...failureCodes.keys()].every(code => INVALID_TOKEN_CODES.has(code));

    if (onlyInvalidTokens) {
      await historyPromise;
      await markDone(snapshot.ref, {
        deliveryStatus: 'no_valid_devices',
        acceptedCount: 0,
        failedCount: failed,
        failureCodes: failures
      });
      logger.warn('Push had no valid devices', { eventId, failed });
      return;
    }

    throw new Error(
      'FCM rejected all device deliveries for ' +
      eventId +
      ': ' +
      JSON.stringify(failures)
    );
  } catch (error) {
    await snapshot.ref.update({
      deliveryStatus: 'retrying',
      lastError: String(error?.message || error),
      processingAt: FieldValue.delete(),
      processingStartedAt: FieldValue.delete()
    });

    logger.error('Push delivery failed', {
      eventId,
      error: String(error?.message || error)
    });

    throw error;
  }
});


function normalizeBuybackArticle(value) {
  // Normalize harmless separators but keep the whole code: truncating APxx
  // codes at their first digits can merge distinct product variants.
  const lookalikes = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I', Ј: 'J', Ѕ: 'S' };
  return String(value || '').normalize('NFKC').trim().toUpperCase()
    .replace(/[АВЕКМНОРСТУХІЈЅ]/g, character => lookalikes[character] || character)
    .replace(/[^A-Z0-9]/g, '');
}

function buybackArticleQuantities(articles) {
  const result = new Map();
  for (const line of Array.isArray(articles) ? articles : []) {
    const article = normalizeBuybackArticle(line?.article);
    const quantity = Math.max(1, Math.floor(Number(line?.quantity) || 1));
    if (article) result.set(article, (result.get(article) || 0) + quantity);
  }
  return result;
}

function buybackEventDocId(prefix, eventId) {
  return `${prefix}_${createHash('sha256').update(String(eventId)).digest('hex').slice(0, 40)}`;
}

async function syncBuybackOrderReferences(order) {
  const quantities = buybackArticleQuantities(order.articles);
  const snap = await db.collection('buybackItems').where('status', 'in', ['active', 'expired']).get();
  const today = new Date().toISOString().slice(0, 10);
  let batch = db.batch();
  let writes = 0;
  for (const item of snap.docs) {
    const data = item.data();
    const matchesOrder = quantities.has(normalizeBuybackArticle(data.article));
    if (!matchesOrder) {
      // Release inventory when the linked order no longer contains its SKU.
      if (data.orderId === order.id) {
        batch.update(item.ref, {
          orderId: FieldValue.delete(), orderNumber: FieldValue.delete(),
          clientName: FieldValue.delete(), reservedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp()
        });
        writes++;
        if (writes === 450) { await batch.commit(); batch = db.batch(); writes = 0; }
      }
      continue;
    }
    if (data.orderId && data.orderId !== order.id) continue;
    batch.update(item.ref, {
      orderId: order.id,
      orderNumber: String(order.number || ''),
      clientName: String(order.client || 'Клиент не указан'),
      reservedAt: data.reservedAt || today,
      updatedAt: FieldValue.serverTimestamp()
    });
    writes++;
    if (writes === 450) { await batch.commit(); batch = db.batch(); writes = 0; }
  }
  if (writes) await batch.commit();
}

async function markBuybackItemsSold(order, eventId) {
  const needed = buybackArticleQuantities(order.articles);
  if (!needed.size) return;
  const markerRef = db.collection('orders').doc(order.id).collection('buybackSync').doc(buybackEventDocId('shipment', eventId));
  const result = await db.runTransaction(async transaction => {
    if ((await transaction.get(markerRef)).exists) return { skipped: true, sold: 0, unmatched: 0 };
    const soldSnap = await transaction.get(db.collection('buybackItems').where('soldByOrderId', '==', order.id));
    const snap = await transaction.get(db.collection('buybackItems').where('status', 'in', ['active', 'expired']));
    const alreadySold = new Map();
    for (const itemDoc of soldSnap.docs) {
      const item = itemDoc.data();
      if (item.status !== 'sold') continue;
      const article = normalizeBuybackArticle(item.article);
      const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
      if (article && quantity) alreadySold.set(article, (alreadySold.get(article) || 0) + quantity);
    }
    // If the same shipped order is edited or re-shipped, only sell its
    // remaining unsynced quantity; never consume stock twice for one order.
    const remaining = new Map([...needed].map(([article, quantity]) => [article, Math.max(0, quantity - (alreadySold.get(article) || 0))]));
    const today = new Date().toISOString().slice(0, 10);
    const candidates = snap.docs.slice().sort((a, b) =>
      String(a.get('receivedAt') || '').localeCompare(String(b.get('receivedAt') || '')) || a.id.localeCompare(b.id)
    );
    let writes = 0;
    let soldTotal = 0;
    for (const itemDoc of candidates) {
      const item = itemDoc.data();
      const article = normalizeBuybackArticle(item.article);
      const quantityNeeded = remaining.get(article) || 0;
      const available = Math.max(0, Math.floor(Number(item.quantity) || 0));
      if (!article || !quantityNeeded || !available) continue;
      const sold = Math.min(available, quantityNeeded);
      const patch = {
        status: 'sold', soldAt: today, updatedAt: FieldValue.serverTimestamp(),
        soldByOrderId: order.id, soldByOrderNumber: String(order.number || ''),
        soldToClient: String(order.client || 'Клиент не указан'), orderId: order.id,
        orderNumber: String(order.number || ''), clientName: String(order.client || 'Клиент не указан'),
        returnedAt: FieldValue.delete(), returnedFromOrderId: FieldValue.delete(),
        returnedFromOrderNumber: FieldValue.delete(), returnedFromReturnId: FieldValue.delete(),
        returnedFromClient: FieldValue.delete(), returnedFromBuybackId: FieldValue.delete(),
        cancelledAt: FieldValue.delete(), shippedAt: FieldValue.delete()
      };
      if (sold === available) transaction.update(itemDoc.ref, patch);
      else {
        const soldRef = db.collection('buybackItems').doc(buybackEventDocId(`sold_${itemDoc.id}`, eventId));
        transaction.set(soldRef, {
          ...item, quantity: sold, ...patch, createdAt: FieldValue.serverTimestamp(),
          returnedAt: null, returnedFromOrderId: null, returnedFromOrderNumber: null,
          returnedFromReturnId: null, returnedFromClient: null, returnedFromBuybackId: null,
          cancelledAt: null, shippedAt: null
        });
        transaction.update(itemDoc.ref, {
          quantity: available - sold, orderId: FieldValue.delete(), orderNumber: FieldValue.delete(),
          clientName: FieldValue.delete(), reservedAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp()
        });
      }
      remaining.set(article, quantityNeeded - sold);
      soldTotal += sold;
      writes += sold === available ? 1 : 2;
    }
    if (writes > 450) throw new Error('Buyback shipment exceeds the safe transaction write limit');
    transaction.set(markerRef, { processedAt: FieldValue.serverTimestamp(), kind: 'shipment' });
    return { skipped: false, sold: soldTotal, unmatched: [...remaining.values()].reduce((sum, quantity) => sum + quantity, 0) };
  });
  if (!result.skipped) logger.info('Buyback inventory reconciled for shipped order', {
    orderId: order.id, orderNumber: String(order.number || ''), soldQuantity: result.sold,
    unmatchedQuantity: result.unmatched, articles: [...needed.keys()]
  });
}

async function restoreBuybackItemsForReturn(order, returnEntry, eventId) {
  const markerRef = db.collection('orders').doc(order.id).collection('buybackSync').doc(buybackEventDocId('return', eventId));
  await db.runTransaction(async transaction => {
    if ((await transaction.get(markerRef)).exists) return;
    const soldQuery = db.collection('buybackItems').where('soldByOrderId', '==', order.id);
    const soldSnap = await transaction.get(soldQuery);
    const remaining = new Map();
    for (const entry of Array.isArray(returnEntry.items) ? returnEntry.items : []) {
      const article = normalizeBuybackArticle(entry?.article);
      const quantity = Math.max(0, Math.floor(Number(entry?.quantity) || 0));
      if (article && quantity) remaining.set(article, (remaining.get(article) || 0) + quantity);
    }
    const today = String(returnEntry.createdAt || new Date().toISOString()).slice(0, 10);
    let writes = 0;
    const soldItems = soldSnap.docs.slice().sort((a, b) =>
      String(a.get('soldAt') || a.get('receivedAt') || '').localeCompare(String(b.get('soldAt') || b.get('receivedAt') || '')) || a.id.localeCompare(b.id)
    );
    for (const itemDoc of soldItems) {
      const item = itemDoc.data(), article = normalizeBuybackArticle(item.article);
      if (item.status !== 'sold') continue;
      const needed = remaining.get(article) || 0, available = Math.max(0, Math.floor(Number(item.quantity) || 0));
      if (!needed || !available) continue;
      const quantity = Math.min(needed, available);
      const returnedFields = {
        status: 'active', returnedAt: today, returnedFromOrderId: order.id,
        returnedFromOrderNumber: String(order.number || ''), returnedFromReturnId: returnEntry.id,
        returnedFromClient: String(order.client || ''), updatedAt: FieldValue.serverTimestamp()
      };
      if (quantity === available) transaction.update(itemDoc.ref, {
        ...returnedFields, orderId: FieldValue.delete(), orderNumber: FieldValue.delete(),
        clientName: FieldValue.delete(), reservedAt: FieldValue.delete()
      });
      else {
        const splitRef = db.collection('buybackItems').doc(buybackEventDocId(`returned_${itemDoc.id}`, eventId));
        transaction.set(splitRef, {
          ...item, quantity, status: 'active', ...returnedFields, returnedFromBuybackId: itemDoc.id,
          orderId: null, orderNumber: null, clientName: null, reservedAt: null,
          createdAt: FieldValue.serverTimestamp()
        });
        transaction.update(itemDoc.ref, { quantity: available - quantity, updatedAt: FieldValue.serverTimestamp() });
      }
      remaining.set(article, needed - quantity);
      writes += quantity === available ? 1 : 2;
    }
    if (writes > 450) throw new Error('Buyback return exceeds the safe transaction write limit');
    transaction.set(markerRef, { processedAt: FieldValue.serverTimestamp(), kind: 'return', returnId: returnEntry.id });
  });
}

async function reverseBuybackReturn(orderId, returnId, eventId) {
  const markerRef = db.collection('orders').doc(orderId).collection('buybackSync').doc(buybackEventDocId('cancel', eventId));
  await db.runTransaction(async transaction => {
    if ((await transaction.get(markerRef)).exists) return;
    const returnedSnap = await transaction.get(db.collection('buybackItems').where('returnedFromReturnId', '==', returnId));
    const sourceRefs = new Map();
    for (const itemDoc of returnedSnap.docs) {
      const item = itemDoc.data();
      if (item.status === 'active' && item.returnedFromBuybackId) sourceRefs.set(item.returnedFromBuybackId, db.collection('buybackItems').doc(item.returnedFromBuybackId));
    }
    const sources = new Map();
    for (const [id, ref] of sourceRefs) { const snap = await transaction.get(ref); if (snap.exists) sources.set(id, snap); }
    let writes = 0;
    for (const itemDoc of returnedSnap.docs) {
      const item = itemDoc.data();
      if (item.status !== 'active') continue;
      if (item.returnedFromBuybackId) {
        const source = sources.get(item.returnedFromBuybackId);
        if (!source) continue;
        transaction.update(source.ref, { quantity: (Number(source.get('quantity')) || 0) + (Number(item.quantity) || 0), updatedAt: FieldValue.serverTimestamp() });
        transaction.delete(itemDoc.ref);
      } else {
        transaction.update(itemDoc.ref, {
          status: 'sold', returnedAt: FieldValue.delete(), returnedFromOrderId: FieldValue.delete(),
          returnedFromOrderNumber: FieldValue.delete(), returnedFromReturnId: FieldValue.delete(),
          returnedFromClient: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp()
        });
      }
      writes++;
    }
    if (writes > 450) throw new Error('Buyback return cancellation exceeds the safe transaction write limit');
    transaction.set(markerRef, { processedAt: FieldValue.serverTimestamp(), kind: 'return-cancel', returnId });
  });
}

exports.syncBuybackFromOrder = onDocumentUpdated({ document: 'orders/{orderId}', retry: true }, async event => {
  const before = event.data?.before.data() || {}, after = event.data?.after.data() || {};
  const order = { id: event.params.orderId, ...after };
  const shipped = ['Отгружен кладовщиком', 'Клиент забрал самовывозом'];
  const articlesChanged = JSON.stringify(before.articles || []) !== JSON.stringify(after.articles || []);

  const previousReturns = new Map((Array.isArray(before.returns) ? before.returns : []).map(item => [item?.id, item]));
  for (const entry of Array.isArray(after.returns) ? after.returns : []) {
    if (!entry?.id) continue;
    const previous = previousReturns.get(entry.id);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(entry)) {
      if (entry.status === 'cancelled' && previous?.status !== 'cancelled') await reverseBuybackReturn(order.id, entry.id, event.id);
      else if (entry.status !== 'cancelled') await restoreBuybackItemsForReturn(order, entry, event.id);
    }
  }

  // Process return cancellation first. It restores the sold quantity, after
  // which shipment reconciliation can see that the order is already covered.
  if (shipped.includes(after.status) && (!shipped.includes(before.status) || articlesChanged)) await markBuybackItemsSold(order, event.id);

  const referenceFieldsChanged = ['number', 'client'].some(key => before[key] !== after[key]) || articlesChanged;
  if (referenceFieldsChanged) await syncBuybackOrderReferences(order);
});

exports.linkBuybackToNewOrder = onDocumentCreated({ document: 'orders/{orderId}', retry: true }, async event => {
  const data = event.data?.data() || {};
  await syncBuybackOrderReferences({ id: event.params.orderId, ...data });
});

// Ежедневная проверка сроков перекупного товара. Отправляем каждую контрольную отметку один раз.

/**
 * Reliable group-chat unread tracking. Receipts are separate from the 50-message
 * history window, so old unread messages remain visible until the recipient reads them.
 */
exports.createChatUnreadReceipts = onDocumentCreated({
  document: 'chatMessages/{messageId}',
  retry: true
}, async event => {
  const initial = event.data?.data() || {};
  const authorId = String(initial.authorId || '');
  if (!authorId) return;
  const recipientIds = [...new Set((Array.isArray(initial.notificationRecipientIds) ? initial.notificationRecipientIds : []).map(String))]
    .filter(uid => uid && uid !== authorId);
  if (!recipientIds.length) return;
  const createdAt = initial.createdAt instanceof Timestamp ? initial.createdAt : Timestamp.now();
  const nextReminderAt = Timestamp.fromMillis(Date.now() + 5 * 60 * 1000);
  const preview = String(initial.text || '').trim().slice(0, 240) || '📷 Фото';
  const candidates = recipientIds.map(uid => ({ id: uid }));
  await db.runTransaction(async tx => {
    // Read the live message inside the transaction. If the recipient opened it
    // before this trigger ran, the updated readBy value prevents a stale receipt.
    const messageSnap = await tx.get(event.data.ref);
    if (!messageSnap.exists) return;
    const currentReadBy = Array.isArray(messageSnap.data()?.readBy) ? messageSnap.data().readBy : [];
    const pending = candidates.filter(user => !currentReadBy.includes(user.id));
    const refs = pending.map(user => db.collection('chatUnread').doc(user.id + '_' + event.params.messageId));
    const existing = await Promise.all(refs.map(ref => tx.get(ref)));
    pending.forEach((user, index) => {
      if (existing[index].exists) return;
      tx.create(refs[index], {
        recipientUserId: user.id,
        messageId: event.params.messageId,
        authorId,
        authorName: String(initial.authorName || 'Сотрудник').slice(0, 100),
        preview,
        createdAt,
        nextReminderAt,
        reminderCount: 0,
        status: 'unread',
        isReply: Boolean(initial.replyToId)
      });
    });
  });
});


/**
 * One-time, paginated backfill for unread messages that existed before receipts
 * were introduced. It never loads the entire chat and advances a durable cursor.
 */
exports.backfillLegacyChatUnreadReceipts = onSchedule({
  schedule: 'every 5 minutes',
  timeZone: 'Europe/Kyiv',
  retryCount: 2
}, async () => {
  const stateRef = db.collection('chatSystemState').doc('legacyUnreadBackfill');
  const stateSnap = await stateRef.get();
  const state = stateSnap.data() || {};
  if (state.completed === true) return;
  let pageQuery = db.collection('chatMessages')
    .orderBy(FieldPath.documentId())
    .limit(25);
  if (state.lastMessageId) pageQuery = pageQuery.startAfter(String(state.lastMessageId));
  const page = await pageQuery.get();
  if (page.empty) {
    await stateRef.set({ completed: true, completedAt: FieldValue.serverTimestamp() }, { merge: true });
    return;
  }
  for (const messageDoc of page.docs) {
    const original = messageDoc.data() || {};
    const authorId = String(original.authorId || '');
    if (!authorId) continue;
    const recipientIds = [...new Set((Array.isArray(original.notificationRecipientIds) ? original.notificationRecipientIds : []).map(String))]
      .filter(uid => uid && uid !== authorId);
    if (!recipientIds.length) continue;
    const pendingUsers = recipientIds
      .filter(uid => !(Array.isArray(original.readBy) && original.readBy.includes(uid)))
      .map(uid => ({ id: uid }));
    const createdDate = original.createdAt instanceof Timestamp
      ? original.createdAt
      : (original.createdAt instanceof Date
        ? Timestamp.fromDate(original.createdAt)
        : Timestamp.now());
    const nextReminderAt = Timestamp.fromMillis(Date.now() + 5 * 60 * 1000);
    const preview = String(original.text || original.message || original.content || '').trim().slice(0, 240) || '📷 Фото';
    await db.runTransaction(async tx => {
      const live = await tx.get(messageDoc.ref);
      if (!live.exists) return;
      const liveData = live.data() || {};
      const readBy = Array.isArray(liveData.readBy) ? liveData.readBy : [];
      const candidates = pendingUsers.filter(user => !readBy.includes(user.id));
      const refs = candidates.map(user => db.collection('chatUnread').doc(user.id + '_' + messageDoc.id));
      const existing = await Promise.all(refs.map(ref => tx.get(ref)));
      candidates.forEach((user, index) => {
        if (existing[index].exists) return;
        tx.create(refs[index], {
          recipientUserId: user.id,
          messageId: messageDoc.id,
          authorId,
          authorName: String(original.authorName || original.author || 'Сотрудник').slice(0, 100),
          preview,
          createdAt: createdDate,
          nextReminderAt,
          reminderCount: 0,
          status: 'unread',
          isReply: Boolean(original.replyToId)
        });
      });
    });
  }
  await stateRef.set({
    lastMessageId: page.docs[page.docs.length - 1].id,
    processedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  if (page.size < 25) {
    await stateRef.set({ completed: true, completedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
});

exports.repeatUnreadChatNotifications = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'Europe/Kyiv',
  retryCount: 2
}, async () => {
  const due = await db.collection('chatUnread')
    .where('nextReminderAt', '<=', Timestamp.now())
    .limit(300)
    .get();
  for (const receipt of due.docs) {
    const data = receipt.data() || {};
    // Legacy receipts were previously created for every active employee.
    // Stop reminders unless this message explicitly addresses this recipient.
    if (data.messageId && data.recipientUserId) {
      const messageSnap = await db.collection('chatMessages').doc(String(data.messageId)).get();
      const recipients = messageSnap.exists && Array.isArray(messageSnap.data()?.notificationRecipientIds)
        ? messageSnap.data().notificationRecipientIds.map(String) : [];
      if (!recipients.includes(String(data.recipientUserId))) {
        await receipt.ref.update({ status: 'ignored', nextReminderAt: null });
        continue;
      }
    } else {
      await receipt.ref.update({ status: 'ignored', nextReminderAt: null });
      continue;
    }
    const nextCount = (Number(data.reminderCount) || 0) + 1;
    const claimed = await db.runTransaction(async tx => {
      const fresh = await tx.get(receipt.ref);
      if (!fresh.exists) return false;
      const current = fresh.data() || {};
      const dueAt = current.nextReminderAt instanceof Timestamp
        ? current.nextReminderAt.toMillis()
        : 0;
      if (current.status !== 'unread' || dueAt > Date.now()) return false;
      tx.update(receipt.ref, {
        reminderCount: nextCount,
        lastReminderAt: FieldValue.serverTimestamp(),
        nextReminderAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000)
      });
      return true;
    });
    if (!claimed) continue;
    const eventId = 'chat-reminder-' + receipt.id + '-' + nextCount;
    const queueRef = db.collection('pushQueue').doc(eventId);
    try {
      await queueRef.create({
        title: String(data.authorName || 'Новое сообщение'),
        body: String(data.preview || 'В общем чате есть непрочитанное сообщение.'),
        authorId: String(data.authorId || ''),
        orderId: '',
        target: 'chat',
        category: 'chat',
        recipientUserId: String(data.recipientUserId || ''),
        isMention: false,
        isReply: data.isReply === true,
        forceAll: false,
        orderVersion: '',
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + 60000,
        sentAt: null,
        reminderForMessageId: String(data.messageId || '')
      });
    } catch (error) {
      if (error.code !== 6 && error.code !== 'already-exists') throw error;
      logger.info('Chat reminder queue event already exists', { eventId });
    }
  }
});

exports.checkBuybackDeadlines = onSchedule({
  schedule: 'every day 09:00',
  timeZone: 'Europe/Kyiv',
  retryCount: 2
}, async () => {
  const snap = await db.collection('buybackItems').where('status', '==', 'active').get();
  const now = new Date();
  const kyivParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  const kyivDateKey = `${kyivParts.year}-${kyivParts.month}-${kyivParts.day}`;
  const todayUtc = Date.parse(`${kyivDateKey}T00:00:00Z`);
  const milestones = {
    3: { title: 'Перекупной товар залежался', body: article => `Артикул ${article}: товар находится на складе уже 3 дня. Проверьте дальнейшие действия.` },
    6: { title: 'Внимание: подходит срок возврата', body: article => `Артикул ${article}: прошло 6 из 14 дней. Срок возврата приближается — пора принять решение.` },
    10: { title: 'КРИТИЧЕСКИЙ СРОК ВОЗВРАТА', body: article => `Артикул ${article}: прошло 10 из 14 дней. До окончания срока осталось 4 дня — срочно проверьте возврат!` }
  };
  for (const itemDoc of snap.docs) {
    const data = itemDoc.data() || {};
    const receivedAt = String(data.receivedAt || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) continue;
    const receivedUtc = Date.parse(`${receivedAt}T00:00:00Z`);
    if (!Number.isFinite(receivedUtc)) continue;
    const elapsed = Math.floor((todayUtc - receivedUtc) / 86400000);
    if (elapsed >= 14) await itemDoc.ref.update({ status: 'expired', updatedAt: FieldValue.serverTimestamp() });
    const sent = Array.isArray(data.sentMilestones) ? data.sentMilestones : [];
    const due = Object.keys(milestones).map(Number).filter(day => elapsed >= day && !sent.includes(day));
    for (const day of due) {
      const milestone = milestones[day];
      const eventId = 'buyback_' + itemDoc.id + '_' + day;
      await db.collection('pushQueue').doc(eventId).set({
        title: milestone.title,
        body: milestone.body(String(data.article || 'без артикула')) + ' Количество: ' + String(data.quantity || 1) + '.',
        authorId: 'system',
        orderId: '',
        target: 'site',
        category: 'orders',
        recipientUserId: '',
        createdAt: new Date().toISOString(),
        sentAt: null,
        buybackItemId: itemDoc.id
      }, { merge: true });
      await itemDoc.ref.update({ sentMilestones: FieldValue.arrayUnion(day), updatedAt: FieldValue.serverTimestamp() });
    }
  }
});


// Read-only bridge to Warehouse Map. The function's runtime service account must be
// granted read-only access to the map project's Realtime Database via Google Cloud IAM.
// Never place a service-account key in source code or browser assets.
const { getAuth } = require('firebase-admin/auth');
const { applicationDefault } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

// Use the Cloud Function's runtime service account via Application Default
// Credentials. Grant that identity read-only Realtime Database IAM access in
// the Warehouse Map project; no long-lived service-account key is required.
let warehouseMapApp;
function getWarehouseMapApp() {
  if (!warehouseMapApp) {
    warehouseMapApp = initializeApp({
      credential: applicationDefault(),
      databaseURL: 'https://warehouse-map-b6ed6-default-rtdb.europe-west1.firebasedatabase.app'
    }, 'warehouse-map-reader');
  }
  return warehouseMapApp;
}

const WAREHOUSE_MAP_ALLOWED_ORIGINS = new Set([
  'https://hlebish.github.io',
  'https://localhost',
  'capacitor://localhost'
]);

const { normalizeMapArticle, lookupArticleInMap } = require('./warehouse-map-lookup');

exports.lookupWarehouseMapAddress = onRequest(
  { memory: '256MiB', timeoutSeconds: 30, maxInstances: 5, invoker: 'public' },
  async (req, res) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('Vary', 'Origin');

    const origin = String(req.get('origin') || '');
    if (origin && WAREHOUSE_MAP_ALLOWED_ORIGINS.has(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
      if (origin && !WAREHOUSE_MAP_ALLOWED_ORIGINS.has(origin)) {
        return res.status(403).json({ ok: false, error: 'Origin not allowed' });
      }
      return res.status(204).send('');
    }
    if (origin && !WAREHOUSE_MAP_ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({ ok: false, error: 'Origin not allowed' });
    }
    if (req.method !== 'POST') {
      res.set('Allow', 'POST, OPTIONS');
      return res.status(405).json({ ok: false, error: 'POST required' });
    }

    try {
      const rawBodySize = req.rawBody?.length;
      if (typeof rawBodySize === 'number' && rawBodySize > 16 * 1024) {
        return res.status(413).json({ ok: false, error: 'Request too large' });
      }

      logger.info('Warehouse Map lookup: request accepted');
      const authorization = String(req.get('authorization') || '');
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match) return res.status(401).json({ ok: false, error: 'Authentication required' });

      let decoded;
      try {
        decoded = await getAuth().verifyIdToken(match[1], true);
        logger.info('Warehouse Map lookup: token verified');
      } catch (error) {
        logger.error('Warehouse Map lookup: token verification failed', {
          error: String(error?.message || error)
        });
        return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
      }

      const userSnap = await db.collection('users').doc(decoded.uid).get();
      logger.info('Warehouse Map lookup: warehouse user checked', { exists: userSnap.exists });
      if (!userSnap.exists || userSnap.data()?.active !== true) {
        return res.status(403).json({ ok: false, error: 'Active warehouse account required' });
      }

      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body : {};
      const rawArticles = Array.isArray(body.articles) ? body.articles : [body.article];
      if (!rawArticles.length || rawArticles.length > 100) {
        return res.status(400).json({ ok: false, error: 'Provide between 1 and 100 article codes' });
      }

      const articles = [];
      const seen = new Set();
      for (const raw of rawArticles) {
        const article = String(raw || '').trim();
        const normalized = normalizeMapArticle(article);
        if (!article || article.length > 120 || !normalized || normalized.length > 120) {
          return res.status(400).json({ ok: false, error: 'Each article must be a non-empty code of at most 120 characters' });
        }
        if (!seen.has(normalized)) {
          seen.add(normalized);
          articles.push({ original: article, normalized });
        }
      }

      // Only read the storage cells and unaddressed-item list. History, metadata,
      // undo data, and write paths are deliberately not exposed by this API.
      logger.info('Warehouse Map lookup: starting Realtime Database reads', {
        articleCount: articles.length
      });
      const mapRoot = getDatabase(getWarehouseMapApp()).ref('warehouse');
      const [cellsSnapshot, unaddressedSnapshot] = await Promise.all([
        mapRoot.child('cells').get(),
        mapRoot.child('unaddressed').get()
      ]);
      logger.info('Warehouse Map lookup: Realtime Database reads completed', {
        cellsExists: cellsSnapshot.exists(),
        unaddressedExists: unaddressedSnapshot.exists()
      });
      const cells = cellsSnapshot.val() || {};
      const unaddressed = unaddressedSnapshot.val() || {};
      const results = articles.map(item => {
        const found = lookupArticleInMap(cells, unaddressed, item.normalized);
        return { article: item.original, locations: found.locations, unaddressed: found.unaddressed };
      });

      return res.status(200).json({ ok: true, results });
    } catch (error) {
      logger.error('Warehouse Map lookup failed', {
        error: String(error?.message || error)
      });
      return res.status(503).json({ ok: false, error: 'Warehouse Map lookup temporarily unavailable' });
    }
  }
);


// Admin-only temporary password reset. Password changes are performed server-side
// with the Admin SDK; never expose privileged credentials in browser code.
exports.setStaffTemporaryPassword = onRequest(
  { memory: '256MiB', timeoutSeconds: 30, maxInstances: 5, invoker: 'public' },
  async (req, res) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('Vary', 'Origin');
    const allowedOrigins = new Set(['https://hlebish.github.io', 'https://localhost', 'capacitor://localhost']);
    const origin = String(req.get('origin') || '');
    if (origin && !allowedOrigins.has(origin)) {
      return res.status(403).json({ ok: false, error: 'Origin not allowed' });
    }
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST required' });

    try {
      const authorization = String(req.get('authorization') || '');
      const match = authorization.match(/^Bearer (.+)$/i);
      if (!match) return res.status(401).json({ ok: false, error: 'Authentication required' });

      const { getAuth } = require('firebase-admin/auth');
      const decoded = await getAuth().verifyIdToken(match[1], true);
      const actorSnap = await db.collection('users').doc(decoded.uid).get();
      const actor = actorSnap.data() || {};
      if (!actorSnap.exists || actor.active !== true || !(actor.admin === true || actor.role === 'director')) {
        return res.status(403).json({ ok: false, error: 'Administrator permission required' });
      }

      const uid = String(req.body?.uid || '').trim();
      if (!uid || uid.length > 128) return res.status(400).json({ ok: false, error: 'Valid employee uid required' });
      if (uid === decoded.uid) return res.status(400).json({ ok: false, error: 'You cannot reset your own password here' });

      const targetSnap = await db.collection('users').doc(uid).get();
      if (!targetSnap.exists) return res.status(404).json({ ok: false, error: 'Employee profile not found' });
      if (targetSnap.data()?.active !== true) return res.status(400).json({ ok: false, error: 'Employee account is disabled' });

      await getAuth().updateUser(uid, { password: '111111' });
      logger.info('Temporary staff password set by administrator', { actorUid: decoded.uid, targetUid: uid });
      return res.status(200).json({ ok: true });
    } catch (error) {
      logger.error('Temporary staff password reset failed', { error: String(error?.message || error) });
      const code = String(error?.code || '');
      if (code === 'auth/id-token-revoked' || code === 'auth/invalid-id-token' || code === 'auth/argument-error') {
        return res.status(401).json({ ok: false, error: 'Session expired; sign in again' });
      }
      if (code === 'auth/user-not-found') return res.status(404).json({ ok: false, error: 'Authentication account not found' });
      return res.status(500).json({ ok: false, error: 'Password reset failed' });
    }
  }
);
