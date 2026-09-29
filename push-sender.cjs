const admin = require('firebase-admin');

let credential;
try {
  credential = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
  if (credential.type !== 'service_account' || !credential.project_id || !credential.client_email || !credential.private_key) throw new Error();
} catch {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain the Firebase service-account JSON key.');
}
admin.initializeApp({ credential: admin.credential.cert(credential), projectId: 'sklad-18f38' });
const db = admin.firestore();
const messaging = admin.messaging();
const siteUrl = 'https://hlebish.github.io/warehouse_orders/';

async function main() {
  const batch = await db.collection('pushQueue').where('sentAt', '==', null).limit(100).get();
  for (const event of batch.docs) {
    const { title, body } = event.data();
    const users = await db.collection('users').where('active', '==', true).get();
    const tokenDocs = [];
    for (const user of users.docs) {
      const tokens = await user.ref.collection('pushTokens').get();
      tokenDocs.push(...tokens.docs);
    }
    if (tokenDocs.length === 0) {
      await event.ref.update({ sentAt: admin.firestore.FieldValue.serverTimestamp(), deliveryStatus: 'no_devices' });
      console.log(`Processed ${event.id}; devices=0; status=no_devices`);
      continue;
    }
    let accepted = 0;
    let failed = 0;
    const failuresByCode = new Map();
    for (let i = 0; i < tokenDocs.length; i += 500) {
      const group = tokenDocs.slice(i, i + 500);
      if (!group.length) continue;
      const response = await messaging.sendEachForMulticast({
        tokens: group.map(doc => doc.get('token')),
        notification: { title, body },
        webpush: { fcmOptions: { link: siteUrl }, notification: { icon: `${siteUrl}amp-logo.png`, badge: `${siteUrl}amp-logo.png` } }
      });
      const removals = [];
      response.responses.forEach((result, index) => {
        if (result.success) {
          accepted++;
          return;
        }
        failed++;
        const code = result.error?.code || 'unknown';
        failuresByCode.set(code, (failuresByCode.get(code) || 0) + 1);
        if (!result.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(result.error?.code)) removals.push(group[index].ref.delete());
      });
      await Promise.all(removals);
    }
    if (accepted === 0) {
      const reasons = [...failuresByCode].map(([code, count]) => `${code}:${count}`).join(', ');
      console.error(`Delivery failed for ${event.id}; accepted=0; failed=${failed}; errors=${reasons}; event remains queued for retry`);
      throw new Error(`FCM rejected all ${failed} device deliveries for ${event.id}`);
    }
    await event.ref.update({
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      deliveryStatus: failed === 0 ? 'accepted' : 'partially_accepted',
      acceptedCount: accepted,
      failedCount: failed,
      failureCodes: Object.fromEntries(failuresByCode)
    });
    const reasons = failuresByCode.size ? `; errors=${[...failuresByCode].map(([code, count]) => `${code}:${count}`).join(', ')}` : '';
    console.log(`Processed ${event.id}; devices=${tokenDocs.length}; accepted=${accepted}; failed=${failed}${reasons}`);
  }
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
