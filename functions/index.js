const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2/options');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

setGlobalOptions({
  region: 'europe-west1',
  memory: '256MiB',
  timeoutSeconds: 60,
  maxInstances: 1
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

async function collectTokens() {
  const users = await db.collection('users').where('active', '==', true).get();
  const tokenGroups = await Promise.all(
    users.docs.map(user => user.ref.collection('pushTokens').get())
  );

  // Do not send the same push twice to one app installation.
  const byInstallation = new Map();
  const byToken = new Map();

  for (let i = 0; i < tokenGroups.length; i++) {
    const user = users.docs[i];

    for (const tokenDoc of tokenGroups[i].docs) {
      const data = tokenDoc.data() || {};
      const token = String(data.token || '');
      if (!token) continue;

      const item = {
        ref: tokenDoc.ref,
        token,
        installationId: String(data.installationId || ''),
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

exports.sendWarehousePush = onDocumentCreated('pushQueue/{eventId}', async event => {
  const snapshot = event.data;
  if (!snapshot) return;

  const claimed = await claimEvent(snapshot.ref);
  if (!claimed) return;

  const data = snapshot.data() || {};
  const title = String(data.title || 'Заказы · Склад').slice(0, 120);
  const body = String(data.body || 'Новое изменение в заказе.').slice(0, 500);
  const eventId = event.params.eventId;
  const siteUrl = 'https://hlebish.github.io/warehouse_orders/';

  try {
    const tokenDocs = await collectTokens();

    if (!tokenDocs.length) {
      await markDone(snapshot.ref, {
        deliveryStatus: 'no_devices',
        acceptedCount: 0,
        failedCount: 0
      });
      logger.info('Push skipped: no registered devices', { eventId });
      return;
    }

    let accepted = 0;
    let failed = 0;
    const failureCodes = new Map();

    for (let i = 0; i < tokenDocs.length; i += 500) {
      const group = tokenDocs.slice(i, i + 500);

      const response = await messaging.sendEachForMulticast({
        tokens: group.map(item => item.token),
        notification: {
          title,
          body
        },
        data: {
          eventId,
          link: siteUrl
        },
        webpush: {
          headers: {
            Urgency: 'high',
            TTL: '86400'
          },
          fcmOptions: {
            link: siteUrl
          }
        }
      });

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
          removals.push(group[index].ref.delete());
        }
      });

      await Promise.all(removals);
    }

    const failures = Object.fromEntries(failureCodes);

    if (accepted > 0) {
      await markDone(snapshot.ref, {
        deliveryStatus: failed ? 'partially_accepted' : 'accepted',
        acceptedCount: accepted,
        failedCount: failed,
        failureCodes: failures
      });
      logger.info('Push sent', { eventId, accepted, failed });
      return;
    }

    const onlyInvalidTokens =
      failed > 0 &&
      [...failureCodes.keys()].every(code => INVALID_TOKEN_CODES.has(code));

    if (onlyInvalidTokens) {
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
