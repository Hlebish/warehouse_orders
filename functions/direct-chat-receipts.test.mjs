import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createDirectChatReceipts} from '../direct-chat-receipts.mjs';
import {createDirectChatNoticeSync} from '../direct-chat-notices.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const incoming=(id,patch={})=>({id,authorId:'alice',text:'Сообщение',readBy:['alice'],...patch});
function receiptsHarness(overrides={}){
 const calls=[],errors=[];
 const controller=createDirectChatReceipts({viewerId:'bob',isActive:()=>true,
  markRead:async message=>{calls.push(message.id);},onError:error=>errors.push(error),...overrides});
 return {controller,calls,errors};
}

test('a rejected legacy receipt does not prevent other incoming messages being read',async()=>{
 const attempted=[],saved=[],error=Object.assign(new Error('Legacy rejection'),{code:'permission-denied'});
 const {controller,errors}=receiptsHarness({markRead:async message=>{
  attempted.push(message.id);if(message.id==='bad')throw error;saved.push(message.id);
 }});
 controller.update([incoming('bad'),incoming('text'),incoming('photo',{text:'',photos:['private.jpg']})]);
 await settle();
 assert.deepEqual(attempted,['bad','text','photo']);
 assert.deepEqual(saved,['text','photo']);assert.deepEqual(errors,[error]);
});

test('optimistic read snapshots and their rollback do not create a denied-write loop',async()=>{
 let rejectWrite,calls=0;
 const {controller,errors}=receiptsHarness({markRead:()=>{calls++;return new Promise((resolve,reject)=>{rejectWrite=reject;});}});
 controller.update([incoming('legacy')]);await settle();
 controller.update([incoming('legacy',{readBy:['alice','bob']})]);
 controller.update([incoming('legacy')]); // Rollback can arrive before rejection settles.
 rejectWrite(new Error('permission-denied'));await settle();
 controller.update([incoming('legacy')]);controller.update([incoming('legacy')]);await settle();
 assert.equal(calls,1);assert.equal(errors.length,1);
});

test('failed receipts can be retried without another message snapshot',async()=>{
 let available=false,calls=0;
 const {controller,errors}=receiptsHarness({markRead:async()=>{calls++;if(!available)throw Error('unavailable');}});
 controller.update([incoming('a')]);await settle();assert.equal(errors.length,1);
 available=true;controller.retry();await settle();assert.equal(calls,2);
 controller.update([incoming('a')]);controller.retry();await settle();assert.equal(calls,2);
});

test('a background conversation waits until it becomes visible before recording reads',async()=>{
 let active=false;
 const {controller,calls}=receiptsHarness({isActive:()=>active});
 controller.update([incoming('hidden')]);await settle();assert.deepEqual(calls,[]);
 active=true;controller.retry();await settle();assert.deepEqual(calls,['hidden']);
});

test('closing a conversation or changing account before a queued write prevents the receipt',async()=>{
 for(const transition of ['close','account','thread']){
  let current={visible:true,uid:'bob',thread:'alice__bob'};
  const {controller,calls}=receiptsHarness({isActive:()=>current.visible&&current.uid==='bob'&&current.thread==='alice__bob'});
  controller.update([incoming('queued')]);
  if(transition==='close')current.visible=false;
  if(transition==='account')current.uid='other';
  if(transition==='thread')current.thread='bob__other';
  await settle();assert.deepEqual(calls,[],transition);
 }
});

test('own messages and existing recipient receipts are skipped; missing legacy receipts are recorded',async()=>{
 const {controller,calls}=receiptsHarness();
 controller.update([incoming('own',{authorId:'bob'}),incoming('already',{readBy:['alice','bob']}),
  incoming('missing',{readBy:undefined}),incoming('empty',{readBy:[]}),incoming('no-author',{authorId:''})]);
 await settle();assert.deepEqual(calls,['missing','empty']);
});

