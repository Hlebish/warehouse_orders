// Source metadata is written only by Admin SDK, never by clients.
const validUid=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!value.includes('/');
function forwardedRecipients(source={}){
 const recipients=new Map();
 for(const uid of Array.isArray(source.mentionUserIds)?source.mentionUserIds:[]){
  if(validUid(uid)&&uid!==source.authorId)recipients.set(uid,{isMention:true,isReply:false});
 }
 if(validUid(source.replyToAuthorId)&&source.replyToAuthorId!==source.authorId){
  const previous=recipients.get(source.replyToAuthorId);
  recipients.set(source.replyToAuthorId,{isMention:previous?.isMention===true,isReply:true});
 }
 return [...recipients].map(([uid,flags])=>({uid,...flags}));
}
module.exports={forwardedRecipients};
