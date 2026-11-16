import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,updateDoc,serverTimestamp,arrayUnion,deleteField,collection,query,orderBy,limit,onSnapshot,writeBatch} from 'firebase/firestore';
import {ref,uploadBytes,getBytes,getMetadata,deleteObject} from 'firebase/storage';
import {readFileSync} from 'node:fs';
const env=await initializeTestEnvironment({projectId:'demo-warehouse-chat',firestore:{host:'127.0.0.1',port:8086,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')},storage:{host:'127.0.0.1',port:9196,rules:readFileSync(new URL('../storage.rules',import.meta.url),'utf8')}});
let checks=0;
const check=async(name,operation,allowed)=>{await(allowed?assertSucceeds(operation):assertFails(operation));checks++;console.log('PASS',name);};
const context=uid=>uid?env.authenticatedContext(uid):env.unauthenticatedContext();
const alice=context('alice'),bob=context('bob');
const path=(id,index=0,author='alice',thread='alice__bob')=>`directChats/${thread}/${author}/${id}/${index}.jpg`;
const message=(id,patch={})=>({text:'Сообщение',authorId:'alice',authorName:'Алиса',createdAt:serverTimestamp(),mentionUserIds:['bob'],notificationRecipientIds:['bob'],isUrgent:false,urgentAckBy:[],readBy:['alice'],...patch});
const create=(id,patch={},who=alice)=>setDoc(doc(who.firestore(),'directChats','alice__bob','messages',id),message(id,patch));
const messageRef=(who,id)=>doc(who.firestore(),'directChats','alice__bob','messages',id);
const messagesQuery=who=>query(collection(who.firestore(),'directChats','alice__bob','messages'),orderBy('createdAt','desc'),limit(100));
const observeReceipt=(who,id,expected)=>new Promise((resolve,reject)=>{
 let stop=()=>{};
 const timer=setTimeout(()=>{stop();reject(new Error('Timed out waiting for live receipt '+id));},10000);
 stop=onSnapshot(messagesQuery(who),snap=>{
  const value=snap.docs.find(item=>item.id===id)?.data();
  if(value&&!snap.metadata.hasPendingWrites&&Array.isArray(value.readBy)&&value.readBy.includes('bob')===expected){clearTimeout(timer);stop();resolve(value);}
 },error=>{clearTimeout(timer);stop();reject(error);});
});
try{
 await env.withSecurityRulesDisabled(async c=>{
  for(const uid of ['alice','bob','outsider','disabled','admin'])await setDoc(doc(c.firestore(),'users',uid),{active:uid!=='disabled',role:uid==='admin'?'director':'warehouse'});
  await setDoc(doc(c.firestore(),'directChats','alice__bob'),{participants:['alice','bob'],lastSenderId:'alice',lastMessage:'',createdAt:serverTimestamp()});
  await setDoc(doc(c.firestore(),'directChats','bob__outsider'),{participants:['bob','outsider'],lastSenderId:'bob',lastMessage:'',createdAt:serverTimestamp()});
 });
 await check('legacy text-only message',create('legacy'),true);
 await check('photo without caption',create('photo',{text:'',photos:[path('photo')]}),true);
 await check('caption and five private photos',create('five',{photos:Array.from({length:5},(_,i)=>path('five',i))}),true);
 await check('reject sixth photo',create('six',{photos:Array.from({length:6},(_,i)=>path('six',i))}),false);
 await check('reject empty message',create('empty',{text:'',photos:[]}),false);
 for(const [name,photos]of [['wrong thread',[path('foreign',0,'alice','bob__outsider')]],['wrong author',[path('foreign',0,'bob')]],['wrong message',[path('another')]],['external URL',['https://example.invalid/photo.jpg']],['invalid element',[42]],['wrong slot',[path('foreign',1)]]])await check(name,create('foreign',{photos}),false);
 await check('outsider cannot read message',getDoc(doc(context('outsider').firestore(),'directChats','alice__bob','messages','photo')),false);
 await check('admin outside the thread cannot read message',getDoc(doc(context('admin').firestore(),'directChats','alice__bob','messages','photo')),false);
 await check('recipient reads a photo message',getDoc(doc(bob.firestore(),'directChats','alice__bob','messages','photo')),true);
 for(const id of ['legacy','photo'])await check('recipient receipt '+id,updateDoc(doc(bob.firestore(),'directChats','alice__bob','messages',id),{readBy:arrayUnion('bob')}),true);
 await env.withSecurityRulesDisabled(async c=>{
  const legacy=message('legacy-missing');delete legacy.readBy;
  await setDoc(messageRef(c,'legacy-missing'),legacy);
  await setDoc(messageRef(c,'legacy-empty'),message('legacy-empty',{readBy:[]}));
  await setDoc(messageRef(c,'legacy-recipient'),message('legacy-recipient',{readBy:['bob']}));
  await setDoc(messageRef(c,'legacy-untyped'),message('legacy-untyped',{readBy:null}));
  await setDoc(messageRef(c,'recipient-only'),legacy);
  await setDoc(messageRef(c,'legacy-body'),{...legacy,text:'Старое сообщение'.repeat(100),authorName:42,photos:['data:image/jpeg;base64,legacy']});
  await setDoc(messageRef(c,'live-receipt'),message('live-receipt'));
  await setDoc(messageRef(c,'batch-normal'),message('batch-normal'));
  await setDoc(messageRef(c,'batch-legacy'),{...legacy,authorName:null,photos:['https://legacy.invalid/photo.jpg']});
 });
 for(const id of ['legacy-missing','legacy-empty','legacy-recipient','legacy-untyped','legacy-body']){
  await check('recipient backfills receipt '+id,updateDoc(messageRef(bob,id),{readBy:arrayUnion('alice','bob')}),true);
  const received=await getDoc(messageRef(alice,id));
  if(!received.data().readBy.includes('bob'))throw new Error('Sender cannot see receipt '+id);
 }
 await check('recipient may add only their own UID to a missing receipt',updateDoc(messageRef(bob,'recipient-only'),{readBy:arrayUnion('bob')}),true);
 const batch=writeBatch(bob.firestore());
 for(const id of ['batch-normal','batch-legacy'])batch.update(messageRef(bob,id),{readBy:arrayUnion('alice','bob')});
 await check('legacy content cannot block normal receipts in the same batch',batch.commit(),true);
 await check('sender can subscribe to the same limited message query as the app',observeReceipt(alice,'live-receipt',false),true);
 const liveReceipt=observeReceipt(alice,'live-receipt',true);
 await check('recipient receipt propagates to the sender live',Promise.all([updateDoc(messageRef(bob,'live-receipt'),{readBy:arrayUnion('bob')}),liveReceipt]),true);
 await check('author cannot forge recipient read receipt',create('author-forgery').then(()=>updateDoc(messageRef(alice,'author-forgery'),{readBy:arrayUnion('bob')})),false);
 await check('author cannot create an already-read message',create('create-forgery',{readBy:['alice','bob']}),false);
 for(const uid of ['outsider','admin','disabled',null])await check('deny receipt outside active participants '+uid,updateDoc(messageRef(context(uid),'photo'),{readBy:arrayUnion('alice','bob')}),false);
 await check('outsider cannot query private messages',getDocs(messagesQuery(context('outsider'))),false);
 for(const [name,readBy]of [['third party',['alice','bob','outsider']],['replace author',['bob','outsider']],['remove author',['bob']],['remove recipient',['alice']],['empty',[]],['wrong type','bob'],['delete',deleteField()]]){
  await check('deny receipt '+name,updateDoc(messageRef(bob,'photo'),{readBy}),false);
 }
 for(const [name,patch]of [['text',{text:'Переписано'}],['author',{authorId:'bob'}],['timestamp',{createdAt:serverTimestamp()}],['arbitrary field',{extraData:'injected'}],['required field removal',{text:deleteField()}],['combined urgent acknowledgement',{urgentAckBy:['bob']}]]){
  await check('deny metadata tampering with receipt '+name,updateDoc(messageRef(bob,'legacy-body'),{readBy:['alice','bob'],...patch}),false);
 }
 await check('recipient cannot replace photos while acknowledging',updateDoc(doc(bob.firestore(),'directChats','alice__bob','messages','photo'),{readBy:['alice','bob'],photos:[]}),false);
 await check('urgent photo create',create('urgent',{text:'',photos:[path('urgent')],isUrgent:true}),true);
 await check('read and urgent acknowledgement remain separate updates',updateDoc(messageRef(bob,'urgent'),{readBy:arrayUnion('bob'),urgentAckBy:arrayUnion('bob')}),false);
 await check('recipient confirms urgent photo',updateDoc(doc(bob.firestore(),'directChats','alice__bob','messages','urgent'),{urgentAckBy:arrayUnion('bob')}),true);
 await check('urgent acknowledgement does not forge a read receipt',(async()=>{const snap=await getDoc(messageRef(alice,'urgent'));if(snap.data().readBy.includes('bob'))throw new Error('Urgent acknowledgement changed readBy');})(),true);
 await check('author cannot rewrite a sent photo message',updateDoc(doc(alice.firestore(),'directChats','alice__bob','messages','photo'),{photos:[]}),false);
 const bytes=new Uint8Array([255,216,255,217]),metadata={contentType:'image/jpeg'},photoPath=path('upload');
 await check('participant uploads own photo',uploadBytes(ref(alice.storage(),photoPath),bytes,metadata),true);
 await check('recipient downloads photo',getBytes(ref(bob.storage(),photoPath)),true);
 for(const uid of ['outsider','admin','disabled',null])await check('deny private photo access '+uid,getMetadata(ref(context(uid).storage(),photoPath)),false);
 await check('reject overwrite',uploadBytes(ref(alice.storage(),photoPath),bytes,metadata),false);
 await check('reject impersonated uploader',uploadBytes(ref(alice.storage(),path('upload',0,'bob')),bytes,metadata),false);
 await check('reject foreign thread upload',uploadBytes(ref(alice.storage(),path('upload',0,'alice','bob__outsider')),bytes,metadata),false);
 await check('reject orphan thread upload',uploadBytes(ref(alice.storage(),path('upload',0,'alice','missing')),bytes,metadata),false);
 await check('reject non-image upload',uploadBytes(ref(alice.storage(),path('pdf')),bytes,{contentType:'application/pdf'}),false);
 await check('reject sixth upload slot',uploadBytes(ref(alice.storage(),path('upload',5)),bytes,metadata),false);
 await check('reject photo over 8 MiB',uploadBytes(ref(alice.storage(),path('large')),new Uint8Array(8*1024*1024+1),metadata),false);
 await check('recipient cannot delete another author photo',deleteObject(ref(bob.storage(),photoPath)),false);
 await check('author can remove own attachment',deleteObject(ref(alice.storage(),photoPath)),true);
 console.log('Private chat rules:',checks,'checks passed');
}finally{await env.cleanup();}
