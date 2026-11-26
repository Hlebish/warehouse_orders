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
 if(articleContent(before.articles)!==articleContent(after.articles))return {authorId,title,body:'Артикулы заказа изменены',category:'editing'};
 const fields=['number','client','clientId','deliveryType','deliveryAddress','paymentType','paymentStatus','mainComment','ttn','trackingNumber'];
 if(fields.some(key=>JSON.stringify(before[key]??'')!==JSON.stringify(after[key]??'')))return {authorId,title,body:'Данные заказа изменены',category:'editing'};
 return null;
}
function entryEvent(entry,excluded=[]){
 if(!entry||!entry.authorId)return null;
 const categories={comment:'comments',question:'questions',decision:'decisions',defect:'defects'};
 const category=categories[entry.kind];
 if(!category||entry.kind==='comment'&&entry.replyToEntryId)return null;
 return {authorId:String(entry.authorId),category,body:String(entry.text|| (entry.kind==='defect'?'Добавлен дефект':'Новая запись')).slice(0,500),excludedRecipientIds:[...new Set(excluded)]};
}
module.exports={serverManagedPush,orderEvent,entryEvent};
