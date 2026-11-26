// Live working set: all non-terminal orders plus the last 30 days.
// Historical dates exist in both ISO string and Firestore Timestamp formats.
export const ARCHIVE_STATUSES=['Отгружен кладовщиком','Клиент забрал самовывозом','Отменён'];
export const ACTIVE_STATUSES=['Создан','Камянское','Собран','Под вопросом','Дефект','Ожидает оплаты','На согласовании','Одобрен на отгрузку клиенту','Ожидает самовывоза','Самовывоз','Перенесен','Возврат'];
export function watchOrderWindow({db,collection,query,where,onSnapshot},next,error,{days=30,now=Date.now()}={}){
 const ref=collection(db,'orders'),cutoff=new Date(now-days*86400000);
 const queries=[query(ref,where('status','in',ACTIVE_STATUSES))];
 for(const field of ['createdAt','updatedAt']){
  queries.push(query(ref,where(field,'>=',cutoff.toISOString())),query(ref,where(field,'>=',cutoff)));
 }
 const parts=new Array(queries.length).fill(null);
 let previous=new Map(),closed=false,stops=[],sequence=0;
 const emit=()=>{
  if(closed||parts.some(x=>!x))return;
  const merged=new Map();
  for(const part of [...parts].sort((a,b)=>a.sequence-b.sequence)){
   for(const doc of part.snapshot.docs)merged.set(doc.id,doc);
  }
  const changes=[];
  for(const [id,doc] of merged){
   const old=previous.get(id);
   if(!old||JSON.stringify(old.data())!==JSON.stringify(doc.data()))changes.push({type:old?'modified':'added',doc});
  }
  for(const [id,doc] of previous)if(!merged.has(id))changes.push({type:'removed',doc});
  previous=merged;
  next({docs:[...merged.values()],metadata:{fromCache:parts.some(x=>x.snapshot.metadata.fromCache),hasPendingWrites:parts.some(x=>x.snapshot.metadata.hasPendingWrites)},docChanges:()=>changes});
 };
 const stop=()=>{if(closed)return;closed=true;stops.forEach(fn=>fn());};
 for(const [i,q] of queries.entries()){
  if(closed)break;
  const unsubscribe=onSnapshot(q,{includeMetadataChanges:true},snapshot=>{if(closed)return;parts[i]={snapshot,sequence:++sequence};emit();},err=>{if(closed)return;stop();error(err);});
  if(closed)unsubscribe();else stops.push(unsubscribe);
 }
 return stop;
}
// Reuse unchanged rows and move existing nodes instead of destroying the table.
export function patchOrderRows(body,html){
 if(body.__ordersHtml===html)return;
 // A tbody context is necessary for parsing table rows.
 const temporary=body.ownerDocument.createElement('tbody');temporary.innerHTML=html;
 const keyed=new Map();const counts=new Map();
 const key=row=>{const base=row.dataset.order?'order:'+row.dataset.order:'section:'+row.className+':'+row.textContent;const n=counts.get(base)||0;counts.set(base,n+1);return base+':'+n;};
 for(const row of [...body.children])keyed.set(key(row),row);
 counts.clear();
 let cursor=body.firstElementChild;
 for(const desired of [...temporary.children]){
  const id=key(desired),old=keyed.get(id);keyed.delete(id);
  const node=old&&old.isEqualNode(desired)?old:desired;
  if(node!==old&&old){if(cursor===old)cursor=old.nextElementSibling;old.remove();}
  if(node!==cursor)body.insertBefore(node,cursor);
  cursor=node.nextElementSibling;
 }
 for(const row of keyed.values())row.remove();
 body.__ordersHtml=html;
}
