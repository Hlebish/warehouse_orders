'use strict';

const {createHash}=require('node:crypto');
const {emptyState,canOperate,GENERATOR_IDS}=require('./generator-hours');

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const sum=segments=>segments.reduce((total,segment)=>total+segment.stoppedAtMs-segment.startedAtMs,0);

function checkedState(previous){
 const state=previous??emptyState();
 if(!integer(state.revision)||state.revision===Number.MAX_SAFE_INTEGER||!integer(state.period)||state.period<1||
  !integer(state.periodMs)||!integer(state.totalMs)||state.periodMs>state.totalMs||
  (state.lastResetAtMs!==null&&!integer(state.lastResetAtMs))||
  (state.startedAtMs!==null&&!integer(state.startedAtMs))||!integer(state.updatedAtMs)){
  fail('failed-precondition','Данные счётчика повреждены. Требуется проверка учёта.');
 }
 return state;
}

function checkedSegment(segment){
 const {startedAtMs,stoppedAtMs}=segment||{};
 if(!integer(startedAtMs)||!integer(stoppedAtMs)||stoppedAtMs<=startedAtMs){
  fail('failed-precondition','В журнале есть некорректный интервал. Требуется проверка учёта.');
 }
 return {startedAtMs,stoppedAtMs};
}

function overlap(a,b){return a.startedAtMs<b.stoppedAtMs&&b.startedAtMs<a.stoppedAtMs;}
function intersect(segments,fromMs,toMs){
 return segments.map(segment=>({startedAtMs:Math.max(segment.startedAtMs,fromMs),stoppedAtMs:Math.min(segment.stoppedAtMs,toMs)}))
  .filter(segment=>segment.stoppedAtMs>segment.startedAtMs);
}
function mergeAdjacent(segments){
 const result=[];
 for(const segment of segments.slice().sort((a,b)=>a.startedAtMs-b.startedAtMs)){
  const last=result.at(-1);
  if(last&&last.stoppedAtMs>segment.startedAtMs)fail('failed-precondition','В журнале обнаружено повторное начисление одного интервала. Требуется проверка учёта.');
  if(last&&last.stoppedAtMs===segment.startedAtMs)last.stoppedAtMs=segment.stoppedAtMs;
  else result.push({...segment});
 }
 return result;
}

// Replaying the immutable journal tracks which recorded intervals still belong
// to this generator. Subtracting a transfer never changes its original run.
function attributedIntervals(events){
 let intervals=[];
 const ordered=events.slice().sort((a,b)=>a.revision-b.revision);
 for(const event of ordered){
  if(event.type==='run'){
   // A start/stop in the same millisecond is valid, but carries no time.
   if(event.durationMs===0&&event.startedAtMs===event.stoppedAtMs&&integer(event.startedAtMs))continue;
   const segment=checkedSegment(event);
   if(event.durationMs!==sum([segment]))fail('failed-precondition','Продолжительность запуска не совпадает с журналом. Требуется проверка учёта.');
   intervals=mergeAdjacent([...intervals,segment]);
  }else if(event.type==='transfer_in'||event.type==='transfer_out'){
   if(!Array.isArray(event.segments)||!event.segments.length)fail('failed-precondition','В журнале переноса отсутствуют интервалы.');
   const segments=mergeAdjacent(event.segments.map(checkedSegment));
   if(sum(segments)!==event.durationMs)fail('failed-precondition','Продолжительность переноса не совпадает с журналом.');
   if(event.type==='transfer_in')intervals=mergeAdjacent([...intervals,...segments]);
   else for(const segment of segments){
    if(sum(intersect(intervals,segment.startedAtMs,segment.stoppedAtMs))!==sum([segment])){
     fail('failed-precondition','В журнале обнаружен повторный перенос одного интервала. Требуется проверка учёта.');
    }
    intervals=intervals.flatMap(current=>{
     if(!overlap(current,segment))return [current];
     const remaining=[];
     if(current.startedAtMs<segment.startedAtMs)remaining.push({startedAtMs:current.startedAtMs,stoppedAtMs:segment.startedAtMs});
     if(current.stoppedAtMs>segment.stoppedAtMs)remaining.push({startedAtMs:segment.stoppedAtMs,stoppedAtMs:current.stoppedAtMs});
     return remaining;
    });
   }
  }
 }
 return intervals;
}