test('repeated snapshots do not duplicate an in-flight write or a confirmed receipt',async()=>{
 let finish,calls=0;
 const {controller}=receiptsHarness({markRead:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
 controller.update([incoming('same')]);controller.update([incoming('same')]);await settle();
 controller.retry();controller.update([incoming('same')]);await settle();assert.equal(calls,1);
 finish();await settle();controller.update([incoming('same')]);await settle();assert.equal(calls,1);
});

test('disposal cancels queued reads and silences failures from a previous conversation',async()=>{
 const first=receiptsHarness();first.controller.update([incoming('queued')]);first.controller.dispose();
 first.controller.retry();await settle();assert.deepEqual(first.calls,[]);
 let fail;
 const second=receiptsHarness({markRead:()=>new Promise((resolve,reject)=>{fail=reject;})});
 second.controller.update([incoming('pending')]);await settle();second.controller.dispose();
 fail(Error('late failure'));await settle();assert.deepEqual(second.errors,[]);
});

function notificationView(update=async()=>{}){
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const start=source.indexOf('async function markNotificationItemsRead('),end=source.indexOf('async function markNotificationsRead(',start);
 assert.ok(start>=0&&end>start);
 const writes=[],refreshes=[];
 const context={signedInUser:{uid:'bob'},db:{},doc:(_db,...parts)=>parts.join('/'),
  updateDoc:async(path,patch)=>{writes.push({path,patch});await update(path,patch);},
  paintNotices:()=>refreshes.push('paint'),refreshNotificationCenter:()=>refreshes.push('center'),
  renderStaffPanel:()=>refreshes.push('staff'),toast:()=>{},console:{warn(){}}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return {markRead:notice=>context.markNotificationItemsRead([notice]),writes,refreshes};
}
const directNotice=()=>({id:'notice',authorId:'alice',directChatThreadId:'alice__bob',directMessageId:'message',read:false,isUrgent:false});

test('optimistic receipts and failed writes never clear a matching unread notification',async()=>{
 let rejectRead,onReads=0;
 const view=notificationView(),notice=directNotice();
 const sync=createDirectChatNoticeSync({viewerId:'bob',isCurrentAccount:()=>true,markRead:view.markRead});
 const {controller}=receiptsHarness({markRead:()=>new Promise((resolve,reject)=>{rejectRead=reject;}),
  onRead:message=>{onReads++;sync.confirmRead('alice__bob',message);}});
 sync.updateNotices([notice]);controller.update([incoming('message')]);await settle();
 const optimistic=incoming('message',{readBy:['alice','bob'],hasPendingWrites:true});
 controller.update([optimistic]);sync.observeMessages('alice__bob',[optimistic]);await settle();
 assert.equal(notice.read,false);assert.equal(view.writes.length,0);assert.equal(onReads,0);
 rejectRead(Error('permission-denied'));await settle();
 controller.update([incoming('message')]);sync.observeMessages('alice__bob',[incoming('message')]);await settle();
 assert.equal(notice.read,false);assert.equal(view.writes.length,0);assert.equal(onReads,0);
});

test('a successful message read callback clears its existing notice and refreshes the badges',async()=>{
 let finishRead;
 const view=notificationView(),notice=directNotice();
 const sync=createDirectChatNoticeSync({viewerId:'bob',isCurrentAccount:()=>true,markRead:view.markRead});
 const {controller}=receiptsHarness({markRead:()=>new Promise(resolve=>{finishRead=resolve;}),
  onRead:message=>sync.confirmRead('alice__bob',message)});
 sync.updateNotices([notice]);controller.update([incoming('message')]);await settle();
 assert.equal(notice.read,false);assert.equal(view.writes.length,0);
 finishRead();await settle();
 assert.equal(notice.read,true);assert.equal(view.writes.length,1);
 assert.equal(view.writes[0].path,'users/bob/notifications/notice');assert.equal(view.writes[0].patch.read,true);
 assert.deepEqual(view.refreshes,['paint','center','staff']);
});

test('a read that finishes after closing the chat keeps proof for a notification arriving later',async()=>{
 let finishRead,onReads=0;
 const view=notificationView(),notice=directNotice();
 const sync=createDirectChatNoticeSync({viewerId:'bob',isCurrentAccount:()=>true,markRead:view.markRead});
 const {controller}=receiptsHarness({markRead:()=>new Promise(resolve=>{finishRead=resolve;}),
  onRead:message=>{onReads++;sync.confirmRead('alice__bob',message);}});
 controller.update([incoming('message')]);await settle();controller.dispose();finishRead();await settle();
 assert.equal(onReads,1);assert.equal(view.writes.length,0);
 sync.updateNotices([notice]);await settle();
 assert.equal(notice.read,true);assert.equal(view.writes.length,1);assert.deepEqual(view.refreshes,['paint','center','staff']);
});

test('a rejected notification update leaves the local notice unread until a successful write',async()=>{
 let finish,available=false;
 const view=notificationView(()=>new Promise((resolve,reject)=>{finish=()=>available?resolve():reject(Error('unavailable'));}));
 const notice=directNotice(),failedWrite=view.markRead(notice);
 await settle();assert.equal(notice.read,false);assert.deepEqual(view.refreshes,[]);
 finish();const failure=await failedWrite;
 assert.equal(failure.failed,1);assert.equal(notice.read,false);assert.deepEqual(view.refreshes,['paint','center','staff']);
 available=true;view.refreshes.length=0;
 const successfulWrite=view.markRead(notice);await settle();
 assert.equal(notice.read,false);assert.deepEqual(view.refreshes,[]);
 finish();const success=await successfulWrite;
 assert.equal(success.failed,0);assert.equal(notice.read,true);assert.deepEqual(view.refreshes,['paint','center','staff']);
});

function senderView(){
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const start=source.indexOf('function renderDirectChatMessages('),end=source.indexOf('async function commitDirectChatMessage(',start);
 assert.ok(start>=0&&end>start);
 const box={dataset:{},scrollHeight:100,clientHeight:100,scrollTop:0,innerHTML:'',querySelectorAll:()=>[]};
 const context={$:()=>box,signedInUser:{uid:'alice'},directChatTarget:{uid:'bob'},
  esc:value=>String(value??''),chatDay:()=> 'Сегодня',chatTime:()=> '12:00',fmtDateTime:()=> '16.11.2026 12:00',
  renderChatText:value=>value,shownDirectUrgentAlerts:new Set(),showDirectUrgentAlert(){},loadDirectPhoto(){}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return {render:messages=>{context.renderDirectChatMessages(messages);return box.innerHTML;}};
}

test('sender status changes from Sent to Read only when the actual recipient has a receipt',async()=>{
 const view=senderView(),message=incoming('live');
 assert.match(view.render([message]),/✓ Отправлено/);
 assert.doesNotMatch(view.render([{...message,readBy:['alice','outsider']}]),/✓✓ Прочитано/);
 const {controller}=receiptsHarness({markRead:async()=>{message.readBy=['alice','bob'];}});
 controller.update([message]);await settle();
 const rendered=view.render([message]);assert.match(rendered,/✓✓ Прочитано/);
 assert.match(rendered,/direct-chat-read-status is-read/);assert.doesNotMatch(rendered,/✓ Отправлено/);
});

test('photo-only outgoing messages show Read while incoming messages have no sender status',()=>{
 const view=senderView();
 const photo=incoming('photo',{text:'',photos:['directChats/alice__bob/alice/photo/0.jpg'],readBy:['alice','bob']});
 const rendered=view.render([photo]);assert.match(rendered,/data-direct-photo=/);assert.match(rendered,/✓✓ Прочитано/);
 const incomingRendered=view.render([{...photo,authorId:'bob'}]);
 assert.doesNotMatch(incomingRendered,/direct-chat-read-status/);
});

test('explicit urgent confirmation from the recipient also proves the message was read',()=>{
 const view=senderView(),message=incoming('urgent',{isUrgent:true,urgentAckBy:['bob']});
 assert.match(view.render([message]),/✓✓ Прочитано/);
 assert.match(view.render([{...message,urgentAckBy:['alice']}]),/✓ Отправлено/);
 assert.match(view.render([{...message,urgentAckBy:['outsider']}]),/✓ Отправлено/);
 assert.match(view.render([{...message,isUrgent:false}]),/✓ Отправлено/);
});
