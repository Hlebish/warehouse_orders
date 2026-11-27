'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {emptyState,transition}=require('./generator-hours');
const HOUR=3600000;
const NOW=Date.parse('2026-11-27T12:00:00Z');
const screen=fs.readFileSync(path.join(__dirname,'..','generator-screen.mjs'),'utf8');
const clone=value=>value===undefined?undefined:structuredClone(value);
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

// Exercise the real screen with browser-like event delivery and a controllable
// Firestore transport. A cancelled listener may still deliver an already queued
// callback; keeping its reference makes those races deterministic.
function harness({states={},journals={},autoSnapshots=true,permission=true,now=NOW,intl=Intl}={}){
 const savedStates=new Map(Object.entries(states).map(([id,state])=>[id,clone(state)]));
 const savedJournals=new Map(Object.entries(journals).map(([id,events])=>[id,clone(events)]));
 const subscriptions=[],intervals=new Set(),calls=[],nodes=new Map(),behaviors=new Map();
 let currentTime=now,canOperate=permission,sequence=0;
 const navigator={onLine:true};
 function target(){
  const listeners=new Map();
  return {
   addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(callback);},
   removeEventListener(type,callback){listeners.get(type)?.delete(callback);},
   dispatch(type,extra={}){
    const event={type,target:this,currentTarget:this,preventDefault(){},stopPropagation(){},...extra};
    for(const callback of [...(listeners.get(type)||[])])callback(event);
   },
   dispatchEvent(event){this.dispatch(event.type,event);return true;}
  };
 }
 function node(tagName='div'){
  const attributes=new Map(),classes=new Set();
  const result=Object.assign(target(),{
   tagName:tagName.toUpperCase(),hidden:false,disabled:false,value:'',textContent:'',className:'',dataset:{},children:[],isConnected:true,
   append(...children){this.children.push(...children);},replaceChildren(...children){this.children=[...children];this.textContent='';},
   setAttribute(name,value){attributes.set(name,String(value));},getAttribute(name){return attributes.get(name)??null;},
   removeAttribute(name){attributes.delete(name);},focus(){document.activeElement=this;},
   checkValidity(){return true;},reportValidity(){return true;},
   classList:{add(...values){values.forEach(value=>classes.add(value));},remove(...values){values.forEach(value=>classes.delete(value));},toggle(value,on){const next=on??!classes.has(value);if(next)classes.add(value);else classes.delete(value);return next;},contains(value){return classes.has(value);}},
   querySelector(selector){return selector.startsWith('#')?nodes.get(selector.slice(1))||null:null;},
   querySelectorAll(selector){return selector==='input,select,textarea,button'?[...nodes.values()].filter(item=>['INPUT','SELECT','TEXTAREA','BUTTON'].includes(item.tagName)):[];}
  });
  return result;
 }
 const window=target(),document=Object.assign(target(),{hidden:false,activeElement:null,createElement:node});
 const root=node('section');
 Object.defineProperty(root,'innerHTML',{set(value){
  for(const previous of nodes.values())previous.isConnected=false;
  nodes.clear();root.children=[];
  for(const match of value.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)){
   const [,tag,attributes,id]=match,element=node(tag);element.id=id;
   element.hidden=/\bhidden(?:\s|=|$)/.test(attributes);element.disabled=/\bdisabled(?:\s|=|$)/.test(attributes);
   element.value=attributes.match(/\bvalue="([^"]*)"/)?.[1]??'';
   nodes.set(id,element);
  }
 }});
 const Clock=class extends Date{constructor(...args){super(...(args.length?args:[currentTime]));}static now(){return currentTime;}};
 const crypto={randomUUID:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`};
 const create=new Function('window','document','navigator','Date','setInterval','clearInterval','crypto','Intl',screen.replace(/\bexport /g,'')+'\nreturn createGeneratorScreen;')(
  window,document,navigator,Clock,callback=>{intervals.add(callback);return callback;},callback=>intervals.delete(callback),crypto,intl);
 const ref=(parts,kind='state')=>({path:parts.join('/'),id:parts[parts.length-1],generatorId:parts[1],kind});
 const doc=(_db,...parts)=>ref(parts);
 const collection=(parent,...parts)=>ref([...parent.path.split('/'),...parts],'journal');
 const snapshot=subscription=>{
  const {reference}=subscription,id=reference.generatorId;
  if(reference.kind==='journal')return {docs:(savedJournals.get(id)||[]).slice().reverse().map(event=>({id:String(event.revision),data:()=>clone(event)})),metadata:{fromCache:!navigator.onLine}};
  return {id,ref:reference,exists:()=>savedStates.has(id),data:()=>clone(savedStates.get(id)),metadata:{fromCache:!navigator.onLine}};
 };
 const emit=(subscription,{force=false,value}={})=>{if(force||subscription.active)subscription.next(value??snapshot(subscription));};
 const notify=id=>{
  for(const subscription of subscriptions)if(subscription.active&&(!id||subscription.reference.generatorId===id))queueMicrotask(()=>emit(subscription));
 };
 const call=async payload=>{
  const request=clone(payload);calls.push(request);
  const queue=behaviors.get(request.action);
  if(queue?.length)return queue.shift()(request);
  if(request.action==='clock')return {data:{serverNowMs:currentTime}};
  if(['start','stop','reset'].includes(request.action)){
   const result=transition(savedStates.get(request.generatorId),request.action,request.expectedRevision,currentTime,'actor');
   savedStates.set(request.generatorId,result.state);
   if(result.event)savedJournals.set(request.generatorId,[...(savedJournals.get(request.generatorId)||[]),result.event]);
   notify(request.generatorId);
   return {data:{generatorId:request.generatorId,state:clone(result.state),serverNowMs:currentTime}};
  }
  throw new Error('Unexpected test request: '+request.action);
 };
 const ui=create({db:{},doc,collection,query:value=>value,orderBy:()=>null,onSnapshot:(reference,_options,next,error)=>{
  const subscription={reference,next,error,active:true};subscriptions.push(subscription);
  if(autoSnapshots)queueMicrotask(()=>emit(subscription));
  return ()=>{subscription.active=false;};
 },call,canOperate:()=>canOperate});
 const get=id=>{const element=nodes.get(id);assert.ok(element,'Missing screen control #'+id);return element;};
 const click=id=>{const control=get(id);if(!control.disabled)control.dispatch('click');};
 const input=(id,value,type='input')=>{const control=get(id);control.value=value;control.dispatch(type);};
 ui.open(root);
 return {
  ui,root,get,click,input,calls,subscriptions,intervals,states:savedStates,journals:savedJournals,
  select(id,type='change'){input('genSelect',id,type);},
  advance(ms){currentTime+=ms;for(const callback of [...intervals])callback();},
  respondNext(action,callback){if(!behaviors.has(action))behaviors.set(action,[]);behaviors.get(action).push(callback);},
  setState(id,value){savedStates.set(id,clone(value));notify(id);},
  emit,deliver(){for(const subscription of [...subscriptions])emit(subscription);},
  offline(){navigator.onLine=false;window.dispatch('offline');},
  online(){navigator.onLine=true;window.dispatch('online');notify();},
  setPermission(value){canOperate=value;ui.refreshPermissions();},
  close(){ui.close();}
 };
}

test('switching generators clears old rendering while delayed old snapshots remain harmless',async t=>{
 const running={...emptyState(),revision:1,startedAtMs:NOW-HOUR,startedBy:'actor'};
 const stopped={...emptyState(),revision:2,periodMs:HOUR/2,totalMs:HOUR/2};
 const h=harness({states:{'red-small':running,'yellow':stopped},autoSnapshots:false});t.after(()=>h.close());
 h.deliver();await flush();
 assert.equal(h.get('genCurrentTime').textContent,'1 ч 0 мин');
 const old=[...h.subscriptions];
 h.select('yellow');
 assert.equal(h.get('genCurrent').textContent,'—','new selection must never display previous generator hours while loading');
 h.deliver();await flush();
 assert.equal(h.root.dataset.generatorId,'yellow');assert.equal(h.get('genCurrentTime').textContent,'0 ч 0 мин');
 assert.equal(h.get('genTotalTime').textContent,'0 ч 30 мин');
 for(const subscription of old)h.emit(subscription,{force:true});
 h.advance(60000);
 assert.equal(h.get('genCurrentTime').textContent,'0 ч 0 мин');assert.equal(h.get('genStatus').textContent,'Остановлен');
 h.select('red-large');h.deliver();await flush();
 assert.equal(h.get('genTotalTime').textContent,'0 ч 0 мин');
 h.select('red-small');h.deliver();await flush();
 assert.equal(h.get('genCurrentTime').textContent,'1 ч 1 мин');
 assert.equal(h.calls.filter(call=>call.action!=='clock').length,0,'selection only reads data');
 assert.equal(h.intervals.size,1);assert.equal(h.subscriptions.filter(item=>item.active).length,2);
});

test('input-before-change selection changes timer identity immediately',async t=>{
 const h=harness({states:{'red-small':{...emptyState(),revision:1,startedAtMs:NOW-HOUR,startedBy:'actor'}}});t.after(()=>h.close());
 await flush();
 h.select('yellow','input');await flush();
 assert.equal(h.root.dataset.generatorId,'yellow');assert.equal(h.get('genStatus').textContent,'Остановлен');
 assert.equal(h.get('genCurrentTime').textContent,'0 ч 0 мин');
 h.select('yellow','change');await flush();
 assert.equal(h.intervals.size,1);assert.equal(h.calls.filter(call=>call.action!=='clock').length,0);
});

test('an action response after closing and reopening cannot overwrite the selected generator',async t=>{
 const h=harness();t.after(()=>h.close());await flush();
 const pending=deferred();h.respondNext('start',()=>pending.promise);
 h.click('genStart');await flush();assert.equal(h.calls.at(-1).generatorId,'red-small');
 h.close();h.ui.open(h.root,'yellow');await flush();
 pending.resolve({data:{generatorId:'red-small',state:{...emptyState(),revision:1,startedAtMs:NOW-HOUR},serverNowMs:NOW}});await flush();
 assert.equal(h.root.dataset.generatorId,'yellow');assert.equal(h.get('genStatus').textContent,'Остановлен');
 assert.equal(h.get('genCurrentTime').textContent,'0 ч 0 мин');
});

const stoppedState=(hours=4,revision=2)=>({...emptyState(),revision,periodMs:hours*HOUR,totalMs:hours*HOUR});
const correctionCalls=h=>h.calls.filter(call=>call.action!=='clock');
function fillAdjustment(h,{hours='1,5',direction='plus',reason='Забыл включить счётчик'}={}){
 h.click('genAdjust');h.input('genAdjustDirection',direction,'change');h.input('genAdjustHours',hours);h.input('genAdjustReason',reason);h.click('genAdjustPreview');
}
function fillTransfer(h,{target='yellow',from='2026-11-27T10:00:00',to='2026-11-27T12:00:00',reason='Перепутал генератор'}={}){
 h.click('genTransfer');h.input('genTransferTarget',target,'change');h.input('genTransferFrom',from);h.input('genTransferTo',to);h.input('genTransferReason',reason);
}
const transferPreview=request=>({
 ...request,sourceRevision:2,targetRevision:7,durationMs:1.5*HOUR,
 segments:[{startedAtMs:request.fromMs,stoppedAtMs:request.fromMs+HOUR},{startedAtMs:request.toMs-HOUR/2,stoppedAtMs:request.toMs}],
 sourcePeriodDeltaMs:1.5*HOUR,targetPeriodDeltaMs:1.5*HOUR,
 sourcePeriodMsAfter:2.5*HOUR,sourceTotalMsAfter:2.5*HOUR,targetPeriodMsAfter:3.5*HOUR,targetTotalMsAfter:3.5*HOUR,serverNowMs:NOW
});

test('manual correction previews signed decimal hours, requires confirmation, and sends the captured revision',async t=>{
 const h=harness({states:{'red-small':stoppedState()}});t.after(()=>h.close());await flush();
 fillAdjustment(h);
 assert.equal(h.get('genAdjustConfirm').hidden,false);assert.equal(h.get('genAdjustYes').disabled,false);
 assert.match(h.get('genAdjustSummary').textContent,/\+1,50 мч/);assert.match(h.get('genAdjustSummary').textContent,/4,00 мч.*5,50 мч/);
 assert.equal(correctionCalls(h).length,0);assert.equal(h.states.get('red-small').totalMs,4*HOUR);
 h.respondNext('adjust',request=>({data:{generatorId:request.generatorId,state:stoppedState(5.5,3),serverNowMs:NOW}}));
 h.click('genAdjustYes');await flush();
 const request=correctionCalls(h).at(-1);
 assert.equal(request.action,'adjust');assert.equal(request.generatorId,'red-small');assert.equal(request.deltaMs,1.5*HOUR);
 assert.equal(request.expectedRevision,2);assert.equal(request.reason,'Забыл включить счётчик');assert.match(request.requestId,/^[a-zA-Z0-9_-]{16,128}$/);
 assert.equal(h.get('genTotal').textContent,'5,50 мч');assert.equal(h.get('genAdjustForm').hidden,true);
 assert.match(h.get('genFeedback').textContent,/исправлены/);
});

test('manual subtraction rejects negative balances, empty reasons and malformed hour values without writes',async t=>{
 const h=harness({states:{'red-small':stoppedState(1)}});t.after(()=>h.close());await flush();
 for(const hours of ['0','-1','1e2','NaN','Infinity','1.2.3','9007199254740992']){
  fillAdjustment(h,{hours});assert.equal(h.get('genAdjustConfirm').hidden,true);assert.equal(h.get('genAdjustYes').disabled,true);
 }
 fillAdjustment(h,{hours:'2',direction:'minus'});
 assert.match(h.get('genFeedback').textContent,/Нельзя вычесть/);assert.equal(h.get('genAdjustYes').disabled,true);
 fillAdjustment(h,{hours:'0,25',reason:' '});assert.match(h.get('genFeedback').textContent,/причину/);
 fillAdjustment(h,{hours:'0.25',direction:'minus',reason:'Счётчик забыли остановить'});
 assert.match(h.get('genAdjustSummary').textContent,/−0,25 мч/);assert.match(h.get('genAdjustSummary').textContent,/0,75 мч/);
 h.respondNext('adjust',request=>({data:{generatorId:request.generatorId,state:stoppedState(0.75,3),serverNowMs:NOW}}));
 h.click('genAdjustYes');await flush();
 assert.equal(correctionCalls(h).length,1);assert.equal(correctionCalls(h)[0].deltaMs,-HOUR/4);
});

test('editing a correction or receiving a newer revision invalidates its confirmation',async t=>{
 const h=harness({states:{'red-small':stoppedState()}});t.after(()=>h.close());await flush();
 fillAdjustment(h);h.input('genAdjustHours','2');
 assert.equal(h.get('genAdjustConfirm').hidden,true);assert.equal(h.get('genAdjustYes').disabled,true);
 h.click('genAdjustYes');assert.equal(correctionCalls(h).length,0);
 h.click('genAdjustPreview');assert.equal(h.get('genAdjustConfirm').hidden,false);
 h.setState('red-small',stoppedState(5,3));await flush();
 assert.equal(h.get('genAdjustConfirm').hidden,true);assert.match(h.get('genFeedback').textContent,/изменились/);
 h.click('genAdjustYes');assert.equal(correctionCalls(h).length,0);
});

test('transfer uses Kyiv boundaries, displays server-calculated work time, and confirms both revisions',async t=>{
 const h=harness({states:{'red-small':stoppedState()}});t.after(()=>h.close());await flush();
 fillTransfer(h);h.respondNext('previewTransfer',request=>({data:transferPreview(request)}));
 h.click('genTransferPreview');await flush();
 assert.equal(correctionCalls(h).length,1);assert.equal(h.states.get('red-small').totalMs,4*HOUR);
 const previewRequest=correctionCalls(h)[0];
 assert.equal(previewRequest.fromMs,Date.parse('2026-11-27T08:00:00Z'));assert.equal(previewRequest.toMs,Date.parse('2026-11-27T10:00:00Z'));
 assert.equal(previewRequest.generatorId,'red-small');assert.equal(previewRequest.targetGeneratorId,'yellow');
 assert.equal(h.get('genTransferConfirm').hidden,false);assert.match(h.get('genTransferSummary').textContent,/1,50 мч/);
 assert.match(h.get('genTransferSummary').textContent,/Красный маленький → Жёлтый/);
 h.respondNext('transfer',request=>({data:{generatorId:request.generatorId,targetGeneratorId:request.targetGeneratorId,state:stoppedState(2.5,3),targetState:stoppedState(3.5,8),durationMs:1.5*HOUR,serverNowMs:NOW}}));
 h.click('genTransferYes');await flush();
 const request=correctionCalls(h).at(-1);
 assert.equal(request.action,'transfer');assert.equal(request.expectedRevision,2);assert.equal(request.expectedTargetRevision,7);
 assert.equal(request.fromMs,previewRequest.fromMs);assert.equal(request.toMs,previewRequest.toMs);assert.equal(request.reason,'Перепутал генератор');
 assert.match(request.requestId,/^[a-zA-Z0-9_-]{16,128}$/);assert.equal(h.get('genTotal').textContent,'2,50 мч');
 assert.equal(h.get('genTransferForm').hidden,true);assert.match(h.get('genFeedback').textContent,/журнале обоих/);
});

test('transfer preview cannot be confirmed after editing fields or a concurrent source update',async t=>{
 const h=harness({states:{'red-small':stoppedState()}});t.after(()=>h.close());await flush();
 fillTransfer(h);h.respondNext('previewTransfer',request=>({data:transferPreview(request)}));h.click('genTransferPreview');await flush();
 h.input('genTransferTarget','red-large','change');
 assert.equal(h.get('genTransferConfirm').hidden,true);assert.equal(h.get('genTransferYes').disabled,true);
 const pending=deferred();h.respondNext('previewTransfer',()=>pending.promise);h.click('genTransferPreview');await flush();
 const request=correctionCalls(h).at(-1);h.setState('red-small',stoppedState(5,3));await flush();
 pending.resolve({data:transferPreview(request)});await flush();
 assert.equal(h.get('genTransferConfirm').hidden,true);assert.equal(h.get('genTransferYes').disabled,true);
 h.click('genTransferYes');assert.equal(correctionCalls(h).filter(call=>call.action==='transfer').length,0);
});

test('corrections stay disabled while running, offline or without write permission',async t=>{
 const h=harness({states:{'red-small':{...stoppedState(),startedAtMs:NOW-HOUR}}});t.after(()=>h.close());await flush();
 assert.equal(h.get('genAdjust').disabled,true);assert.equal(h.get('genTransfer').disabled,true);assert.match(h.get('genCorrectionHint').textContent,/остановите/);
 h.get('genAdjust').dispatch('click');h.get('genTransfer').dispatch('click');
 assert.equal(h.get('genAdjustForm').hidden,true);assert.equal(h.get('genTransferForm').hidden,true);
 h.setState('red-small',stoppedState());await flush();fillAdjustment(h);h.offline();
 assert.equal(h.get('genAdjustYes').disabled,true);h.get('genAdjustYes').dispatch('click');await flush();
 assert.equal(correctionCalls(h).length,0);assert.match(h.get('genFeedback').textContent,/Нет связи/);
 h.online();await flush();h.setPermission(false);
 assert.equal(h.get('genCorrectionButtons').hidden,true);assert.equal(h.get('genAdjustForm').hidden,true);
 h.get('genAdjustYes').dispatch('click');h.get('genTransferPreview').dispatch('click');await flush();assert.equal(correctionCalls(h).length,0);
});

test('a running recipient is rejected by server preview without enabling transfer confirmation',async t=>{
 const h=harness({states:{'red-small':stoppedState()}});t.after(()=>h.close());await flush();fillTransfer(h);
 h.respondNext('previewTransfer',()=>Promise.reject(Object.assign(new Error('Сначала остановите счётчик генератора-получателя.'),{code:'functions/failed-precondition'})));
 h.click('genTransferPreview');await flush();
 assert.equal(h.get('genTransferConfirm').hidden,true);assert.equal(h.get('genTransferYes').disabled,true);
 assert.match(h.get('genFeedback').textContent,/остановите.*получателя/);assert.equal(correctionCalls(h).length,1);
});

test('retrying a manual correction after lost response retains the original idempotency identity',async t=>{
 const h=harness({states:{'red-small':stoppedState()}});t.after(()=>h.close());await flush();fillAdjustment(h);
 h.respondNext('adjust',async()=>{
  h.setState('red-small',stoppedState(5.5,3));
  throw Object.assign(new Error('Response lost after commit'),{code:'functions/unavailable'});
 });
 h.click('genAdjustYes');await flush();
 assert.equal(h.get('genAdjustYes').textContent,'Проверить результат');assert.equal(h.get('genAdjustYes').disabled,false);
 assert.equal(h.get('genTotal').textContent,'5,50 мч');assert.match(h.get('genFeedback').textContent,/второй раз/);
 const original=clone(correctionCalls(h)[0]);
 h.respondNext('adjust',request=>({data:{generatorId:request.generatorId,state:stoppedState(5.5,3),serverNowMs:NOW,replayed:true}}));
 h.click('genAdjustYes');await flush();
 assert.deepEqual(correctionCalls(h)[1],original,'retry must use the same requestId, revision and amount even after the state snapshot advances');
 assert.equal(h.get('genTotal').textContent,'5,50 мч');assert.equal(h.get('genAdjustForm').hidden,true);
});

test('retrying a transfer after lost response retains both generator revisions and the request identity',async t=>{
 const h=harness({states:{'red-small':stoppedState()}});t.after(()=>h.close());await flush();fillTransfer(h);
 h.respondNext('previewTransfer',request=>({data:transferPreview(request)}));h.click('genTransferPreview');await flush();
 h.respondNext('transfer',async()=>{h.setState('red-small',stoppedState(2.5,3));throw Object.assign(new Error('Response lost'),{code:'functions/deadline-exceeded'});});
 h.click('genTransferYes');await flush();assert.equal(h.get('genTransferYes').textContent,'Проверить результат');
 const original=clone(correctionCalls(h).at(-1));
 h.respondNext('transfer',request=>({data:{generatorId:request.generatorId,state:stoppedState(2.5,3),serverNowMs:NOW,replayed:true}}));
 h.click('genTransferYes');await flush();
 assert.deepEqual(correctionCalls(h).at(-1),original);assert.equal(correctionCalls(h).filter(call=>call.action==='previewTransfer').length,1);
 assert.equal(h.get('genTotal').textContent,'2,50 мч');assert.equal(h.get('genTransferForm').hidden,true);
});

test('mismatched state snapshots and action replies never populate another generator counter',async t=>{
 const h=harness({states:{'red-small':stoppedState(1)}});t.after(()=>h.close());await flush();
 const subscription=h.subscriptions.find(item=>item.reference.kind==='state');
 h.emit(subscription,{value:{id:'yellow',exists:()=>true,data:()=>({...stoppedState(100,50),startedAtMs:NOW-HOUR}),metadata:{fromCache:false}}});
 assert.equal(h.get('genTotal').textContent,'1,00 мч');assert.equal(h.get('genStart').disabled,true);assert.match(h.get('genFeedback').textContent,/выбранного генератора/);
 h.deliver();await flush();
 h.respondNext('start',()=>({data:{generatorId:'yellow',state:{...stoppedState(100,50),startedAtMs:NOW-HOUR},serverNowMs:NOW}}));
 h.click('genStart');await flush();
 assert.equal(h.get('genStatus').textContent,'Остановлен');assert.equal(h.get('genTotal').textContent,'1,00 мч');
});

test('an older backend gives an explicit update message and leaves the correction uncommitted',async t=>{
 const h=harness({states:{'red-small':stoppedState()}});t.after(()=>h.close());await flush();fillAdjustment(h);
 h.respondNext('adjust',()=>Promise.reject(Object.assign(new Error('Некорректное действие.'),{code:'functions/invalid-argument'})));
 h.click('genAdjustYes');await flush();
 assert.match(h.get('genFeedback').textContent,/Серверная часть требует обновления/);assert.equal(h.get('genTotal').textContent,'4,00 мч');
 assert.equal(h.get('genAdjustConfirm').hidden,true);assert.equal(h.get('genAdjustYes').disabled,true);
});

test('Kyiv datetime conversion is independent of host timezone and rejects invalid or ambiguous wall times',()=>{
 const {parseGeneratorInputTime,parseGeneratorHours,generatorInputTime}=new Function(screen.replace(/\bexport /g,'')+'\nreturn {parseGeneratorInputTime,parseGeneratorHours,generatorInputTime};')();
 assert.equal(parseGeneratorInputTime('2026-11-27T10:15:30'),Date.parse('2026-11-27T08:15:30Z'));
 assert.equal(parseGeneratorInputTime('2026-07-01T10:15'),Date.parse('2026-07-01T07:15:00Z'));
 assert.equal(generatorInputTime(Date.parse('2026-11-27T08:15:30Z')),'2026-11-27T10:15:30');
 for(const value of ['','2026-02-30T10:00','2025-02-29T10:00','2026-13-01T10:00','2026-11-27T24:00','2026-11-27T10:60','2026-11-27T10:00:60','1969-12-31T23:00'])assert.throws(()=>parseGeneratorInputTime(value),Error,value);
 assert.throws(()=>parseGeneratorInputTime('2026-03-29T03:30'),/нет.*летнее/);
 assert.throws(()=>parseGeneratorInputTime('2026-10-25T03:30'),/дважды/);
 assert.equal(parseGeneratorInputTime('2024-02-29T10:00'),Date.parse('2024-02-29T08:00:00Z'));
 assert.equal(parseGeneratorHours('1,5'),1.5*HOUR);assert.equal(parseGeneratorHours('0.25'),HOUR/4);
});

test('invalid transfer dates are rejected before any preview request',async t=>{
 const h=harness({states:{'red-small':stoppedState()}});t.after(()=>h.close());await flush();
 for(const from of ['2026-02-30T10:00','2026-03-29T03:30','2026-10-25T03:30']){
  fillTransfer(h,{from});h.click('genTransferPreview');await flush();assert.equal(correctionCalls(h).length,0);assert.equal(h.get('genTransferConfirm').hidden,true);
 }
 fillTransfer(h,{from:'2026-11-27T12:00',to:'2026-11-27T10:00'});h.click('genTransferPreview');await flush();
 assert.match(h.get('genFeedback').textContent,/позже начала/);assert.equal(correctionCalls(h).length,0);
});

test('audit history shows signed changes, actors, reasons and transferred run intervals as text',async t=>{
 const reason='<img src=x onerror=alert(1)> исправление';
 const h=harness({states:{'red-small':stoppedState(2.5,4)},journals:{'red-small':[
  {type:'adjustment',revision:3,period:1,deltaMs:HOUR,atMs:NOW,actorName:'Иван',reason,periodMsBefore:3*HOUR,periodMsAfter:4*HOUR,totalMsBefore:3*HOUR,totalMsAfter:4*HOUR},
  {type:'transfer_out',revision:4,period:1,targetGeneratorId:'yellow',durationMs:1.5*HOUR,atMs:NOW,actorName:'Ольга',reason:'Другой генератор',fromMs:NOW-4*HOUR,toMs:NOW-2*HOUR,segments:[{startedAtMs:NOW-4*HOUR,stoppedAtMs:NOW-2.5*HOUR}],periodMsBefore:4*HOUR,periodMsAfter:2.5*HOUR,totalMsBefore:4*HOUR,totalMsAfter:2.5*HOUR}
 ]}});t.after(()=>h.close());await flush();
 const items=h.get('genHistory').children;assert.equal(items.length,2);
 assert.match(items[0].children[0].textContent,/Перенос → Жёлтый.*−1,50 мч/);assert.match(items[0].children[1].textContent,/Ольга/);
 assert.match(items[0].children[1].textContent,/Учтённый запуск:/);assert.match(items[0].children[1].textContent,/4,00 мч.*2,50 мч/);
 assert.match(items[1].children[0].textContent,/Исправление.*\+1,00 мч/);assert.ok(items[1].children[1].textContent.includes(reason));
 assert.equal(items[1].children[1].children.length,0,'an audit reason must not be interpreted as markup');
});

test('losing write permission while a save is pending handles a rejected response without reopening controls',async t=>{
 const h=harness({states:{'red-small':stoppedState()}});t.after(()=>h.close());await flush();fillAdjustment(h);
 const pending=deferred();h.respondNext('adjust',()=>pending.promise);h.click('genAdjustYes');await flush();
 assert.equal(correctionCalls(h).length,1);h.setPermission(false);
 assert.equal(h.get('genCorrectionButtons').hidden,true);assert.equal(h.get('genAdjustYes').disabled,true);
 pending.reject(Object.assign(new Error('Network response lost'),{code:'functions/unavailable'}));await flush();
 assert.equal(h.get('genCorrectionButtons').hidden,true);assert.equal(h.get('genAdjustYes').disabled,true);assert.equal(h.get('genAdjustForm').hidden,true);
 h.get('genAdjustYes').dispatch('click');await flush();assert.equal(correctionCalls(h).length,1);
});

test('the default transfer range preserves every millisecond of the selected recorded run',async t=>{
 const startedAtMs=Date.parse('2026-11-27T08:00:00.123Z'),stoppedAtMs=Date.parse('2026-11-27T10:00:00.987Z');
 const run={type:'run',revision:2,period:1,startedAtMs,stoppedAtMs,durationMs:stoppedAtMs-startedAtMs};
 const h=harness({states:{'red-small':stoppedState()},journals:{'red-small':[run]}});t.after(()=>h.close());await flush();
 h.click('genTransfer');h.input('genTransferTarget','yellow','change');
 h.respondNext('previewTransfer',request=>({data:transferPreview(request)}));h.click('genTransferPreview');await flush();
 const request=correctionCalls(h)[0];assert.ok(request,'valid prefilled range should be sent for preview');
 assert.equal(request.fromMs,startedAtMs);assert.equal(request.toMs,stoppedAtMs);
 const {parseGeneratorInputTime,generatorInputTime}=new Function(screen.replace(/\bexport /g,'')+'\nreturn {parseGeneratorInputTime,generatorInputTime};')();
 for(const instant of [startedAtMs,stoppedAtMs,Date.parse('2026-07-01T07:15:30.001Z')])assert.equal(parseGeneratorInputTime(generatorInputTime(instant)),instant);
});

function legacyKyivIntl(){
 const zones=[];
 function DateTimeFormat(locale,options){
  zones.push(options?.timeZone);
  if(options?.timeZone==='Europe/Kyiv')throw new RangeError('Invalid time zone specified: Europe/Kyiv');
  return new Intl.DateTimeFormat(locale,options);
 }
 return {intl:{NumberFormat:Intl.NumberFormat,DateTimeFormat},zones};
}

test('evaluating the optional generator module does not initialize date formatters before the app starts',()=>{
 let constructions=0;
 const intl={NumberFormat:Intl.NumberFormat,DateTimeFormat:function(){constructions++;throw new RangeError('Timezone data unavailable during startup');}};
 const exports=new Function('Intl',screen.replace(/\bexport /g,'')+'\nreturn {createGeneratorScreen,generatorInputTime,parseGeneratorInputTime};')(intl);
 assert.equal(typeof exports.createGeneratorScreen,'function');
 assert.equal(constructions,0,'importing the generator module must not require timezone support');
});

test('legacy Intl with only Europe/Kiev preserves winter, summer and DST conversions',()=>{
 const {intl,zones}=legacyKyivIntl();
 const {generatorInputTime,parseGeneratorInputTime}=new Function('Intl',screen.replace(/\bexport /g,'')+'\nreturn {generatorInputTime,parseGeneratorInputTime};')(intl);
 const examples=[
  ['2026-11-27T10:15:30.123','2026-11-27T08:15:30.123Z'],
  ['2026-07-01T10:15:30.456','2026-07-01T07:15:30.456Z'],
  ['2026-03-29T02:59:59','2026-03-29T00:59:59Z'],
  ['2026-03-29T04:00:00','2026-03-29T01:00:00Z']
 ];
 for(const [local,utc] of examples){
  assert.equal(generatorInputTime(Date.parse(utc)),local);
  assert.equal(parseGeneratorInputTime(local),Date.parse(utc));
 }
 assert.throws(()=>parseGeneratorInputTime('2026-03-29T03:30'),/нет.*летнее/);
 assert.throws(()=>parseGeneratorInputTime('2026-10-25T03:30'),/дважды/);
 assert.ok(zones.includes('Europe/Kiev'),'use the supported IANA alias rather than a fixed UTC offset');
});

test('journal and prefilled transfer form mount when the runtime rejects Europe/Kyiv',async t=>{
 const {intl,zones}=legacyKyivIntl();
 const startedAtMs=Date.parse('2026-11-27T08:00:00.123Z'),stoppedAtMs=Date.parse('2026-11-27T10:00:00.987Z');
 const run={type:'run',revision:2,period:1,startedAtMs,stoppedAtMs,durationMs:stoppedAtMs-startedAtMs};
 const h=harness({states:{'red-small':stoppedState()},journals:{'red-small':[run]},intl});t.after(()=>h.close());await flush();
 assert.equal(h.get('genStatus').textContent,'Остановлен');
 const display=new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Kiev'});
 const text=h.get('genHistory').children[0].children[1].textContent;
 assert.ok(text.includes(display.format(new Date(startedAtMs))));assert.ok(text.includes(display.format(new Date(stoppedAtMs))));
 h.click('genTransfer');assert.equal(h.get('genTransferForm').hidden,false);
 assert.equal(h.get('genTransferFrom').value,'2026-11-27T10:00:00.123');assert.equal(h.get('genTransferTo').value,'2026-11-27T12:00:00.987');
 h.input('genTransferTarget','yellow','change');h.respondNext('previewTransfer',request=>({data:transferPreview(request)}));h.click('genTransferPreview');await flush();
 assert.equal(h.get('genTransferConfirm').hidden,false);assert.ok(zones.includes('Europe/Kiev'));
});
