function messageTime(value){
 try{
  const time=typeof value?.toMillis==='function'?value.toMillis()
   :typeof value?.toDate==='function'?value.toDate().getTime()
   :value instanceof Date?value.getTime():value==null?NaN:new Date(value).getTime();
  // A local serverTimestamp can be unresolved while its message is sending.
  return Number.isFinite(time)?time:Infinity;
 }catch{return Infinity;}
}
function ascending(a,b){
 const left=messageTime(a.createdAt),right=messageTime(b.createdAt);
 if(left!==right)return left<right?-1:1;
 const x=String(a.id),y=String(b.id);return x<y?-1:x>y?1:0;
}
const searchable=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ru');
const cursorIdentity=value=>value?.id??value;

// Recent messages stay live through the caller's subscription. Older pages are
// fetched only on request or while searching the complete conversation.
export function createDirectChatHistory({loadPage,onChange=()=>{},onError=()=>{},pageSize=100}){
 const records=new Map(),liveRevisions=new Map();
 let cursor=null,hasMore=true,loading=false,error=null,search='',searching=false;
 let disposed=false,paginationSeeded=false,paginationStarted=false,inFlight=null;
 let revision=0,searchGeneration=0,focusGeneration=0;
 function getState(){
  const allMessages=[...records.values()].sort(ascending),term=searchable(search);
  const messages=term?allMessages.filter(message=>searchable(message.text).includes(term)
   ||searchable(message.article).includes(term)):allMessages;
  return {messages,allMessages,search,searching,loading,hasMore,error};
 }
 const emit=()=>{if(!disposed)onChange(getState());};
 function fetchNext(){
  if(disposed||!hasMore)return Promise.resolve();
  if(inFlight)return inFlight;
  const requestedCursor=cursor,requestRevision=revision;
  paginationStarted=true;loading=true;error=null;
  inFlight=Promise.resolve().then(()=>{
   if(disposed)return null;
   return loadPage(requestedCursor);
  }).then(page=>{
   if(disposed||!page)return;
   if(!Array.isArray(page.messages))throw new Error('Не удалось прочитать страницу переписки.');
   const more=page.hasMore===undefined?page.messages.length>=pageSize:page.hasMore===true;
   if(more&&page.messages.length&&(page.cursor==null||cursorIdentity(page.cursor)===cursorIdentity(requestedCursor)))
    throw new Error('Не удалось продолжить загрузку истории. Повторите попытку.');
   for(const message of page.messages){
    if(!message?.id||(liveRevisions.get(message.id)||0)>requestRevision)continue;
    records.set(message.id,message);
   }
   cursor=page.cursor??cursor;
   hasMore=page.messages.length>0&&more;
  }).catch(reason=>{
   if(disposed)return;
   error=reason;onError(reason);
  }).finally(()=>{
   loading=false;inFlight=null;emit();
  });
  emit();return inFlight;
 }
 async function scan(generation){
  while(!disposed&&generation===searchGeneration&&search&&hasMore){
   await fetchNext();
   if(error)break;
  }
  if(!disposed&&generation===searchGeneration){searching=false;emit();}
  return getState();
 }
 function setSearch(value=''){
  if(disposed)return Promise.resolve(getState());
  search=String(value).trim();error=null;focusGeneration++;
  const generation=++searchGeneration;
  searching=!!search&&hasMore;emit();
  return searching?scan(generation):Promise.resolve(getState());
 }
 return {
  getState,
  updateRecent(messages=[],pagination){
   if(disposed)return;
   const liveRevision=++revision;
   const liveIds=new Set(messages.map(message=>message.id));
   for(const [id,message] of records)if(message.hasPendingWrites===true&&!liveIds.has(id)){records.delete(id);liveRevisions.set(id,liveRevision);}
   for(const message of messages){if(message?.id){records.set(message.id,message);liveRevisions.set(message.id,liveRevision);}}
   // A cache snapshot may be incomplete. The caller passes pagination only
   // after a server snapshot; page reads must never reset an established cursor.
   if(pagination&&!paginationSeeded&&!paginationStarted){
    cursor=pagination.cursor??null;
    hasMore=pagination.hasMore===undefined?messages.length>=pageSize:pagination.hasMore===true;
    paginationSeeded=true;
   }
   emit();
   if(search&&hasMore&&!searching&&!error)void setSearch(search);
  },
  async loadOlder(){await fetchNext();return getState();},
  setSearch,
  async ensureMessage(messageId){
   const id=String(messageId||''),generation=++focusGeneration;
   if(!id||disposed)return null;
   while(!disposed&&generation===focusGeneration&&!records.has(id)&&hasMore){
    await fetchNext();if(error)break;
   }
   return !disposed&&generation===focusGeneration?records.get(id)||null:null;
  },
  dispose(){disposed=true;searchGeneration++;focusGeneration++;records.clear();liveRevisions.clear();}
 };
}
