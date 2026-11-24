const {test}=require('node:test');
const assert=require('node:assert/strict');
const {forwardedRecipients}=require('./forwarded-context');
test('mentions and reply are deduplicated and never sent to the author',()=>{
 assert.deepEqual(forwardedRecipients({authorId:'a',mentionUserIds:['a','b','b','c','bad/id'],replyToAuthorId:'b'}),[{uid:'b',isMention:true,isReply:true},{uid:'c',isMention:true,isReply:false}]);
});
test('ordinary message is not forwarded; reply alone is forwarded',()=>{
 assert.deepEqual(forwardedRecipients({authorId:'a'}),[]);
 assert.deepEqual(forwardedRecipients({authorId:'a',replyToAuthorId:'b'}),[{uid:'b',isMention:false,isReply:true}]);
});
