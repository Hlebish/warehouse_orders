import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, serverTimestamp, query, orderBy } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
let currentUser = null, unsubscribe = null, items = [], selectedStatus = 'active';

const style = document.createElement('style');
style.textContent = `
.buyback-nav-alert[hidden]{display:none}.buyback-nav-alert{margin-left:auto;display:inline-grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#c83e3e;color:white;font-weight:900;font-size:17px;box-shadow:0 0 0 4px #c83e3e18;animation:buybackPulse 1.5s infinite}
@keyframes buybackPulse{50%{box-shadow:0 0 0 7px #c83e3e08}}
.buyback-overlay{position:fixed;inset:0;background:#141c2a70;z-index:50;display:grid;place-items:center;padding:16px}
.buyback-overlay[hidden]{display:none}
.buyback-window{width:min(1000px,100%);max-height:92vh;overflow:auto;background:var(--surface,#fff);border-radius:14px;box-shadow:0 24px 80px #11182740;color:var(--text,#27313d)}
.buyback-head{display:flex;align-items:flex-start;justify-content:space-between;padding:22px 24px;border-bottom:1px solid var(--line,#e6e9ed);gap:14px}
.buyback-head h2{margin:4px 0;font-size:23px}.buyback-head p{margin:0;color:#8b95a2;font-size:12px}
.buyback-body{padding:20px 24px}.buyback-form{display:grid;grid-template-columns:2fr 1fr 1.2fr auto;gap:10px;align-items:end;padding:15px;background:#f7f9fb;border:1px solid #e8ebef;border-radius:10px;margin-bottom:18px}
.buyback-field{display:grid;gap:6px;font-size:11px;font-weight:700;color:#667180}.buyback-field input,.buyback-field select{width:100%;min-width:0;padding:10px;border:1px solid #dfe4ea;border-radius:7px;background:white;color:#27313d;font:inherit;font-weight:400}
.buyback-add{height:38px;border:0;border-radius:7px;background:#2867dc;color:white;padding:0 15px;font-weight:700}
.buyback-summary{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.buyback-chip{padding:7px 10px;border-radius:7px;background:#f0f3f7;font-size:11px;color:#596574}
.buyback-list{display:grid;gap:10px}.buyback-card{border:1px solid #e5e8ed;border-left:4px solid #72a88a;border-radius:10px;padding:14px 15px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}
.buyback-card.warn{border-left-color:#d6a03c;background:#fffdf8}.buyback-card.critical{border-left-color:#cf4141;background:#fff8f7}.buyback-card.expired{border-left-color:#8d2929;background:#fff0ef}
.buyback-article{font-size:15px;font-weight:800;color:#283341;overflow-wrap:anywhere}.buyback-meta{font-size:11px;color:#8993a0;margin-top:5px;line-height:1.6}
.buyback-progress{height:6px;background:#edf0f4;border-radius:99px;overflow:hidden;margin-top:10px;max-width:400px}.buyback-progress span{display:block;height:100%;background:#6da985;border-radius:99px}
.buyback-status{font-size:11px;font-weight:800;margin-top:8px}.buyback-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.buyback-actions button{border:1px solid #dfe4ea;background:#fff;color:#5e6876;border-radius:6px;padding:7px 9px;font-size:10px}.buyback-actions button.primary{background:#edf4ff;border-color:#dce8ff;color:#2867dc}.buyback-actions button.danger{background:#fff1f0;color:#b43c3c;border-color:#f2d4d2}
.buyback-empty{padding:30px;text-align:center;color:#929ba7;border:1px dashed #dfe4ea;border-radius:10px;font-size:12px}
@media(max-width:700px){.buyback-form{grid-template-columns:1fr 1fr}.buyback-add{width:100%}.buyback-card{grid-template-columns:1fr}.buyback-actions{justify-content:flex-start}.buyback-head,.buyback-body{padding:16px}}

/* Dark palette matching the warehouse site's charcoal and olive accents */
.buyback-overlay{background:rgba(0,0,0,.78)}
.buyback-window{background:#141414;color:#f0f0f0;border:1px solid #303030;box-shadow:0 24px 80px rgba(0,0,0,.7);color-scheme:dark}
.buyback-head{border-color:#303030}
.buyback-head h2{color:#f5f5f5}
.buyback-head p{color:#9b9b9b}
.buyback-head .eyebrow{color:#669900}
.buyback-form{background:#1b1b1b;border-color:#363636}
.buyback-field{color:#d0d0d0}
.buyback-field input,.buyback-field select{background:#202020;border-color:#3b3b3b;color:#f3f3f3;accent-color:#7ca900}
.buyback-field input::placeholder{color:#858585}
.buyback-field input:focus,.buyback-field select:focus{outline:2px solid rgba(102,153,0,.35);border-color:#669900}
.buyback-add{background:#669900;color:#fff}
.buyback-add:hover{background:#78a900}
.buyback-chip{background:#242424;color:#d3d3d3;border:1px solid #383838}
.buyback-chip[data-status].active{background:#293317;border-color:#587a13;color:#c5e58a}
.buyback-card{background:#1b1b1b;border-color:#363636;border-left-color:#6d9e7d}
.buyback-card.warn{background:#211f18;border-color:#49402a;border-left-color:#c39a3d}
.buyback-card.critical{background:#251b1b;border-color:#4a3030;border-left-color:#d05a5a}
.buyback-card.expired{background:#291919;border-color:#573030;border-left-color:#b94343}
.buyback-article{color:#f1f1f1}
.buyback-article span{color:#a1a1a1!important}
.buyback-meta{color:#a0a0a0}
.buyback-progress{background:#333}
.buyback-progress span{background:#7cae28}
.buyback-status{color:#b7b7b7}
.buyback-actions button{background:#242424;border-color:#414141;color:#ddd}
.buyback-actions button.primary{background:#293317;border-color:#4e6e17;color:#c5e58a}
.buyback-actions button.danger{background:#301d1d;color:#ffaaaa;border-color:#653333}
.buyback-empty{color:#a0a0a0;border-color:#414141;background:#191919}
.buyback-nav-alert{background:#c83e3e;color:#fff}
@media(max-width:700px){.buyback-window{max-height:calc(100dvh - 20px);border-radius:14px}.buyback-form{grid-template-columns:1fr 1fr}.buyback-field input,.buyback-field select{font-size:16px}.buyback-add{min-height:42px}}
`;
document.head.append(style);
const overlay=document.createElement('div');
overlay.className='buyback-overlay';overlay.hidden=true;overlay.innerHTML=`
<section class="buyback-window" role="dialog" aria-modal="true" aria-labelledby="buybackTitle">
<header class="buyback-head"><div><span class="eyebrow">КОНТРОЛЬ СРОКОВ · 14 ДНЕЙ</span><h2 id="buybackTitle">Перекупной товар</h2><p>Срок считается от даты приёма на склад. Напоминания на 3-й, 6-й и 10-й день.</p></div><button id="buybackClose" class="close-button" aria-label="Закрыть">×</button></header>
<div class="buyback-body">
<form id="buybackForm" class="buyback-form">
<label class="buyback-field">Артикул<input id="buybackArticle" required maxlength="100" placeholder="Например, APAU1603"></label>
<label class="buyback-field">Количество<input id="buybackQuantity" required type="number" min="1" step="1" value="1"></label>
<label class="buyback-field">Дата приёма<input id="buybackDate" required type="date"></label>
<button class="buyback-add" type="submit">＋ Добавить</button>
</form>
<div class="buyback-summary" id="buybackSummary"></div>
<div class="buyback-summary"><button class="buyback-chip" data-status="active" type="button">В работе</button><button class="buyback-chip" data-status="returned" type="button">Возвращён</button><button class="buyback-chip" data-status="sold" type="button">Продан</button><button class="buyback-chip" data-status="cancelled" type="button">Отменён</button><button class="buyback-chip" data-status="expired" type="button">Просрочен</button></div>
<div class="buyback-list" id="buybackList"><div class="buyback-empty">Загружаю перекупной товар…</div></div>
</div></section>`;
document.body.append(overlay);
const nav=$('buybackNavButton');
const dateInput=$('buybackDate');
dateInput.value=(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})();
function showToast(message){const stack=$('toastStack');if(stack){const el=document.createElement('div');el.className='toast';el.textContent=message;stack.append(el);setTimeout(()=>el.remove(),3500)}}
function elapsedDays(date){const d=new Date(date+'T00:00:00');const n=new Date();return Math.floor((Date.UTC(n.getFullYear(),n.getMonth(),n.getDate())-Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()))/86400000)}
function deadline(item){return new Date(new Date(item.receivedAt+'T00:00:00').getTime()+14*86400000)}
function render(){
 const active=items.filter(x=>x.status==='active'&&elapsedDays(x.receivedAt)<14);
 const expiredItems=items.filter(x=>x.status==='expired'||(x.status==='active'&&elapsedDays(x.receivedAt)>=14));
 const critical=active.filter(x=>elapsedDays(x.receivedAt)>=10&&elapsedDays(x.receivedAt)<14).length;
 const warn=active.filter(x=>elapsedDays(x.receivedAt)>=6&&elapsedDays(x.receivedAt)<10).length;
 $('buybackNavAlert').hidden=!active.some(x=>elapsedDays(x.receivedAt)>=10);
 $('buybackSummary').innerHTML=`<span class="buyback-chip" data-summary-status="active">В работе: <b>${active.length}</b></span><span class="buyback-chip">Срок подходит: <b>${warn}</b></span><span class="buyback-chip">Критично: <b>${critical}</b></span><span class="buyback-chip" data-summary-status="expired">Просрочено: <b>${expiredItems.length}</b></span>`;
 const visible=items.filter(x=>{
   const isExpired=x.status==='expired'||(x.status==='active'&&elapsedDays(x.receivedAt)>=14);
   return selectedStatus==='expired'?isExpired:(selectedStatus==='active'?!isExpired&&x.status==='active':x.status===selectedStatus);
 }).sort((a,b)=>String(a.receivedAt).localeCompare(String(b.receivedAt)));
 if(!visible.length){$('buybackList').innerHTML='<div class="buyback-empty">Здесь пока нет записей.</div>';return}
 $('buybackList').innerHTML=visible.map(item=>{
  const days=elapsedDays(item.receivedAt),left=14-days;
  const isExpired=item.status==='expired'||(item.status==='active'&&days>=14);
  const cls=isExpired?'expired':days>=10?'critical':days>=6?'warn':'';
  const status=isExpired?'ПРОСРОЧЕН':item.status==='active'?(days>=10?'КРИТИЧЕСКИ МАЛО ВРЕМЕНИ':days>=6?'Срок возврата приближается':days>=3?'Товар залежался на складе':'Срок идёт'):(item.status==='returned'?'Возвращён':item.status==='sold'?'Продан':item.status==='cancelled'?'Отменён':'');
  const bar=Math.max(0,Math.min(100,days/14*100));
  const actions=(item.status==='active'||isExpired)?'<button class="primary" data-set-status="returned" data-id="'+item.id+'">Возвращён</button><button class="primary" data-set-status="sold" data-id="'+item.id+'">Продан</button><button data-set-status="cancelled" data-id="'+item.id+'">Отменить</button>':'<button data-set-status="active" data-id="'+item.id+'">Вернуть в работу</button>';
  return `<article class="buyback-card ${cls}"><div><div class="buyback-article">${escapeHtml(item.article)} <span style="font-weight:500;color:#8a94a1">× ${item.quantity}</span></div><div class="buyback-meta">Принят: ${escapeHtml(item.receivedAt)} · Прошло дней: <b>${Math.max(0,days)}</b> · ${isExpired?'Просрочено на '+Math.max(0,days-14)+' дн.':item.status==='active'?'Осталось дней: '+Math.max(0,left):'14-дневный срок остановлен'}</div><div class="buyback-progress"><span style="width:${bar}%"></span></div><div class="buyback-status">${status}</div></div><div class="buyback-actions">${actions}${(item.status==='active'||isExpired)?'<button data-set-status="returned" data-id="'+item.id+'" data-partial="true">По количеству…</button>':''}</div></article>`;
 }).join('');
 $('buybackSummary').querySelectorAll('[data-summary-status]').forEach(btn=>btn.addEventListener('click',()=>{selectedStatus=btn.dataset.summaryStatus;render()}));
}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function open(){overlay.hidden=false;nav?.classList.add('active');}
function close(){overlay.hidden=true;nav?.classList.remove('active')}
nav?.addEventListener('click',open);
$('buybackClose').addEventListener('click',close);
overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)close()});
overlay.querySelectorAll('[data-status]').forEach(btn=>btn.addEventListener('click',()=>{selectedStatus=btn.dataset.status;render()}));
$('buybackForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!currentUser){showToast('Сначала войдите в систему.');return}
 const article=$('buybackArticle').value.trim(),quantity=Number($('buybackQuantity').value),receivedAt=$('buybackDate').value;
 if(!article||!Number.isInteger(quantity)||quantity<1||!receivedAt){showToast('Проверьте артикул, количество и дату.');return}
 const submit=$('buybackForm').querySelector('button[type="submit"]');submit.disabled=true;
 try{await addDoc(collection(db,'buybackItems'),{article,quantity,receivedAt,createdAt:serverTimestamp(),createdBy:currentUser.uid,createdByName:currentUser.displayName||currentUser.email||'Сотрудник',status:'active',soldAt:null,cancelledAt:null,returnedAt:null,createdOn: new Date().toISOString().slice(0,10),sentMilestones:[],updatedAt:serverTimestamp()});$('buybackArticle').value='';$('buybackQuantity').value='1';showToast('Перекупной товар добавлен. Отсчёт 14 дней начат.');selectedStatus='active'}
 catch(err){console.error(err);showToast('Не удалось добавить товар: '+(err.code||'проверьте доступ'))}
 finally{submit.disabled=false}
});
overlay.addEventListener('click',async e=>{
 const btn=e.target.closest('[data-set-status]');if(!btn)return;
 try{
  const nextStatus=btn.dataset.setStatus,item=items.find(x=>x.id===btn.dataset.id);
  if(!item)throw new Error('Запись не найдена');
  const eventDate=new Date().toISOString().slice(0,10),isExpired=item.status==='expired'||(item.status==='active'&&elapsedDays(item.receivedAt)>=14);
  if((item.status==='active'||isExpired)&&['returned','sold','cancelled'].includes(nextStatus)){
    let qty=Number(item.quantity)||1;
    if(btn.dataset.partial==='true'||qty>1){
      const entered=window.prompt('Сколько единиц из '+qty+' отметить как «'+(nextStatus==='returned'?'возвращённые':nextStatus==='sold'?'проданные':'отменённые')+'»? Введите количество от 1 до '+qty+'.',String(qty));
      if(entered===null)return;qty=Number(entered);
      if(!Number.isInteger(qty)||qty<1||qty>Number(item.quantity)){showToast('Укажите целое количество от 1 до '+item.quantity+'.');return}
    }
    const patch={status:nextStatus,updatedAt:serverTimestamp()};
    if(nextStatus==='sold')patch.soldAt=eventDate;else if(nextStatus==='cancelled')patch.cancelledAt=eventDate;else patch.returnedAt=eventDate;
    if(qty===Number(item.quantity))await updateDoc(doc(db,'buybackItems',item.id),patch);
    else{
      await addDoc(collection(db,'buybackItems'),{article:item.article,quantity:qty,receivedAt:item.receivedAt,createdAt:serverTimestamp(),createdOn:item.createdOn||eventDate,createdBy:item.createdBy||currentUser.uid,createdByName:item.createdByName||currentUser.displayName||currentUser.email||'Сотрудник',status:nextStatus,soldAt:nextStatus==='sold'?eventDate:null,cancelledAt:nextStatus==='cancelled'?eventDate:null,returnedAt:nextStatus==='returned'?eventDate:null,sentMilestones:Array.isArray(item.sentMilestones)?item.sentMilestones:[],updatedAt:serverTimestamp()});
      await updateDoc(doc(db,'buybackItems',item.id),{quantity:Number(item.quantity)-qty,updatedAt:serverTimestamp()});
    }
    showToast(qty===Number(item.quantity)?'Статус перекупного товара обновлён.':'Часть товара перенесена в категорию «'+(nextStatus==='returned'?'Возвращён':nextStatus==='sold'?'Продан':'Отменён')+'».');
  }else{
    const patch={status:nextStatus,updatedAt:serverTimestamp()};
    if(nextStatus==='active'){patch.soldAt=null;patch.cancelledAt=null;patch.returnedAt=null}
    await updateDoc(doc(db,'buybackItems',item.id),patch);showToast('Статус перекупного товара обновлён.');
  }
 catch(err){console.error(err);showToast('Не удалось изменить статус.')}
});
onAuthStateChanged(auth,user=>{
 currentUser=user;
 unsubscribe?.();unsubscribe=null;items=[];
 if(!user){nav.hidden=true;overlay.hidden=true;return}
 nav.hidden=false;
 unsubscribe=onSnapshot(query(collection(db,'buybackItems'),orderBy('receivedAt','desc')),snap=>{
  items=snap.docs.map(d=>({id:d.id,...d.data()}));render();items.filter(x=>x.status==='active'&&elapsedDays(x.receivedAt)>=14).forEach(x=>updateDoc(doc(db,'buybackItems',x.id),{status:'expired',updatedAt:serverTimestamp()}).catch(err=>console.error('Не удалось отметить товар просроченным',x.id,err)));
 },err=>{console.error('buybackItems snapshot failed',err);$('buybackList').innerHTML='<div class="buyback-empty">Нет доступа к перекупному товару. Проверьте правила Firestore.</div>';});
});
