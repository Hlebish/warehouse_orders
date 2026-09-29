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
    const { title, body, authorId } = event.data();
    const users = await db.collection('users').where('active', '==', true).get();
    const tokenDocs = [];
    for (const user of users.docs) {
      if (user.id === authorId) continue;
      const tokens = await user.ref.collection('pushTokens').get();
      tokenDocs.push(...tokens.docs);
    }
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
        if (!result.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(result.error?.code)) removals.push(group[index].ref.delete());
      });
      await Promise.all(removals);
    }
    await event.ref.update({ sentAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`Processed ${event.id}; devices=${tokenDocs.length}`);
  }
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
