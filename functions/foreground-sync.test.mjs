import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createForegroundSync} from '../foreground-sync.mjs';

function harness(reconnect){
 let time=0,seq=0,calls=0;const timers=new Map(),states=[];
 const sync=createForegroundSync({reconnect:()=>{calls++;return reconnect?.();},onStateChange:status=>states.push(status),
  now:()=>time,setTimer:(fn,delay)=>{timers.set(++seq,{fn,at:time+delay});return seq;},clearTimer:id=>timers.delete(id)});
 function tick(ms){const until=time+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>until)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=until;}
 const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
 return {sync,states,tick,flush,calls:()=>calls,timers};
}
const confirmed={fromCache:false,hasPendingWrites:false};
test('a fast refresh has no indicator flash; a local write cannot confirm server freshness',()=>{
 const h=harness();h.sync.start();h.tick(100);h.sync.snapshot(confirmed);h.tick(500);assert.deepEqual(h.states,['idle']);
 h.sync.hide();h.tick(12000);h.sync.resume();h.tick(400);assert.equal(h.states.at(-1),'syncing');
 h.sync.snapshot({fromCache:true});h.sync.snapshot({fromCache:false,hasPendingWrites:true});assert.equal(h.states.at(-1),'syncing');
 h.sync.snapshot(confirmed);assert.equal(h.states.at(-1),'idle');assert.equal(h.timers.size,0);
});
test('native and visibility resume events reconnect once after sleep and do not refresh a quick app switch',async()=>{
 const h=harness();h.sync.start();h.sync.snapshot(confirmed);h.sync.hide();h.tick(3000);h.sync.resume();await h.flush();assert.equal(h.calls(),0);
 h.sync.hide();h.tick(15000);h.sync.resume();h.sync.resume();h.sync.resume();await h.flush();assert.equal(h.calls(),1);
 h.sync.snapshot(confirmed);h.tick(25000);await h.flush();assert.equal(h.calls(),1);
});
test('lost internet keeps cached data usable and restoration retries immediately, even during the resume cooldown',async()=>{
 const h=harness();h.sync.start();h.sync.snapshot(confirmed);h.sync.resume();h.sync.network(false);assert.equal(h.states.at(-1),'offline');
 h.tick(700);h.sync.network(true);await h.flush();assert.equal(h.calls(),1);h.sync.network(true);await h.flush();assert.equal(h.calls(),1);
 h.tick(400);assert.equal(h.states.at(-1),'syncing');h.sync.snapshot(confirmed);assert.equal(h.states.at(-1),'idle');
});
test('native background duration wakes the connection when a WebView missed visibilitychange',async()=>{
 const h=harness();h.sync.start();h.sync.snapshot(confirmed);h.tick(25000);h.sync.resume();
 h.sync.resume({backgroundMs:25000});h.sync.resume({backgroundMs:25000});await h.flush();assert.equal(h.calls(),1);
});
test('a stalled connection becomes a small waiting notice and retries; background timers do not reconnect',async()=>{
 const h=harness();h.sync.start();h.tick(10000);assert.equal(h.states.at(-1),'waiting');h.tick(15000);await h.flush();assert.equal(h.calls(),1);
 h.sync.hide();h.tick(90000);await h.flush();assert.equal(h.calls(),1);assert.equal(h.states.at(-1),'idle');
 h.sync.resume();await h.flush();assert.equal(h.calls(),2);h.sync.snapshot(confirmed);assert.equal(h.timers.size,0);
});
test('signout cancels indicators and retries even when an old reconnect fails later',async()=>{
 let reject;const h=harness(()=>new Promise((_,fail)=>{reject=fail;}));h.sync.start();h.sync.hide();h.tick(12000);h.sync.resume();await h.flush();
 h.sync.reset();reject(new Error('old session'));await h.flush();h.tick(90000);await h.flush();assert.equal(h.states.at(-1),'idle');assert.equal(h.timers.size,0);assert.equal(h.calls(),1);
});
test('permanent permission errors stop retries until a new session',async()=>{
 const h=harness();h.sync.start();h.sync.fail(true);h.sync.hide();h.tick(20000);h.sync.resume({force:true});h.tick(90000);await h.flush();assert.equal(h.calls(),0);
 h.sync.reset();h.sync.start();h.tick(400);assert.equal(h.states.at(-1),'syncing');
});

function ordersHarness(){
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');let listener,renders=0;const notices=[];
 const context={ordersRetryTimer:null,ordersUnsubscribe:null,ordersRetryDelay:3000,ordersConnectionNoticeShown:false,initialCloudLoad:true,
  foregroundDataSync:{start(){},snapshot(){},fail(){}},db:{},collection:()=>({}),onSnapshot(_ref,opts,fn){assert.equal(opts.includeMetadataChanges,true);listener=fn;return ()=>{};},
  state:{orders:[{id:'cached',number:'1',status:'Создан',entries:[]}]},pendingWrites:new Set(),pendingOrderData:new Map(),serverCache:new Map(),entryUnsubscribes:new Map(),selectedId:null,
  saveOrdersCache(){},watchPendingDefectOrders(){},scheduleRender(){renders++;},restoreUiState(){},pendingNotificationOrderId:'',toast:text=>notices.push(text),notify(){}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function watchOrders(){'),source.indexOf('function resumeOrdersListener()')),context);context.watchOrders();
 const snapshot=(docs,fromCache,changes=[])=>listener({docs,docChanges:()=>changes,metadata:{fromCache,hasPendingWrites:false}});
 return {context,snapshot,notices,renders:()=>renders};
}
test('an empty SDK cache never erases the persisted Android orders; a confirmed empty server result does',()=>{
 const h=ordersHarness();h.snapshot([],true);assert.equal(h.context.state.orders.length,1);assert.equal(h.renders(),0);
 h.snapshot([],false);assert.equal(h.context.state.orders.length,0);assert.equal(h.renders(),1);
 h.snapshot([],false);assert.equal(h.renders(),1,'metadata-only events do not repaint the interface');
});
test('server reconciliation retains pending local orders and updates counters through the existing renderer',()=>{
 const h=ordersHarness();h.context.pendingWrites.add('cached');const added={id:'new',data:()=>({number:'2',status:'Создан',articles:[]})};
 h.snapshot([added],false,[{doc:added,type:'added'}]);assert.equal(h.context.state.orders.length,2);assert.equal(h.renders(),1);assert.equal(h.notices.length,0);
});
