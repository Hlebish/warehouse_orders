import test from 'node:test';
import assert from 'node:assert/strict';
import {bindDirectChatDraft} from '../direct-chat-draft.mjs';
import {draftKey} from '../draft-store.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const photo=()=>new File(['photo'],'image.jpg',{type:'image/jpeg',lastModified:123});
function memoryStore(){
 const values=new Map(),calls=[];
 return {values,calls,async get(key){calls.push(['get',key]);return values.get(key);},async put(key,value){calls.push(['put',key]);values.set(key,value);},async remove(key){calls.push(['remove',key]);values.delete(key);},async removeIfRevision(key,revision){
  calls.push(['conditional-remove',key,revision]);
  const saved=values.get(key);if(saved&&saved.revision!==revision)return false;
  values.delete(key);return true;
 }};
}
function composerHarness(){
 const input={value:''},urgent={checked:false},statuses=[],listeners=new Set();let files=[];
 const emit=()=>{for(const listener of listeners)listener();};
 const form={isConnected:true,querySelector:selector=>selector==='textarea'?input:urgent};
 const composer={getFiles:()=>[...files],setFiles:next=>{files=[...next];emit();return true;},onChange:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},resize(){},setStatus:(...args)=>statuses.push(args),clear(){files=[];input.value='';emit();}};
 return {form,composer,input,urgent,statuses,type(text){input.value=text;emit();},toggle(value){urgent.checked=value;emit();},emit};
}
function bind(t,{store=memoryStore(),userId='alice',threadId='alice__bob',...options}={}){
 const h=composerHarness();
 const session=bindDirectChatDraft({...h,userId,threadId,store,delay:100000,...options});
 t.after(()=>session.dispose());return {...h,session,store};
}

test('text, raw photographs and urgent flag restore from an account-scoped conversation draft',async t=>{
 const store=memoryStore(),file=photo(),key=draftKey('alice','alice__bob','direct-chat');
 store.values.set(key,{text:'Проверить артикул 123',files:[file],urgent:true,revision:'saved'});
 const h=bind(t,{store});await h.session.ready;
 assert.equal(h.input.value,'Проверить артикул 123');assert.equal(h.urgent.checked,true);
 assert.deepEqual(h.composer.getFiles(),[file]);assert.match(h.statuses.at(-1)[0],/восстановлен/);
 await h.session.flush();assert.equal(store.values.get(key).text,h.input.value);
});

test('a slow restore cannot overwrite typing, newly attached photos or changed urgency',async t=>{
 const store=memoryStore(),loading=deferred();store.get=()=>loading.promise;
 const h=bind(t,{store}),file=photo();h.type('Новый текст');h.composer.setFiles([file]);h.toggle(true);
 loading.resolve({text:'Старый текст',files:[],urgent:false,revision:'old'});await h.session.ready;
 assert.equal(h.input.value,'Новый текст');assert.deepEqual(h.composer.getFiles(),[file]);assert.equal(h.urgent.checked,true);
 await h.session.flush();assert.equal(store.values.get(h.session.key).text,'Новый текст');
});

test('every composer change persists a full draft and removing all content clears it',async t=>{
 const h=bind(t);await h.session.ready;
 h.type('Текст');h.composer.setFiles([photo()]);h.toggle(true);await h.session.flush();
 let saved=h.store.values.get(h.session.key);assert.equal(saved.text,'Текст');assert.equal(saved.files.length,1);assert.equal(saved.urgent,true);
 h.composer.setFiles([]);h.toggle(false);h.type('');await h.session.flush();
 assert.equal(h.store.values.has(h.session.key),false);
});

test('user and thread keys isolate private drafts',async t=>{
 const store=memoryStore(),first=bind(t,{store});await first.session.ready;first.type('Для Боба');await first.session.flush();
 const otherThread=bind(t,{store,threadId:'alice__carol'}),otherUser=bind(t,{store,userId:'bob'});
 await Promise.all([otherThread.session.ready,otherUser.session.ready]);
 assert.equal(otherThread.input.value,'');assert.equal(otherUser.input.value,'');
 assert.notEqual(first.session.key,otherThread.session.key);assert.notEqual(first.session.key,otherUser.session.key);
});

