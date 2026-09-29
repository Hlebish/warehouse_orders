const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();

const db = getFirestore();
const auth = getAuth();
const normalizedEmail = value => String(value || '').trim().toLowerCase();

async function requireUserManager(uid) {
  const snapshot = await db.collection('users').doc(uid).get();
  const profile = snapshot.data();
  if (!profile || profile.active !== true || !(profile.admin === true || profile.role === 'director')) {
    throw new HttpsError('permission-denied', 'Only an active administrator can manage accounts.');
  }
  return profile;
}

exports.provisionStaff = onCall({ region: 'europe-west1', cors: ['https://hlebish.github.io'] }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requireUserManager(request.auth.uid);

  const displayName = String(request.data?.displayName || '').trim();
  const email = normalizedEmail(request.data?.email);
  const role = String(request.data?.role || '');
  if (!displayName || !email.includes('@') || !['warehouse', 'manager', 'director'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Name, valid email and role are required.');
  }

  await db.collection('pendingStaff').doc(email).set({ displayName, email, role, createdAt: new Date().toISOString() });
  return { email };
});

exports.claimStaffProfile = onCall({ region: 'europe-west1', cors: ['https://hlebish.github.io'] }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in through Google first.');
  const email = normalizedEmail(request.auth.token.email);
  if (!email || request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'A verified Google email is required.');
  }

  const userRef = db.collection('users').doc(request.auth.uid);
  if ((await userRef.get()).exists) return { claimed: true };

  const inviteRef = db.collection('pendingStaff').doc(email);
  const invite = await inviteRef.get();
  if (invite.exists) {
    const data = invite.data();
    await userRef.set({ displayName: data.displayName, email, role: data.role, active: true, admin: false });
    await inviteRef.delete();
    return { claimed: true };
  }

  const allProfiles = await db.collection('users').get();
  const previous = allProfiles.docs.find(profile => normalizedEmail(profile.data().email) === email);
  if (!previous) return { claimed: false };
  await userRef.set(previous.data());
  await previous.ref.delete();
  return { claimed: true };
});

exports.deleteStaffAccount = onCall({ region: 'europe-west1', cors: ['https://hlebish.github.io'] }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  await requireUserManager(request.auth.uid);

  const email = normalizedEmail(request.data?.email);
  if (!email || !email.includes('@')) throw new HttpsError('invalid-argument', 'A valid email is required.');
  if (normalizedEmail(request.auth.token.email) === email) {
    throw new HttpsError('failed-precondition', 'You cannot delete the account you are currently using.');
  }

  let authUser = null;
  try {
    authUser = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }
  if (authUser?.uid === request.auth.uid) {
    throw new HttpsError('failed-precondition', 'You cannot delete the account you are currently using.');
  }

  const allProfiles = await db.collection('users').get();
  const matchingProfiles = allProfiles.docs.filter(profile => normalizedEmail(profile.data().email) === email);
  if (authUser) await auth.deleteUser(authUser.uid);
  const batch = db.batch();
  for (const profile of matchingProfiles) batch.delete(profile.ref);
  batch.delete(db.collection('pendingStaff').doc(email));
  await batch.commit();
  return { email, deleted: true };
});
