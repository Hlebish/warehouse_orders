// Pure classification for persisted order events. No browser dependency.
const managedCategories=new Set(['orders','assembly','status','editing','comments','questions','decisions','defects']);
function serverManagedPush(input={}){
 if(input.forceAll===true||input.target!=='site'||!input.orderId)return false;
 if(input.category==='editing'&&input.body==='Удалена запись из истории заказа')return false;
 return managedCategories.has(input.category)||input.category==='replies';
}
function articleContent(items){
 return JSON.stringify((Array.isArray(items)?items:[]).map(x=>[String(x?.article||''),Number(x?.quantity)||1]));
}
function orderEvent(before,after){
 if(!after)return null;
 const authorId=String(before?after.updatedBy|| (after.source==='1c'?'1c':''):after.createdBy||'');
 if(!authorId)return null;
 const client=String(after.client||'Клиент не указан');
 const number=String(after.number||'');
 const title=(client+' · № '+number).slice(0,120);
 if(!before)return {authorId,title,body:'Новый заказ',category:'orders'};
 if(before.status!==after.status){
  if(after.status==='Дефект')return null; // the saved defect entry is the source
  return {authorId,title,body:'Статус: '+String(after.status||''),category:after.status==='Собран'?'assembly':'status'};
 }
 if(Boolean(before.assemblyInProgress)!==Boolean(after.assemblyInProgress))return {authorId,title,body:after.assemblyInProgress?'Начата сборка заказа.':'Сборка заказа завершена.',category:'assembly'};
 if(articleContent(before.articles)!==articleContent(after.articles)){
  const totals=items=>{const map=new Map();for(const item of Array.isArray(items)?items:[]){const key=String(item?.article||'').trim();if(key)map.set(key,(map.get(key)||0)+(Number(item.quantity)||1));}return map;};
  const old=totals(before.articles),next=totals(after.articles),changes=[];
  for(const [article,qty] of next){if(!old.has(article))changes.push('+'+article+' × '+qty);else if(old.get(article)!==qty)changes.push(article+': '+old.get(article)+' → '+qty);}
  for(const article of old.keys())if(!next.has(article))changes.push('−'+article);
  return {authorId,title,body:(changes.length?'Артикулы: '+changes.join(', '):'Изменён порядок артикулов').slice(0,500),category:'editing'};
 }
 const fields=['number','client','clientId','deliveryType','deliveryAddress','paymentType','paymentStatus','mainComment','ttn','trackingNumber'];
 const changed=fields.filter(key=>JSON.stringify(before[key]??'')!==JSON.stringify(after[key]??''));
 if(changed.length){
  const labels={number:'Номер',client:'Клиент',clientId:'Клиент из справочника',deliveryType:'Доставка',deliveryAddress:'Адрес',paymentType:'Оплата',paymentStatus:'Статус оплаты',mainComment:'Комментарий',ttn:'ТТН',trackingNumber:'Номер отслеживания'};
  const delivery={city:'По городу',pickup:'Самовывоз',post:'Почтой',kamyanske:'Камянское'};
  const payments={cash:'Наличными',bank_transfer:'На рахунок',unknown:'Неизвестно'};
  const details=changed.filter(key=>key!=='clientId'||!changed.includes('client')).map(key=>{
   if(key==='clientId')return 'Изменён клиент из справочника';
   const value=key==='deliveryType'?delivery[after[key]]||after[key]:key==='paymentType'?payments[after[key]]||after[key]:after[key];
   return labels[key]+': '+(String(value??'').trim()||'убрано');
  });
  return {authorId,title,body:details.join(' · ').slice(0,500),category:'editing'};
 }
 return null;
}
function entryEvent(entry,excluded=[]){
 if(!entry||!entry.authorId)return null;
 const categories={comment:'comments',question:'questions',decision:'decisions',defect:'defects'};
 const category=categories[entry.kind];
 if(!category||entry.kind==='comment'&&entry.replyToEntryId)return null;
 const text=String(entry.text||'').trim();
 const article=String(entry.article||'').trim();
 const photos=Array.isArray(entry.photos)?entry.photos.length:0;
 const photoText=photos?' · Фото: '+photos:'';
 const label=entry.kind==='comment'?'':entry.kind==='defect'?'Дефект':entry.kind==='question'?'Вопрос':'Решение';
 const prefix=[label,article].filter(Boolean).join(' · ');
 const body=(prefix&&text?prefix+': '+text:prefix||text||'Прикреплённые фотографии')+photoText;
 return {authorId:String(entry.authorId),category,body:body.slice(0,500),isUrgent:entry.important===true||entry.isUrgent===true,excludedRecipientIds:[...new Set(excluded)]};
}
module.exports={serverManagedPush,orderEvent,entryEvent};