test('dispose flushes before closing and a disconnected form is not cleared after a completed send',async t=>{
 const h=bind(t);await h.session.ready;h.type('Отправляем');h.composer.setFiles([photo()]);
 const captured=h.session.capture();h.form.isConnected=false;await h.session.dispose();
 assert.equal(h.store.values.get(h.session.key).text,'Отправляем');
 await h.session.clearAfterSend(captured);
 assert.equal(h.store.values.has(h.session.key),false);assert.equal(h.input.value,'Отправляем');assert.equal(h.composer.getFiles().length,1);
});

test('closing before asynchronous restoration completes preserves the stored draft',async t=>{
 const loading=deferred(),store=memoryStore();store.get=()=>loading.promise;
 const h=bind(t,{store});await h.session.dispose();h.form.isConnected=false;
 loading.resolve({text:'Сохранено раньше',files:[],urgent:false,revision:'old'});await h.session.ready;
 assert.equal(h.input.value,'');assert.equal(store.calls.some(([action])=>action==='put'||action==='remove'),false);
});

test('successful send removes queued saves without resurrecting the sent draft',async t=>{
 const h=bind(t);await h.session.ready;h.type('Готово');h.composer.setFiles([photo()]);h.toggle(true);
 const captured=h.session.capture();void h.session.flush();await h.session.clearAfterSend(captured);await h.session.flush();
 assert.equal(h.input.value,'');assert.equal(h.composer.getFiles().length,0);assert.equal(h.urgent.checked,false);assert.equal(h.store.values.has(h.session.key),false);
 assert.equal(h.store.calls.at(-1)[0],'conditional-remove');
});

test('completion of an older send cannot clear edits made after its capture',async t=>{
 const h=bind(t);await h.session.ready;h.type('Отправлено');const captured=h.session.capture();
 h.type('Следующее сообщение');await h.session.clearAfterSend(captured);await h.session.flush();
 assert.equal(h.input.value,'Следующее сообщение');assert.equal(h.store.values.get(h.session.key).text,'Следующее сообщение');
});

test('reopening the same conversation protects its new draft from an earlier send completing',async t=>{
 const store=memoryStore(),first=bind(t,{store});await first.session.ready;first.type('Первое');const captured=first.session.capture();await first.session.dispose();
 const reopened=bind(t,{store});await reopened.session.ready;reopened.type('Следующий черновик');await reopened.session.flush();
 await first.session.clearAfterSend(captured);
 assert.equal(reopened.input.value,'Следующий черновик');assert.equal(store.values.get(reopened.session.key).text,'Следующий черновик');
});

test('an immediate same-key reopen waits for the previous closing flush, including photos',async t=>{
 const store=memoryStore(),first=bind(t,{store});await first.session.ready;
 first.type('Последний ещё не сохранённый текст');const file=photo();first.composer.setFiles([file]);first.toggle(true);
 const slowWrite=deferred(),put=store.put;store.put=async(key,value)=>{await slowWrite.promise;await put(key,value);};
 const closing=first.session.dispose();first.form.isConnected=false;
 const reopened=bind(t,{store});let restored=false;void reopened.session.ready.then(()=>{restored=true;});
 await settle();assert.equal(restored,false);
 slowWrite.resolve();await Promise.all([closing,reopened.session.ready]);
 assert.equal(reopened.input.value,'Последний ещё не сохранённый текст');assert.deepEqual(reopened.composer.getFiles(),[file]);assert.equal(reopened.urgent.checked,true);
});

test('a new edit during immediate reopen wins over restoration and the previous closing flush',async t=>{
 const store=memoryStore(),first=bind(t,{store});await first.session.ready;first.type('Закрываемый текст');
 void first.session.dispose();const reopened=bind(t,{store});reopened.type('Новое сообщение после открытия');
 await reopened.session.ready;await reopened.session.flush();
 assert.equal(reopened.input.value,'Новое сообщение после открытия');assert.equal(store.values.get(reopened.session.key).text,'Новое сообщение после открытия');
});

