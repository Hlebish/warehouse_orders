const urgent=notice=>notice?.isUrgent===true||notice?.isUrgent==='true'||notice?.isUrgent===1;
const messageKey=(threadId,messageId)=>JSON.stringify([threadId,messageId]);

// Keep confirmed reads for this signed-in account after a dialog closes, since
// notification history can arrive after the message and its read receipt.
export function createDirectChatNoticeSync({viewerId,isCurrentAccount,markRead,onError=()=>{}}){
 let notices=[],disposed=false;
 const proofs=new Map(),pending=new Set(),confirmed=new Set(),failed=new Set();
 const current=()=>!disposed&&isCurrentAccount();
 function proofFor(threadId,message){
  if(!threadId||!message?.id||!message.authorId||message.authorId===viewerId)return null;
  const key=messageKey(threadId,message.id);
  let proof=proofs.get(key);
  if(!proof||proof.authorId!==message.authorId){
   proof={authorId:message.authorId,read:false,urgent:false};proofs.set(key,proof);
  }
  return proof;
 }
 function eligible(notice){
  if(!notice?.id||notice.read||!notice.directChatThreadId||!notice.directMessageId||!notice.authorId||notice.authorId===viewerId)return false;
  const proof=proofs.get(messageKey(notice.directChatThreadId,notice.directMessageId));
  return !!proof&&proof.authorId===notice.authorId&&(urgent(notice)?proof.urgent:proof.read);
 }
 function flush(){
  if(!current())return;
  for(const notice of notices){
   if(!eligible(notice)||pending.has(notice.id)||confirmed.has(notice.id)||failed.has(notice.id))continue;
   pending.add(notice.id);
   void Promise.resolve().then(async()=>{
    if(!current())return;
    const result=await markRead(notice);
    if(result?.failed)throw new Error('Не удалось отметить уведомление о личном сообщении прочитанным.');
    confirmed.add(notice.id);
   }).catch(error=>{
    failed.add(notice.id);
    if(current())onError(error,notice);
   }).finally(()=>pending.delete(notice.id));
  }
 }
 return {
  observeMessages(threadId,messages=[]){
   if(!current())return;
   for(const message of messages){
    if(message.hasPendingWrites===true)continue;
    const proof=proofFor(threadId,message);if(!proof)continue;
    if(Array.isArray(message.readBy)&&message.readBy.includes(viewerId))proof.read=true;
    if(Array.isArray(message.urgentAckBy)&&message.urgentAckBy.includes(viewerId)){proof.urgent=true;proof.read=true;}
   }
   flush();
  },
  confirmRead(threadId,message){
   if(!current())return;
   const proof=proofFor(threadId,message);if(proof)proof.read=true;
   flush();
  },
  confirmUrgentRead(threadId,messageId){
   if(!current())return;
   const proof=proofs.get(messageKey(threadId,messageId));
   if(proof){proof.urgent=true;proof.read=true;}
   flush();
  },
  updateNotices(nextNotices=[]){if(!current())return;notices=nextNotices;flush();},
  retry(){if(!current())return;failed.clear();flush();},
  dispose(){disposed=true;notices=[];proofs.clear();pending.clear();confirmed.clear();failed.clear();}
 };
}
