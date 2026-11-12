const {createHash}=require('node:crypto');
function directPushEventId(threadId,messageId,authorId,recipientId){
 return 'direct-'+createHash('sha256').update(JSON.stringify([threadId,messageId,authorId,recipientId])).digest('hex');
}
module.exports={directPushEventId};
