import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const server=readFileSync(new URL('./index.js',import.meta.url),'utf8');
const between=(source,start,end)=>{
 const a=source.indexOf(start),b=source.indexOf(end,a);
 assert.ok(a>=0&&b>a,'Missing source boundary: '+start);
 return source.slice(a,b);
};
const siteUrl='https://hlebish.github.io/warehouse_orders/';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function serverLink(data={}){
 const source=between(server,"  const directChatThreadId = String(data.directChatThreadId || '');","\n\n  try {");
 return vm.runInNewContext(source+'\nlink;',{data,siteUrl,target:data.target||'chat',orderId:data.orderId||''});
}
function desktopLink(n={}){
 const source=between(app,'          const link=n.directChatThreadId&&n.authorId','\n          showForegroundPushNotification(');
 return vm.runInNewContext(source+'\nlink;',{n,target:n.target==='chat'?'chat':'site'});
}

test('web and native push links retain the exact private message and safely encode every identifier',()=>{
 const notice={directChatThreadId:'alice &__bob?',authorId:'Алиса + &',directMessageId:'message &?#="№1',target:'chat'};
 for(const link of [serverLink(notice),desktopLink(notice)]){
  const url=new URL(link);
  assert.equal(url.origin,'https://hlebish.github.io');
  assert.equal(url.pathname,'/warehouse_orders/');
  assert.equal(url.searchParams.get('directChat'),notice.directChatThreadId);
  assert.equal(url.searchParams.get('peer'),notice.authorId);
  assert.equal(url.searchParams.get('directMessage'),notice.directMessageId);
  assert.equal(url.hash,'');assert.equal([...url.searchParams].length,3);
 }
});

test('legacy direct links and order or general-chat links retain their existing destinations',()=>{
 const legacy={directChatThreadId:'alice__bob',authorId:'alice',target:'chat'};
 for(const link of [serverLink(legacy),desktopLink(legacy)]){
  const url=new URL(link);assert.equal(url.searchParams.get('peer'),'alice');assert.equal(url.searchParams.has('directMessage'),false);
 }
 for(const link of [serverLink({target:'chat'}),desktopLink({target:'chat'})])assert.equal(new URL(link).search,'?chat=1');
 const order={target:'site',orderId:'order &1',entryId:'entry +1'};
 for(const link of [serverLink(order),desktopLink(order)]){
  const url=new URL(link);assert.equal(url.searchParams.get('order'),order.orderId);assert.equal(url.searchParams.get('entry'),order.entryId);
 }
});

test('startup captures the private message target without inventing one for older links',()=>{
 const source=between(app,'const notificationParams=new URLSearchParams(location.search);','const $=id=>');
 for(const message of ['message &1','']){
  const url=new URL(siteUrl);url.searchParams.set('directChat','alice__bob');url.searchParams.set('peer','alice');
  if(message)url.searchParams.set('directMessage',message);
  const context={URLSearchParams,location:{search:url.search}};vm.createContext(context);vm.runInContext(source,context);
  assert.equal(context.pendingDirectChatThreadId,'alice__bob');assert.equal(context.pendingDirectChatPeerId,'alice');assert.equal(context.pendingDirectMessageId,message);
 }
});

function routingHarness(){
 const opened=[],events=[];
 const context={signedInUser:{uid:'bob'},pendingDirectChatThreadId:'alice__bob',pendingDirectChatPeerId:'alice',pendingDirectMessageId:'old-message',
  resolveDirectChatPeer:async uid=>uid==='alice'?{uid,displayName:'Алиса'}:null,
  openDirectChat:async(...args)=>opened.push(args),toast:message=>events.push(message)};
 vm.createContext(context);
 vm.runInContext(between(app,'async function openPendingDirectChat(){','async function resolveDirectChatPeer('),context);
 return {context,opened,events};
}

test('pending notification targets survive sign-in and are consumed with the exact message once ready',async()=>{
 const {context,opened}=routingHarness();context.signedInUser=null;
 await context.openPendingDirectChat();assert.equal(opened.length,0);assert.equal(context.pendingDirectMessageId,'old-message');
 context.signedInUser={uid:'bob'};await context.openPendingDirectChat();
 assert.equal(opened.length,1);assert.equal(opened[0][0].uid,'alice');assert.equal(opened[0][1],'alice__bob');assert.equal(opened[0][2],'old-message');
 assert.equal(context.pendingDirectChatThreadId,'');assert.equal(context.pendingDirectChatPeerId,'');assert.equal(context.pendingDirectMessageId,'');
 await context.openPendingDirectChat();assert.equal(opened.length,1);
});

