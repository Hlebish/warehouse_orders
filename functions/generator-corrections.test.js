'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {emptyState,transition}=require('./generator-hours');
const {attributedIntervals,previewTransfer,adjustment,createGeneratorCorrectionsHandler}=require('./generator-corrections');
const HOUR=3600000;
const segment=(start,end)=>({startedAtMs:start*HOUR,stoppedAtMs:end*HOUR});
const rejection=(fn,code='failed-precondition')=>assert.throws(fn,error=>error.code===code);
function journal(runs,resets=[]){
 let state=emptyState();const events=[];
 const actions=[...runs.flatMap(([start,end])=>[{action:'start',at:start},{action:'stop',at:end}]),...resets.map(at=>({action:'reset',at}))].sort((a,b)=>a.at-b.at);
 for(const {action,at} of actions){const result=transition(state,action,state.revision,at*HOUR,'worker');state=result.state;if(result.event)events.push(result.event);}
 return {state,events};
}
const defaultPreview=source=>({generatorId:'red-small',targetGeneratorId:'yellow',fromMs:0,toMs:20*HOUR,source:source.state,target:emptyState(),sourceEvents:source.events,targetEvents:[],now:30*HOUR});

test('transfer preview clips partial runs, excludes gaps, and does not change journal',()=>{
 const source=journal([[0,10],[12,15]]),before=JSON.stringify(source);
 const result=previewTransfer({...defaultPreview(source),fromMs:2*HOUR,toMs:14*HOUR});
 assert.deepEqual(result.segments,[segment(2,10),segment(12,14)]);
 assert.equal(result.durationMs,10*HOUR);
 assert.equal(result.sourceTotalMsAfter,3*HOUR);assert.equal(result.targetTotalMsAfter,10*HOUR);
 assert.equal(JSON.stringify(source),before);
});

test('old and current period amounts use each generator reset boundary',()=>{
 const source=journal([[0,10],[12,15]],[11]),target=journal([[16,17]],[13]);
 const result=previewTransfer({...defaultPreview(source),fromMs:2*HOUR,toMs:14*HOUR,target:target.state,targetEvents:target.events});
 assert.equal(result.durationMs,10*HOUR);
 assert.equal(result.sourcePeriodDeltaMs,2*HOUR);assert.equal(result.sourcePeriodMsAfter,HOUR);
 assert.equal(result.targetPeriodDeltaMs,HOUR);assert.equal(result.targetPeriodMsAfter,2*HOUR);
 assert.equal(result.sourceTotalMsAfter,3*HOUR);assert.equal(result.targetTotalMsAfter,11*HOUR);
});

test('journal replay prevents repeating removed time, permits remaining time and transferring received time',()=>{
 const source=journal([[0,10]]);
 const moved={type:'transfer_out',revision:3,durationMs:6*HOUR,segments:[segment(2,8)]};
 const intervals=attributedIntervals([...source.events,moved]);
 assert.deepEqual(intervals,[segment(0,2),segment(8,10)]);
 const after={...source,state:{...source.state,revision:3,periodMs:4*HOUR,totalMs:4*HOUR},events:[...source.events,moved]};
 rejection(()=>previewTransfer({...defaultPreview(after),fromMs:2*HOUR,toMs:8*HOUR}));
 assert.equal(previewTransfer(defaultPreview(after)).durationMs,4*HOUR);
 const received={type:'transfer_in',revision:1,durationMs:6*HOUR,segments:[segment(2,8)]};
 const recipient={state:{...emptyState(),revision:1,periodMs:6*HOUR,totalMs:6*HOUR},events:[received]};
 assert.equal(previewTransfer({...defaultPreview(recipient),generatorId:'yellow',targetGeneratorId:'red-large',fromMs:3*HOUR,toMs:5*HOUR}).durationMs,2*HOUR);
 assert.deepEqual(attributedIntervals([...source.events,moved,{...received,revision:4}]),[segment(0,10)],'a transfer back is attributed only once');
});