test('send cleanup reserved before a reopen completes before that reopen can restore a sent draft',async t=>{
 const store=memoryStore(),first=bind(t,{store});await first.session.ready;first.type('Уже отправлено');const captured=first.session.capture();
 const clearing=first.session.clearAfterSend(captured);void first.session.dispose();first.form.isConnected=false;
 const reopened=bind(t,{store});await Promise.all([clearing,reopened.session.ready]);
 assert.equal(reopened.input.value,'');assert.equal(store.values.has(reopened.session.key),false);
});

test('conditional deletion preserves a draft written in another tab during send cleanup',async t=>{
 const h=bind(t);await h.session.ready;h.type('Первое');const captured=h.session.capture();await h.session.flush();
 h.store.values.set(h.session.key,{text:'Из другой вкладки',files:[],urgent:false,revision:'newer-tab'});
 await h.session.clearAfterSend(captured);
 assert.equal(h.store.values.get(h.session.key).text,'Из другой вкладки');
});

test('storage failures are reported and a sent draft is not restored again in this session after deletion failure',async t=>{
 const h=bind(t);await h.session.ready;h.type('Отправляем');const captured=h.session.capture();await h.session.flush();
 const remove=h.store.removeIfRevision;h.store.removeIfRevision=async()=>{throw Error('quota error');};
 assert.equal(await h.session.clearAfterSend(captured),false);assert.match(h.statuses.at(-1)[0],/Сообщение отправлено/);
 await h.session.dispose();h.form.isConnected=false;
 const reopened=bind(t,{store:h.store});await reopened.session.ready;assert.equal(reopened.input.value,'');
 h.store.removeIfRevision=remove;
});

test('a failed save leaves editable text and photographs intact and reports the storage error',async t=>{
 const h=bind(t);await h.session.ready;h.type('Не терять');const file=photo();h.composer.setFiles([file]);
 h.store.put=async()=>{throw Error('storage unavailable');};
 assert.equal(await h.session.flush(),false);assert.equal(h.input.value,'Не терять');assert.deepEqual(h.composer.getFiles(),[file]);
 assert.match(h.statuses.at(-1)[0],/Не удалось сохранить/);assert.equal(h.statuses.at(-1)[1],true);
});

test('invalid stored attachments do not populate the composer',async t=>{
 const store=memoryStore();store.values.set(draftKey('alice','alice__bob','direct-chat'),{text:'Фото',files:[new File(['pdf'],'bad.pdf',{type:'application/pdf'})],urgent:false});
 const h=bind(t,{store});await h.session.ready;assert.equal(h.input.value,'');assert.deepEqual(h.composer.getFiles(),[]);assert.equal(h.statuses.at(-1)[1],true);
});

test('IndexedDB conditional removal checks and deletes a matching revision in one write transaction',async()=>{
 const records=new Map(),modes=[];const previous=globalThis.indexedDB;
 const database={createObjectStore(){},transaction(_name,mode){
  modes.push(mode);const tx={};let pending=0;
  const perform=action=>{pending++;setImmediate(()=>{action();pending--;if(!pending)setImmediate(()=>tx.oncomplete?.());});};
  tx.objectStore=()=>({
   get(key){const request={};perform(()=>{request.result=records.get(key);request.onsuccess?.();});return request;},
   put(value,key){perform(()=>records.set(key,value));},
   delete(key){records.delete(key);if(!pending)perform(()=>{});}
  });return tx;
 }};
 globalThis.indexedDB={open(){const request={result:database};setImmediate(()=>{request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
 try{
  const {drafts:storage}=await import('../draft-store.mjs?conditional-draft-test');
  await storage.put('key',{text:'old',revision:'old'});
  await storage.put('key',{text:'new',revision:'new'});
  assert.equal(await storage.removeIfRevision('key','old'),false);assert.equal((await storage.get('key')).text,'new');
  assert.equal(await storage.removeIfRevision('key','new'),true);assert.equal(await storage.get('key'),null);
  assert.equal(await storage.removeIfRevision('missing','anything'),true);
  assert.equal(modes.filter(mode=>mode==='readwrite').length,5);
 }finally{globalThis.indexedDB=previous;}
});