function validateGenerator(id,{target=false}={}){
 if(!GENERATOR_IDS.includes(id))fail('invalid-argument','Выберите генератор.');
 if(target&&id==='warehouse')fail('invalid-argument','Выберите конкретный генератор, которому нужно передать моточасы.');
 return id;
}
function validateRevision(expected,state){
 if(!integer(expected))fail('invalid-argument','Некорректная версия данных.');
 if(expected!==state.revision)fail('failed-precondition','Данные уже изменены на другом устройстве. Проверьте расчёт ещё раз.');
}
function requireStopped(state,label){
 if(state.startedAtMs!==null)fail('failed-precondition','Сначала остановите счётчик '+label+'.');
}
function safeBalance(value){
 if(!integer(value))fail('failed-precondition','Корректировка не должна делать моточасы отрицательными или превышать допустимый счётчик.');
 return value;
}
function checkedBalances(periodMs,totalMs){
 safeBalance(periodMs);safeBalance(totalMs);
 if(periodMs>totalMs)fail('failed-precondition','В выбранном периоде недостаточно моточасов с учётом предыдущих исправлений. Выберите меньший интервал.');
 return {periodMs,totalMs};
}
function validatedRange(fromMs,toMs,now){
 if(!integer(fromMs)||!integer(toMs)||fromMs>=toMs||toMs>now){
  fail('invalid-argument','Укажите корректное начало и окончание периода, не позднее текущего времени.');
 }
}

function previewTransfer({generatorId,targetGeneratorId,fromMs,toMs,source,target,sourceEvents,targetEvents,now}){
 validateGenerator(generatorId);validateGenerator(targetGeneratorId,{target:true});
 if(generatorId===targetGeneratorId)fail('invalid-argument','Выберите другой генератор для переноса.');
 validatedRange(fromMs,toMs,now);
 source=checkedState(source);target=checkedState(target);
 requireStopped(source,'исходного генератора');requireStopped(target,'генератора-получателя');
 const segments=intersect(attributedIntervals(sourceEvents),fromMs,toMs);
 const durationMs=sum(segments);
 if(!durationMs)fail('failed-precondition','За выбранный период нет моточасов для переноса: запусков не было или они уже перенесены.');
 // Keep a correction small enough for one Firestore document and one atomic
// transaction; the caller can split a very large historical range into parts.
 if(segments.length>1000)fail('resource-exhausted','В периоде слишком много отдельных запусков. Выберите меньший период.');
 const targetIntervals=attributedIntervals(targetEvents);
 if(segments.some(segment=>targetIntervals.some(current=>overlap(segment,current)))){
  fail('failed-precondition','У выбранного генератора уже учтена работа в этом интервале. Выберите другой период или генератор.');
 }
 const sourcePeriodDeltaMs=sum(intersect(segments,source.lastResetAtMs??0,Number.MAX_SAFE_INTEGER));
 const targetPeriodDeltaMs=sum(intersect(segments,target.lastResetAtMs??0,Number.MAX_SAFE_INTEGER));
 const sourceBalances=checkedBalances(source.periodMs-sourcePeriodDeltaMs,source.totalMs-durationMs);
 const targetBalances=checkedBalances(target.periodMs+targetPeriodDeltaMs,target.totalMs+durationMs);
 return {generatorId,targetGeneratorId,fromMs,toMs,durationMs,segments,
  sourceRevision:source.revision,targetRevision:target.revision,sourcePeriodDeltaMs,targetPeriodDeltaMs,
  sourceTotalMsAfter:sourceBalances.totalMs,sourcePeriodMsAfter:sourceBalances.periodMs,
  targetTotalMsAfter:targetBalances.totalMs,targetPeriodMsAfter:targetBalances.periodMs};
}

