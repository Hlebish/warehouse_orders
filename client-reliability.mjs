// Local text drafts are scoped to one employee and one form. No photos or
// access credentials are stored here (photo drafts use the existing IndexedDB).
export function createFormDraftStore(storage,{now=Date.now,maxAge=7*86400000}={}){
 const key=(uid,orderId,kind)=>'warehouse-form-draft:'+JSON.stringify([uid,orderId,kind]);
 return {
  load(uid,orderId,kind){
   const k=key(uid,orderId,kind),raw=storage.getItem(k);
   if(!raw)return null;
   const draft=JSON.parse(raw);
   if(!draft||now()-draft.savedAt>maxAge){storage.removeItem(k);return null;}
   return draft.value;
  },
  save(uid,orderId,kind,value){storage.setItem(key(uid,orderId,kind),JSON.stringify({savedAt:now(),value}));},
  remove(uid,orderId,kind){storage.removeItem(key(uid,orderId,kind));}
 };
}
export async function mapLimited(values,limit,fn){
 const result=new Array(values.length);let next=0,failed=false,firstError;
 async function work(){
  while(!failed&&next<values.length){
   const i=next++;
   try{result[i]=await fn(values[i],i);}catch(error){failed=true;firstError=error;}
  }
 }
 await Promise.all(Array.from({length:Math.min(values.length,Math.max(1,limit))},work));
 if(failed)throw firstError;
 return result;
}
export function memoizeByObject(fn){
 const cache=new WeakMap();
 return value=>{
  if(cache.has(value))return cache.get(value);
  const promise=Promise.resolve().then(()=>fn(value)).catch(error=>{cache.delete(value);throw error;});
  cache.set(value,promise);return promise;
 };
}
export function pushDiagnosticText(data={}){
 const status=String(data.status||'pending');
 const labels={pending:'В очереди',processing:'Обрабатывается',retrying:'Повторная попытка',sent:'Firebase принял отправку',partial:'Часть устройств недоступна',partial_expired:'Часть устройств не получила сигнал до истечения срока',expired:'Истёк срок отправки',no_devices:'Нет зарегистрированных устройств',no_valid_devices:'Нет действительных push-токенов',stale:'Событие устарело'};
 const count=' · принято: '+(Number(data.acceptedCount)||0)+' · отклонено: '+(Number(data.failedCount)||0);
 const platforms=Object.entries(data.platformDelivery||{}).map(([name,p])=>(name==='android'?'Android':'ПК/браузер')+': '+(Number(p.accepted)||0)+'/'+(Number(p.selected)||0));
 return (labels[status]||status)+count+(platforms.length?' · '+platforms.join(' · '):'');
}
