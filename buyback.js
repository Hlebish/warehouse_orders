import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, serverTimestamp, query, orderBy } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
let currentUser = null, unsubscribe = null, items = [], selectedStatus = 'active', selectedSupplier = '';

const style = document.createElement('style');
style.textContent = `
.buyback-nav-alert[hidden]{display:none}.buyback-nav-alert{margin-left:auto;display:inline-grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#c83e3e;color:white;font-weight:900;font-size:17px;box-shadow:0 0 0 4px #c83e3e18;animation:buybackPulse 1.5s infinite}
@keyframes buybackPulse{50%{box-shadow:0 0 0 7px #c83e3e08}}
.buyback-overlay{position:fixed;inset:0;background:#141c2a70;z-index:50;display:grid;place-items:center;padding:16px}
.buyback-overlay[hidden]{display:none}
.buyback-window{width:min(1000px,100%);max-height:92vh;overflow:auto;background:var(--surface,#fff);border-radius:14px;box-shadow:0 24px 80px #11182740;color:var(--text,#27313d);scrollbar-width:thin}
.buyback-window::-webkit-scrollbar{width:6px}.buyback-window::-webkit-scrollbar-thumb{background:#3a403b;border-radius:8px}
.buyback-body{padding:16px 20px}.buyback-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-bottom:12px}
.buyback-chip{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:10px 11px;border:1px solid #343a42;border-radius:9px;background:#20252b;color:#c1c7cf;font-size:11px}
.buyback-chip b{font-size:15px;color:#f3f5f7}
.buyback-chip:last-child{border-color:#554044;background:#292124}.buyback-chip:last-child b{color:#efaaaa}
.buyback-supplier-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;align-items:start}
.buyback-supplier-group{border:1px solid #343a42;border-radius:11px;overflow:hidden;background:#1b1f24;min-width:0}
.buyback-supplier-toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:62px;padding:11px 12px;border:0;background:#1b1f24;color:#e7e9ec;text-align:left;font-size:12px;font-weight:750;cursor:pointer}
.buyback-supplier-toggle span{display:flex;align-items:flex-start;gap:7px;min-width:0;overflow-wrap:anywhere;line-height:1.35}
.buyback-supplier-toggle small{flex-shrink:0;white-space:nowrap;color:#b4bbc4;background:#282e35;border:1px solid #3a414a;border-radius:7px;padding:4px 6px;font-size:10px;font-weight:650}
.buyback-supplier-arrow{color:#aab3bd;transition:transform .15s}.buyback-supplier-group[open] .buyback-supplier-arrow{transform:rotate(90deg)}
.buyback-supplier-group[open]{grid-column:1/-1}
.buyback-supplier-items{display:grid;gap:7px;padding:8px;border-top:1px solid #343a42}
.buyback-supplier-items .buyback-card{background:#20252b!important;border-color:#363d45!important;border-left:3px solid #596574!important}
.buyback-supplier-items .buyback-card.warn{background:#28272a!important;border-left-color:#c79b48!important}
.buyback-supplier-items .buyback-card.critical,.buyback-supplier-items .buyback-card.expired{background:#2a2224!important;border-left-color:#c75c5c!important}
.buyback-supplier-items .buyback-article{color:#eef0f3!important}.buyback-supplier-items .buyback-meta{color:#aab2bc!important}
.buyback-supplier-items .buyback-progress{background:#343a42!important}.buyback-supplier-items .buyback-progress span{background:#7f8a98!important}
.buyback-supplier-items .buyback-status{color:#d0d5dc!important}
.buyback-supplier-filter{border-color:#343a42!important;background:#1b1f24!important}
.buyback-supplier-filter label{color:#c3c9d1!important}
.buyback-supplier-filter select{border-color:#3b424b!important;background:#111418!important;color:#eceff2!important}
.buyback-head{display:flex;align-items:flex-start;justify-content:space-between;padding:22px 24px;border-bottom:1px solid var(--line,#e6e9ed);gap:14px}
.buyback-head h2{margin:4px 0;font-size:23px}.buyback-head p{margin:0;color:#8b95a2;font-size:12px}
.buyback-body{padding:20px 24px}.buyback-form{display:grid;grid-template-columns:2fr 1fr 1.2fr auto;gap:10px;align-items:end;padding:15px;background:#f7f9fb;border:1px solid #e8ebef;border-radius:10px;margin-bottom:18px}
.buyback-field{display:grid;gap:6px;font-size:11px;font-weight:700;color:#667180}.buyback-field input,.buyback-field select{width:100%;min-width:0;padding:10px;border:1px solid #dfe4ea;border-radius:7px;background:white;color:#27313d;font:inherit;font-weight:400}
.buyback-add{height:38px;border:0;border-radius:7px;background:#2867dc;color:white;padding:0 15px;font-weight:700}
.buyback-summary{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.buyback-chip{padding:7px 10px;border-radius:7px;background:#f0f3f7;font-size:11px;color:#596574}
.buyback-list{display:grid;gap:10px}.buyback-supplier-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;align-items:start}.buyback-supplier-group{border:1px solid #343a42;border-radius:11px;overflow:hidden;background:#1b1f24;min-width:0}.buyback-supplier-toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:62px;padding:11px 12px;border:0;background:#1b1f24;color:#e7e9ec;text-align:left;font-size:12px;font-weight:750;cursor:pointer}.buyback-supplier-toggle span{display:flex;align-items:flex-start;gap:7px;min-width:0;overflow-wrap:anywhere;line-height:1.35}.buyback-supplier-toggle small{flex-shrink:0;color:#b4bbc4;background:#282e35;border:1px solid #3a414a;border-radius:7px;padding:4px 6px;font-size:10px;font-weight:650}.buyback-supplier-arrow{color:#aab3bd;transition:transform .15s}.buyback-supplier-group[open] .buyback-supplier-arrow{transform:rotate(90deg)}.buyback-supplier-group[open]{grid-column:1/-1}.buyback-supplier-items{display:grid;gap:7px;padding:8px}.buyback-supplier-items .buyback-card{padding:9px 10px!important;gap:8px!important;border-radius:8px!important}.buyback-supplier-items .buyback-article{font-size:13px!important}.buyback-supplier-items .buyback-meta{font-size:10px!important;line-height:1.45!important}.buyback-supplier-items .buyback-status{font-size:9px!important;padding:3px 6px!important}.buyback-supplier-items .buyback-progress{height:3px!important;margin-top:5px!important}.buyback-supplier-items .buyback-comment{margin-top:6px!important}.buyback-supplier-items .buyback-comment textarea{min-height:48px!important;font-size:11px!important}.buyback-supplier-items .buyback-actions{gap:4px!important}.buyback-supplier-items .buyback-actions button{padding:5px 7px!important;font-size:10px!important}.buyback-supplier-filter{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px;padding:10px 12px;border:1px solid #303a32;border-radius:10px;background:#181d1a}.buyback-supplier-filter label{font-size:11px;font-weight:800;color:#b8c4bc}.buyback-supplier-filter select{min-width:0;max-width:100%;flex:1;padding:9px 11px;border-radius:8px;border:1px solid #354039;background:#111513;color:#edf2ee;font-size:12px}.buyback-card{border:1px solid #e5e8ed;border-left:4px solid #72a88a;border-radius:10px;padding:14px 15px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}
.buyback-card.warn{border-left-color:#c79b48;background:#28272a}.buyback-card.critical{border-left-color:#c75c5c;background:#2a2224}.buyback-card.expired{border-left-color:#c75c5c;background:#2a2224}
.buyback-article{font-size:15px;font-weight:800;color:#283341;overflow-wrap:anywhere}.buyback-meta{font-size:11px;color:#8993a0;margin-top:5px;line-height:1.6}
.buyback-progress{height:6px;background:#edf0f4;border-radius:99px;overflow:hidden;margin-top:10px;max-width:400px}.buyback-progress span{display:block;height:100%;background:#6da985;border-radius:99px}
.buyback-status{font-size:11px;font-weight:800;margin-top:8px}.buyback-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.buyback-actions button{border:1px solid #dfe4ea;background:#fff;color:#5e6876;border-radius:6px;padding:7px 9px;font-size:10px}.buyback-actions button.primary{background:#edf4ff;border-color:#dce8ff;color:#2867dc}.buyback-actions button.danger{background:#fff1f0;color:#b43c3c;border-color:#f2d4d2}
.buyback-empty{padding:30px;text-align:center;color:#929ba7;border:1px dashed #dfe4ea;border-radius:10px;font-size:12px}
@media(min-width:701px){.buyback-supplier-groups{grid-template-columns:repeat(3,minmax(0,1fr))}.buyback-supplier-group[open]{grid-column:1/-1}.buyback-supplier-toggle{min-height:68px}}
@media(max-width:700px){.buyback-overlay{padding:0;place-items:stretch}.buyback-window{width:100%;height:100%;max-height:100dvh;border-radius:0;border-left:0;border-right:0}.buyback-form{grid-template-columns:1fr 1fr}.buyback-add{width:100%}.buyback-card{grid-template-columns:1fr}.buyback-actions{justify-content:flex-start}.buyback-head{padding:17px 16px 13px;position:sticky;top:0;z-index:3;background:#141414}.buyback-head h2{font-size:21px}.buyback-body{padding:13px 12px calc(20px + env(safe-area-inset-bottom))}.buyback-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.buyback-chip{font-size:11px;padding:9px 10px}.buyback-chip b{font-size:16px}.buyback-supplier-filter{display:grid;grid-template-columns:1fr;gap:7px}.buyback-supplier-filter select{width:100%}.buyback-supplier-toggle{padding:10px 9px;min-height:76px;font-size:11px}.buyback-supplier-toggle small{font-size:9px;padding:4px 5px}.buyback-supplier-items{padding:6px}.buyback-supplier-items .buyback-meta{overflow-wrap:anywhere}}

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

/* Buyback workspace v2 — clearer hierarchy, compact controls, deadline-first cards */
.buyback-overlay{padding:12px!important;background:rgba(0,0,0,.82)!important;backdrop-filter:blur(3px)!important}
.buyback-window{width:min(1160px,100%)!important;max-height:calc(100dvh - 24px)!important;border-radius:16px!important;border:1px solid #343b36!important;background:#121514!important;box-shadow:0 28px 90px #000b!important}
.buyback-head{position:sticky!important;top:0!important;z-index:5!important;padding:18px 24px!important;background:#191f1b!important;border-bottom:1px solid #303831!important}
.buyback-head h2{font-size:24px!important;letter-spacing:-.45px!important;margin:6px 0 5px!important}
.buyback-head p{font-size:11px!important;color:#9da9a1!important}
.buyback-head .eyebrow{color:#8fcf9c!important;letter-spacing:1.2px!important}
.buyback-head .close-button{width:34px!important;height:34px!important;border-radius:9px!important;background:#242a26!important;border:1px solid #39423c!important;color:#d4ddd7!important}
.buyback-body{padding:16px 24px 22px!important}
.buyback-form{grid-template-columns:minmax(200px,1.7fr) minmax(84px,.55fr) minmax(145px,.9fr) minmax(155px,1fr) auto!important;gap:10px!important;padding:13px!important;margin-bottom:14px!important;background:#181d1a!important;border:1px solid #303a32!important;border-radius:12px!important}
.buyback-field{gap:6px!important;color:#b8c4bc!important;font-size:10px!important;letter-spacing:.1px!important}
.buyback-field input,.buyback-field select{min-height:39px!important;padding:9px 10px!important;border-radius:8px!important;background:#111513!important;border-color:#354039!important;color:#edf2ee!important;font-size:12px!important}
.buyback-field input:focus,.buyback-field select:focus{outline:2px solid #4caf7822!important;border-color:#4caf78!important}
.buyback-add{min-height:39px!important;height:39px!important;padding:0 14px!important;border-radius:8px!important;background:#319b68!important;border:1px solid #48b77d!important;color:#071b11!important;font-size:11px!important;box-shadow:none!important}
.buyback-add:hover{background:#3bb478!important;filter:none!important;transform:translateY(-1px)!important}
#buybackSummary.buyback-summary{display:flex!important;gap:7px!important;margin:0 0 12px!important}
#buybackSummary .buyback-chip{padding:7px 10px!important;border-radius:8px!important;background:#1b211d!important;border-color:#303a32!important;color:#aebbb2!important;font-size:10px!important}
#buybackSummary .buyback-chip b{font-size:12px!important;color:#edf3ee!important}
.buyback-summary:has(button[data-status]){display:flex!important;flex-wrap:wrap!important;gap:4px!important;width:max-content!important;max-width:100%!important;padding:4px!important;margin-bottom:14px!important;background:#151916!important;border:1px solid #303831!important;border-radius:10px!important}
.buyback-chip[data-status]{padding:8px 12px!important;border-radius:7px!important;font-size:10px!important}
.buyback-chip[data-status].active,.buyback-chip[data-status][aria-pressed="true"]{background:#26382b!important;border-color:#42634a!important;color:#a9e5b7!important}
.buyback-list{gap:9px!important}
.buyback-card{grid-template-columns:minmax(0,1fr) auto!important;gap:16px!important;padding:14px 16px!important;border-radius:12px!important;background:#191e1b!important;border:1px solid #303a33!important;border-left:3px solid #4d8b65!important;box-shadow:none!important;transform:none!important}
.buyback-card:hover{border-color:#46594b!important;box-shadow:0 5px 14px #0003!important;transform:none!important}
.buyback-card.warn{background:#211f18!important;border-color:#51452d!important;border-left-color:#d0a54b!important}
.buyback-card.critical{background:#231b1b!important;border-color:#553232!important;border-left-color:#d46b65!important}
.buyback-card.expired{background:#281a1a!important;border-color:#663535!important;border-left-color:#d24f4f!important}
.buyback-article{font-size:16px!important;font-weight:800!important;line-height:1.35!important;letter-spacing:0!important}
.buyback-article span{font-size:12px!important;color:#9ba7a0!important}
.buyback-meta{margin-top:6px!important;font-size:11px!important;line-height:1.6!important;color:#a5b0a9!important}
.buyback-meta b{color:#e0e9e2!important}
.buyback-comment{grid-column:1/-1;margin-top:10px;padding-top:10px;border-top:1px solid #303a33;display:grid;gap:7px}
.buyback-comment label{font-size:10px;font-weight:800;color:#aebbb2}
.buyback-comment textarea{width:100%;min-height:58px;resize:vertical;box-sizing:border-box;padding:9px 10px;border-radius:8px;border:1px solid #354039;background:#121517;color:#e8ecee;font:inherit;font-size:12px;line-height:1.5}
.buyback-comment textarea:focus{outline:2px solid #4caf7822;border-color:#4caf78}
.buyback-comment-footer{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.buyback-comment-save{min-height:30px;padding:6px 11px;border-radius:7px;border:1px solid #3d7754;background:#203629;color:#a9e4b6;font-size:10px;font-weight:800}
.buyback-comment-save:disabled{opacity:.55}
.buyback-comment-saved{font-size:10px;color:#899a8e}
.buyback-progress{height:4px!important;margin-top:9px!important;background:#303833!important;border-radius:5px!important;max-width:none!important}
.buyback-progress span{border-radius:5px!important;background:#55b77b!important}
.buyback-card.warn .buyback-progress span{background:#d0a54b!important}
.buyback-card.critical .buyback-progress span,.buyback-card.expired .buyback-progress span{background:#d85e5e!important}
.buyback-status{margin-top:8px!important;padding:4px 7px!important;border-radius:6px!important;font-size:9px!important;letter-spacing:.2px!important}
.buyback-actions{max-width:none!important;min-width:0!important;display:flex!important;flex-wrap:wrap!important;align-items:center!important;justify-content:flex-end!important;gap:5px!important}
.buyback-actions button{min-height:31px!important;padding:6px 9px!important;border-radius:7px!important;font-size:10px!important;font-weight:750!important}
.buyback-actions button.buyback-action-edit{background:#242a27!important;border-color:#3b4640!important;color:#d5dfd8!important}
.buyback-actions button.buyback-action-green{background:#203629!important;border-color:#345d41!important;color:#a9e4b6!important}
.buyback-actions button.buyback-action-red{background:#351f20!important;border-color:#613638!important;color:#f0b2b0!important}
.buyback-empty{padding:34px 18px!important;background:#171c19!important;border-color:#364039!important;color:#9da9a1!important}
@media(max-width:900px){
 .buyback-window{width:min(760px,100%)!important}
 .buyback-form{grid-template-columns:repeat(2,minmax(0,1fr))!important}
 .buyback-form .buyback-add{width:100%!important}
 .buyback-card{grid-template-columns:minmax(0,1fr)!important;gap:10px!important}
 .buyback-actions{justify-content:flex-start!important;padding-top:2px!important}
}
@media(max-width:620px){
 .buyback-overlay{padding:6px!important}
 .buyback-window{max-height:calc(100dvh - 12px)!important;border-radius:12px!important}
 .buyback-head{padding:15px 14px!important}
 .buyback-head h2{font-size:21px!important}
 .buyback-body{padding:12px 10px 15px!important}
 .buyback-form{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important;padding:10px!important}
 .buyback-form .buyback-field:first-child,.buyback-form .buyback-field:nth-child(4){grid-column:1/-1!important}
 .buyback-summary:has(button[data-status]){display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;width:100%!important}
 .buyback-chip[data-status]{width:100%!important}
 .buyback-card{padding:12px!important}
 .buyback-article{font-size:15px!important}
 .buyback-meta{font-size:10px!important;line-height:1.6!important}
 .buyback-actions{gap:5px!important}
 .buyback-actions button{flex:1 1 auto!important;min-height:32px!important}
}

/* Final graphite pass: neutralize the green cast on the buyback workspace shell and form. */
.buyback-window,
.buyback-head,
.buyback-body,
.buyback-form,
.buyback-summary:has(button[data-status]),
#buybackSummary .buyback-chip {
  background: #191d20 !important;
  border-color: #30373b !important;
  color: #e8ecee !important;
}
.buyback-head .eyebrow { color: #8f999e !important; }
.buyback-head p, .buyback-field { color: #aeb8bc !important; }
.buyback-form input, .buyback-form select {
  background: #121517 !important;
  border-color: #30373b !important;
  color: #e8ecee !important;
}
.buyback-chip[data-status].active,
.buyback-chip[data-status][aria-pressed="true"] {
  background: #242a2e !important;
  border-color: #454e53 !important;
  color: #e0e6e8 !important;
}


/* Graphite reference design */
.buyback-overlay{background:rgba(0,0,0,.82);backdrop-filter:blur(7px)}
.buyback-window{width:min(1410px,calc(100vw - 48px));max-height:calc(100dvh - 28px);background:radial-gradient(ellipse at 50% 0%,#1c2229 0%,#15191e 72%);border:1px solid #303740;border-radius:18px;color:#edf0f4;box-shadow:0 28px 90px #0009}
.buyback-head{padding:24px 28px 20px;background:transparent;border-bottom:1px solid #303740}
.buyback-head .eyebrow{color:#a6b4c5;font-size:10px;letter-spacing:1.8px}
.buyback-head h2{color:#f1f4f8;font-size:27px;letter-spacing:-.7px}
.buyback-head p{color:#aab4c0;font-size:12px}
.buyback-head .close-button{display:grid;place-items:center;width:44px;height:44px;border:1px solid #353d47;border-radius:12px;background:#20262d;color:#dce2e9;font-size:22px}
.buyback-body{padding:20px 28px 28px}
#buybackInvoiceImport{margin:0 0 14px!important;padding:0!important;background:transparent!important;border:0!important;border-radius:12px!important;overflow:hidden}
#buybackInvoiceImport>summary{display:flex;align-items:center;gap:16px;min-height:78px;padding:15px 18px;list-style:none;cursor:pointer;background:linear-gradient(110deg,#1c2229,#1a1f25);border:1px solid #343c46;border-radius:12px;color:#f0f3f7}
#buybackInvoiceImport>summary::-webkit-details-marker{display:none}
#buybackInvoiceImport>summary:before{content:'›';font-size:25px;color:#b9c4d1;transition:transform .15s}
#buybackInvoiceImport[open]>summary:before{transform:rotate(90deg)}
#buybackInvoiceImport .invoice-icon{display:grid;place-items:center;flex:0 0 34px;font-size:27px;color:#d9e1ea}
#buybackInvoiceImport .invoice-heading{display:block;font-size:15px;font-weight:800}
#buybackInvoiceImport .invoice-description{display:block;margin-top:5px;color:#aeb9c7;font-size:12px;font-weight:400;line-height:1.5}
#buybackInvoiceImport .invoice-content{padding:16px 18px 18px;background:#191e24;border:1px solid #343c46;border-top:0;border-radius:0 0 12px 12px}
#buybackInvoiceImport[open]>summary{border-radius:12px 12px 0 0}
#buybackInvoiceImport textarea{background:#111519!important;border-color:#363e48!important;color:#edf1f5!important;border-radius:9px!important;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace!important;min-height:130px}
#buybackInvoiceImport textarea::placeholder{color:#75808d}
#buybackInvoiceImport button#buybackInvoiceParse{background:#35465d!important;border:1px solid #4a5b70!important;color:#f2f5f8!important;border-radius:8px!important;padding:10px 14px!important}
#buybackInvoiceImport button#buybackInvoiceSave{background:#354f78!important;border:1px solid #45658f!important;color:#f2f5f8!important;border-radius:8px!important;padding:10px 14px!important}
#buybackInvoiceImport #buybackInvoiceStatus{color:#aeb9c7!important;line-height:1.5}
#buybackInvoiceImport #buybackInvoicePreview table{color:#d9e0e8}
#buybackInvoiceImport #buybackInvoicePreview th{color:#aeb9c7}
.buyback-form{grid-template-columns:minmax(180px,2fr) minmax(90px,.7fr) minmax(145px,1fr) minmax(150px,1.2fr) auto;gap:12px;padding:16px;background:#191e24;border:1px solid #343c46;border-radius:12px}
.buyback-field{color:#bfc8d2}
.buyback-field input,.buyback-field select{background:#111519;border:1px solid #3a434e;color:#eef2f6;border-radius:9px;min-height:42px}
.buyback-field input:focus,.buyback-field select:focus{outline:2px solid #6a7e942e;border-color:#64788e}
.buyback-add{background:#35465d;color:#f3f5f8;border:1px solid #4a5b70;border-radius:9px;box-shadow:none}
.buyback-add:hover{background:#40536c}
.buyback-summary#buybackSummary{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px!important;margin:0 0 14px!important}
#buybackSummary .buyback-chip{display:grid!important;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:12px;padding:14px 16px!important;min-height:66px;background:linear-gradient(110deg,#1c2229,#1a1f25)!important;border:1px solid #343c46!important;border-radius:12px!important;color:#d5dce4!important;font-size:12px!important}
#buybackSummary .buyback-chip b{font-size:22px!important;color:#e7edf4!important;margin:0!important}
.buyback-stat-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;font-size:22px;font-weight:800}
.buyback-stat-icon.blue{color:#80b2ff;background:#253448}.buyback-stat-icon.amber{color:#f2c46c;background:#352e20}.buyback-stat-icon.red{color:#ff7777;background:#382527}.buyback-stat-icon.neutral{color:#b7c2cf;background:#293039}
#buybackSummary .buyback-chip:nth-child(2) b{color:#f2c46c!important}#buybackSummary .buyback-chip:nth-child(3) b,#buybackSummary .buyback-chip:nth-child(4) b{color:#ff7777!important}
.buyback-supplier-filter{display:grid;grid-template-columns:92px minmax(0,1fr);align-items:center;gap:14px;margin:0 0 12px;padding:13px 16px;background:#191e24;border:1px solid #343c46;border-radius:12px}
.buyback-supplier-filter label{color:#c2cbd5!important;font-size:12px;font-weight:600}.buyback-supplier-filter select{background:#111519!important;border:1px solid #3a434e!important;color:#edf1f5!important;border-radius:9px;min-height:44px;padding:10px 14px}
.buyback-summary:has(button[data-status]){display:flex;gap:0!important;width:100%;max-width:none;margin:0 0 14px!important;padding:4px;background:#191e24;border:1px solid #343c46;border-radius:10px;overflow-x:auto}
.buyback-chip[data-status]{flex:1 0 110px;min-height:42px;padding:9px 12px!important;background:transparent!important;border:1px solid transparent!important;border-radius:7px!important;color:#c2cbd5!important;font-size:12px!important;font-weight:650!important;white-space:nowrap}
.buyback-chip[data-status].active,.buyback-chip[data-status][aria-pressed="true"]{background:#354f78!important;border-color:#4b6890!important;color:#f2f5f8!important}
.buyback-list{gap:10px}.buyback-supplier-groups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start}
.buyback-supplier-group{background:linear-gradient(110deg,#1c2229,#1a1f25);border:1px solid #343c46;border-radius:12px}
.buyback-supplier-toggle{min-height:68px;padding:13px 14px;background:transparent;color:#e9edf2;font-size:12px;gap:10px}
.buyback-supplier-toggle small{background:#252d36;border-color:#3a4551;color:#c1cbd6;border-radius:9px;padding:6px 9px;font-size:11px}.buyback-supplier-arrow{font-size:22px;color:#c0cad5}.buyback-supplier-group[open]{grid-column:1/-1}
.buyback-supplier-items{background:#171c22;border-color:#343c46;padding:12px;gap:9px}
.buyback-supplier-items .buyback-card{background:#20262d!important;border:1px solid #39434e!important;border-left:3px solid #687b91!important;border-radius:10px!important}
.buyback-supplier-items .buyback-card.warn{background:#292720!important;border-left-color:#d0a653!important}.buyback-supplier-items .buyback-card.critical,.buyback-supplier-items .buyback-card.expired{background:#2b2225!important;border-left-color:#d46c70!important}
.buyback-supplier-items .buyback-article{color:#edf1f5!important}.buyback-supplier-items .buyback-meta{color:#b1bdc9!important}.buyback-supplier-items .buyback-progress{background:#343d47!important}.buyback-supplier-items .buyback-progress span{background:#8799ad!important}.buyback-supplier-items .buyback-status{background:#293039!important;color:#d5dfe9!important}
.buyback-supplier-items .buyback-actions button{background:#252d36!important;border:1px solid #414d5a!important;color:#dce3eb!important}.buyback-supplier-items .buyback-actions button.buyback-action-red{background:#342427!important;border-color:#5b3a40!important;color:#f0b8bb!important}.buyback-supplier-items .buyback-actions button.buyback-action-green{background:#252d36!important;border-color:#414d5a!important;color:#dce3eb!important}
.buyback-empty{background:#191e24;border:1px solid #343c46;border-radius:12px;color:#b8c3cf;padding:28px}
.buyback-edit-window .buyback-head,.buyback-edit-footer{background:#191e24!important}.buyback-edit-grid .buyback-field input{background:#111519!important;color:#edf1f5!important}
@media(min-width:1100px){.buyback-window{width:min(1410px,calc(100vw - 48px))}}
@media(max-width:900px){.buyback-window{width:calc(100vw - 24px)}.buyback-summary#buybackSummary{grid-template-columns:repeat(2,minmax(0,1fr))}.buyback-supplier-groups{grid-template-columns:repeat(2,minmax(0,1fr))}.buyback-form{grid-template-columns:repeat(2,minmax(0,1fr))}.buyback-add{width:100%}}
@media(max-width:700px){.buyback-overlay{padding:0;place-items:stretch}.buyback-window{width:100%;height:100%;max-height:100dvh;border-radius:0}.buyback-head{padding:17px 16px 14px;position:sticky;top:0;z-index:3;background:#151a20}.buyback-head h2{font-size:22px}.buyback-body{padding:14px 12px calc(20px + env(safe-area-inset-bottom))}.buyback-summary#buybackSummary{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px!important}.buyback-chip[data-status]{flex:1 0 100px}.buyback-supplier-filter{grid-template-columns:1fr;gap:7px}.buyback-supplier-toggle{min-height:76px;padding:10px;font-size:11px}.buyback-supplier-toggle small{font-size:10px}.buyback-supplier-groups{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.buyback-supplier-group[open]{grid-column:1/-1}.buyback-supplier-items{padding:7px}.buyback-form{grid-template-columns:1fr 1fr}.buyback-form .buyback-field:first-child,.buyback-form .buyback-field:last-of-type{grid-column:1/-1}#buybackInvoiceImport>summary{min-height:72px;padding:12px}#buybackInvoiceImport .invoice-heading{font-size:13px}#buybackInvoiceImport .invoice-description{font-size:11px}#buybackInvoiceImport .invoice-content{padding:12px}#buybackInvoiceImport .invoice-icon{display:none}}

/* Mobile polish: compact add form, keep supplier groups before the long list, slim import field */
@media(max-width:700px){
 .buyback-head{padding:15px 14px 12px!important}
 .buyback-head .eyebrow{font-size:9px!important}
 .buyback-head h2{font-size:21px!important;margin:5px 0!important}
 .buyback-head p{font-size:11px!important;line-height:1.45!important}
 .buyback-head .close-button{width:36px!important;height:36px!important}
 .buyback-body{padding:10px 10px calc(18px + env(safe-area-inset-bottom))!important}
 .buyback-form{gap:8px!important;padding:10px!important;margin-bottom:10px!important}
 .buyback-field{gap:5px!important;font-size:10px!important}
 .buyback-field input,.buyback-field select{min-height:36px!important;padding:7px 9px!important;border-radius:8px!important;font-size:13px!important}
 .buyback-add{min-height:34px!important;height:34px!important;padding:0 11px!important;font-size:11px!important;border-radius:8px!important}
 .buyback-summary#buybackSummary{gap:7px!important;margin-bottom:10px!important}
 #buybackSummary .buyback-chip{grid-template-columns:26px minmax(0,1fr) auto!important;gap:7px!important;min-height:54px!important;padding:9px!important}
 .buyback-stat-icon{width:25px;height:25px;font-size:17px}
 #buybackSummary .buyback-chip b{font-size:18px!important}
 #buybackSummary .buyback-chip .buyback-stat-label{font-size:10px;line-height:1.25}
 #buybackInvoiceImport{margin:0 0 10px!important}
 #buybackInvoiceImport>summary{min-height:58px!important;padding:10px 12px!important;gap:9px!important}
 #buybackInvoiceImport .invoice-heading{font-size:12px!important}
 #buybackInvoiceImport .invoice-description{font-size:10px!important;line-height:1.4!important;margin-top:3px!important}
 #buybackInvoiceImport .invoice-content{padding:10px!important}
 #buybackInvoiceImport textarea{display:block;width:100%!important;box-sizing:border-box!important;min-height:76px!important;height:76px!important;max-height:120px!important;resize:vertical!important;padding:9px!important;font-size:11px!important;line-height:1.4!important}
 #buybackInvoiceImport .invoice-content>div:first-of-type{display:grid!important;grid-template-columns:1fr 1fr!important;gap:7px!important}
 #buybackInvoiceImport button#buybackInvoiceParse,#buybackInvoiceImport button#buybackInvoiceSave{min-height:36px!important;padding:7px 8px!important;font-size:11px!important;white-space:normal!important}
 .buyback-supplier-filter{margin-bottom:9px!important;padding:10px 12px!important}
 .buyback-supplier-filter select{min-height:38px!important;padding:8px 10px!important;font-size:13px!important}
 .buyback-summary:has(button[data-status]){margin-bottom:10px!important}
 .buyback-chip[data-status]{min-height:36px!important;padding:7px 8px!important;font-size:11px!important}
 .buyback-supplier-groups{grid-template-columns:1fr!important;gap:7px!important}
 .buyback-supplier-group[open]{grid-column:auto!important}
 .buyback-supplier-toggle{min-height:48px!important;padding:9px 11px!important;font-size:12px!important}
 .buyback-supplier-items{padding:7px!important}
}


/* Status sorting controls: clean graphite segmented tabs */
.buyback-summary:has(button[data-status]){
 display:flex!important;flex-wrap:wrap;align-items:center;gap:6px!important;
 width:100%!important;max-width:none!important;margin:0 0 12px!important;
 padding:6px!important;background:#151a20!important;border:1px solid #303943!important;
 border-radius:12px!important;overflow:visible!important;box-sizing:border-box;
}
.buyback-chip[data-status]{
 display:inline-flex!important;align-items:center;justify-content:center;gap:7px;
 flex:1 1 105px!important;min-width:0;min-height:38px!important;padding:8px 11px!important;
 border:1px solid transparent!important;border-radius:8px!important;
 background:transparent!important;color:#aeb8c4!important;
 font-size:12px!important;font-weight:650!important;line-height:1.2;
 white-space:nowrap;transition:background .15s,border-color .15s,color .15s,box-shadow .15s;
}
.buyback-chip[data-status]:before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:#687584;flex:0 0 6px}
.buyback-chip[data-status]:hover{background:#222a33!important;color:#e0e6ed!important;border-color:#36414d!important}
.buyback-chip[data-status].active,.buyback-chip[data-status][aria-pressed="true"]{
 background:#2b3b50!important;border-color:#435a75!important;color:#f0f5fb!important;
 box-shadow:inset 0 1px 0 #ffffff08;
}
.buyback-chip[data-status].active:before,.buyback-chip[data-status][aria-pressed="true"]:before{background:#8bbcff;box-shadow:0 0 0 3px #6da8ff1c}
@media(max-width:700px){
 .buyback-summary:has(button[data-status]){display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px!important;padding:5px!important;border-radius:10px!important}
 .buyback-chip[data-status]{flex:initial!important;min-height:36px!important;padding:7px 8px!important;font-size:11px!important;border-radius:7px!important}
}

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
<div class="buyback-supplier-filter"><label for="buybackSupplierFilter">Поставщик</label><select id="buybackSupplierFilter"><option value="">Все поставщики</option></select></div>
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
 $('buybackSummary').innerHTML=`<span class="buyback-chip"><span class="buyback-stat-icon blue">⬡</span><span class="buyback-stat-label">В работе</span><b>${active.length}</b></span><span class="buyback-chip"><span class="buyback-stat-icon amber">◷</span><span class="buyback-stat-label">Срок подходит</span><b>${warn}</b></span><span class="buyback-chip"><span class="buyback-stat-icon red">!</span><span class="buyback-stat-label">Критично</span><b>${critical}</b></span><span class="buyback-chip"><span class="buyback-stat-icon neutral">⌛</span><span class="buyback-stat-label">Просрочено</span><b>${expiredItems.length}</b></span>`;
 const visible=items.filter(x=>{
   const isExpired=x.status==='expired'||(x.status==='active'&&elapsedDays(x.receivedAt)>=14);
   return selectedStatus==='expired'?isExpired:selectedStatus==='approaching'?!isExpired&&x.status==='active'&&elapsedDays(x.receivedAt)>=6&&elapsedDays(x.receivedAt)<10:selectedStatus==='critical'?!isExpired&&x.status==='active'&&elapsedDays(x.receivedAt)>=10&&elapsedDays(x.receivedAt)<14:(selectedStatus==='active'?!isExpired&&x.status==='active':x.status===selectedStatus);
 }).sort((a,b)=>String(a.receivedAt).localeCompare(String(b.receivedAt)));
 if(!visible.length){$('buybackList').innerHTML='<div class="buyback-empty">Здесь пока нет записей.</div>';return}
 const renderItem=item=>{
  const days=elapsedDays(item.receivedAt),left=14-days;
  const isExpired=item.status==='expired'||(item.status==='active'&&days>=14);
  const cls=isExpired?'expired':days>=10?'critical':days>=6?'warn':'';
  const status=isExpired?'ПРОСРОЧЕН':item.status==='active'?(days>=10?'Срок подходит к концу':days>=6?'Срок возврата приближается':days>=3?'Товар залежался на складе':'Срок идёт'):(item.status==='returned'?'Возвращён':item.status==='sold'?'Продан':item.status==='cancelled'?'Отменён':'');
  const bar=Math.max(0,Math.min(100,days/14*100));
  const actions='<button class="buyback-action-edit" data-edit-buyback="'+item.id+'">Редактировать</button>'+((item.status==='active'||isExpired)?'<button class="buyback-action-green" data-set-status="returned" data-id="'+item.id+'">Возвращён</button><button class="buyback-action-green" data-set-status="sold" data-id="'+item.id+'">Продан</button><button class="buyback-action-red" data-set-status="cancelled" data-id="'+item.id+'">Отменить</button>':'<button class="buyback-action-edit" data-set-status="active" data-id="'+item.id+'">Вернуть в работу</button>');
  return `<article class="buyback-card ${cls}"><div><div class="buyback-article">${escapeHtml(item.article)} <span style="font-weight:500;color:#8a94a1">× ${item.quantity}</span></div>${item.name?'<div style="margin-top:4px;font-size:12px;color:#aab4c0">' + escapeHtml(item.name) + '</div>':''}<div class="buyback-meta">${item.supplier?'<b>Поставщик:</b> '+escapeHtml(item.supplier)+' · ':''}Принят: ${escapeHtml(item.receivedAt)} · Последний день срока: <b>${escapeHtml(deadline(item).toLocaleDateString('ru-RU',{timeZone:'UTC'}))}</b> · Прошло дней: <b>${Math.max(0,days)}</b> · ${isExpired?'Просрочено на '+Math.max(0,days-14)+' дн.':item.status==='active'?'Осталось дней: '+Math.max(0,left):'14-дневный срок остановлен'}</div><div class="buyback-progress"><span style="width:${bar}%"></span></div><div class="buyback-status">${status}</div><div class="buyback-comment"><label for="buybackComment-${escapeHtml(item.id)}">Комментарий к товару</label><textarea id="buybackComment-${escapeHtml(item.id)}" data-buyback-comment="${escapeHtml(item.id)}" maxlength="1000" placeholder="Напишите примечание по этому товару…">${escapeHtml(item.comment||'')}</textarea><div class="buyback-comment-footer"><button type="button" class="buyback-comment-save" data-save-buyback-comment="${escapeHtml(item.id)}">Сохранить комментарий</button><span class="buyback-comment-saved">${item.comment?'Комментарий сохранён':'Можно оставить пустым'}</span></div></div></div><div class="buyback-actions">${'<button class="buyback-action-edit" data-edit-buyback="'+item.id+'">Редактировать</button>' + ((item.status==='active'||isExpired) ? '<button class="buyback-action-green" data-set-status="returned" data-id="'+item.id+'">Возвращён</button><button class="buyback-action-green" data-set-status="sold" data-id="'+item.id+'">Продан</button><button class="buyback-action-red" data-set-status="cancelled" data-id="'+item.id+'">Отменить</button>' : '<button class="buyback-action-edit" data-set-status="active" data-id="'+item.id+'">Вернуть в работу</button>')}</div></article>`;
 };
 const groups=new Map();
 const supplierKey=value=>{
  const raw=String(value||'').trim();
  if(!raw)return 'unknown';
  const normalized=raw.toLocaleLowerCase('ru').replace(/товариство з обмеженою відповідальністю|товариство з обмеженою відповідальнiстю|тов\.?\s*о\.?\s*в\.?|ооо|тзов|тов/g,' ').replace(/[^a-zа-яіїєґ0-9]/gi,'');
  if(normalized.includes('форм पार्टс')||normalized.includes('формпартс')||normalized.includes('formaparts'))return 'formaparts';
  return normalized;
 };
 const supplierLabels=new Map();
 for(const item of visible){
  const raw=String(item.supplier||'').trim();
  const key=supplierKey(raw);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(item);
  if(raw&&!supplierLabels.has(key))supplierLabels.set(key,raw);
 }
 const groupRows=[...groups.entries()].map(([key,groupItems])=>{
  const label=key==='unknown'?'Не указан поставщик':key==='formaparts'?'Форма Партс':supplierLabels.get(key);
  const urgent=groupItems.filter(item=>{const d=elapsedDays(item.receivedAt);return item.status==='active'&&(d>=10||d>=14)||item.status==='expired'}).length;
  return {key,label,groupItems,urgent,oldest:Math.max(...groupItems.map(item=>elapsedDays(item.receivedAt)))};
 }).sort((a,b)=>b.urgent-a.urgent||b.oldest-a.oldest||a.label.localeCompare(b.label,'ru'));
 $('buybackList').innerHTML='<div class="buyback-supplier-groups">'+groupRows.map((group,index)=>{
  const {key,label,groupItems,urgent}=group;
  const isOpen=false;
  return '<details class="buyback-supplier-group" '+(isOpen?'open':'')+'><summary class="buyback-supplier-toggle"><span><span class="buyback-supplier-arrow">›</span>'+escapeHtml(label)+'</span><small>'+groupItems.length+' '+(groupItems.length===1?'товар':groupItems.length<5?'товара':'товаров')+(urgent?' · ⚠ '+urgent:'')+'</small></summary><div class="buyback-supplier-items">'+groupItems.map(renderItem).join('')+'</div></details>'
 }).join('')+'</div>';


}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
let buybackHistoryEntry=false;
function open(){
 if(!overlay.hidden)return;
 overlay.hidden=false;
 nav?.classList.add('active');
 // Make the phone/browser Back gesture close this panel instead of leaving the site.
 try{history.pushState({...history.state,buybackPanelOpen:true},'');buybackHistoryEntry=true}catch{buybackHistoryEntry=false}
}
function close(fromPopState=false){
 if(overlay.hidden)return;
 overlay.hidden=true;
 nav?.classList.remove('active');
 if(buybackHistoryEntry&&!fromPopState){
  buybackHistoryEntry=false;
  try{history.back()}catch{}
 }
}
nav?.addEventListener('click',open);
$('buybackClose').addEventListener('click',()=>close());
overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
document.addEventListener('keydown',e=>{
 if(e.key!=='Escape')return;
 if(!editOverlay.hidden){e.preventDefault();closeBuybackEditor();return}
 if(!overlay.hidden){e.preventDefault();close()}
});
window.addEventListener('popstate',()=>{
 if(!overlay.hidden){buybackHistoryEntry=false;close(true)}
});
overlay.querySelectorAll('[data-status]').forEach(btn=>btn.addEventListener('click',()=>{selectedStatus=btn.dataset.status;render()}));
$('buybackSupplierFilter').addEventListener('change',e=>{selectedSupplier=e.target.value;render()});
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
 try{await addDoc(collection(db,'buybackItems'),{article,quantity,receivedAt,supplier,comment:'',createdAt:serverTimestamp(),createdBy:currentUser.uid,createdByName:currentUser.displayName||currentUser.email||'Сотрудник',status:'active',soldAt:null,cancelledAt:null,returnedAt:null,createdOn: new Date().toISOString().slice(0,10),sentMilestones:[],updatedAt:serverTimestamp()});$('buybackArticle').value='';$('buybackQuantity').value='1';$('buybackSupplier').value='';showToast('Перекупной товар добавлен. Отсчёт 14 дней начат.');selectedStatus='active'}
 catch(err){console.error(err);showToast('Не удалось добавить товар: '+(err.code||'проверьте доступ'))}
 finally{submit.disabled=false}
});
overlay.addEventListener('click',async e=>{
 const commentBtn=e.target.closest('[data-save-buyback-comment]');
 if(commentBtn){
  const itemId=commentBtn.dataset.saveBuybackComment;
  const field=overlay.querySelector('[data-buyback-comment="'+itemId+'"]');
  const item=items.find(x=>x.id===itemId);
  if(!field||!item)return;
  const comment=field.value.trim();
  if(comment.length>1000){showToast('Комментарий не должен превышать 1000 символов.');return}
  commentBtn.disabled=true;commentBtn.textContent='Сохраняю…';
  try{await updateDoc(doc(db,'buybackItems',itemId),{comment,updatedAt:serverTimestamp()});showToast('Комментарий к товару сохранён.');}
  catch(err){console.error(err);showToast('Не удалось сохранить комментарий: '+(err.code||'проверьте доступ'));}
  finally{commentBtn.disabled=false;commentBtn.textContent='Сохранить комментарий'}
  return;
 }
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
      await addDoc(collection(db,'buybackItems'),{article:item.article,quantity:qty,receivedAt:item.receivedAt,supplier:item.supplier||'',comment:item.comment||'',createdAt:serverTimestamp(),createdOn:item.createdOn||eventDate,createdBy:item.createdBy||currentUser.uid,createdByName:item.createdByName||currentUser.displayName||currentUser.email||'Сотрудник',status:nextStatus,soldAt:nextStatus==='sold'?eventDate:null,cancelledAt:nextStatus==='cancelled'?eventDate:null,returnedAt:nextStatus==='returned'?eventDate:null,sentMilestones:Array.isArray(item.sentMilestones)?item.sentMilestones:[],updatedAt:serverTimestamp()});
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
 },err=>{console.error('buybackItems snapshot failed',err);const code=String(err?.code||'unknown');const message=String(err?.message||'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));$('buybackList').innerHTML='<div class="buyback-empty">Нет доступа к перекупному товару.<br><b>Код:</b> '+code+'<br><b>Детали:</b> '+message+'</div>';});
});