function adjustment(previous,{deltaMs,expectedRevision},now){
 const state=checkedState(previous);
 validateRevision(expectedRevision,state);requireStopped(state,'генератора');
 if(!Number.isSafeInteger(deltaMs)||deltaMs===0)fail('invalid-argument','Укажите ненулевое количество моточасов для корректировки.');
 return {...state,revision:state.revision+1,updatedAtMs:Math.max(now,state.updatedAtMs),
  ...checkedBalances(state.periodMs+deltaMs,state.totalMs+deltaMs)};
}

function normalizeRequest(data){
 const {action,generatorId}=data;
 validateGenerator(generatorId);
 if(!['adjust','previewTransfer','transfer'].includes(action))fail('invalid-argument','Некорректное действие.');
 const result={action,generatorId};
 if(action!=='adjust'){
  validateGenerator(data.targetGeneratorId,{target:true});
  if(generatorId===data.targetGeneratorId)fail('invalid-argument','Выберите другой генератор для переноса.');
  Object.assign(result,{targetGeneratorId:data.targetGeneratorId,fromMs:data.fromMs,toMs:data.toMs});
 }
 if(action!=='previewTransfer'){
  if(typeof data.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(data.requestId))fail('invalid-argument','Не удалось определить запрос. Откройте форму заново.');
  if(!integer(data.expectedRevision))fail('invalid-argument','Некорректная версия данных.');
  if(data.reason!==undefined&&typeof data.reason!=='string')fail('invalid-argument','Укажите причину исправления текстом.');
  const reason=(data.reason||'').trim();
  if(reason.length>500||(action==='adjust'&&!reason))fail('invalid-argument','Укажите причину исправления: от 1 до 500 символов.');
  Object.assign(result,{expectedRevision:data.expectedRevision,requestId:data.requestId,reason});
  if(action==='adjust'){
   if(!Number.isSafeInteger(data.deltaMs)||data.deltaMs===0)fail('invalid-argument','Укажите ненулевое количество моточасов для корректировки.');
   result.deltaMs=data.deltaMs;
  }else{
   if(!integer(data.expectedTargetRevision))fail('invalid-argument','Некорректная версия данных получателя.');
   result.expectedTargetRevision=data.expectedTargetRevision;
  }
 }
 return result;
}

const balanceFields=(before,after)=>({periodMsBefore:before.periodMs,periodMsAfter:after.periodMs,totalMsBefore:before.totalMs,totalMsAfter:after.totalMs});
const digest=value=>createHash('sha256').update(value).digest('hex');

