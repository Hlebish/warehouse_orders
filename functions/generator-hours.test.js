const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const model=require('./generator-hours');
const screen=fs.readFileSync(path.join(__dirname,'..','generator-screen.mjs'),'utf8');

function runTests({test,assert,model,screen}){
 const {emptyState,canOperate,transition}=model;
 const reject=(fn)=>assert.throws(fn,e=>e.code==='failed-precondition');
 test('start and simultaneous requests with same revision',()=>{
  const a=transition(null,'start',0,1000,'pc');
  assert.equal(a.state.startedAtMs,1000);assert.equal(a.event,null);
  reject(()=>transition(a.state,'start',0,1001,'android'));
  reject(()=>transition(a.state,'start',1,1002,'android'));
  reject(()=>transition(a.state,'reset',1,1002,'android'));
 });
 test('stop, repeated stop, two runs, reset and next period preserve immutable journal',()=>{
  let state=emptyState();const history=[];
  const action=(type,at)=>{const r=transition(state,type,state.revision,at,'pc');state=r.state;if(r.event)history.push(r.event);};
  action('start',1000);action('stop',61000);
  reject(()=>transition(state,'stop',1,62000,'android'));reject(()=>transition(state,'stop',2,62000,'android'));
  action('start',100000);action('stop',220000);
  assert.deepEqual([state.periodMs,state.totalMs],[180000,180000]);
  const old=JSON.stringify(history);
  action('reset',230000);
  assert.deepEqual([state.periodMs,state.totalMs,state.period,state.lastResetAtMs],[0,180000,2,230000]);
  assert.equal(JSON.stringify(history.slice(0,2)),old);
  assert.deepEqual([history[2].type,history[2].durationMs,history[2].totalMs,history[2].atMs],['reset',180000,180000,230000]);
  reject(()=>transition(state,'reset',4,230001,'android'));
  action('start',300000);action('stop',360000);
  assert.deepEqual([state.periodMs,state.totalMs,history.length],[60000,240000,4]);
  assert.deepEqual(history.map(e=>e.type),['run','run','reset','run']);
 });
 test('seconds are accumulated before rounding and backwards server clocks do not subtract time',()=>{
  let s=transition(null,'start',0,1000,'a').state;
  s=transition(s,'stop',1,31000,'a').state;
  s=transition(s,'start',2,32000,'a').state;
  s=transition(s,'stop',3,62000,'a').state;
  assert.equal(s.totalMs,60000);
  s=transition(s,'start',4,70000,'a').state;
  s=transition(s,'stop',5,69000,'a').state;
  assert.equal(s.totalMs,60000);
 });
 test('permissions follow active warehouse, director and admin roles',()=>{
  assert.equal(canOperate({active:true,role:'warehouse'}),true);
  assert.equal(canOperate({active:true,role:'director'}),true);
  assert.equal(canOperate({active:true,role:'manager',admin:true}),true);
  assert.equal(canOperate({active:true,role:'manager'}),false);
  assert.equal(canOperate({active:false,role:'warehouse',admin:true}),false);
 });
 function harness(){
  let now=1000,writes=0,failed=false;
  const states=new Map(),journals=new Map();
  const clients=new Set();
  const notify=()=>{for(const c of clients)c.send();};
  function device(){
   const nav={onLine:true};const nodes=new Map();const intervals=new Set();
   const target=()=>{const listeners=new Map();return {addEventListener(k,fn){listeners.set(k,fn)},removeEventListener(k){listeners.delete(k)},dispatch(k){listeners.get(k)?.()}}};
   const node=()=>Object.assign(target(),{hidden:false,disabled:false,textContent:'',children:[],append(...n){this.children.push(...n)},replaceChildren(){this.children=[]}});
   const root={dataset:{},querySelector:s=>nodes.get(s.slice(1)),set innerHTML(value){nodes.clear();for(const m of value.matchAll(/id="([^"]+)"/g)){const n=node();n.hidden=m[1]==='genConfirm';nodes.set(m[1],n);}}};
   const window=target(),document=Object.assign(target(),{hidden:false,createElement:node});
   const Clock=class extends Date{static now(){return now}};
   const factory=new Function('window','document','navigator','Date','setInterval','clearInterval',screen.replace(/export /g,'')+'\nreturn {createGeneratorScreen,generatorDuration};');
   const {createGeneratorScreen,generatorDuration}=factory(window,document,nav,Clock,fn=>{intervals.add(fn);return fn},fn=>intervals.delete(fn));
   const subscriptions=new Map();
   const client={send(){for(const [key,cb] of subscriptions){if(key.endsWith('/state')){const id=key.split('/')[0],state=states.get(id);cb({id,ref:{id},exists:()=>state!=null,data:()=>state,metadata:{fromCache:!nav.onLine}});}else{const events=journals.get(key.split('/')[0])||[];cb({docs:events.slice().reverse().map(e=>({data:()=>e})),metadata:{fromCache:!nav.onLine}});}}}};
   clients.add(client);
   const ui=createGeneratorScreen({db:{},doc:(_db,_collection,id)=>id+'/state',collection:ref=>ref.split('/')[0]+'/journal',query:x=>x,orderBy:()=>null,onSnapshot:(key,opts,cb)=>{subscriptions.set(key,cb);client.send();return ()=>subscriptions.delete(key)},canOperate:()=>true,call:async data=>{
    if(data.action==='clock')return {data:{serverNowMs:now}};
    if(failed||!nav.onLine)throw Object.assign(Error('network'),{code:'functions/unavailable'});
    const id=model.validateGeneratorAction(data.generatorId,data.action);
    const next=transition(states.get(id),data.action,data.expectedRevision,now,'actor');
    states.set(id,next.state);if(next.event){if(!journals.has(id))journals.set(id,[]);journals.get(id).push(next.event);}writes++;notify();
    return {data:{generatorId:id,state:next.state,serverNowMs:now}};
   }});
   const get=id=>nodes.get(id);
   const click=id=>{if(!get(id).disabled)get(id).dispatch('click')};
   ui.open(root);
   return {ui,root,get,click,select(id){get('genSelect').value=id;get('genSelect').dispatch('change')},generatorDuration,tick(){for(const cb of intervals)cb()},offline(){nav.onLine=false;window.dispatch('offline');client.send()},online(){nav.onLine=true;window.dispatch('online');client.send()},close(){ui.close();clients.delete(client)},subscriptions};
  }
  return {device,setTime(v){now=v;for(const c of clients)c.send()},get writes(){return writes},get state(){return states.get('red-small')},stateFor:id=>states.get(id),setFailed(v){failed=v}};
 }
 test('decimal engine hours show hundredths and retain hours/minutes',()=>{
  const h=harness(),pc=h.device();
  for(const [ms,expected] of [[0,'0,00 мч (0 ч 0 мин)'],[900000,'0,25 мч (0 ч 15 мин)'],[1800000,'0,50 мч (0 ч 30 мин)'],[45000000,'12,50 мч (12 ч 30 мин)'],[36000,'0,01 мч (0 ч 0 мин)']])assert.equal(pc.generatorDuration(ms),expected);
  pc.close();
 });
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
 test('actual screen restores active run, synchronizes two clients, handles stop and reset',async()=>{
  const h=harness(),pc=h.device(),android=h.device();await flush();
  assert.equal(pc.get('genStatus').textContent,'Остановлен');
  pc.click('genStart');await flush();
  assert.equal(android.get('genStatus').textContent,'Работает');
  assert.equal(android.get('genReset').disabled,true);
  assert.equal(android.get('genStart').disabled,true);assert.equal(android.get('genStop').disabled,false);assert.equal(android.root.dataset.running,'true');
  h.setTime(61000);pc.tick();android.tick();
  assert.equal(pc.get('genCurrent').textContent,'0,02 мч');assert.equal(pc.get('genCurrentTime').textContent,'0 ч 1 мин');
  assert.equal(h.writes,1);
  android.close();const restarted=h.device();await flush();
  assert.equal(restarted.get('genCurrent').textContent,'0,02 мч');assert.equal(restarted.get('genCurrentTime').textContent,'0 ч 1 мин');
  restarted.click('genStop');await flush();restarted.click('genStop');await flush();
  assert.equal(pc.root.dataset.running,'false');assert.equal(pc.get('genStop').disabled,true);assert.equal(pc.get('genStart').disabled,false);
  assert.equal(h.writes,2);assert.equal(pc.get('genTotal').textContent,'0,02 мч');assert.equal(pc.get('genTotalTime').textContent,'0 ч 1 мин');
  h.setTime(100000);pc.click('genStart');await flush();h.setTime(220000);pc.click('genStop');await flush();
  assert.equal(restarted.get('genTotal').textContent,'0,05 мч');assert.equal(restarted.get('genTotalTime').textContent,'0 ч 3 мин');
  restarted.click('genReset');assert.equal(restarted.get('genConfirm').hidden,false);
  restarted.click('genResetNo');assert.equal(h.writes,4);
  restarted.click('genReset');restarted.click('genResetYes');await flush();
  assert.equal(pc.get('genPeriod').textContent,'0,00 мч');assert.equal(pc.get('genPeriodTime').textContent,'0 ч 0 мин');
  assert.equal(pc.get('genTotal').textContent,'0,05 мч');assert.equal(pc.get('genTotalTime').textContent,'0 ч 3 мин');
  assert.equal(pc.get('genHistory').children.length,3);
  assert.match(pc.get('genHistory').children[0].children[0].textContent,/Сброс/);
  assert.match(pc.get('genHistory').children[0].children[1].textContent,/0,05 мч \(0 ч 3 мин\)/);
  assert.match(pc.get('genHistory').children[1].children[0].textContent,/0,03 мч \(0 ч 2 мин\)/);
  h.setTime(300000);pc.click('genStart');await flush();h.setTime(360000);pc.click('genStop');await flush();
  assert.equal(restarted.get('genPeriod').textContent,'0,02 мч');assert.equal(restarted.get('genPeriodTime').textContent,'0 ч 1 мин');
  assert.equal(restarted.get('genTotal').textContent,'0,07 мч');assert.equal(restarted.get('genTotalTime').textContent,'0 ч 4 мин');
  assert.equal(restarted.get('genHistory').children.length,4);
  pc.close();restarted.close();assert.equal(pc.subscriptions.size,0);
 });
 test('three generators have independent runs, totals, journals and resets',async()=>{
  const h=harness(),pc=h.device(),android=h.device();await flush();
  pc.click('genStart');await flush();
  pc.select('yellow');await flush();
  assert.equal(pc.get('genStatus').textContent,'Остановлен');
  assert.equal(android.get('genStatus').textContent,'Работает');
  h.setTime(31000);pc.click('genStart');await flush();
  h.setTime(61000);android.click('genStop');await flush();
  assert.equal(pc.get('genStatus').textContent,'Работает');
  h.setTime(151000);pc.click('genStop');await flush();
  assert.equal(h.stateFor('red-small').totalMs,60000);
  assert.equal(h.stateFor('yellow').totalMs,120000);
  pc.select('red-large');await flush();assert.equal(pc.get('genTotal').textContent,'0,00 мч');
  pc.click('genStart');await flush();h.setTime(211000);pc.click('genStop');await flush();
  assert.equal(h.stateFor('red-large').totalMs,60000);
  pc.select('yellow');await flush();assert.equal(pc.get('genHistory').children.length,1);
  pc.click('genReset');pc.click('genResetYes');await flush();
  assert.equal(h.stateFor('yellow').periodMs,0);
  assert.equal(h.stateFor('yellow').totalMs,120000);
  assert.equal(h.stateFor('red-small').periodMs,60000);
  assert.equal(h.stateFor('red-large').periodMs,60000);
  pc.select('warehouse');await flush();assert.equal(pc.get('genStart').disabled,true);assert.equal(pc.get('genReset').disabled,true);
  assert.throws(()=>model.validateGeneratorAction(undefined,'start'),e=>e.code==='invalid-argument');
  assert.throws(()=>model.validateGeneratorAction('other','start'),e=>e.code==='invalid-argument');
  assert.throws(()=>model.validateGeneratorAction('warehouse','start'),e=>e.code==='failed-precondition');
  assert.equal(model.validateGeneratorAction('warehouse','stop'),'warehouse');
  pc.close();android.close();
 });
 test('offline and rejected save are explicit and do not queue writes',async()=>{
  const h=harness(),pc=h.device();await flush();pc.offline();
  assert.equal(pc.get('genStart').disabled,true);assert.match(pc.get('genFeedback').textContent,/Нет связи/);
  pc.click('genStart');assert.equal(h.writes,0);pc.online();await flush();
  h.setFailed(true);pc.click('genStart');await flush();
  assert.equal(h.writes,0);assert.match(pc.get('genFeedback').textContent,/Сохранение не подтверждено/);
  assert.equal(pc.get('genStatus').textContent,'Остановлен');pc.close();
 });
}
runTests({test,assert,model,screen});
