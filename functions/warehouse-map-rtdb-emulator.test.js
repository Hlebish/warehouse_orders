const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

const projectId = 'demo-warehouse-map-rules';
// Firebase Database Emulator names its default instance <project-id>-default-rtdb.
const databaseNamespace = `${projectId}-default-rtdb`;
const databaseUrl = `http://127.0.0.1:9000?ns=${databaseNamespace}`;
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';

async function seedEmulator() {
  // Use a separate Admin SDK app without databaseAuthVariableOverride to seed
  // fixture data; the synthetic identity used below must still obey RTDB rules.
  const seedApp = initializeApp({ projectId, databaseURL: databaseUrl }, 'warehouse-map-rules-seed');
  try {
    await getDatabase(seedApp).ref('warehouse').set({
      cells: { S1: { A: { 1: 'APHD4307 — капот Honda' } } },
      unaddressed: { testItem: { article: 'APBM1203' } },
      history: { privateTestEvent: { description: 'rules-scope-probe' } }
    });
  } finally {
    await deleteApp(seedApp);
  }
}

test('Warehouse Map auth override reads allowed paths, denies writes, and exposes current broad read scope', async t => {
  assert.ok(process.env.FIREBASE_DATABASE_EMULATOR_HOST,
    'Run this test through the Firebase Realtime Database emulator script');

  const rulesResponse = await fetch(
    `http://${emulatorHost}/.settings/rules.json?ns=${databaseNamespace}`,
    { headers: { Authorization: 'Bearer owner' } }
  );
  assert.equal(rulesResponse.ok, true, 'Could not inspect emulator rules');
  const activeRules = await rulesResponse.json();
  assert.equal(activeRules?.rules?.warehouse?.['.read'], 'auth != null',
    'Expected Warehouse Map rules were not loaded into the default RTDB namespace');
  assert.equal(typeof activeRules?.rules?.['.write'], 'undefined',
    'Unexpected root-level write rule would invalidate this test');

  await seedEmulator();

  const app = initializeApp({
    projectId,
    databaseURL: databaseUrl,
    databaseAuthVariableOverride: { uid: 'warehouse-map-reader' }
  }, 'warehouse-map-rules-test');

  t.after(async () => deleteApp(app));

  const db = getDatabase(app);
  const cell = await db.ref('warehouse/cells/S1/A/1').get();
  assert.equal(cell.val(), 'APHD4307 — капот Honda');

  const unaddressed = await db.ref('warehouse/unaddressed/testItem/article').get();
  assert.equal(unaddressed.val(), 'APBM1203');

  await assert.rejects(
    db.ref('warehouse/cells/S1/A/1').set('MUST NOT WRITE'),
    error => /permission_denied|Permission denied/i.test(String(error?.message || error))
  );

  // Documents the existing broad parent .read rule; this must be reconsidered
  // before production deployment because it permits history reads too.
  const history = await db.ref('warehouse/history/privateTestEvent/description').get();
  assert.equal(history.val(), 'rules-scope-probe');
});