function createGeneratorCorrectionsHandler({db,HttpsError,clock=Date.now}){
 return async request=>{
  try{
   if(!request.auth?.uid)fail('unauthenticated','Войдите в приложение.');
   const uid=request.auth.uid,data=normalizeRequest(request.data||{});
   const actorRef=db.collection('users').doc(uid);
   const sourceRef=db.collection('generators').doc(data.generatorId);
   const targetRef=data.targetGeneratorId?db.collection('generators').doc(data.targetGeneratorId):null;
   const receiptRef=data.requestId?db.collection('generatorOperations').doc(digest(JSON.stringify([uid,data.requestId]))):null;
   const fingerprint=digest(JSON.stringify(data));
   return await db.runTransaction(async tx=>{
    const actorSnap=await tx.get(actorRef),actor=actorSnap.data();
    if(!canOperate(actor))fail('permission-denied','Недостаточно прав для учёта генератора.');
    const now=clock();
    if(!integer(now))fail('internal','Некорректное время сервера.');
    if(receiptRef){
     const receipt=await tx.get(receiptRef);
     if(receipt.exists){
      if(receipt.data().fingerprint!==fingerprint)fail('failed-precondition','Этот запрос уже использован для другого исправления. Откройте форму заново.');
      return {...receipt.data().result,serverNowMs:now,replayed:true};
     }
    }
    const source=checkedState((await tx.get(sourceRef)).data());
    if(data.action!=='previewTransfer')validateRevision(data.expectedRevision,source);
    const actorName=typeof actor.displayName==='string'?actor.displayName.trim().slice(0,100):'';
    const audit={actorId:uid,actorName:actorName||'Сотрудник',reason:data.reason||'',requestId:data.requestId||'',atMs:Math.max(now,source.updatedAtMs)};
    let result;
    if(data.action==='adjust'){
     const state=adjustment(source,data,now);
     const event={type:'adjustment',generatorId:data.generatorId,revision:state.revision,period:state.period,
      deltaMs:data.deltaMs,periodDeltaMs:data.deltaMs,...balanceFields(source,state),...audit};
     result={generatorId:data.generatorId,state,serverNowMs:now};
     tx.set(sourceRef,state);tx.create(sourceRef.collection('journal').doc(String(state.revision)),event);
    }else{
     const target=checkedState((await tx.get(targetRef)).data());
     if(data.action==='transfer')validateRevision(data.expectedTargetRevision,target);
     validatedRange(data.fromMs,data.toMs,now);
     const [sourceJournal,targetJournal]=await Promise.all([tx.get(sourceRef.collection('journal').orderBy('revision')),tx.get(targetRef.collection('journal').orderBy('revision'))]);
     const preview=previewTransfer({...data,source,target,sourceEvents:sourceJournal.docs.map(doc=>doc.data()),targetEvents:targetJournal.docs.map(doc=>doc.data()),now});
     if(data.action==='previewTransfer')return {...preview,serverNowMs:now};
     const atMs=Math.max(now,source.updatedAtMs,target.updatedAtMs);
     const state={...source,revision:source.revision+1,updatedAtMs:atMs,periodMs:preview.sourcePeriodMsAfter,totalMs:preview.sourceTotalMsAfter};
     const targetState={...target,revision:target.revision+1,updatedAtMs:atMs,periodMs:preview.targetPeriodMsAfter,totalMs:preview.targetTotalMsAfter};
     const shared={sourceGeneratorId:data.generatorId,targetGeneratorId:data.targetGeneratorId,fromMs:data.fromMs,toMs:data.toMs,
      durationMs:preview.durationMs,segments:preview.segments,...audit,atMs};
     tx.set(sourceRef,state);tx.set(targetRef,targetState);
     tx.create(sourceRef.collection('journal').doc(String(state.revision)),{type:'transfer_out',revision:state.revision,period:state.period,
      periodDeltaMs:-preview.sourcePeriodDeltaMs,...balanceFields(source,state),...shared});
     tx.create(targetRef.collection('journal').doc(String(targetState.revision)),{type:'transfer_in',revision:targetState.revision,period:targetState.period,
      periodDeltaMs:preview.targetPeriodDeltaMs,...balanceFields(target,targetState),...shared});
     result={generatorId:data.generatorId,targetGeneratorId:data.targetGeneratorId,state,targetState,durationMs:preview.durationMs,serverNowMs:now};
    }
    // The receipt is committed with both counters and journal entries. A retry
    // after a lost response returns this result without applying time twice.
    tx.create(receiptRef,{actorId:uid,requestId:data.requestId,fingerprint,result,createdAtMs:now});
    return result;
   });
  }catch(error){
   if(error instanceof HttpsError)throw error;
   const known=['unauthenticated','permission-denied','invalid-argument','failed-precondition','resource-exhausted'];
   if(known.includes(error.code))throw new HttpsError(error.code,error.message);
   throw new HttpsError('internal','Не удалось сохранить исправление. Проверьте состояние перед повтором.');
  }
 };
}

module.exports={attributedIntervals,previewTransfer,adjustment,createGeneratorCorrectionsHandler};
