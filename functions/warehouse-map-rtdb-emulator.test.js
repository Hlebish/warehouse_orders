const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const projectId = 'demo-warehouse-map-rules';
const databaseNamespace = `${projectId}-default-rtdb`;
const databaseUrl = `http://127.0.0.1:9000?ns=${databaseNamespace}`;
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
async function seedEmulator() {
 const seedApp = initializeApp({projectId,databaseURL:databaseUrl},'warehouse-map-rules-seed');
 try { await getDatabase(seedApp).ref('warehouse').set({
  cells:{S1:{A:{1:'APHD4307 — капот Honda'}}},
  unaddressed:{testItem:{article:'APBM1203'}},
  history:{privateTestEvent:{description:'private'}},
  special:{resale:'private'},itemMeta:{privateItem:{note:'private'}},
  unaddressedTrash:{privateTrash:{article:'APXX0000'}},undo:{lastImport:{description:'private'}}
 }); } finally { await deleteApp(seedApp); }
}
test('synthetic Warehouse Map reader can only read cells and unaddressed items, and cannot write',async t=>{
 assert.ok(process.env.FIREBASE_DATABASE_EMULATOR_HOST,'Run through Firebase Database Emulator');
 const rr=await fetch(`http://${emulatorHost}/.settings/rules.json?ns=${databaseNamespace}`,{headers:{Authorization:'Bearer owner'}});
 assert.equal(rr.ok,true,'Could not inspect emulator rules');
 const rules=await rr.json();
 assert.equal(rules?.rules?.warehouse?.['.read'],"auth != null && auth.uid != 'warehouse-map-reader'");
 assert.equal(rules?.rules?.warehouse?.cells?.['.read'],'auth != null');
 assert.equal(rules?.rules?.warehouse?.unaddressed?.['.read'],'auth != null');
 await seedEmulator();
 const app=initializeApp({projectId,databaseURL:databaseUrl,databaseAuthVariableOverride:{uid:'warehouse-map-reader'}},'warehouse-map-rules-test');
 t.after(async()=>deleteApp(app));
 const db=getDatabase(app);
 assert.equal((await db.ref('warehouse/cells/S1/A/1').get()).val(),'APHD4307 — капот Honda');
 assert.equal((await db.ref('warehouse/unaddressed/testItem/article').get()).val(),'APBM1203');
 await assert.rejects(db.ref('warehouse/cells/S1/A/1').set('MUST NOT WRITE'),e=>/permission_denied|Permission denied/i.test(String(e?.message||e)));
 for(const path of ['warehouse','warehouse/history/privateTestEvent/description','warehouse/special/resale','warehouse/itemMeta/privateItem/note','warehouse/unaddressedTrash/privateTrash/article','warehouse/undo/lastImport/description']){
  await assert.rejects(db.ref(path).get(),e=>/permission_denied|Permission denied/i.test(String(e?.message||e)),`Unexpected read: ${path}`);
 }
});