test('in-app notices target their own message, while a missing peer never opens another conversation',async()=>{
 const {context,opened,events}=routingHarness();let closed=0;
 context.closeModal=()=>closed++;context.openOrderAtEntry=()=>{};context.openChat=()=>{};context.showNotifications=()=>{};
 vm.runInContext(between(app,'async function openMentionNotice(n){','function showDirectUrgentAlert('),context);
 await context.openMentionNotice({directChatThreadId:'alice__bob',authorId:'alice',directMessageId:'notice-message'});
 assert.equal(closed,1);assert.equal(opened[0][2],'notice-message');
 await context.openDirectChatByIds('unknown__bob','unknown','missing');assert.equal(opened.length,1);assert.equal(events.length,1);
});

test('native notification handoff propagates exact messages and preserves same-origin restrictions',()=>{
 const source=between(app,' window.handleNativeNotificationLink=rawUrl=>{','\n };')+'\n };';
 const calls=[],rewrites=[];
 const context={window:{},URL,location:{href:siteUrl,origin:new URL(siteUrl).origin,pathname:'/warehouse_orders/',hash:''},
  history:{replaceState:(...args)=>rewrites.push(args)},signedInUser:{uid:'bob'},
  openPendingDirectChat:()=>calls.push([context.pendingDirectChatThreadId,context.pendingDirectChatPeerId,context.pendingDirectMessageId]),
  openPendingNotificationOrder(){},openChat(){},console:{warn(){}}};
 vm.createContext(context);vm.runInContext(source,context);
 assert.equal(context.window.handleNativeNotificationLink(siteUrl+'?directChat=alice__bob&peer=alice&directMessage=message%26id'),true);
 assert.deepEqual(calls,[['alice__bob','alice','message&id']]);
 assert.equal(context.window.handleNativeNotificationLink(siteUrl+'?directChat=alice__bob&peer=alice'),true);
 assert.equal(calls[1][2],'');
 const before=rewrites.length;
 assert.equal(context.window.handleNativeNotificationLink('https://other.invalid/?directChat=alice__bob&peer=alice&directMessage=foreign'),false);
 assert.equal(calls.length,2);assert.equal(rewrites.length,before);
});

test('notification history buttons keep each individual message target and escape attributes',()=>{
 const context={esc};vm.createContext(context);
 vm.runInContext(between(app,"function directChatNoticeButton(notice,className='small-button'){",'function showNotifications(){'),context);
 const first={directChatThreadId:'alice__bob',authorId:'alice',directMessageId:'one" onclick="bad'};
 const html=context.directChatNoticeButton(first);
 assert.match(html,/data-open-direct-chat-message="one&quot; onclick=&quot;bad"/);assert.match(html,/>К сообщению<\/button>/);
 assert.equal(context.directChatNoticeButton({authorId:'alice'}),'');
 const entries=[first,{...first,directMessageId:'second'}];
 context.entries=entries;context.fmtDateTime=()=>'';
 const historySource=between(app,'      const history=entries.length>1?', '\n      const openButton=');
 const history=vm.runInContext(historySource+'\nhistory;',context);
 assert.match(history,/data-open-direct-chat-message="second"/);assert.equal((history.match(/data-open-direct-chat-message=/g)||[]).length,2);
});

test('notification-center clicks pass the selected individual message rather than the newest one',()=>{
 const source=between(app,'    if(openDirectChatButton){e.preventDefault();closeModal();void openDirectChatByIds(', '\n    else if(openButton)');
 const opened=[];let closed=0;
 vm.runInNewContext(source,{openDirectChatButton:{dataset:{openDirectChatThread:'alice__bob',openDirectChatPeer:'alice',openDirectChatMessage:'selected-old-message'}},
  e:{preventDefault(){}},closeModal:()=>closed++,openDirectChatByIds:(...args)=>opened.push(args)});
 assert.equal(closed,1);assert.deepEqual(opened,[['alice__bob','alice','selected-old-message']]);
});
