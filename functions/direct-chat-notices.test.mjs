import test from 'node:test';
import assert from 'node:assert/strict';
import {createDirectChatNoticeSync} from '../direct-chat-notices.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const incoming=(patch={})=>({id:'message',authorId:'alice',readBy:['alice'],urgentAckBy:[],...patch});
const notice=(patch={})=>({id:'notice',authorId:'alice',directChatThreadId:'alice__bob',directMessageId:'message',read:false,isUrgent:false,...patch});
function harness(overrides={}){
 const calls=[],errors=[];
 const sync=createDirectChatNoticeSync({viewerId:'bob',isCurrentAccount:()=>true,
  markRead:async value=>{calls.push(value.id);return {failed:0};},onError:error=>errors.push(error),...overrides});
 return {sync,calls,errors};
}

test('a notification received before the message clears after its read is confirmed',async()=>{
 const {sync,calls}=harness();sync.updateNotices([notice()]);await settle();assert.deepEqual(calls,[]);
 sync.observeMessages('alice__bob',[incoming()]);await settle();assert.deepEqual(calls,[]);
 sync.confirmRead('alice__bob',incoming());await settle();assert.deepEqual(calls,['notice']);
});

test('read proof survives closing the dialog and clears a notification that arrives later',async()=>{
 const {sync,calls}=harness();sync.confirmRead('alice__bob',incoming());
 // Opening a different conversation does not discard confirmed prior reads.
 sync.observeMessages('bob__carol',[incoming({id:'other-message',authorId:'carol'})]);
 sync.updateNotices([notice()]);await settle();assert.deepEqual(calls,['notice']);
});

test('new read messages in an open conversation clear their own notifications independently',async()=>{
 const {sync,calls}=harness();
 sync.updateNotices([notice(),notice({id:'next-notice',directMessageId:'next-message'})]);
 sync.confirmRead('alice__bob',incoming());await settle();assert.deepEqual(calls,['notice']);
 sync.confirmRead('alice__bob',incoming({id:'next-message'}));await settle();assert.deepEqual(calls,['notice','next-notice']);
});

test('a confirmed server receipt clears a notice while optimistic and unread snapshots do not',async()=>{
 const {sync,calls}=harness();sync.updateNotices([notice()]);
 sync.observeMessages('alice__bob',[incoming({readBy:['alice','bob'],hasPendingWrites:true})]);
 sync.observeMessages('alice__bob',[incoming()]);await settle();assert.deepEqual(calls,[]);
 sync.observeMessages('alice__bob',[incoming({readBy:['alice','bob'],hasPendingWrites:false})]);
 await settle();assert.deepEqual(calls,['notice']);
});

test('thread, message and author must match and legacy notices without message IDs stay untouched',async()=>{
 const {sync,calls}=harness();sync.confirmRead('alice__bob',incoming());
 sync.updateNotices([
  notice({id:'wrong-thread',directChatThreadId:'alice__other'}),
  notice({id:'wrong-message',directMessageId:'other-message'}),
  notice({id:'wrong-author',authorId:'carol'}),notice({id:'own-author',authorId:'bob'}),
  notice({id:'legacy',directMessageId:''}),notice({id:'already-read',read:true}),notice()
 ]);
 await settle();assert.deepEqual(calls,['notice']);
});

test('own messages cannot establish a read proof',async()=>{
 const {sync,calls}=harness();const own=incoming({authorId:'bob',readBy:['bob']});
 sync.observeMessages('alice__bob',[own]);sync.confirmRead('alice__bob',own);
 sync.updateNotices([notice()]);await settle();assert.deepEqual(calls,[]);
});

test('urgent notices require explicit acknowledgement for every supported urgent flag',async()=>{
 for(const flag of [true,'true',1]){
  const {sync,calls}=harness();sync.updateNotices([notice({isUrgent:flag})]);
  sync.confirmRead('alice__bob',incoming());await settle();assert.deepEqual(calls,[]);
  sync.confirmUrgentRead('alice__bob','message');await settle();assert.deepEqual(calls,['notice']);
 }
});

test('server urgent acknowledgement clears a late notice but an optimistic one does not',async()=>{
 const {sync,calls}=harness();sync.updateNotices([notice({isUrgent:true})]);
 sync.observeMessages('alice__bob',[incoming({urgentAckBy:['bob'],hasPendingWrites:true})]);await settle();assert.deepEqual(calls,[]);
 sync.observeMessages('alice__bob',[incoming({urgentAckBy:['bob']})]);await settle();assert.deepEqual(calls,['notice']);
});

test('an urgent confirmation without a known incoming author cannot clear a notice',async()=>{
 const {sync,calls}=harness();sync.confirmUrgentRead('alice__bob','message');
 sync.updateNotices([notice({isUrgent:true})]);await settle();assert.deepEqual(calls,[]);
});

test('pending writes and successful writes are deduplicated across notification snapshots',async()=>{
 let finish,count=0;const {sync}=harness({markRead:()=>{count++;return new Promise(resolve=>{finish=resolve;});}});
 sync.confirmRead('alice__bob',incoming());sync.updateNotices([notice()]);sync.updateNotices([notice()]);
 await settle();sync.retry();await settle();assert.equal(count,1);
 finish({failed:0});await settle();sync.updateNotices([notice()]);sync.retry();await settle();assert.equal(count,1);
});

test('a failed notification write does not loop and can be retried without a new snapshot',async()=>{
 let available=false,count=0;
 const {sync,errors}=harness({markRead:async()=>{count++;return {failed:available?0:1};}});
 sync.confirmRead('alice__bob',incoming());sync.updateNotices([notice()]);await settle();
 sync.updateNotices([notice()]);sync.observeMessages('alice__bob',[incoming({readBy:['bob']})]);await settle();
 assert.equal(count,1);assert.equal(errors.length,1);
 available=true;sync.retry();await settle();assert.equal(count,2);
});

test('a rejected write is isolated from other notices',async()=>{
 const saved=[],{sync,errors}=harness({markRead:async value=>{if(value.id==='broken')throw Error('permission-denied');saved.push(value.id);return {failed:0};}});
 sync.confirmRead('alice__bob',incoming());sync.updateNotices([notice({id:'broken'}),notice()]);await settle();
 assert.deepEqual(saved,['notice']);assert.equal(errors.length,1);
});

test('account changes and disposal prevent queued writes and silence stale failures',async()=>{
 for(const dispose of [true,false]){
  let current=true;const {sync,calls}=harness({isCurrentAccount:()=>current});
  sync.confirmRead('alice__bob',incoming());sync.updateNotices([notice()]);
  if(dispose)sync.dispose();else current=false;
  await settle();sync.retry();await settle();assert.deepEqual(calls,[]);
 }
 let fail;const {sync,errors}=harness({markRead:()=>new Promise((resolve,reject)=>{fail=reject;})});
 sync.confirmRead('alice__bob',incoming());sync.updateNotices([notice()]);await settle();sync.dispose();
 fail(Error('late failure'));await settle();assert.deepEqual(errors,[]);
});