test('invalid ranges, future dates, same and legacy targets, running counters and target overlap reject',()=>{
 const source=journal([[0,10]]),base=defaultPreview(source);
 for(const patch of [{fromMs:10,toMs:10},{fromMs:-1},{fromMs:0.5},{toMs:31*HOUR},{targetGeneratorId:'red-small'},{targetGeneratorId:'warehouse'},{generatorId:'unknown'}])rejection(()=>previewTransfer({...base,...patch}),'invalid-argument');
 rejection(()=>previewTransfer({...base,source:{...source.state,startedAtMs:12*HOUR}}));
 rejection(()=>previewTransfer({...base,target:{...emptyState(),startedAtMs:12*HOUR}}));
 const target=journal([[5,7]]);
 rejection(()=>previewTransfer({...base,target:target.state,targetEvents:target.events}));
 assert.equal(previewTransfer({...base,generatorId:'warehouse'}).durationMs,10*HOUR);
 assert.equal(previewTransfer({...base,toMs:5*HOUR,target:target.state,targetEvents:target.events}).durationMs,5*HOUR,'adjacent intervals do not overlap');
});

test('manual adjustments apply signed time to current and total with no negative balance',()=>{
 const source=journal([[0,3],[5,7]],[4]);
 const plus=adjustment(source.state,{expectedRevision:source.state.revision,deltaMs:HOUR/2},10*HOUR);
 assert.equal(plus.periodMs,2.5*HOUR);assert.equal(plus.totalMs,5.5*HOUR);
 const minus=adjustment(plus,{expectedRevision:plus.revision,deltaMs:-2*HOUR},11*HOUR);
 assert.equal(minus.periodMs,HOUR/2);assert.equal(minus.totalMs,3.5*HOUR);
 rejection(()=>adjustment(minus,{expectedRevision:minus.revision,deltaMs:-HOUR},12*HOUR));
 rejection(()=>adjustment(minus,{expectedRevision:0,deltaMs:HOUR},12*HOUR));
 for(const deltaMs of [0,NaN,Infinity,0.1,'100',Number.MAX_SAFE_INTEGER+1])rejection(()=>adjustment(minus,{expectedRevision:minus.revision,deltaMs},12*HOUR),'invalid-argument');
 const running=transition(minus,'start',minus.revision,12*HOUR,'worker').state;
 rejection(()=>adjustment(running,{expectedRevision:running.revision,deltaMs:HOUR},13*HOUR));
});

test('manual counter deductions cannot cause a subsequent transfer to take balances below zero',()=>{
 const source=journal([[0,10]]);
 source.state=adjustment(source.state,{expectedRevision:source.state.revision,deltaMs:-9*HOUR},11*HOUR);
 rejection(()=>previewTransfer(defaultPreview(source)));
 assert.equal(previewTransfer({...defaultPreview(source),toMs:HOUR}).sourceTotalMsAfter,0);
});

test('malformed or duplicate journal intervals fail closed while zero-duration runs carry no time',()=>{
 const source=journal([[0,10]]);
 rejection(()=>attributedIntervals([...source.events,{...source.events[0],revision:4}]));
 rejection(()=>attributedIntervals([{...source.events[0],durationMs:1}]));
 rejection(()=>attributedIntervals([{type:'transfer_out',revision:3,durationMs:HOUR,segments:[segment(0,1)]}]));
 rejection(()=>attributedIntervals([{type:'transfer_in',revision:1,durationMs:HOUR,segments:[segment(0,2)]}]));
 assert.deepEqual(attributedIntervals([{type:'run',revision:2,startedAtMs:0,stoppedAtMs:0,durationMs:0}]),[]);
});

