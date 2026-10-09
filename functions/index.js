const { onDocumentCreated } = require('firebase-functions/v2/firestore');
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
  const users = recipientUserId
    ? await db.collection('users').where('active', '==', true).where('__name__', '==', recipientUserId).get()
    : await db.collection('users').where('active', '==', true).get();

  const batch = db.batch();
  let count = 0;

  for (const user of users.docs) {
    const profile = user.data() || {};
    if (!recipientUserId && user.id === authorId && profile.extraPhoneNotifications !== true) continue;
    const settings = profile.notificationSettings || {};
    if (settings[category] === false) continue;

    const notificationRef = user.ref.collection('notifications').doc(eventId);
    batch.set(notificationRef, {
      title: String(data.title || 'Заказы · Склад').slice(0, 120),
      message: String(data.body || 'Новое изменение.').slice(0, 500),
      body: String(data.body || 'Новое изменение.').slice(0, 500),
      orderId: String(data.orderId || ''),
      target: data.target === 'chat' ? 'chat' : 'site',
      category,
      eventId,
      createdAt: FieldValue.serverTimestamp(),
      read: false
    }, { merge: true });
    count++;
  }

  if (count) await batch.commit();
  return count;
}

async function collectTokens(category='orders', recipientUserId='', authorId='') {
  const users = await db.collection('users').where('active', '==', true).get();
  const tokenGroups = await Promise.all(
    users.docs.map(user => user.ref.collection('pushTokens').get())
  );

  const byInstallation = new Map();
  const byToken = new Map();

  for (let i = 0; i < tokenGroups.length; i++) {
    const user = users.docs[i];

    if (recipientUserId && user.id !== recipientUserId) continue;

    const profile = user.data() || {};
    // Own broadcast events are delivered to all registered devices only when opted in.
    if (!recipientUserId && authorId && user.id === authorId && profile.extraPhoneNotifications !== true) continue;

    const settings = profile.notificationSettings || {};
    if (settings[category] === false) continue;

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

        if (!previous || item.updatedAt >= previous.updatedAt) {
          byInstallation.set(key, item);
        }
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

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'POST required' });
    }

    const apiKey = String(req.get('x-1c-api-key') || '');
    if (!apiKey || apiKey !== oneCImportKey.value()) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const number = String(body.number || '').trim();
      const client = String(body.client || '').trim();
      const sourceId = String(body.externalId || number).trim();
      const articles = Array.isArray(body.articles)
        ? body.articles.map(item => ({
            article: String(item?.article || '').trim(),
            quantity: Math.max(1, Number(item?.quantity) || 1)
          })).filter(item => item.article)
        : [];

      if (!number) return res.status(400).json({ ok: false, error: 'number is required' });
      if (!articles.length) return res.status(400).json({ ok: false, error: 'articles are required' });

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
        sourceType: String(body.sourceType || 'Заказ покупателя')
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
          sourceType: String(body.sourceType || 'Заказ покупателя'),
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
    const tokenDocs = await collectTokens(category, recipientUserId, String(data.authorId || ''));

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
            category
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
