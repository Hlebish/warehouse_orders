// Shared generator screen, mounted inside the existing application modal.
const INITIAL={revision:0,period:1,startedAtMs:null,periodMs:0,totalMs:0,lastResetAtMs:null};
export const generatorDuration=ms=>{
 const duration=Math.max(0,ms);
 const minutes=Math.floor(duration/60000);
 const decimal=(duration/3600000).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false});
 return decimal+' мч ('+Math.floor(minutes/60)+' ч '+minutes%60+' мин)';
};
const dateTime=ms=>ms==null?'—':new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Kyiv'}).format(new Date(ms));
export function createGeneratorScreen({db,doc,collection,query,orderBy,onSnapshot,call,canOperate}){
 let dispose=null,refresh=null;
 function close(){dispose?.();dispose=null;refresh=null;}
 function open(root){
  close();
  if(!root)return;
  let alive=true,state=null,serverState=false,journalReady=false,busy=false,clockOffset=0,message='',clockPending=false;
  let events=[];
  root.innerHTML='<div class="generator-status-line"><span id="genStatus" class="status-pill status-neutral">Загрузка…</span><span id="genPeriodLabel" class="field-hint"></span></div>'+
   '<div class="generator-grid">'+
   '<article class="stat-card"><div class="stat-label">Текущий запуск</div><strong id="genCurrent">—</strong><small id="genStarted"></small></article>'+
   '<article class="stat-card"><div class="stat-label">Наработка за текущий период</div><strong id="genPeriod">—</strong></article>'+
   '<article class="stat-card"><div class="stat-label">Наработка за всё время</div><strong id="genTotal">—</strong></article></div>'+
   '<div class="generator-actions"><button type="button" id="genStart" class="primary-button" disabled>Старт генератора</button>'+
   '<button type="button" id="genStop" class="small-button danger" disabled>Стоп генератора</button>'+
   '<button type="button" id="genReset" class="secondary-button" disabled>Сбросить счётчик</button></div>'+
   '<div id="genConfirm" class="generator-confirm" hidden><p>Начать новый период с 0 ч 0 мин? История запусков и итог прошлого периода сохранятся</p><div class="generator-actions"><button type="button" id="genResetYes" class="small-button danger">Подтвердить сброс</button><button type="button" id="genResetNo" class="secondary-button">Отмена</button></div></div>'+
   '<p id="genFeedback" role="status" class="generator-feedback"></p><p class="field-hint">1 мч = 1 час работы двигателя. Моточасы отображаются с округлением до сотых; время сохраняется без округления. Приложение не управляет генератором.</p>'+
   '<h3 class="detail-section-title">Журнал запусков и сбросов</h3><div id="genHistory" class="timeline" aria-label="Журнал"></div>';
  const el=id=>root.querySelector('#'+id);
  let confirmationRevision=null;
  function hideConfirmation(){confirmationRevision=null;el('genConfirm').hidden=true;}
  const online=()=>navigator.onLine!==false;
  function render(){
   if(!alive)return;
   const running=state?.startedAtMs!=null;
   const usable=!!state&&serverState&&online()&&canOperate()&&!busy;
   const elapsed=running?Math.max(0,Date.now()+clockOffset-state.startedAtMs):0;
   el('genStatus').textContent=!state?'Загрузка…':running?'Работает':'Остановлен';
   el('genStatus').className='status-pill '+(running?'status-assembled':'status-neutral');
   el('genCurrent').textContent=state?generatorDuration(elapsed):'—';
   el('genPeriod').textContent=state?generatorDuration(state.periodMs+elapsed):'—';
   el('genTotal').textContent=state?generatorDuration(state.totalMs+elapsed):'—';
   el('genStarted').textContent=running?'Старт: '+dateTime(state.startedAtMs):'';
   el('genPeriodLabel').textContent=state?'Период № '+state.period+(state.lastResetAtMs?' · с '+dateTime(state.lastResetAtMs):''):'';
   el('genStart').disabled=!usable||running;
   el('genStop').disabled=!usable||!running;
   el('genReset').disabled=!usable||running;
   if(confirmationRevision!==null&&(!usable||running||state.revision!==confirmationRevision))hideConfirmation();
   el('genFeedback').textContent=busy?'Сохраняем на сервере…':message||(!online()?'Нет связи. Изменения не отправляются; данные могут быть устаревшими.':!serverState?'Ожидаем подтверждение данных с сервера…':!canOperate()?'Доступен просмотр. Запись — кладовщику, директору и администратору.':!journalReady?'Загружаем журнал…':'');
  }
  function renderHistory(){
   if(!alive)return;
   const history=el('genHistory');history.replaceChildren();
   if(!events.length){
    const p=document.createElement('p');p.className='field-hint';p.textContent=journalReady?'Записей пока нет.':'Загрузка журнала…';history.append(p);return;
   }
   for(const entry of events){
    const item=document.createElement('article');item.className='timeline-item';
    const title=document.createElement('b');const body=document.createElement('div');body.className='timeline-text';
    if(entry.type==='reset'){
     title.textContent='Сброс · период № '+entry.period;
     body.textContent=dateTime(entry.atMs)+' · итог закрытого периода: '+generatorDuration(entry.durationMs)+' · всего: '+generatorDuration(entry.totalMs);
    }else{
     title.textContent='Запуск · период № '+entry.period+' · '+generatorDuration(entry.durationMs);
     body.textContent='Старт: '+dateTime(entry.startedAtMs)+'\nСтоп: '+dateTime(entry.stoppedAtMs);
    }
    item.append(title,body);history.append(item);
   }
  }
  async function syncClock(){
   if(!alive||!online()||clockPending)return;
   clockPending=true;
   const begin=Date.now();
   try{const result=await call({action:'clock'});if(alive&&Number.isFinite(result.data.serverNowMs))clockOffset=result.data.serverNowMs-(begin+Date.now())/2;}
   catch{}finally{clockPending=false;if(alive)render();}
  }
  async function act(action){
   if(!alive||busy||!state||!serverState||!online()||!canOperate()){
    message='Действие не отправлено. Проверьте подключение и права доступа.';render();return;
   }
   const running=state.startedAtMs!==null;
   if((action==='start'&&running)||(action!=='start'&&!running&&action==='stop')||(action==='reset'&&running))return;
   const expectedRevision=state.revision;
   if(action==='reset'&&confirmationRevision!==expectedRevision)return;
   hideConfirmation();busy=true;message='';render();
   const begin=Date.now();
   try{
    const {data}=await call({action,expectedRevision});
    if(!alive)return;
    if(data.state&&data.state.revision>=state.revision)state=data.state;
    if(Number.isFinite(data.serverNowMs))clockOffset=data.serverNowMs-(begin+Date.now())/2;
    message='Сохранено на сервере.';
   }catch(error){
    if(!alive)return;
    // A timeout may mean the server committed but the response was lost. Never
    // retry automatically; the live snapshot will reveal the actual revision.
    const code=String(error?.code||'');
    if(code.endsWith('failed-precondition')||code.endsWith('permission-denied')||code.endsWith('invalid-argument')){
     message='Действие не сохранено. '+(error.message||'Обновите состояние.');
    }else{
     message='Сохранение не подтверждено. Проверьте связь и состояние перед повторным действием.';
    }
   }finally{if(alive){busy=false;render();}}
  }
  el('genStart').addEventListener('click',()=>void act('start'));
  el('genStop').addEventListener('click',()=>void act('stop'));
  el('genReset').addEventListener('click',()=>{
   if(el('genReset').disabled)return;
   confirmationRevision=state.revision;el('genConfirm').hidden=false;
  });
  el('genResetYes').addEventListener('click',()=>void act('reset'));
  el('genResetNo').addEventListener('click',hideConfirmation);
  const ref=doc(db,'generators','warehouse');
  const stateStop=onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
   if(!alive)return;
   const incoming=snapshot.exists()?snapshot.data():{...INITIAL};
   if(!state||incoming.revision>=state.revision)state=incoming;
   serverState=!snapshot.metadata.fromCache;render();
  },()=>{
   if(!alive)return;serverState=false;message='Не удалось получить состояние генератора с сервера.';render();
  });
  const journalStop=onSnapshot(query(collection(ref,'journal'),orderBy('revision','desc')),{includeMetadataChanges:true},snapshot=>{
   if(!alive)return;
   events=snapshot.docs.map(d=>d.data());journalReady=!snapshot.metadata.fromCache;renderHistory();render();
  },()=>{
   if(!alive)return;journalReady=false;el('genHistory').textContent='Не удалось загрузить журнал.';render();
  });
  function onOffline(){serverState=false;message='Нет связи. Действия не отправляются.';render();}
  function onOnline(){message='';render();void syncClock();}
  function onVisible(){if(!document.hidden){render();void syncClock();}}
  window.addEventListener('offline',onOffline);
  window.addEventListener('online',onOnline);
  window.addEventListener('warehouse-app-resumed',onVisible);
  document.addEventListener('visibilitychange',onVisible);
  const timer=setInterval(render,1000);
  refresh=render;
  dispose=()=>{
   alive=false;clearInterval(timer);stateStop();journalStop();
   window.removeEventListener('offline',onOffline);window.removeEventListener('online',onOnline);
   window.removeEventListener('warehouse-app-resumed',onVisible);document.removeEventListener('visibilitychange',onVisible);
  };
  renderHistory();render();void syncClock();
 }
 return {open,close,isOpen:()=>dispose!==null,refreshPermissions:()=>refresh?.()};
}
