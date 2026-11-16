// Each message has its own write: a rejected legacy receipt must not block
// the rest of the conversation. Do not trust optimistic snapshots as a
// successful write, and do not loop on their rollback after a rejection.
export function createDirectChatReceipts({viewerId,isActive,markRead,onError=()=>{}}){
 let messages=[],disposed=false;
 const pending=new Set(),confirmed=new Set(),failed=new Set();
 function flush(){
  if(disposed||!isActive())return;
  for(const message of messages){
   if(!message.id||!message.authorId||message.authorId===viewerId
     ||(Array.isArray(message.readBy)&&message.readBy.includes(viewerId))
     ||pending.has(message.id)||confirmed.has(message.id)||failed.has(message.id))continue;
   pending.add(message.id);
   void Promise.resolve().then(()=>{
    if(disposed||!isActive())return false;
    return Promise.resolve(markRead(message)).then(()=>true);
   }).then(saved=>{
    if(saved)confirmed.add(message.id);
   }).catch(error=>{
    failed.add(message.id);
    if(!disposed)onError(error);
   }).finally(()=>pending.delete(message.id));
  }
 }
 return {
  update(nextMessages){messages=nextMessages;flush();},
  retry(){failed.clear();flush();},
  dispose(){disposed=true;messages=[];}
 };
}
