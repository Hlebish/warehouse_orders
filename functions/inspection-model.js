const {normalizeBuybackArticle,resolveBuybackArticle}=require('./buyback-articles');
const clientKey=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('uk').replace(/[^\p{L}\p{N}]/gu,'');
const millis=value=>value?.toMillis?.()||Date.parse(String(value||''))||0;
function inspectionMatches(order,items,cutoff=Infinity,before=null,consumed={},available=null){
 if(['Отменён','Возврат'].includes(order.status))return [];
 const active=items.filter(item=>['pending','checked'].includes(item.status)&&millis(item.createdAt)<=cutoff);
 const known=new Set(active.map(item=>item.articleKey));
 const quantities=lines=>{const result=new Map();for(const line of lines||[]){const key=resolveBuybackArticle(line.article,known);result.set(key,(result.get(key)||0)+Math.max(1,Math.floor(Number(line.quantity)||1)));}return result;};
 const needed=quantities(order.articles),old=quantities(before?.articles);
 if(before)for(const [key,count]of needed)needed.set(key,Math.max(0,count-(old.get(key)||0)));
 for(const [key,count]of needed)needed.set(key,Math.max(0,Math.min(count,available?.get(key)??Infinity)-(Number(consumed[key])||0)));
 const key=clientKey(order.client),matches=[];
 const priority=item=>item.clientId&&order.clientId?(item.clientId===order.clientId?0:3):item.clientKey&&key===item.clientKey?1:!item.clientKey&&!item.clientId?2:3;
 active.sort((a,b)=>priority(a)-priority(b)||(a.status==='checked'?0:1)-(b.status==='checked'?0:1)||millis(a.createdAt)-millis(b.createdAt)||a.id.localeCompare(b.id));
 for(const item of active){if(priority(item)>2||!(needed.get(item.articleKey)>0))continue;needed.set(item.articleKey,needed.get(item.articleKey)-1);matches.push(item);}
 return matches;
}
module.exports={inspectionMatches,clientKey,millis,articleKey:normalizeBuybackArticle};
