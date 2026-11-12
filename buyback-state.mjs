import {validReceivedDate} from './buyback-dates.mjs?v=2026.11.12.05';
export function buybackAgeDays(receivedAt,now=new Date()){
 if(!validReceivedDate(receivedAt))return NaN;
 const [year,month,day]=receivedAt.split('-').map(Number);
 return Math.floor((Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())-Date.UTC(year,month-1,day))/86400000);
}
export function buybackPhase(item,now=new Date()){
 if(item.status!=='active')return item.status||'active';
 const days=buybackAgeDays(item.receivedAt,now);
 return days>=14?'expired':days>=10?'critical':days>=6?'approaching':'active';
}
export function buybackIsCritical(item,now=new Date()){return buybackPhase(item,now)==='critical';}
export function buybackIsTimed(item){return ['active','expired'].includes(item.status);}
export function buybackStockPatch(actor,date){return {status:'stocked',stockedAt:date,stockedBy:actor.uid,stockedByName:actor.name||'Сотрудник'};}
