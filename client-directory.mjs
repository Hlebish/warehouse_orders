export function searchClients(clients, text, maxResults = 8) {
  const query = String(text || '').trim().toLocaleLowerCase('ru');
  if (!query) return [];
  return (Array.isArray(clients) ? clients : [])
    .filter(client => !client.hiddenFromDirectory)
    .filter(client => String(client.name || '').toLocaleLowerCase('ru').includes(query)
      || String(client.phone || '').toLocaleLowerCase('ru').includes(query))
    .slice(0, maxResults);
}

export function searchProducts(products, text, maxResults = 8) {
  const query = String(text || '').trim().toLocaleLowerCase('ru');
  if (query.length < 2) return [];
  const exact = [], starts = [], other = [];
  for (const product of Array.isArray(products) ? products : []) {
    const article = String(product.a || '').toLocaleLowerCase('ru');
    const aliases = String(product.o || '').split(',').map(value => value.trim().toLocaleLowerCase('ru'));
    if (article === query || aliases.includes(query)) exact.push(product);
    else if (article.startsWith(query) || aliases.some(value => value.startsWith(query))) starts.push(product);
    else if (String(product.n || '').toLocaleLowerCase('ru').includes(query)
      || String(product.b || '').toLocaleLowerCase('ru').includes(query)) other.push(product);
  }
  return [...exact, ...starts, ...other].slice(0, maxResults);
}

export function clientValue(client,keys){
 for(const key of keys){const value=client?.[key];if(Array.isArray(value)){const joined=value.map(item=>String(item||'').trim()).filter(Boolean).join(', ');if(joined)return joined;}else if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim();}
 return '';
}
export const clientPhone=client=>clientValue(client,['phone','phoneNumber','telephone','mobile','tel','phones','Телефон','Номер телефона']);
export const clientAddress=client=>clientValue(client,['address','deliveryAddress','customerAddress','postalAddress','Адрес','Адрес клиента','Адрес доставки']);
export const clientComment=client=>clientValue(client,['comment','comments','note','notes','Комментарий']);
const legalWords=new Set(['тов','тзов','ооо','фоп','флп','пп','чп','товариство','обмеженою','відповідальністю','общество','ограниченной','ответственностью','приватне','приватное','підприємство','предприятие','з','с']);
const normalized=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[ʼ’'`]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const words=value=>normalized(value).split(/\s+/).filter(word=>word.length>1&&!legalWords.has(word));
const pairs=value=>new Set([...value].slice(1).map((_,i)=>value.slice(i,i+2)));
function nameSimilarity(a,b){const x=pairs(a),y=pairs(b);return x.size&&y.size?2*[...x].filter(pair=>y.has(pair)).length/(x.size+y.size):0;}
export function findClientCandidates(clients,text,{limit=8,linkedId=''}={}){
 const query=normalized(text),tokens=words(text),compact=tokens.join(''),digits=String(text||'').replace(/\D/g,'');
 return (Array.isArray(clients)?clients:[]).filter(client=>!client.hiddenFromDirectory&&!String(client.id||'').startsWith('history:')).map(client=>{
  let score=0,reason='Похожее название';
  const names=[client.name,client.fullName,client.shortName,client.legalName,client.tradeName,client.alias,...(Array.isArray(client.aliases)?client.aliases:[]),...(Array.isArray(client.alternateNames)?client.alternateNames:[])].filter(Boolean);
  for(const name of names){const value=normalized(name),parts=words(name),code=parts.join('');
   if(query&&query===value){score=Math.max(score,120);reason='Точное название';}
   else if(compact&&compact===code){score=Math.max(score,110);reason='Название без сокращений';}
   else if(compact.length>=3&&code){const common=tokens.filter(token=>parts.includes(token)),similarity=nameSimilarity(compact,code);let next=0;
    if(common.length)next=45+35*common.length/Math.max(tokens.length,parts.length);
    if(code.includes(compact)||compact.includes(code))next=Math.max(next,60+20*Math.min(code.length,compact.length)/Math.max(code.length,compact.length));
    if(similarity>=.55)next=Math.max(next,similarity*75);score=Math.max(score,next);
   }
  }
  if(digits.length>=4&&clientPhone(client).split(/[,;/]/).some(phone=>phone.replace(/\D/g,'').includes(digits))){score=130;reason='Совпадение телефона';}
  if(query.length>=4&&normalized(clientAddress(client)).includes(query))score=Math.max(score,50);
  if(client.id===linkedId){score=Math.max(score,125);reason='Связана с заказом';}
  const hasContacts=!!(clientPhone(client)||clientAddress(client));
  return {client,score:score+(score&&hasContacts?8:0),reason,hasContacts};
 }).filter(match=>match.score>0).sort((a,b)=>Number(b.hasContacts)-Number(a.hasContacts)||b.score-a.score||String(a.client.name).localeCompare(String(b.client.name),'ru')).slice(0,limit);
}
