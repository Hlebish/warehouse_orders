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
 const revision=doc=>{const data=doc.data();const value=data.updatedAt||data.createdAt;const ms=typeof value?.toMillis==='function'?value.toMillis():Date.parse(value);return Number.isFinite(ms)?ms:0;};
 const prefer=(a,b)=>{
  if(!a)return b;
  if(a.doc.metadata?.hasPendingWrites!==b.doc.metadata?.hasPendingWrites)return b.doc.metadata?.hasPendingWrites?b:a;
  const delta=revision(b.doc)-revision(a.doc);
  return delta>0||(delta===0&&b.sequence>a.sequence)?b:a;
 };
 const emit=()=>{
  if(closed||parts.some(x=>!x))return;
  const candidates=new Map();
  for(const part of parts)for(const [id,record] of part.records)candidates.set(id,prefer(candidates.get(id),record));
  const merged=new Map([...candidates].map(([id,record])=>[id,record.doc]));
  const changes=[];
  for(const [id,doc] of merged){
   const old=previous.get(id);
   if(!old||(old!==doc&&JSON.stringify(old.data())!==JSON.stringify(doc.data())))changes.push({type:old?'modified':'added',doc});
  }
  for(const [id,doc] of previous)if(!merged.has(id))changes.push({type:'removed',doc});
  previous=merged;
  next({docs:[...merged.values()],metadata:{fromCache:parts.some(x=>x.snapshot.metadata.fromCache),hasPendingWrites:parts.some(x=>x.snapshot.metadata.hasPendingWrites)},docChanges:()=>changes});
 };
 const stop=()=>{if(closed)return;closed=true;stops.forEach(fn=>fn());};
 for(const [i,q] of queries.entries()){
  if(closed)break;
  const unsubscribe=onSnapshot(q,{includeMetadataChanges:true},snapshot=>{
   if(closed)return;
   const old=parts[i],records=new Map();
   for(const doc of snapshot.docs){
    const record=old?.records.get(doc.id);
    const unchanged=record&&JSON.stringify(record.doc.data())===JSON.stringify(doc.data());
    records.set(doc.id,{doc,sequence:unchanged?record.sequence:++sequence});
   }
   parts[i]={snapshot,records};emit();
  },err=>{if(closed)return;stop();error(err);});
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

// Filter before sorting and compute each date key only once per visible order.
const statusPriority={'Создан':0,'Собран':1,'На согласовании':2,'Под вопросом':3,'Дефект':4,'Ожидает оплаты':5,'Одобрен на отгрузку клиенту':6,'Ожидает самовывоза':7,'Самовывоз':7,'Перенесен':8,'Отгружен кладовщиком':9,'Клиент забрал самовывозом':10,'Отменён':11};
export function sortOrderRows(orders,{activeFilter,search,dateFrom,dateTo,orderDisplayDate,localDateKey,orderSearchText,isDateInRange,asDate}){
 return orders.filter(o=>(activeFilter==='Камянское'||o.status!=='Камянское')&&
  (activeFilter==='all'||o.status===activeFilter)&&(!search||orderSearchText(o).includes(search))&&
  (!(dateFrom||dateTo)||isDateInRange(o,dateFrom,dateTo))).map(order=>{
   const transferred=order.status==='Перенесен';
   const date=transferred?(order.createdAt||order.transferredAt||order.updatedAt):orderDisplayDate(order);
   return {order,transferred,day:localDateKey(date),ms:asDate(transferred?(order.createdAt||order.transferredAt):date)?.getTime()||0,priority:statusPriority[order.status]??8};
  }).sort((a,b)=>{
   if(a.transferred!==b.transferred)return a.transferred?-1:1;
   if(a.transferred)return a.day.localeCompare(b.day)||a.ms-b.ms;
   return b.day.localeCompare(a.day)||a.priority-b.priority||b.ms-a.ms;
  }).map(row=>row.order);
}