function harness({role='warehouse',active=true,admin=false}={}){
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const source=journal([[0,10]]),records=new Map([['users/actor',{active,role,admin,displayName:'Иван Кладовщик'}],['generators/red-small',source.state]]);
 for(const entry of source.events)records.set('generators/red-small/journal/'+entry.revision,entry);
 let writes=0,rejectCommit=false,commits=0;
 const ref=path=>({path,collection:name=>collection(path+'/'+name)});
 const collection=path=>({path,doc:id=>ref(path+'/'+id),orderBy:()=>({path,isQuery:true})});
 const clone=value=>value===undefined?undefined:structuredClone(value);
 const snapshot=path=>({exists:records.has(path),data:()=>clone(records.get(path))});
 const db={collection,runTransaction:async callback=>{
  const pending=[];
  const result=await callback({get:async target=>{
   assert.equal(pending.length,0,'Firestore transactions must finish reads before writes');
   if(target.isQuery)return {docs:[...records.keys()].filter(key=>key.startsWith(target.path+'/')).map(snapshot)};
   return snapshot(target.path);
  },set:(target,value)=>pending.push({path:target.path,value:clone(value)}),create:(target,value)=>pending.push({path:target.path,value:clone(value),create:true})});
  if(rejectCommit&&pending.length)throw new Error('Simulated transaction failure');
  for(const operation of pending)if(operation.create&&records.has(operation.path))throw new Error('Duplicate document');
  for(const operation of pending)records.set(operation.path,operation.value);
  writes+=pending.length;if(pending.length)commits++;
  return result;
 }};
 const handle=createGeneratorCorrectionsHandler({db,HttpsError,clock:()=>30*HOUR});
 return {records,call:data=>handle({auth:{uid:'actor'},data}),handle,get writes(){return writes},get commits(){return commits},rejectCommit(){rejectCommit=true}};
}
const transferInput={action:'transfer',generatorId:'red-small',targetGeneratorId:'yellow',fromMs:2*HOUR,toMs:8*HOUR,expectedRevision:2,expectedTargetRevision:0,requestId:'transfer-request-0001',reason:'Выбран не тот генератор'};
const adjustInput={action:'adjust',generatorId:'red-small',expectedRevision:2,deltaMs:HOUR,reason:'Забыл включить счётчик',requestId:'adjustment-request-0001'};

test('server preview is read-only; transfer atomically writes both counters, detailed audit and receipt',async()=>{
 const h=harness(),original=JSON.stringify(h.records.get('generators/red-small/journal/2'));
 const preview=await h.call({...transferInput,action:'previewTransfer'});
 assert.equal(h.writes,0);assert.equal(preview.durationMs,6*HOUR);assert.equal(preview.sourceRevision,2);assert.equal(preview.targetRevision,0);
 const response=await h.call(transferInput);
 assert.equal(h.commits,1);assert.equal(h.writes,5);
 assert.equal(response.generatorId,'red-small');assert.equal(response.targetGeneratorId,'yellow');
 assert.equal(response.state.totalMs+response.targetState.totalMs,10*HOUR);
 const out=h.records.get('generators/red-small/journal/3'),incoming=h.records.get('generators/yellow/journal/1');
 assert.equal(out.type,'transfer_out');assert.equal(incoming.type,'transfer_in');
 for(const entry of [out,incoming]){
  assert.equal(entry.actorId,'actor');assert.equal(entry.actorName,'Иван Кладовщик');assert.equal(entry.reason,transferInput.reason);
  assert.equal(entry.fromMs,2*HOUR);assert.equal(entry.toMs,8*HOUR);assert.equal(entry.durationMs,6*HOUR);
  assert.deepEqual(entry.segments,[segment(2,8)]);assert.equal(entry.requestId,transferInput.requestId);
 }
 assert.equal(out.periodDeltaMs,-6*HOUR);assert.equal(out.totalMsBefore,10*HOUR);assert.equal(out.totalMsAfter,4*HOUR);
 assert.equal(incoming.periodDeltaMs,6*HOUR);assert.equal(incoming.totalMsBefore,0);assert.equal(incoming.totalMsAfter,6*HOUR);
 assert.equal(JSON.stringify(h.records.get('generators/red-small/journal/2')),original);
});

test('lost-response retries reuse receipt without applying transfer or manual correction twice',async()=>{
 const h=harness(),result=await h.call(transferInput),writes=h.writes;
 const replay=await h.call(transferInput);
 assert.equal(replay.replayed,true);assert.deepEqual(replay.state,result.state);assert.equal(h.writes,writes);
 await assert.rejects(h.call({...transferInput,toMs:9*HOUR}),error=>error.code==='failed-precondition');
 await assert.rejects(h.call({...transferInput,expectedRevision:3,expectedTargetRevision:1,requestId:'transfer-request-0002'}),error=>error.code==='failed-precondition');
 const manual=harness();const adjusted=await manual.call(adjustInput),manualWrites=manual.writes;
 assert.equal(adjusted.state.totalMs,11*HOUR);
 assert.equal((await manual.call(adjustInput)).state.totalMs,11*HOUR);assert.equal(manual.writes,manualWrites);
 const audit=manual.records.get('generators/red-small/journal/3');assert.equal(audit.type,'adjustment');assert.equal(audit.deltaMs,HOUR);assert.equal(audit.totalMsBefore,10*HOUR);assert.equal(audit.totalMsAfter,11*HOUR);
});

