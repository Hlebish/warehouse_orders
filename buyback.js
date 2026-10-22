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


/* Final graphite workspace design */
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
.buyback-stat-icon.blue{color:#80b2ff;background:#253448}
.buyback-stat-icon.amber{color:#f2c46c;background:#352e20}
.buyback-stat-icon.red{color:#ff7777;background:#382527}
.buyback-stat-icon.neutral{color:#b7c2cf;background:#293039}
#buybackSummary .buyback-chip:nth-child(2) b{color:#f2c46c!important}
#buybackSummary .buyback-chip:nth-child(3) b,#buybackSummary .buyback-chip:nth-child(4) b{color:#ff7777!important}
.buyback-supplier-filter{display:grid;grid-template-columns:92px minmax(0,1fr) auto;align-items:center;gap:14px;margin:0 0 12px;padding:13px 16px;background:#191e24;border:1px solid #343c46;border-radius:12px}
.buyback-supplier-filter label{color:#c2cbd5!important;font-size:12px;font-weight:600}
.buyback-supplier-filter select{background:#111519!important;border:1px solid #3a434e!important;color:#edf1f5!important;border-radius:9px;min-height:44px;padding:10px 14px}
.buyback-summary:has(button[data-status]){display:flex;gap:0!important;width:100%;max-width:none;margin:0 0 14px!important;padding:4px;background:#191e24;border:1px solid #343c46;border-radius:10px;overflow-x:auto}
.buyback-chip[data-status]{flex:1 0 110px;min-height:42px;padding:9px 12px!important;background:transparent!important;border:1px solid transparent!important;border-radius:7px!important;color:#c2cbd5!important;font-size:12px!important;font-weight:650!important;white-space:nowrap}
.buyback-chip[data-status].active,.buyback-chip[data-status][aria-pressed="true"]{background:#354f78!important;border-color:#4b6890!important;color:#f2f5f8!important}
.buyback-list{gap:10px}
.buyback-supplier-groups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start}
.buyback-supplier-group{background:linear-gradient(110deg,#1c2229,#1a1f25);border:1px solid #343c46;border-radius:12px}
.buyback-supplier-toggle{min-height:68px;padding:13px 14px;background:transparent;color:#e9edf2;font-size:12px;gap:10px}
.buyback-supplier-toggle small{background:#252d36;border-color:#3a4551;color:#c1cbd6;border-radius:9px;padding:6px 9px;font-size:11px}
.buyback-supplier-arrow{font-size:22px;color:#c0cad5}
.buyback-supplier-group[open]{grid-column:1/-1}
.buyback-supplier-items{background:#171c22;border-color:#343c46;padding:12px;gap:9px}
.buyback-supplier-items .buyback-card{background:#20262d!important;border:1px solid #39434e!important;border-left:3px solid #687b91!important;border-radius:10px!important}
.buyback-supplier-items .buyback-card.warn{background:#292720!important;border-left-color:#d0a653!important}
.buyback-supplier-items .buyback-card.critical,.buyback-supplier-items .buyback-card.expired{background:#2b2225!important;border-left-color:#d46c70!important}
.buyback-supplier-items .buyback-article{color:#edf1f5!important}
.buyback-supplier-items .buyback-meta{color:#b1bdc9!important}
.buyback-supplier-items .buyback-progress{background:#343d47!important}
.buyback-supplier-items .buyback-progress span{background:#8799ad!important}
.buyback-supplier-items .buyback-status{background:#293039!important;color:#d5dfe9!important}
.buyback-supplier-items .buyback-actions button{background:#252d36!important;border:1px solid #414d5a!important;color:#dce3eb!important}
.buyback-supplier-items .buyback-actions button.buyback-action-red{background:#342427!important;border-color:#5b3a40!important;color:#f0b8bb!important}
.buyback-supplier-items .buyback-actions button.buyback-action-green{background:#252d36!important;border-color:#414d5a!important;color:#dce3eb!important}
.buyback-empty{background:#191e24;border:1px solid #343c46;border-radius:12px;color:#b8c3cf;padding:28px}
.buyback-edit-window .buyback-head,.buyback-edit-footer{background:#191e24!important}
.buyback-edit-grid .buyback-field input{background:#111519!important;color:#edf1f5!important}
@media(min-width:1100px){.buyback-window{width:min(1410px,calc(100vw - 48px))}}
@media(max-width:900px){.buyback-window{width:calc(100vw - 24px)}.buyback-summary#buybackSummary{grid-template-columns:repeat(2,minmax(0,1fr))}.buyback-supplier-groups{grid-template-columns:repeat(2,minmax(0,1fr))}.buyback-form{grid-template-columns:repeat(2,minmax(0,1fr))}.buyback-add{width:100%}}
@media(max-width:700px){.buyback-overlay{padding:0;place-items:stretch}.buyback-window{width:100%;height:100%;max-height:100dvh;border-radius:0}.buyback-head{padding:17px 16px 14px;position:sticky;top:0;z-index:3;background:#151a20}.buyback-head h2{font-size:22px}.buyback-body{padding:14px 12px calc(20px + env(safe-area-inset-bottom))}.buyback-summary#buybackSummary{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px!important}.buyback-chip[data-status]{flex:1 0 100px}.buyback-supplier-filter{grid-template-columns:1fr;gap:7px}.buyback-supplier-toggle{min-height:76px;padding:10px;font-size:11px}.buyback-supplier-toggle small{font-size:10px}.buyback-supplier-groups{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.buyback-supplier-group[open]{grid-column:1/-1}.buyback-supplier-items{padding:7px}.buyback-form{grid-template-columns:1fr 1fr}.buyback-form .buyback-field:first-child,.buyback-form .buyback-field:last-of-type{grid-column:1/-1}#buybackInvoiceImport>summary{min-height:72px;padding:12px}#buybackInvoiceImport .invoice-heading{font-size:13px}#buybackInvoiceImport .invoice-description{font-size:11px}#buybackInvoiceImport .invoice-content{padding:12px}#buybackInvoiceImport .invoice-icon{display:none}}
