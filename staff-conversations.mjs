const time=value=>{
 try{
  const result=value?.toMillis?.()??value?.toDate?.()?.getTime()??(typeof value?.seconds==='number'?value.seconds*1000:typeof value==='number'?value:new Date(value||0).getTime());
  return Number.isFinite(result)&&result>0?result:0;
 }catch{return 0;}
};
const urgent=notice=>notice?.isUrgent===true||notice?.isUrgent==='true'||notice?.isUrgent===1;
const text=value=>String(value||'').replace(/\s+/g,' ').trim();
const normalize=value=>text(value).normalize('NFKC').toLocaleLowerCase('ru');
const values=collection=>collection instanceof Map?[...collection.values()]:Array.isArray(collection)?collection:[];

// One row per person combines their current presence and private conversation.
// Threads/notices keep known senders reachable while the directory is loading.
export function buildStaffConversations({viewerId,directory=[],presence=new Map(),threads=[],notices=[],now=Date.now(),search='',unreadOnly=false}={}){
 if(!viewerId)return {items:[],allItems:[],unreadTotal:0,onlineCount:0,totalPeople:0};
 const people=new Map(),latestThreads=new Map(),latestNotices=new Map(),unread=new Map(),urgentCounts=new Map(),seenNotices=new Set();
 const known=new Map(values(directory).filter(person=>person?.uid).map(person=>[String(person.uid),person]));
 const add=uid=>{
  uid=String(uid||'');if(!uid||uid===String(viewerId||''))return;
  const person=known.get(uid);
  if(person?.active===false)return;
  if(!people.has(uid))people.set(uid,person||{uid,displayName:'Сотрудник',roleLabel:'Личная переписка',active:true});
 };
 for(const person of known.values())if(person.active===true)add(person.uid);
 for(const thread of values(threads)){
  if(!Array.isArray(thread?.participants)||thread.participants.length!==2||!thread.participants.includes(viewerId))continue;
  const peer=String(thread.participants.find(uid=>uid!==viewerId)||'');add(peer);
  if(!people.has(peer))continue;
  const at=time(thread.lastMessageAt||thread.updatedAt),prior=latestThreads.get(peer);
  if(!prior||at>prior.at)latestThreads.set(peer,{thread,at});
 }
 for(const notice of values(notices)){
  if(!notice||notice.read||!notice.directChatThreadId||!notice.authorId)continue;
  const peer=String(notice.authorId);add(peer);if(!people.has(peer))continue;
  const key=notice.directMessageId?JSON.stringify([notice.directChatThreadId,notice.directMessageId]):String(notice.id||JSON.stringify(notice));
  if(seenNotices.has(key))continue;seenNotices.add(key);
  unread.set(peer,(unread.get(peer)||0)+1);
  if(urgent(notice))urgentCounts.set(peer,(urgentCounts.get(peer)||0)+1);
  const at=time(notice.createdAt||notice.at),prior=latestNotices.get(peer);
  if(!prior||at>prior.at)latestNotices.set(peer,{notice,at});
 }
 const allItems=[...people.values()].map(person=>{
  const uid=String(person.uid),status=presence instanceof Map?presence.get(uid):presence?.[uid];
  const lastSeen=time(status?.updatedAt),online=status?.active===true&&lastSeen>0&&now-lastSeen<45000;
  const recent=latestThreads.get(uid),incoming=latestNotices.get(uid),notice=incoming?.notice;
  const preferNotice=incoming&&(!recent||incoming.at>recent.at);
  const preview=preferNotice?text(notice.message||notice.body||'Новое личное сообщение')
   :recent?.thread.lastMessage?((recent.thread.lastSenderId===viewerId?'Вы: ':'')+text(recent.thread.lastMessage))
   :notice?text(notice.message||notice.body||'Новое личное сообщение'):'Напишите первое сообщение';
  return {...person,uid,online,lastSeen,activity:online?text(status.activity||'В приложении'):'Не в сети',
   preview,lastActivity:Math.max(recent?.at||0,incoming?.at||0),unreadCount:unread.get(uid)||0,urgentCount:urgentCounts.get(uid)||0,
   threadId:String(notice?.directChatThreadId||recent?.thread.id||''),focusMessageId:String(notice?.directMessageId||''),newestNotice:notice||null};
 }).sort((a,b)=>Number(b.urgentCount>0)-Number(a.urgentCount>0)||Number(b.unreadCount>0)-Number(a.unreadCount>0)
  ||b.lastActivity-a.lastActivity||String(a.displayName||'').localeCompare(String(b.displayName||''),'ru')||a.uid.localeCompare(b.uid));
 const query=normalize(search);
 return {allItems,items:allItems.filter(person=>(!unreadOnly||person.unreadCount>0)&&(!query||normalize([person.displayName,person.roleLabel,person.preview].join(' ')).includes(query))),
  unreadTotal:allItems.reduce((sum,person)=>sum+person.unreadCount,0),onlineCount:allItems.filter(person=>person.online).length,totalPeople:allItems.length};
}
