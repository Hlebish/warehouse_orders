import {drafts,draftKey} from './draft-store.mjs?v=2026.11.16.04';
import {validChatPhotos} from './chat-ui.mjs?v=2026.11.16.04';

const owners=new Map(),sentRevisions=new Map(),pendingByKey=new Map();
let nextSession=0;
const validFiles=files=>Array.isArray(files)&&files.every(file=>file&&typeof file.type==='string'&&typeof file.size==='number')&&!validChatPhotos(files);

// Draft keys include both account and conversation. The local operation queue
// orders saves before send cleanup; conditional deletion also protects a newer
// draft written in another tab while the previous message was being sent.
export function bindDirectChatDraft({form,composer,userId,threadId,store=drafts,delay=300}){
 if(!userId||!threadId)throw new Error('Для черновика нужны пользователь и личный чат.');
 const key=draftKey(userId,threadId,'direct-chat'),owner=Date.now()+':'+(++nextSession)+':'+Math.random().toString(36).slice(2);
 const preceding=pendingByKey.get(key)||Promise.resolve();
 owners.set(key,owner);
 const input=form.querySelector('textarea'),urgent=form.querySelector('input[type="checkbox"]');
 let revision=0,changed=false,loaded=false,disposed=false,suppressed=false,timer=null,operations=Promise.resolve(),lastStoredRevision;
 const current=()=>owners.get(key)===owner;
 const report=(message,error)=>{if(!disposed&&form.isConnected)composer.setStatus(message+(error?.message?' '+error.message:''),true);};
 const value=()=>({text:String(input.value||''),files:composer.getFiles(),urgent:urgent?.checked===true});
 const empty=data=>!data.text&&!data.files.length&&!data.urgent;
 const recordRevision=at=>owner+':'+at;
 const cancelTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
 const enqueue=operation=>{
  const earlier=pendingByKey.get(key)||Promise.resolve();
  const result=Promise.all([operations.catch(()=>{}),earlier.catch(()=>{})]).then(operation);
  operations=result.catch(()=>{});
  pendingByKey.set(key,operations);
  return result;
 };
 const removeMatching=async expected=>{
  if(store.removeIfRevision)return store.removeIfRevision(key,expected);
  // Test/custom stores may omit the atomic IndexedDB extension.
  const saved=await store.get(key);
  if(saved&&saved.revision!==expected)return false;
  await store.remove(key);return true;
 };
 let ready;
 const save=(snapshot,at=revision,force=false)=>{
  if(!current())return Promise.resolve(true);
  return enqueue(async()=>{
  await ready;
  // This write was reserved by the owner before a possible reopen. The next
  // session waits for it before restoring, so a legitimate closing flush must
  // finish even when that next session has already claimed the key.
  if(at!==revision||(!force&&!changed&&!loaded))return true;
  if(empty(snapshot))await removeMatching(lastStoredRevision);
  else{
   const stored={...snapshot,revision:recordRevision(at)};
   await store.put(key,stored);lastStoredRevision=stored.revision;
  }
  return true;
  }).catch(error=>{report('Не удалось сохранить черновик на устройстве. Не закрывайте чат до отправки.',error);return false;});
 };
 const onChange=()=>{
  if(suppressed||disposed||!current())return;
  revision++;changed=true;cancelTimer();
  timer=setTimeout(()=>{timer=null;void save(value());},delay);
 };
 const unsubscribe=composer.onChange(onChange);
 ready=(async()=>{
  try{
   await preceding;
   const saved=await store.get(key);loaded=true;lastStoredRevision=saved?.revision;
   if(!saved||disposed||!current()||changed||!form.isConnected||!empty(value()))return;
   if(sentRevisions.get(key)?.has(saved.revision)){
    await removeMatching(saved.revision);return;
   }
   if(typeof saved.text!=='string'||saved.text.length>1000||!validFiles(saved.files||[]))throw new Error('Сохранённый черновик имеет неподдерживаемый формат.');
   suppressed=true;
   try{
    input.value=saved.text;composer.setFiles(saved.files||[]);
    if(urgent)urgent.checked=saved.urgent===true;
    composer.resize?.();
   }finally{suppressed=false;}
   if(!empty(value()))composer.setStatus('Черновик восстановлен.');
  }catch(error){loaded=true;report('Не удалось восстановить черновик на устройстве.',error);}
 })();
 function flush(){
  cancelTimer();
  if(disposed||!current()||(!loaded&&!changed))return operations.then(()=>true);
  return save(value());
 }
 return {
  key,ready,flush,
  capture(){
   const at=revision;
   cancelTimer();void save(value(),at,true);
   return {owner,revision:at};
  },
  clearAfterSend(captured={owner,revision}){
   if(!current()||captured.owner!==owner||captured.revision!==revision)return Promise.resolve(true);
   cancelTimer();
   return enqueue(async()=>{
    await ready;
    if(captured.owner!==owner||captured.revision!==revision)return true;
    const sent=sentRevisions.get(key)||new Set();
    sent.add(lastStoredRevision);sentRevisions.set(key,sent);
    suppressed=true;
    try{if(form.isConnected){if(urgent)urgent.checked=false;composer.clear();}}finally{suppressed=false;}
    revision++;changed=false;
    try{
     const removed=await removeMatching(lastStoredRevision);
     if(removed)sentRevisions.delete(key);
     return true;
    }catch(error){report('Сообщение отправлено, но сохранённый черновик не удалось удалить с устройства.',error);return false;}
   });
  },
  dispose(){
   if(disposed)return operations.then(()=>true);
   const pending=flush();disposed=true;cancelTimer();unsubscribe();return pending;
  }
 };
}
