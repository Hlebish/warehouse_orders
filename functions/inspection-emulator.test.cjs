const assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const {createInspectionHandlers}=require('./inspection-items');
async function main(){
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Use the Firebase emulators');
 const {initializeTestEnvironment,assertSucceeds,assertFails}=await import('@firebase/rules-unit-testing');
 const {collection,doc,getDocs,query,where,setDoc}=await import('firebase/firestore');
 const {ref,uploadBytes,getBytes}=await import('firebase/storage');
 const projectId='demo-warehouse-inspections',app=initializeApp({projectId}),db=getFirestore(app),handlers=createInspectionHandlers({db,FieldValue,HttpsError});
 const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8089,rules:fs.readFileSync('../firestore.rules','utf8')},storage:{host:'127.0.0.1',port:9199,rules:fs.readFileSync('../storage.rules','utf8')}});
 const call=(uid,action,id,extra={})=>handlers.manage({auth:uid?{uid}:null,data:{action,id,...extra}});
 const reject=async(p,code)=>assert.rejects(p,error=>error.code===code);
 try{
  for(const role of ['warehouse','manager','accountant','chief_accountant','director'])await db.doc('users/'+role).set({active:true,role,displayName:role,admin:false});
  await db.doc('users/inactive').set({active:false,role:'warehouse'});
  for(const role of ['warehouse','manager','accountant','chief_accountant','director']){
   await call(role,'create','item-'+role,{article:'AP-'+role});
   await assertSucceeds(getDocs(query(collection(env.authenticatedContext(role).firestore(),'inspectionItems'),where('status','in',['pending','checked']))));
   await assertFails(setDoc(doc(env.authenticatedContext(role).firestore(),'inspectionItems','forged'),{article:'fake',status:'checked'}));
  }
  await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(),'inspectionItems')));
  await assertFails(getDocs(collection(env.authenticatedContext('inactive').firestore(),'inspectionItems')));
  await reject(call('inactive','create','inactive',{article:'A'}),'permission-denied');
  await reject(call('manager','create','empty',{article:' '}),'invalid-argument');
  await call('manager','create','inspect',{article:'APMA2506',client:'Иван Петренко'});await call('manager','create','inspect',{article:'APMA2506',client:'Иван Петренко'});
  await reject(call('manager','check','inspect'),'permission-denied');await call('warehouse','check','inspect');
  assert.equal((await db.doc('inspectionItems/inspect').get()).data().status,'checked');
  const storagePath='inspectionItems/inspect/warehouse/defect-1/0.jpg',storage=env.authenticatedContext('warehouse').storage();
  await assertSucceeds(uploadBytes(ref(storage,storagePath),new Uint8Array([1,2,3]),{contentType:'image/jpeg'}));
  await assertFails(uploadBytes(ref(env.authenticatedContext('manager').storage(),'inspectionItems/inspect/manager/fake/0.jpg'),new Uint8Array([1]),{contentType:'image/jpeg'}));
  await assertFails(uploadBytes(ref(storage,'inspectionItems/inspect/warehouse/defect-1/5.jpg'),new Uint8Array([1]),{contentType:'image/jpeg'}));
  await assertFails(uploadBytes(ref(storage,'inspectionItems/inspect/warehouse/defect-2/0.jpg'),new Uint8Array([1]),{contentType:'text/plain'}));
  await assertSucceeds(getBytes(ref(env.authenticatedContext('manager').storage(),storagePath)));
  const photo='https://firebasestorage.googleapis.com/v0/b/sklad-18f38.firebasestorage.app/o/'+encodeURIComponent(storagePath)+'?alt=media&token=fixture';
  await call('warehouse','reportDefect','inspect',{defectId:'defect-1',text:'Вмятина',photos:[photo]});
  await reject(call('warehouse','check','inspect'),'failed-precondition');await reject(call('warehouse','decideDefect','inspect',{defectId:'defect-1',decision:'approve'}),'permission-denied');
  await reject(call('manager','reportDefect','inspect',{defectId:'fake',text:'x',photos:[]}),'permission-denied');
  await call('accountant','decideDefect','inspect',{defectId:'defect-1',decision:'approve'});await call('warehouse','check','inspect');
  await call('manager','create','other-client',{article:'APMA2506',client:'Мария'});
  const orderRef=db.doc('orders/new-order');await orderRef.set({number:'QA-1',client:'Иван Петренко',status:'Создан',articles:[{article:'APMA2506 Бампер',quantity:1}]});
  await handlers.syncOrder(await orderRef.get(),'event-created');await handlers.syncOrder(await orderRef.get(),'event-created');
  assert.equal((await db.doc('inspectionItems/inspect').get()).data().status,'ordered');assert.equal((await db.doc('inspectionItems/other-client').get()).data().status,'pending');
  const entries=await orderRef.collection('entries').get();assert.equal(entries.size,1);assert.deepEqual(entries.docs[0].data().photos,[photo]);assert.equal(entries.docs[0].data().decision,'Подтверждён');
  await call('manager','create','with-defect',{article:'APNEW1001'});await call('warehouse','reportDefect','with-defect',{defectId:'pending-defect',text:'Царапина',photos:[]});
  const defectOrder=db.doc('orders/defect-order');await defectOrder.set({number:'QA-2',status:'Создан',articles:[{article:'APNEW1001',quantity:1}]});await handlers.syncOrder(await defectOrder.get(),'defect-event');
  assert.equal((await defectOrder.get()).data().status,'Дефект');assert.equal((await defectOrder.collection('entries').get()).size,1);
  // A request added after the order must survive delayed creation delivery.
  const oldOrder=db.doc('orders/old');await oldOrder.set({number:'OLD',status:'Создан',articles:[{article:'APLATE1',quantity:1}]});const oldSnapshot=await oldOrder.get();
  await call('manager','create','later',{article:'APLATE1'});await handlers.syncOrder(oldSnapshot,'late-event');assert.equal((await db.doc('inspectionItems/later').get()).data().status,'pending');
  // More than one transaction batch must never consume beyond order quantity.
  const seed=db.batch();for(let i=0;i<50;i++)seed.set(db.doc('inspectionItems/bulk-'+i),{article:'BULK100',articleKey:'BULK100',client:'',clientId:'',clientKey:'',status:'checked',createdAt:Timestamp.fromMillis(Date.now()-10000),defects:[]});await seed.commit();
  const bulk=db.doc('orders/bulk');await bulk.set({status:'Создан',articles:[{article:'BULK100',quantity:25}]});await handlers.syncOrder(await bulk.get(),'bulk-event');
  assert.equal((await db.collection('inspectionItems').where('orderId','==','bulk').get()).size,25);
  await reject(call('warehouse','check','with-defect'),'failed-precondition');
  console.log('PASS employee roles, read-only client rules, photo permissions, defect decisions, order transfer, retry safety and 25-item quantity across batches');
 }finally{await env.cleanup();await deleteApp(app);}
}main().catch(error=>{console.error(error);process.exitCode=1;});
