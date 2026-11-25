'use strict';

function emptyState(){return {revision:0,period:1,startedAtMs:null,startedBy:null,periodMs:0,totalMs:0,lastResetAtMs:null,updatedAtMs:0};}

function canOperate(profile){return profile?.active===true&&(profile.admin===true||['warehouse','director'].includes(profile.role));}

function transition(previous,action,expectedRevision,now,uid){
 const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
 const state=previous??emptyState();
 if(!['start','stop','reset'].includes(action)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('invalid-argument','Некорректное действие.');
 if(state.revision!==expectedRevision)fail('failed-precondition','Данные уже изменены на другом устройстве. Проверьте состояние.');
 if(!Number.isSafeInteger(now)||now<0)fail('internal','Некорректное время сервера.');
 const at=Math.max(now,state.updatedAtMs||0,state.startedAtMs??0);
 const next={...state,revision:state.revision+1,updatedAtMs:at};
 let event=null;
 if(action==='start'){
  if(state.startedAtMs!==null)fail('failed-precondition','Генератор уже работает.');
  next.startedAtMs=at;next.startedBy=uid;
 }else if(action==='stop'){
  if(state.startedAtMs===null)fail('failed-precondition','Генератор уже остановлен.');
  const durationMs=at-state.startedAtMs;
  next.periodMs+=durationMs;next.totalMs+=durationMs;next.startedAtMs=null;next.startedBy=null;
  event={type:'run',revision:next.revision,period:state.period,startedAtMs:state.startedAtMs,stoppedAtMs:at,durationMs,startedBy:state.startedBy,stoppedBy:uid,atMs:at};
 }else{
  if(state.startedAtMs!==null)fail('failed-precondition','Сначала остановите генератор.');
  event={type:'reset',revision:next.revision,period:state.period,atMs:at,durationMs:state.periodMs,totalMs:state.totalMs,resetBy:uid};
  next.period+=1;next.periodMs=0;next.lastResetAtMs=at;
 }
 return {state:next,event};
}

module.exports={emptyState,canOperate,transition};
