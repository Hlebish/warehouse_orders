// Shared generator screen, mounted inside the existing application modal.
const GENERATORS=[['red-small','Красный маленький'],['yellow','Жёлтый'],['red-large','Красный большой'],['warehouse','Старый учёт (без привязки)']];
const INITIAL={revision:0,period:1,startedAtMs:null,periodMs:0,totalMs:0,lastResetAtMs:null};
const generatorName=id=>GENERATORS.find(([key])=>key===id)?.[1]||'Генератор';
const decimalHours=new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false});
export const generatorEngineHours=ms=>decimalHours.format(Math.max(0,ms)/3600000)+' мч';
export const generatorClockHours=ms=>{
 const minutes=Math.floor(Math.max(0,ms)/60000);
 return Math.floor(minutes/60)+' ч '+minutes%60+' мин';
};
export const generatorDuration=ms=>generatorEngineHours(ms)+' ('+generatorClockHours(ms)+')';
const dateTime=ms=>ms==null?'—':new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Kyiv'}).format(new Date(ms));
const kyivParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function generatorInputTime(ms){
 const p=Object.fromEntries(kyivParts.formatToParts(new Date(ms)).map(part=>[part.type,part.value]));
 const milliseconds=new Date(ms).getUTCMilliseconds();
 return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':'+p.second+(milliseconds?'.'+String(milliseconds).padStart(3,'0'):'');
}
// datetime-local has no timezone. Resolve its Kyiv wall time explicitly so that
// a phone configured for another timezone cannot move the wrong hours.
export function parseGeneratorInputTime(value){
 const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
 if(!match)throw new Error('Укажите дату и время начала и окончания.');
 const [year,month,day,hour,minute,second]=match.slice(1,7).map(value=>Number(value||0)),milliseconds=Number((match[7]||'').padEnd(3,'0'));
 const nominal=Date.UTC(year,month-1,day,hour,minute,second,milliseconds),utc=new Date(nominal);
 if(year<1970||utc.getUTCFullYear()!==year||utc.getUTCMonth()!==month-1||utc.getUTCDate()!==day||utc.getUTCHours()!==hour||utc.getUTCMinutes()!==minute||utc.getUTCSeconds()!==second)throw new Error('Проверьте дату и время.');
 const normalized=match[1]+'-'+match[2]+'-'+match[3]+'T'+match[4]+':'+match[5]+':'+String(second).padStart(2,'0')+(milliseconds?'.'+String(milliseconds).padStart(3,'0'):'');
 const offsets=new Set([-129600000,0,129600000].map(delta=>{
  const sample=Math.floor((nominal+delta)/1000)*1000;
  const p=Object.fromEntries(kyivParts.formatToParts(new Date(sample)).map(part=>[part.type,Number(part.value)]));
  return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-sample;
 }));
 const candidates=[...offsets].map(offset=>nominal-offset).filter(ms=>generatorInputTime(ms)===normalized);
 if(candidates.length===0)throw new Error('Такого времени в Киеве нет из-за перехода на летнее время. Выберите другое время.');
 if(candidates.length!==1)throw new Error('Это время в Киеве встречается дважды при переводе часов. Выберите границу периода вне повторяющегося часа.');
 return candidates[0];
}
export function parseGeneratorHours(value){
 const text=String(value||'').trim();
 if(text.length>20||!/^\d+(?:[.,]\d{1,6})?$/.test(text))throw new Error('Введите положительное число моточасов, например 1,5.');
 const ms=Math.round(Number(text.replace(',','.'))*3600000);
 if(!Number.isSafeInteger(ms)||ms<=0)throw new Error('Количество моточасов должно быть больше нуля.');
 return ms;
}
const newRequestId=()=>globalThis.crypto?.randomUUID?.()||'gen-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const signedDuration=ms=>(ms<0?'−':'+')+generatorDuration(Math.abs(ms));

