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

/* Buyback workspace refresh */
.buyback-window{width:min(1080px,100%);border-radius:20px;overflow:auto}
.buyback-head{padding:24px 28px;background:linear-gradient(120deg,#1a2817,#202820);align-items:center}
.buyback-head .eyebrow{display:inline-block;font-size:10px;letter-spacing:1.6px;font-weight:900;color:#a8d66a}
.buyback-head h2{font-size:26px;letter-spacing:-.6px;margin:8px 0 6px}
.buyback-head p{font-size:12px;line-height:1.5;max-width:620px}
.buyback-body{padding:22px 28px 28px}
.buyback-form{grid-template-columns:minmax(180px,2fr) minmax(90px,.7fr) minmax(145px,1fr) minmax(150px,1.2fr) auto;gap:12px;padding:18px;background:linear-gradient(135deg,#1c211b,#1a1c19);border-color:#343b30;border-radius:14px}
.buyback-field{gap:8px;font-size:11px;letter-spacing:.2px}
.buyback-field input,.buyback-field select{min-height:42px;padding:10px 12px;border-radius:9px;font-size:13px;transition:border-color .15s,box-shadow .15s}
.buyback-add{min-height:42px;border-radius:9px;padding:0 17px;font-size:12px;box-shadow:0 5px 14px #66990026;transition:transform .15s,filter .15s}
.buyback-add:hover{filter:brightness(1.1);transform:translateY(-1px)}
.buyback-summary{gap:9px;margin:0 0 16px}
.buyback-chip{padding:9px 12px;border-radius:9px;font-size:11px}
#buybackSummary .buyback-chip{background:#20261d;border-color:#343d2d;color:#c4cbbd}
#buybackSummary .buyback-chip b{color:#f1f5eb;font-size:13px;margin-left:4px}
.buyback-summary:has(button[data-status]){padding:5px;background:#171a16;border:1px solid #30362d;border-radius:12px;width:max-content;max-width:100%}
.buyback-chip[data-status]{padding:9px 13px;border:1px solid transparent;background:transparent;color:#aeb5a8;font-size:11px;font-weight:800;transition:background .15s,color .15s,border-color .15s}
.buyback-chip[data-status].active,.buyback-chip[data-status][aria-pressed="true"]{background:#2a381b;border-color:#526d2e;color:#d7f3a5}
.buyback-list{gap:12px}
.buyback-card{position:relative;padding:18px 20px;border-radius:14px;grid-template-columns:minmax(0,1fr) auto;gap:20px;background:linear-gradient(110deg,#1b1e1a,#191b19);border-color:#30372f;box-shadow:0 4px 16px #00000012;transition:border-color .16s,transform .16s,box-shadow .16s}
.buyback-card:hover{border-color:#526347;box-shadow:0 8px 22px #00000020;transform:translateY(-1px)}
.buyback-card.warn{background:linear-gradient(110deg,#272318,#1c1b17);border-color:#5a4928}
.buyback-card.critical{background:linear-gradient(110deg,#2b1d1d,#1e1919);border-color:#633535}
.buyback-card.expired{background:linear-gradient(110deg,#301b1b,#211717);border-color:#713737}
.buyback-article{font-size:18px;letter-spacing:.1px;line-height:1.4}
.buyback-meta{font-size:12px;line-height:1.85;margin-top:8px;color:#a9b0a4;overflow-wrap:anywhere}
.buyback-meta b{color:#e4eadc}
.buyback-progress{max-width:none;height:5px;margin-top:13px;background:#30352e}
.buyback-status{display:inline-flex;align-items:center;margin-top:11px;padding:5px 9px;border-radius:7px;background:#252b22;color:#c6d7b5;font-size:10px;letter-spacing:.3px;font-weight:900}
.buyback-card.warn .buyback-status{background:#3b301c;color:#f0ce7d}
.buyback-card.critical .buyback-status,.buyback-card.expired .buyback-status{background:#452323;color:#ffb1ab}
.buyback-actions{max-width:250px;align-content:center;gap:7px}
.buyback-actions button{min-height:34px;padding:8px 11px;border-radius:8px;font-size:11px;font-weight:800;white-space:nowrap;transition:filter .15s,transform .15s}
.buyback-actions button:hover{filter:brightness(1.13);transform:translateY(-1px)}
.buyback-actions button.primary{background:#29351d;border-color:#465c2b;color:#d5edae}
.buyback-actions button.danger{background:#351e1e;color:#ffb8b3;border-color:#633737}
.buyback-empty{padding:42px 20px;background:#191c18;border-color:#394035;border-radius:14px;font-size:13px}
.buyback-edit-window{width:min(620px,100%);overflow:hidden}
.buyback-edit-window .buyback-head{background:linear-gradient(120deg,#24351b,#1b2419)}
#buybackEditForm{display:flex;flex-direction:column}
.buyback-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:17px}
.buyback-edit-grid .buyback-field:first-child,.buyback-edit-grid .buyback-field:last-child{grid-column:1/-1}
.buyback-edit-note{margin:18px 0 0;padding:12px 14px;border:1px solid #3b4730;border-radius:10px;background:#20271b;color:#b8c5a9;font-size:12px;line-height:1.55}
.buyback-edit-footer{display:flex;justify-content:flex-end;gap:9px;padding:16px 24px 22px;border-top:1px solid #30352e;background:#171a16}
.buyback-edit-footer button{min-height:42px;padding:0 17px;border-radius:9px;font-size:12px;font-weight:800}
.buyback-cancel-edit{background:#252825;border:1px solid #414640;color:#d6dbd2}
.buyback-edit-overlay{z-index:60;backdrop-filter:blur(7px)}
.buyback-edit-overlay[hidden]{display:none}
@media(max-width:900px){.buyback-form{grid-template-columns:repeat(2,minmax(0,1fr))}.buyback-add{width:100%}.buyback-card{grid-template-columns:minmax(0,1fr)}.buyback-actions{max-width:none;justify-content:flex-start;padding-top:4px}}
@media(max-width:700px){.buyback-window{border-radius:16px}.buyback-head{padding:18px 18px 16px}.buyback-head h2{font-size:22px}.buyback-body{padding:16px 14px 20px}.buyback-form{grid-template-columns:1fr 1fr;gap:11px;padding:13px}.buyback-form .buyback-field:first-child,.buyback-form .buyback-field:last-of-type{grid-column:1/-1}.buyback-summary:has(button[data-status]){width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.buyback-chip[data-status]{width:100%}.buyback-card{padding:15px 14px;gap:10px}.buyback-article{font-size:16px}.buyback-meta{font-size:11px}.buyback-actions button{flex:1 1 auto}.buyback-edit-grid{grid-template-columns:1fr;gap:13px}.buyback-edit-grid .buyback-field:first-child,.buyback-edit-grid .buyback-field:last-child{grid-column:auto}.buyback-edit-footer{padding:13px 14px calc(14px + env(safe-area-inset-bottom))}.buyback-edit-footer button{flex:1}.buyback-edit-window{max-height:calc(100dvh - 20px)}}

/* Compact single-row buyback actions with clear semantic colors */
.buyback-actions{display:flex;flex-wrap:nowrap;align-items:center;justify-content:flex-end;gap:5px;max-width:none;min-width:0}
.buyback-actions button{min-height:30px;padding:6px 9px;border-radius:7px;font-size:10px;line-height:1.1;font-weight:800;white-space:nowrap;flex:0 0 auto}
.buyback-actions button.buyback-action-edit{background:#292b2d!important;border:1px solid #45484a!important;color:#e0e2e3!important}
.buyback-actions button.buyback-action-green{background:#293b1b!important;border:1px solid #49682c!important;color:#d5efad!important}
.buyback-actions button.buyback-action-red{background:#411f20!important;border:1px solid #743537!important;color:#ffb8b8!important}
.buyback-actions button:hover{filter:brightness(1.12);transform:translateY(-1px)}
@media(max-width:900px){.buyback-actions{flex-wrap:wrap;justify-content:flex-start}}
@media(max-width:700px){.buyback-actions{display:flex;flex-wrap:wrap;gap:5px}.buyback-actions button{min-height:29px;padding:6px 8px;font-size:10px;flex:0 0 auto}}
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
<label class="buyback-field">Поставщик<input id="buybackSupplier" maxlength="160" placeholder="Название поставщика"></label>
<button class="buyback-add" type="submit">＋ Добавить</button>
</form>
<div class="buyback-summary" id="buybackSummary"></div>
<div class="buyback-summary"><button class="buyback-chip" data-status="active" type="button">В работе</button><button class="buyback-chip" data-status="returned" type="button">Возвращён</button><button class="buyback-chip" data-status="sold" type="button">Продан</button><button class="buyback-chip" data-status="cancelled" type="button">Отменён</button><button class="buyback-chip" data-status="expired" type="button">Просрочен</button></div>
<div class="buyback-list" id="buybackList"><div class="buyback-empty">Загружаю перекупной товар…</div></div>
</div></section>`;
document.body.append(overlay);
const editOverlay=document.createElement('div');
editOverlay.className='buyback-overlay buyback-edit-overlay';
editOverlay.hidden=true;
editOverlay.innerHTML=`
<section class="buyback-window buyback-edit-window" role="dialog" aria-modal="true" aria-labelledby="buybackEditTitle">
<header class="buyback-head"><div><span class="eyebrow">ИЗМЕНЕНИЕ ЗАПИСИ</span><h2 id="buybackEditTitle">Редактирование товара</h2><p>Изменения сохранятся в существующей записи.</p></div><button type="button" class="close-button" data-close-buyback-edit aria-label="Закрыть">×</button></header>
<form id="buybackEditForm">
<div class="buyback-body">
<div class="buyback-edit-grid">
<label class="buyback-field">Артикул<input id="buybackEditArticle" required maxlength="100" autocomplete="off" placeholder="Например, APAU1603"></label>
<label class="buyback-field">Количество<input id="buybackEditQuantity" required type="number" min="1" max="100000" step="1"></label>
<label class="buyback-field">Дата приёмки<input id="buybackEditDate" required type="date"></label>
<label class="buyback-field">Поставщик<input id="buybackEditSupplier" maxlength="160" autocomplete="off" placeholder="Название поставщика"></label>
</div>
<p class="buyback-edit-note">Последний день срока и оставшиеся дни пересчитаются автоматически по дате приёмки.</p>
</div>
<footer class="buyback-edit-footer"><button type="button" class="buyback-cancel-edit" data-close-buyback-edit>Отмена</button><button type="submit" class="buyback-add" id="buybackEditSave">Сохранить изменения</button></footer>
</form></section>`;
document.body.append(editOverlay);
let editingBuybackId=null;
const nav=$('buybackNavButton');
const dateInput=$('buybackDate');
dateInput.value=(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})();
function showToast(message){const stack=$('toastStack');if(stack){const el=document.createElement('div');el.className='toast';el.textContent=message;stack.append(el);setTimeout(()=>el.remove(),3500)}}
function elapsedDays(date){const d=new Date(date+'T00:00:00');const n=new Date();return Math.floor((Date.UTC(n.getFullYear(),n.getMonth(),n.getDate())-Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()))/86400000)}
function deadline(item){const [year,month,day]=item.receivedAt.split('-').map(Number);return new Date(Date.UTC(year,month-1,day+13))}
function render(){
 const active=items.filter(x=>x.status==='active'&&elapsedDays(x.receivedAt)<14);
 const expiredItems=items.filter(x=>x.status==='expired'||(x.status==='active'&&elapsedDays(x.receivedAt)>=14));
 const critical=active.filter(x=>elapsedDays(x.receivedAt)>=10&&elapsedDays(x.receivedAt)<14).length;
 const warn=active.filter(x=>elapsedDays(x.receivedAt)>=6&&elapsedDays(x.receivedAt)<10).length;
 $('buybackNavAlert').hidden=!active.some(x=>elapsedDays(x.receivedAt)>=10);
 $('buybackSummary').innerHTML=`<span class="buyback-chip">В работе: <b>${active.length}</b></span><span class="buyback-chip">Срок подходит: <b>${warn}</b></span><span class="buyback-chip">Критично: <b>${critical}</b></span><span class="buyback-chip">Просрочено: <b>${expiredItems.length}</b></span>`;
 const visible=items.filter(x=>{
   const isExpired=x.status==='expired'||(x.status==='active'&&elapsedDays(x.receivedAt)>=14);
   return selectedStatus==='expired'?isExpired:selectedStatus==='approaching'?!isExpired&&x.status==='active'&&elapsedDays(x.receivedAt)>=6&&elapsedDays(x.receivedAt)<10:selectedStatus==='critical'?!isExpired&&x.status==='active'&&elapsedDays(x.receivedAt)>=10&&elapsedDays(x.receivedAt)<14:(selectedStatus==='active'?!isExpired&&x.status==='active':x.status===selectedStatus);
 }).sort((a,b)=>String(a.receivedAt).localeCompare(String(b.receivedAt)));
 if(!visible.length){$('buybackList').innerHTML='<div class="buyback-empty">Здесь пока нет записей.</div>';return}
 $('buybackList').innerHTML=visible.map(item=>{
  const days=elapsedDays(item.receivedAt),left=14-days;
  const isExpired=item.status==='expired'||(item.status==='active'&&days>=14);
  const cls=isExpired?'expired':days>=10?'critical':days>=6?'warn':'';
  const status=isExpired?'ПРОСРОЧЕН':item.status==='active'?(days>=10?'Срок подходит к концу':days>=6?'Срок возврата приближается':days>=3?'Товар залежался на складе':'Срок идёт'):(item.status==='returned'?'Возвращён':item.status==='sold'?'Продан':item.status==='cancelled'?'Отменён':'');
  const bar=Math.max(0,Math.min(100,days/14*100));
  const actions='<button class="buyback-action-edit" data-edit-buyback="'+item.id+'">Редактировать</button>'+((item.status==='active'||isExpired)?'<button class="buyback-action-green" data-set-status="returned" data-id="'+item.id+'">Возвращён</button><button class="buyback-action-green" data-set-status="sold" data-id="'+item.id+'">Продан</button><button class="buyback-action-red" data-set-status="cancelled" data-id="'+item.id+'">Отменить</button>':'<button class="buyback-action-edit" data-set-status="active" data-id="'+item.id+'">Вернуть в работу</button>');
  return `<article class="buyback-card ${cls}"><div><div class="buyback-article">${escapeHtml(item.article)} <span style="font-weight:500;color:#8a94a1">× ${item.quantity}</span></div><div class="buyback-meta">${item.supplier?'<b>Поставщик:</b> '+escapeHtml(item.supplier)+' · ':''}Принят: ${escapeHtml(item.receivedAt)} · Последний день срока: <b>${escapeHtml(deadline(item).toLocaleDateString('ru-RU',{timeZone:'UTC'}))}</b> · Прошло дней: <b>${Math.max(0,days)}</b> · ${isExpired?'Просрочено на '+Math.max(0,days-14)+' дн.':item.status==='active'?'Осталось дней: '+Math.max(0,left):'14-дневный срок остановлен'}</div><div class="buyback-progress"><span style="width:${bar}%"></span></div><div class="buyback-status">${status}</div></div><div class="buyback-actions">${'<button class="buyback-action-edit" data-edit-buyback="'+item.id+'">Редактировать</button>' + ((item.status==='active'||isExpired) ? '<button class="buyback-action-green" data-set-status="returned" data-id="'+item.id+'">Возвращён</button><button class="buyback-action-green" data-set-status="sold" data-id="'+item.id+'">Продан</button><button class="buyback-action-red" data-set-status="cancelled" data-id="'+item.id+'">Отменить</button>' : '<button class="buyback-action-edit" data-set-status="active" data-id="'+item.id+'">Вернуть в работу</button>')}</div></article>`;
 }).join('');

}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function open(){overlay.hidden=false;nav?.classList.add('active');}
function close(){overlay.hidden=true;nav?.classList.remove('active')}
nav?.addEventListener('click',open);
$('buybackClose').addEventListener('click',close);
overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)close()});
overlay.querySelectorAll('[data-status]').forEach(btn=>btn.addEventListener('click',()=>{selectedStatus=btn.dataset.status;render()}));
function closeBuybackEditor(){editOverlay.hidden=true;editingBuybackId=null}
editOverlay.addEventListener('click',e=>{if(e.target===editOverlay||e.target.closest('[data-close-buyback-edit]'))closeBuybackEditor()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!editOverlay.hidden)closeBuybackEditor()});
$('buybackEditForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!editingBuybackId)return;
 const article=$('buybackEditArticle').value.trim(),quantity=Number($('buybackEditQuantity').value),receivedAt=$('buybackEditDate').value,supplier=$('buybackEditSupplier').value.trim();
 if(!article||article.length>100||!Number.isInteger(quantity)||quantity<1||quantity>100000||!receivedAt||!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)||Number.isNaN(Date.parse(receivedAt+'T00:00:00'))){showToast('Проверьте артикул, количество и дату.');return}
 const save=$('buybackEditSave');save.disabled=true;save.textContent='Сохраняю…';
 try{await updateDoc(doc(db,'buybackItems',editingBuybackId),{article,quantity,receivedAt,supplier,updatedAt:serverTimestamp()});closeBuybackEditor();showToast('Изменения сохранены.');}
 catch(err){console.error(err);showToast('Не удалось сохранить изменения: '+(err.code||'проверьте доступ'));}
 finally{if(!editOverlay.hidden){save.disabled=false;save.textContent='Сохранить изменения'}}
});
$('buybackForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!currentUser){showToast('Сначала войдите в систему.');return}
 const article=$('buybackArticle').value.trim(),quantity=Number($('buybackQuantity').value),receivedAt=$('buybackDate').value,supplier=$('buybackSupplier').value.trim();
 if(!article||!Number.isInteger(quantity)||quantity<1||!receivedAt){showToast('Проверьте артикул, количество и дату.');return}
 const submit=$('buybackForm').querySelector('button[type="submit"]');submit.disabled=true;
 try{await addDoc(collection(db,'buybackItems'),{article,quantity,receivedAt,supplier,createdAt:serverTimestamp(),createdBy:currentUser.uid,createdByName:currentUser.displayName||currentUser.email||'Сотрудник',status:'active',soldAt:null,cancelledAt:null,returnedAt:null,createdOn: new Date().toISOString().slice(0,10),sentMilestones:[],updatedAt:serverTimestamp()});$('buybackArticle').value='';$('buybackQuantity').value='1';$('buybackSupplier').value='';showToast('Перекупной товар добавлен. Отсчёт 14 дней начат.');selectedStatus='active'}
 catch(err){console.error(err);showToast('Не удалось добавить товар: '+(err.code||'проверьте доступ'))}
 finally{submit.disabled=false}
});
overlay.addEventListener('click',async e=>{
 const editBtn=e.target.closest('[data-edit-buyback]');
 if(editBtn){
  const item=items.find(x=>x.id===editBtn.dataset.editBuyback);if(!item)return;
  editingBuybackId=item.id;
  $('buybackEditArticle').value=item.article||'';
  $('buybackEditQuantity').value=String(item.quantity??1);
  $('buybackEditDate').value=item.receivedAt||'';
  $('buybackEditSupplier').value=item.supplier||'';
  $('buybackEditSave').disabled=false;
  $('buybackEditSave').textContent='Сохранить изменения';
  editOverlay.hidden=false;
  $('buybackEditArticle').focus();
  return;
 }
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
      await addDoc(collection(db,'buybackItems'),{article:item.article,quantity:qty,receivedAt:item.receivedAt,supplier:item.supplier||'',createdAt:serverTimestamp(),createdOn:item.createdOn||eventDate,createdBy:item.createdBy||currentUser.uid,createdByName:item.createdByName||currentUser.displayName||currentUser.email||'Сотрудник',status:nextStatus,soldAt:nextStatus==='sold'?eventDate:null,cancelledAt:nextStatus==='cancelled'?eventDate:null,returnedAt:nextStatus==='returned'?eventDate:null,sentMilestones:Array.isArray(item.sentMilestones)?item.sentMilestones:[],updatedAt:serverTimestamp()});
      await updateDoc(doc(db,'buybackItems',item.id),{quantity:Number(item.quantity)-qty,updatedAt:serverTimestamp()});
    }
    showToast(qty===Number(item.quantity)?'Статус перекупного товара обновлён.':'Часть товара перенесена в категорию «'+(nextStatus==='returned'?'Возвращён':nextStatus==='sold'?'Продан':'Отменён')+'».');
  }else{
    const patch={status:nextStatus,updatedAt:serverTimestamp()};
    if(nextStatus==='active'){patch.soldAt=null;patch.cancelledAt=null;patch.returnedAt=null}
    await updateDoc(doc(db,'buybackItems',item.id),patch);showToast('Статус перекупного товара обновлён.');
  }
  }catch(err){console.error(err);showToast('Не удалось изменить статус.')}
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