test('old preview revisions, transaction failure and permissions cannot partially change balances',async()=>{
 for(const patch of [{expectedRevision:1},{expectedTargetRevision:1}]){
  const h=harness();await assert.rejects(h.call({...transferInput,...patch}),error=>error.code==='failed-precondition');assert.equal(h.writes,0);
 }
 const failed=harness();failed.rejectCommit();await assert.rejects(failed.call(transferInput),error=>error.code==='internal');assert.equal(failed.writes,0);
 assert.equal(failed.records.get('generators/red-small').totalMs,10*HOUR);assert.equal(failed.records.has('generators/yellow'),false);
 for(const profile of [{role:'manager'},{role:'warehouse',active:false},{role:'director',active:false,admin:true}]){
  const h=harness(profile);for(const data of [transferInput,adjustInput,{...transferInput,action:'previewTransfer'}])await assert.rejects(h.call(data),error=>error.code==='permission-denied');assert.equal(h.writes,0);
 }
 for(const profile of [{role:'director'},{role:'manager',admin:true}])assert.equal((await harness(profile).call(adjustInput)).state.totalMs,11*HOUR);
 await assert.rejects(harness().handle({data:adjustInput}),error=>error.code==='unauthenticated');
});

test('server validates correction reason, request identity and legacy destination; legacy source remains usable',async()=>{
 for(const patch of [{reason:''},{reason:' '.repeat(4)},{reason:'x'.repeat(501)},{reason:42},{requestId:'bad'},{deltaMs:'100'}])await assert.rejects(harness().call({...adjustInput,...patch}),error=>error.code==='invalid-argument');
 await assert.rejects(harness().call({...transferInput,targetGeneratorId:'warehouse'}),error=>error.code==='invalid-argument');
 const h=harness();h.records.set('generators/warehouse',h.records.get('generators/red-small'));h.records.set('generators/warehouse/journal/2',h.records.get('generators/red-small/journal/2'));
 const result=await h.call({...transferInput,generatorId:'warehouse'});assert.equal(result.state.totalMs,4*HOUR);assert.equal(result.targetState.totalMs,6*HOUR);
 assert.equal(h.records.get('generators/red-small').totalMs,10*HOUR);
});

test('a deduction before reset prevents removing more old time than its remaining balance',async()=>{
 const first=journal([[0,3]]),events=[...first.events];
 let state=adjustment(first.state,{expectedRevision:first.state.revision,deltaMs:-2*HOUR},3.5*HOUR);
 events.push({type:'adjustment',revision:state.revision,deltaMs:-2*HOUR});
 for(const [action,at] of [['reset',4],['start',5],['stop',9]]){
  const result=transition(state,action,state.revision,at*HOUR,'worker');state=result.state;if(result.event)events.push(result.event);
 }
 assert.equal(state.totalMs,5*HOUR);assert.equal(state.periodMs,4*HOUR);
 const h=harness();
 for(const key of [...h.records.keys()])if(key.startsWith('generators/red-small/journal/'))h.records.delete(key);
 h.records.set('generators/red-small',state);
 for(const entry of events)h.records.set('generators/red-small/journal/'+entry.revision,entry);
 const before=JSON.stringify([...h.records]);
 const request={...transferInput,fromMs:0,toMs:2*HOUR,expectedRevision:state.revision};
 await assert.rejects(h.call({...request,action:'previewTransfer'}),error=>error.code==='failed-precondition');
 await assert.rejects(h.call(request),error=>error.code==='failed-precondition');
 assert.equal(h.writes,0);assert.equal(JSON.stringify([...h.records]),before);
 const allowed=await h.call({...request,toMs:HOUR});
 assert.equal(allowed.state.totalMs,4*HOUR);assert.equal(allowed.state.periodMs,4*HOUR);
 assert.equal(allowed.targetState.totalMs,HOUR);
});
