const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {forwardedRecipients}=require('./forwarded-context');
const {directPushEventId}=require('./direct-push-id');
const server=readFileSync(require('node:path').join(__dirname,'index.js'),'utf8');
const app=readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function between(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i);return s.slice(i,j);}
test('group messages enqueue once, exclude only recipients of forwarded cards',async()=>{
 const queue=new Map();
 const db={collection:()=>({doc:id=>({create:async data=>{if(queue.has(id))throw Object.assign(Error('exists'),{code:6});queue.set(id,data);}})})};
 const ctx={db,createHash,forwardedRecipients};
 vm.createContext(ctx);
 vm.runInContext(between(server,'async function createChatPushOnce(','exports.forwardGroupChatContext='),ctx);
 const source=(id,data)=>({id,ref:{path:'chatMessages/'+id},data:()=>data});
 await ctx.queueGroupChatPush(source('1',{authorId:'a',authorName:'A',text:'Hello'}));
 await ctx.queueGroupChatPush(source('1',{authorId:'a',authorName:'A',text:'Hello'}));
 await ctx.queueGroupChatPush(source('2',{authorId:'a',text:'@B',mentionUserIds:['b'],replyToAuthorId:'b'}));
 assert.equal(queue.size,2);
 const [plain,addressed]=[...queue.values()];
 assert.equal(plain.category,'chat');assert.equal(plain.recipientUserId,'');assert.deepEqual(Array.from(plain.excludedRecipientIds),[]);
 assert.deepEqual(Array.from(addressed.excludedRecipientIds),['b']);
});
test('direct send uses one atomic commit and only reads on ambiguous failure',async()=>{
 let commits=0,reads=0;const saved={authorId:'a',text:'hello',photos:[],isUrgent:false};
 const context={db:{},doc:(_,...p)=>p.join('/'),serverTimestamp:()=>0,writeBatch:()=>({set(){},update(){},async commit(){commits++;}}),getDocFromServer:async()=>{reads++;return {exists:()=>true,data:()=>saved};}};
 vm.createContext(context);vm.runInContext(between(app,'async function commitDirectChatMessage(','async function acknowledgeDirectUrgentMessage('),context);
 assert.equal((await context.commitDirectChatMessage('a__b','m',saved)).duplicate,false);assert.equal(commits,1);assert.equal(reads,0);
 context.writeBatch=()=>({set(){},update(){},async commit(){throw Error('already saved');}});
 assert.equal((await context.commitDirectChatMessage('a__b','m',saved)).duplicate,true);assert.equal(reads,1);
 await assert.rejects(context.commitDirectChatMessage('a__b','m',{...saved,text:'changed'}),/другим содержимым/);
});

test('private message enqueue targets only the other participant and ignores forwarded cards',async()=>{
 const queue=new Map(),exports={};
 const db={collection:kind=>({doc:id=>({
  create:async data=>{if(queue.has(id))throw Object.assign(Error('exists'),{code:6});queue.set(id,data);},
  get:async()=>({exists:kind==='directChats',data:()=>({participants:['a','b']})})
 })})};
 const context={db,createHash,forwardedRecipients,directPushEventId,exports,onDocumentCreated:(_config,handler)=>handler,forwardAddressedMessage:async()=>{}};
 vm.createContext(context);
 vm.runInContext(between(server,'async function createChatPushOnce(','exports.forwardOrderCommentContext='),context);
 const event={params:{threadId:'a__b',messageId:'1'},data:{data:()=>({authorId:'a',authorName:'A',text:'private'})}};
 await exports.queueDirectChatPush(event);await exports.queueDirectChatPush(event);
 await exports.queueDirectChatPush({...event,params:{threadId:'a__b',messageId:'2'},data:{data:()=>({authorId:'a',forwardedContext:{kind:'chat'}})}});
 assert.equal(queue.size,1);
 assert.equal(queue.get(directPushEventId('a__b','1','a','b')).recipientUserId,'b');
});
