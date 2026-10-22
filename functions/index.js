const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2/options');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();
const messaging = getMessaging();
const oneCImportKey = defineSecret('ONE_C_API_KEY');
const warehouseMapServiceAccount = defineSecret('WAREHOUSE_MAP_SERVICE_ACCOUNT');

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
  const category = ['orders', 'chat', 'replies', 'likes'].includes(data.category)
    ? data.category
    : (data.target === 'chat' ? 'chat' : 'orders');
  const recipientUserId = String(data.recipientUserId || '');
  const authorId = String(data.authorId || '');
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
    if (!recipientUserId && user.id === authorId && profile.extraPhoneNotifications !== true) continue;
    const settings = profile.notificationSettings || {};
    if (settings[category] === false && !data.buybackItemId) continue;

    const notificationRef = user.ref.collection('notifications').doc(eventId);
    batch.set(notificationRef, {
      title: String(data.title || 'Заказы · Склад').slice(0, 120),
      message: String(data.body || 'Новое изменение.').slice(0, 500),
      body: String(data.body || 'Новое изменение.').slice(0, 500),
      orderId: String(data.orderId || ''),
      target: data.target === 'chat' ? 'chat' : 'site',
      category,
      isMention: data.isMention === true || data.isMention === 'true',
      isReply: data.isReply === true || data.isReply === 'true',
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

async function collectTokens(category='orders', recipientUserId='', authorId='', forceAll=false) {
  // Direct notifications should never enumerate every employee's devices.
  const users = recipientUserId
    ? await db.collection('users').doc(recipientUserId).get().then(user =>
        user.exists && user.data()?.active === true ? [user] : [])
    : (await db.collection('users').where('active', '==', true).get()).docs;

  const eligibleUsers = users.filter(user => {
    const profile = user.data() || {};
    if (!recipientUserId && authorId && user.id === authorId && profile.extraPhoneNotifications !== true) return false;
    return forceAll || (profile.notificationSettings || {})[category] !== false;
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

  return result;
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
      const existing = await orderRef.get();
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

      if (!existing.exists) {
        await orderRef.set(order);
      } else {
        await orderRef.update({
          number,
          client,
          articles,
          source: '1c',
          externalId: sourceId,
          sourceType,
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      logger.info('1C order imported', { number, sourceId, updated: existing.exists });
      return res.status(200).json({ ok: true, id: orderRef.id, number, updated: existing.exists });
    } catch (error) {
      logger.error('1C order import failed', { error: String(error?.message || error) });
      return res.status(500).json({ ok: false, error: 'Import failed' });
    }
  }
);

exports.sendWarehousePush = onDocumentCreated({ document: 'pushQueue/{eventId}', retry: true }, async event => {
  const snapshot = event.data;
  if (!snapshot) return;

  const claimed = await claimEvent(snapshot.ref);
  if (!claimed) return;

  const data = snapshot.data() || {};
  const title = String(data.title || 'Заказы · Склад').slice(0, 120);
  const body = String(data.body || 'Новое изменение в заказе.').slice(0, 500);
  const eventId = event.params.eventId;
  const siteUrl = 'https://hlebish.github.io/warehouse_orders/';
  const orderId = String(data.orderId || '');
  const target = data.target === 'chat' ? 'chat' : 'site';
  const category = ['orders', 'chat', 'replies', 'likes'].includes(data.category) ? data.category : (target === 'chat' ? 'chat' : 'orders');
  const recipientUserId = String(data.recipientUserId || '');
  // Start notification history immediately, but do not make push delivery wait for it.
  const historyPromise = createNotificationHistory(data, eventId).catch(error => {
    logger.error('Notification history write failed', {
      eventId,
      error: String(error?.message || error)
    });
  });
  const link = target === 'chat'
    ? `${siteUrl}?chat=1`
    : (orderId ? `${siteUrl}?order=${encodeURIComponent(orderId)}` : siteUrl);

  try {
    const tokenDocs = await collectTokens(category, recipientUserId, String(data.authorId || ''), Boolean(data.buybackItemId));

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

    let accepted = 0;
    let failed = 0;
    const failureCodes = new Map();

    for (let i = 0; i < tokenDocs.length; i += 500) {
      const group = tokenDocs.slice(i, i + 500);

      for (const platform of ['web', 'android']) {
        const platformGroup = group.filter(item => item.platform === platform);
        if (!platformGroup.length) continue;

        const baseMessage = {
          tokens: platformGroup.map(item => item.token),
          data: {
            title,
            body,
            eventId,
            link,
            orderId,
            target,
            category,
            isMention: String(data.isMention === true || data.isMention === 'true'),
            isReply: String(data.isReply === true || data.isReply === 'true')
          }
        };

        const message = platform === 'android'
          ? {
              ...baseMessage,
              android: {
                priority: 'high'
              }
            }
          : {
              ...baseMessage,
              webpush: {
                headers: {
                  Urgency: 'high',
                  TTL: '86400'
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


// Ежедневная проверка сроков перекупного товара. Отправляем каждую контрольную отметку один раз.
exports.checkBuybackDeadlines = onSchedule({
  schedule: 'every day 09:00',
  timeZone: 'Europe/Kyiv',
  retryCount: 2
}, async () => {
  const snap = await db.collection('buybackItems').where('status', '==', 'active').get();
  const now = new Date();
  const milestones = {
    3: { title: 'Перекупной товар залежался', body: article => `Артикул ${article}: товар находится на складе уже 3 дня. Проверьте дальнейшие действия.` },
    6: { title: 'Внимание: подходит срок возврата', body: article => `Артикул ${article}: прошло 6 из 14 дней. Срок возврата приближается — пора принять решение.` },
    10: { title: 'КРИТИЧЕСКИЙ СРОК ВОЗВРАТА', body: article => `Артикул ${article}: прошло 10 из 14 дней. До окончания срока осталось 4 дня — срочно проверьте возврат!` }
  };
  for (const itemDoc of snap.docs) {
    const data = itemDoc.data() || {};
    const received = new Date(String(data.receivedAt || '') + 'T00:00:00');
    if (Number.isNaN(received.getTime())) continue;
    const elapsed = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(received.getFullYear(), received.getMonth(), received.getDate())) / 86400000);
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
const { applicationDefault, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

// Initialize the cross-project RTDB app lazily. Keeping credential discovery and
// named-app initialization out of module loading lets Firebase CLI inspect the
// function backend without waiting on Application Default Credentials.
let warehouseMapApp;
function getWarehouseMapApp() {
  if (!warehouseMapApp) {
    // Use a dedicated service account created in the Warehouse Map project.
    // The JSON key is stored in Secret Manager, never committed to source.
    // databaseAuthVariableOverride ensures RTDB rules restrict this identity
    // to the explicitly permitted read-only paths.
    const serviceAccount = JSON.parse(warehouseMapServiceAccount.value());
    warehouseMapApp = initializeApp({
      credential: cert(serviceAccount),
      databaseURL: 'https://warehouse-map-b6ed6-default-rtdb.europe-west1.firebasedatabase.app',
      databaseAuthVariableOverride: { uid: 'warehouse-map-reader' }
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
  { memory: '256MiB', timeoutSeconds: 15, maxInstances: 5, invoker: 'public', secrets: [warehouseMapServiceAccount] },
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

      const authorization = String(req.get('authorization') || '');
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match) return res.status(401).json({ ok: false, error: 'Authentication required' });

      let decoded;
      try {
        decoded = await getAuth().verifyIdToken(match[1], true);
      } catch {
        return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
      }

      const userSnap = await db.collection('users').doc(decoded.uid).get();
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
      const mapRoot = getDatabase(getWarehouseMapApp()).ref('warehouse');
      const [cellsSnapshot, unaddressedSnapshot] = await Promise.all([
        mapRoot.child('cells').get(),
        mapRoot.child('unaddressed').get()
      ]);
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