export function createGeneratorScreen({db,doc,collection,query,orderBy,onSnapshot,call,canOperate}){
 let dispose=null,refresh=null,selectedId='red-small';
 function close(){dispose?.();dispose=null;refresh=null;}
 function open(root,generatorId=selectedId){
  close();
  if(!root)return;
  if(!GENERATORS.some(([id])=>id===generatorId))generatorId='red-small';
  selectedId=generatorId;
  const legacy=generatorId==='warehouse',name=generatorName(generatorId);
  root.dataset.generatorId=generatorId;
  let alive=true,state=null,serverState=false,journalReady=false,busy=false,clockOffset=0,message='',clockPending=false;
  let events=[],adjustmentPreview=null,transferPreview=null,pendingMutation=null;
  root.innerHTML='<label class="generator-label" for="genSelect">Выберите генератор</label><select class="generator-select" id="genSelect">'+GENERATORS.map(([id,name])=>'<option value="'+id+'">'+name+'</option>').join('')+'</select>'+(legacy?'<p class="field-hint">Старые записи сохранены без привязки к конкретному генератору. Их можно перенести на нужный генератор. Новые запуски учитываются отдельно.</p>':'')+'<div class="generator-status-line"><span id="genStatus" class="status-pill status-neutral">Загрузка…</span><span id="genPeriodLabel" class="field-hint"></span></div>'+
   '<div class="generator-grid">'+
   '<article class="generator-metric generator-current"><div class="generator-label" id="genCurrentLabel">Текущий запуск · '+name+'</div><strong class="generator-value" id="genCurrent">—</strong><div class="generator-time" id="genCurrentTime">—</div><small class="generator-started" id="genStarted"></small></article>'+
   '<article class="generator-metric"><div class="generator-label">За текущий период</div><strong class="generator-value" id="genPeriod">—</strong><div class="generator-time" id="genPeriodTime">—</div></article>'+
   '<article class="generator-metric"><div class="generator-label">За всё время</div><strong class="generator-value" id="genTotal">—</strong><div class="generator-time" id="genTotalTime">—</div></article></div>'+
   '<p class="field-hint">Счётчики относятся к выбранному генератору. Переключение списка не запускает и не останавливает учёт.</p>'+
   '<div class="generator-actions generator-controls"><button type="button" id="genStart" class="generator-button generator-start" disabled>Старт генератора</button>'+
   '<button type="button" id="genStop" class="generator-button generator-stop" disabled>Стоп генератора</button>'+
   '<button type="button" id="genReset" class="generator-button generator-reset" disabled>Сбросить счётчик</button></div>'+
   '<div id="genConfirm" class="generator-confirm" hidden><p>Начать новый период с 0 ч 0 мин? История запусков и итог прошлого периода сохранятся.</p><div class="generator-actions"><button type="button" id="genResetYes" class="generator-button generator-stop">Подтвердить сброс</button><button type="button" id="genResetNo" class="generator-button generator-reset">Отмена</button></div></div>'+
   '<div id="genCorrectionButtons" class="generator-actions generator-correction-actions"><button type="button" id="genAdjust" class="generator-button" disabled>Исправить моточасы</button><button type="button" id="genTransfer" class="generator-button" disabled>Перенести моточасы</button></div>'+
   '<p id="genCorrectionHint" class="field-hint"></p>'+
   '<section id="genAdjustForm" class="generator-editor" aria-label="Ручная корректировка моточасов" hidden><h3>Исправить моточасы</h3><p class="field-hint">'+name+' · изменение текущего периода и общего счётчика. Часы, добавленные вручную, не привязаны к датам запусков.</p>'+
   '<div class="generator-form-grid"><label class="generator-field" for="genAdjustDirection"><span>Действие</span><select id="genAdjustDirection" class="generator-input"><option value="plus">Добавить (+)</option><option value="minus">Вычесть (−)</option></select></label><label class="generator-field" for="genAdjustHours"><span>Количество моточасов</span><input id="genAdjustHours" class="generator-input" inputmode="decimal" autocomplete="off" placeholder="Например, 1,5"></label></div>'+
   '<label class="generator-field" for="genAdjustReason"><span>Причина исправления</span><textarea id="genAdjustReason" class="generator-input" rows="2" maxlength="500" placeholder="Например, забыл вовремя включить счётчик"></textarea></label>'+
   '<div class="generator-actions"><button type="button" id="genAdjustPreview" class="generator-button generator-start">Проверить изменение</button><button type="button" id="genAdjustCancel" class="generator-button">Отмена</button></div>'+
   '<div id="genAdjustConfirm" class="generator-confirm" hidden><p id="genAdjustSummary"></p><div class="generator-actions"><button type="button" id="genAdjustYes" class="generator-button generator-stop">Подтвердить исправление</button><button type="button" id="genAdjustBack" class="generator-button">Изменить</button></div></div></section>'+
   '<section id="genTransferForm" class="generator-editor" aria-label="Перенос моточасов" hidden><h3>Перенести моточасы</h3><p class="field-hint">Откуда: '+name+'. Переносятся записанные запуски или их части за выбранное время. Оба генератора должны быть остановлены.</p>'+
   '<label class="generator-field" for="genTransferTarget"><span>На какой генератор</span><select id="genTransferTarget" class="generator-input"><option value="">Выберите генератор</option>'+GENERATORS.filter(([id])=>id!=='warehouse'&&id!==generatorId).map(([id,name])=>'<option value="'+id+'">'+name+'</option>').join('')+'</select></label>'+
   '<div class="generator-form-grid"><label class="generator-field" for="genTransferFrom"><span>Начало периода · Киев</span><input type="datetime-local" step="0.001" id="genTransferFrom" class="generator-input"></label><label class="generator-field" for="genTransferTo"><span>Конец периода · Киев</span><input type="datetime-local" step="0.001" id="genTransferTo" class="generator-input"></label></div>'+
   '<label class="generator-field" for="genTransferReason"><span>Причина · необязательно</span><textarea id="genTransferReason" class="generator-input" rows="2" maxlength="500" placeholder="По ошибке был выбран другой генератор"></textarea></label>'+
   '<div class="generator-actions"><button type="button" id="genTransferPreview" class="generator-button generator-start">Рассчитать перенос</button><button type="button" id="genTransferCancel" class="generator-button">Отмена</button></div>'+
   '<div id="genTransferConfirm" class="generator-confirm" hidden><p id="genTransferSummary"></p><div class="generator-actions"><button type="button" id="genTransferYes" class="generator-button generator-stop">Подтвердить перенос</button><button type="button" id="genTransferBack" class="generator-button">Изменить</button></div></div></section>'+
   '<p id="genFeedback" role="status" aria-live="polite" class="generator-feedback"></p><p class="field-hint">1 мч = 1 час работы двигателя. Только учёт времени; без управления генератором.</p>'+
   '<h3 class="detail-section-title">Журнал запусков и исправлений</h3><div id="genHistory" class="timeline" aria-label="Журнал"></div>';
  const el=id=>root.querySelector('#'+id);
  el('genSelect').value=generatorId;el('genAdjustDirection').value='plus';el('genTransferTarget').value='';
  const selectGenerator=()=>{
   if(!alive)return;
   const next=el('genSelect').value;
   if(busy||!GENERATORS.some(([id])=>id===next)){el('genSelect').value=generatorId;return;}
   if(next!==generatorId)open(root,next);
  };
  el('genSelect').addEventListener('input',selectGenerator);el('genSelect').addEventListener('change',selectGenerator);
  let confirmationRevision=null;
  function hideConfirmation(){confirmationRevision=null;el('genConfirm').hidden=true;}
  function invalidateCorrections(){adjustmentPreview=null;transferPreview=null;pendingMutation=null;el('genAdjustConfirm').hidden=true;el('genTransferConfirm').hidden=true;}
  function closeEditor(){invalidateCorrections();el('genAdjustForm').hidden=true;el('genTransferForm').hidden=true;}
  const online=()=>navigator.onLine!==false;
  const usable=()=>alive&&!!state&&serverState&&online()&&canOperate()&&!busy;
  function render(){
   if(!alive)return;
   const running=state?.startedAtMs!=null,ready=usable(),correctable=ready&&!running;
   const elapsed=running?Math.max(0,Date.now()+clockOffset-state.startedAtMs):0;
   el('genStatus').textContent=!state?'Загрузка…':running?'Работает':'Остановлен';
   el('genStatus').className='status-pill '+(running?'status-assembled':'status-neutral');
   const metric=(id,ms)=>{el(id).textContent=state?generatorEngineHours(ms):'—';el(id+'Time').textContent=state?generatorClockHours(ms):'—';};
   metric('genCurrent',elapsed);metric('genPeriod',(state?.periodMs??0)+elapsed);metric('genTotal',(state?.totalMs??0)+elapsed);
   root.dataset.running=String(running);
   el('genStarted').textContent=running?'Старт: '+dateTime(state.startedAtMs):'';
   el('genPeriodLabel').textContent=state?'Период № '+state.period+(state.lastResetAtMs?' · с '+dateTime(state.lastResetAtMs):''):'';
   el('genSelect').disabled=busy;
   el('genStart').disabled=!ready||running||legacy;el('genStop').disabled=!ready||!running;el('genReset').disabled=!ready||running||legacy;
   el('genCorrectionButtons').hidden=!canOperate();el('genAdjust').disabled=!correctable;el('genTransfer').disabled=!correctable;
   el('genCorrectionHint').textContent=canOperate()&&running?'Для исправления или переноса сначала остановите счётчик выбранного генератора.':'';
   if(!canOperate()&&!busy)closeEditor();
   if(!busy&&!pendingMutation?.uncertain&&((adjustmentPreview&&adjustmentPreview.expectedRevision!==state?.revision)||(transferPreview&&transferPreview.sourceRevision!==state?.revision))){invalidateCorrections();message='Данные генератора изменились. Проверьте изменение заново.';}
   for(const id of ['genAdjustDirection','genAdjustHours','genAdjustReason','genTransferTarget','genTransferFrom','genTransferTo','genTransferReason','genAdjustCancel','genTransferCancel','genAdjustBack','genTransferBack'])el(id).disabled=busy;
   el('genAdjustPreview').disabled=!correctable;el('genTransferPreview').disabled=!correctable;
   el('genAdjustYes').disabled=!correctable||!adjustmentPreview;el('genTransferYes').disabled=!correctable||!transferPreview;
   el('genAdjustYes').textContent=pendingMutation?.uncertain&&pendingMutation.payload.action==='adjust'?'Проверить результат':'Подтвердить исправление';
   el('genTransferYes').textContent=pendingMutation?.uncertain&&pendingMutation.payload.action==='transfer'?'Проверить результат':'Подтвердить перенос';
   if(confirmationRevision!==null&&(!ready||running||state.revision!==confirmationRevision))hideConfirmation();
   el('genFeedback').textContent=busy?(busy==='preview'?'Рассчитываем перенос…':'Сохраняем на сервере…'):message||(!online()?'Нет связи. Изменения не отправляются; данные могут быть устаревшими.':!serverState?'Ожидаем подтверждение данных с сервера…':!canOperate()?'Доступен просмотр. Запись — кладовщику, директору и администратору.':!journalReady?'Загружаем журнал…':'');
  }
  function renderHistory(){
   if(!alive)return;
   const history=el('genHistory');history.replaceChildren();
   if(!events.length){const p=document.createElement('p');p.className='field-hint';p.textContent=journalReady?'Записей пока нет.':'Загрузка журнала…';history.append(p);return;}
   for(const entry of events){
    const item=document.createElement('article');item.className='timeline-item';
    const title=document.createElement('b'),body=document.createElement('div');body.className='timeline-text';
    if(entry.type==='reset'){
     title.textContent='Сброс · период № '+entry.period;
     body.textContent=dateTime(entry.atMs)+' · итог на момент сброса: '+generatorDuration(entry.durationMs)+' · всего: '+generatorDuration(entry.totalMs);
    }else if(entry.type==='adjustment'||entry.type==='transfer_out'||entry.type==='transfer_in'){
     const isAdjustment=entry.type==='adjustment',out=entry.type==='transfer_out';
     title.textContent=(isAdjustment?'Исправление':out?'Перенос → '+generatorName(entry.targetGeneratorId):'Перенос ← '+generatorName(entry.sourceGeneratorId))+' · '+signedDuration(isAdjustment?entry.deltaMs:out?-entry.durationMs:entry.durationMs);
     const lines=[dateTime(entry.atMs)+' · '+(entry.actorName||entry.actorId||'Сотрудник')];
     if(!isAdjustment){
      lines.push('Выбранный период: '+dateTime(entry.fromMs)+' — '+dateTime(entry.toMs)+' (Киев)');
      for(const segment of Array.isArray(entry.segments)?entry.segments:[])lines.push('Учтённый запуск: '+dateTime(segment.startedAtMs)+' — '+dateTime(segment.stoppedAtMs)+' · '+generatorDuration(segment.stoppedAtMs-segment.startedAtMs));
     }
     if(Number.isFinite(entry.periodMsBefore)&&Number.isFinite(entry.periodMsAfter))lines.push('За период: '+generatorDuration(entry.periodMsBefore)+' → '+generatorDuration(entry.periodMsAfter));
     if(Number.isFinite(entry.totalMsBefore)&&Number.isFinite(entry.totalMsAfter))lines.push('За всё время: '+generatorDuration(entry.totalMsBefore)+' → '+generatorDuration(entry.totalMsAfter));
     if(entry.reason)lines.push('Причина: '+entry.reason);body.textContent=lines.join('\n');
    }else if(entry.type==='run'){
     title.textContent='Запуск · период № '+entry.period+' · '+generatorDuration(entry.durationMs);
     body.textContent='Старт: '+dateTime(entry.startedAtMs)+'\nСтоп: '+dateTime(entry.stoppedAtMs);
    }else{title.textContent='Запись журнала';body.textContent=dateTime(entry.atMs);}
    item.append(title,body);history.append(item);
   }
  }
  function applyReply(data,begin,requireIdentity=false){
   if((requireIdentity&&data.generatorId!==generatorId)||(data.generatorId&&data.generatorId!==generatorId))throw new Error('Получен ответ для другого генератора. Обновите окно учёта.');
   if(data.state&&(!state||data.state.revision>=state.revision))state=data.state;
   if(Number.isFinite(data.serverNowMs))clockOffset=data.serverNowMs-(begin+Date.now())/2;
  }
  function errorMessage(error,correction=false){
   const code=String(error?.code||'');
   if(correction&&(code.endsWith('unimplemented')||code.endsWith('not-found')||(code.endsWith('invalid-argument')&&error.message==='Некорректное действие.')))return 'Серверная часть требует обновления для исправления моточасов. Изменение не сохранено.';
   if(['failed-precondition','permission-denied','invalid-argument','unauthenticated'].some(value=>code.endsWith(value)))return 'Действие не сохранено. '+(error.message||'Обновите состояние.');
   return correction?'Сохранение не подтверждено. Нажмите «Проверить результат»: повторная проверка не добавит часы второй раз.':'Сохранение не подтверждено. Проверьте связь и состояние перед повторным действием.';
  }
  async function syncClock(){
   if(!alive||!online()||clockPending)return;
   clockPending=true;const begin=Date.now();
   try{const result=await call({action:'clock'});if(alive&&Number.isFinite(result.data.serverNowMs))clockOffset=result.data.serverNowMs-(begin+Date.now())/2;}
   catch{}finally{clockPending=false;if(alive)render();}
  }
  async function act(action){
   if(!usable()){message='Действие не отправлено. Проверьте подключение и права доступа.';render();return;}
   const running=state.startedAtMs!==null;
   if(legacy&&action!=='stop')return;
   if((action==='start'&&running)||(action==='stop'&&!running)||(action==='reset'&&running))return;
   const expectedRevision=state.revision;if(action==='reset'&&confirmationRevision!==expectedRevision)return;
   hideConfirmation();closeEditor();busy=true;message='';render();const begin=Date.now();
   try{const {data}=await call({action,expectedRevision,generatorId});if(!alive)return;applyReply(data,begin);message='Сохранено на сервере.';}
   catch(error){if(alive)message=errorMessage(error);}finally{if(alive){busy=false;render();}}
  }
  function openEditor(mode){
   if(!usable()||state.startedAtMs!==null)return;
   hideConfirmation();closeEditor();message='';el('genAdjustForm').hidden=mode!=='adjust';el('genTransferForm').hidden=mode!=='transfer';
   if(mode==='transfer'&&!el('genTransferFrom').value){
    const lastRun=events.find(entry=>entry.type==='run'&&Number.isFinite(entry.startedAtMs)&&Number.isFinite(entry.stoppedAtMs));
    if(lastRun){el('genTransferFrom').value=generatorInputTime(lastRun.startedAtMs);el('genTransferTo').value=generatorInputTime(lastRun.stoppedAtMs);}
   }
   render();el(mode==='adjust'?'genAdjustHours':'genTransferTarget').focus?.();
  }
  function previewAdjustment(){
   if(!usable()||state.startedAtMs!==null)return;invalidateCorrections();
   try{
    const deltaMs=parseGeneratorHours(el('genAdjustHours').value)*(el('genAdjustDirection').value==='minus'?-1:1),reason=String(el('genAdjustReason').value||'').trim();
    if(!reason||reason.length>500)throw new Error('Укажите причину исправления — до 500 символов.');
    const periodAfter=state.periodMs+deltaMs,totalAfter=state.totalMs+deltaMs;
    if(!Number.isSafeInteger(periodAfter)||!Number.isSafeInteger(totalAfter)||periodAfter<0||totalAfter<0)throw new Error('Нельзя вычесть больше моточасов, чем есть в текущем периоде.');
    adjustmentPreview={deltaMs,reason,expectedRevision:state.revision};
    el('genAdjustSummary').textContent=name+'\nИзменение: '+signedDuration(deltaMs)+'\nЗа текущий период: '+generatorDuration(state.periodMs)+' → '+generatorDuration(periodAfter)+'\nЗа всё время: '+generatorDuration(state.totalMs)+' → '+generatorDuration(totalAfter)+'\nПричина: '+reason;
    el('genAdjustConfirm').hidden=false;message='Проверьте сумму и подтвердите исправление.';
   }catch(error){message=error.message;}render();
  }
  function transferInput(){
   const targetGeneratorId=el('genTransferTarget').value;
   if(!GENERATORS.some(([id])=>id===targetGeneratorId&&id!==generatorId&&id!=='warehouse'))throw new Error('Выберите другой генератор для переноса.');
   const fromMs=parseGeneratorInputTime(el('genTransferFrom').value),toMs=parseGeneratorInputTime(el('genTransferTo').value);
   if(fromMs>=toMs)throw new Error('Конец периода должен быть позже начала.');
   const reason=String(el('genTransferReason').value||'').trim();if(reason.length>500)throw new Error('Причина должна быть не длиннее 500 символов.');
   return {generatorId,targetGeneratorId,fromMs,toMs,reason};
  }
  async function previewTransfer(){
   if(!usable()||state.startedAtMs!==null)return;invalidateCorrections();let input;
   try{input=transferInput();}catch(error){message=error.message;render();return;}
   busy='preview';message='';render();
   try{
    const {reason,...range}=input,{data}=await call({action:'previewTransfer',...range});if(!alive)return;
    if(data.generatorId!==generatorId||data.targetGeneratorId!==input.targetGeneratorId||data.fromMs!==input.fromMs||data.toMs!==input.toMs||!Number.isSafeInteger(data.durationMs)||data.durationMs<=0)throw new Error('Сервер не подтвердил расчёт для выбранных генераторов. Повторите расчёт.');
    transferPreview={...data,reason};
    el('genTransferSummary').textContent=name+' → '+generatorName(data.targetGeneratorId)+'\nК переносу: '+generatorDuration(data.durationMs)+'\nВыбранный период: '+dateTime(data.fromMs)+' — '+dateTime(data.toMs)+' (Киев)\n'+name+': за период '+generatorDuration(data.sourcePeriodMsAfter)+', за всё время '+generatorDuration(data.sourceTotalMsAfter)+'\n'+generatorName(data.targetGeneratorId)+': за период '+generatorDuration(data.targetPeriodMsAfter)+', за всё время '+generatorDuration(data.targetTotalMsAfter)+'\nУчитывается только записанное время работы. Общая сумма моточасов двух генераторов сохранится.'+(reason?'\nПричина: '+reason:'');
    el('genTransferConfirm').hidden=false;message='Проверьте расчёт и подтвердите перенос.';
   }catch(error){
    if(alive){const code=String(error?.code||'');message=code?errorMessage(error,true):error.message;if(code&&!['failed-precondition','permission-denied','invalid-argument','unimplemented','not-found','unauthenticated'].some(value=>code.endsWith(value)))message='Не удалось рассчитать перенос. '+(error.message||'Проверьте подключение.');}
   }finally{if(alive){busy=false;render();}}
  }
  async function commitCorrection(action){
   if(!usable()||state.startedAtMs!==null)return;
   if(!pendingMutation){
    if(action==='adjust'){
     if(!adjustmentPreview||adjustmentPreview.expectedRevision!==state.revision)return;
     pendingMutation={payload:{action,generatorId,...adjustmentPreview,requestId:newRequestId()}};
    }else{
     if(!transferPreview||transferPreview.sourceRevision!==state.revision)return;
     const {targetGeneratorId,fromMs,toMs,sourceRevision,targetRevision,reason}=transferPreview;
     pendingMutation={payload:{action,generatorId,targetGeneratorId,fromMs,toMs,expectedRevision:sourceRevision,expectedTargetRevision:targetRevision,reason,requestId:newRequestId()}};
    }
   }
   if(pendingMutation.payload.action!==action)return;
   const mutation=pendingMutation;
   busy=true;message='';render();const begin=Date.now();
   try{
    const {data}=await call(mutation.payload);if(!alive)return;applyReply(data,begin,true);closeEditor();
    message=action==='transfer'?'Моточасы перенесены. Исправление сохранено в журнале обоих генераторов.':'Моточасы исправлены. Изменение и причина сохранены в журнале.';
   }catch(error){
    if(!alive)return;message=errorMessage(error,true);const code=String(error?.code||'');
    if(['failed-precondition','permission-denied','invalid-argument','unauthenticated','unimplemented','not-found'].some(value=>code.endsWith(value)))invalidateCorrections();else if(pendingMutation===mutation)mutation.uncertain=true;
   }finally{if(alive){busy=false;render();}}
  }
  el('genStart').addEventListener('click',()=>void act('start'));el('genStop').addEventListener('click',()=>void act('stop'));
  el('genReset').addEventListener('click',()=>{if(el('genReset').disabled)return;closeEditor();confirmationRevision=state.revision;el('genConfirm').hidden=false;});
  el('genResetYes').addEventListener('click',()=>void act('reset'));el('genResetNo').addEventListener('click',hideConfirmation);
  el('genAdjust').addEventListener('click',()=>openEditor('adjust'));el('genTransfer').addEventListener('click',()=>openEditor('transfer'));
  el('genAdjustPreview').addEventListener('click',previewAdjustment);el('genTransferPreview').addEventListener('click',()=>void previewTransfer());
  el('genAdjustYes').addEventListener('click',()=>void commitCorrection('adjust'));el('genTransferYes').addEventListener('click',()=>void commitCorrection('transfer'));
  for(const id of ['genAdjustCancel','genTransferCancel'])el(id).addEventListener('click',()=>{if(busy)return;closeEditor();message='';render();});
  for(const id of ['genAdjustBack','genTransferBack'])el(id).addEventListener('click',()=>{if(busy)return;invalidateCorrections();message='';render();});
  for(const id of ['genAdjustDirection','genAdjustHours','genAdjustReason','genTransferTarget','genTransferFrom','genTransferTo','genTransferReason'])for(const eventName of ['input','change'])el(id).addEventListener(eventName,()=>{if(busy)return;invalidateCorrections();message='';render();});
  const ref=doc(db,'generators',generatorId);
  const stateStop=onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
   if(!alive)return;
   if((snapshot.id&&snapshot.id!==generatorId)||(snapshot.ref?.id&&snapshot.ref.id!==generatorId)){serverState=false;message='Не удалось подтвердить данные выбранного генератора. Откройте окно заново.';render();return;}
   const incoming=snapshot.exists()?snapshot.data():{...INITIAL};if(!state||incoming.revision>=state.revision)state=incoming;
   serverState=!snapshot.metadata.fromCache;render();
  },()=>{if(!alive)return;serverState=false;message='Не удалось получить состояние генератора с сервера.';render();});
  const journalStop=onSnapshot(query(collection(ref,'journal'),orderBy('revision','desc')),{includeMetadataChanges:true},snapshot=>{
   if(!alive)return;events=snapshot.docs.map(d=>d.data());journalReady=!snapshot.metadata.fromCache;renderHistory();render();
  },()=>{if(!alive)return;journalReady=false;el('genHistory').textContent='Не удалось загрузить журнал.';render();});
  function onOffline(){serverState=false;message='Нет связи. Действия не отправляются.';render();}
  function onOnline(){message='';render();void syncClock();}
  function onVisible(){if(!document.hidden){render();void syncClock();}}
  window.addEventListener('offline',onOffline);window.addEventListener('online',onOnline);window.addEventListener('warehouse-app-resumed',onVisible);document.addEventListener('visibilitychange',onVisible);
  const timer=setInterval(render,1000);refresh=render;
  dispose=()=>{alive=false;clearInterval(timer);stateStop();journalStop();window.removeEventListener('offline',onOffline);window.removeEventListener('online',onOnline);window.removeEventListener('warehouse-app-resumed',onVisible);document.removeEventListener('visibilitychange',onVisible);};
  renderHistory();render();void syncClock();
 }
 return {open,close,isOpen:()=>dispose!==null,refreshPermissions:()=>refresh?.()};
}
