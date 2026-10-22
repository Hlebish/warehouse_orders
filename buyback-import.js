import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let currentUser = null;
onAuthStateChanged(auth, user => { currentUser = user; });

const monthMap = {
  'січня':'01','лютого':'02','березня':'03','квітня':'04','травня':'05','червня':'06',
  'липня':'07','серпня':'08','вересня':'09','жовтня':'10','листопада':'11','грудня':'12',
  'января':'01','февраля':'02','марта':'03','апреля':'04','мая':'05','июня':'06',
  'июля':'07','августа':'08','сентября':'09','октября':'10','ноября':'11','декабря':'12'
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function parseInvoice(raw) {
  const text = raw.replace(/\u00a0/g, ' ').replace(/\r/g, '');
  const dateMatch = text.match(/(?:Прибуткова\s+накладна|Приходная\s+накладная)[^\n]*?\bвід?\s*(\d{1,2})\s+([а-яіїєґ]+)\s+(\d{4})\s*(?:р\.?|г\.?)?/i)
    || text.match(/(?:від|от)\s*(\d{1,2})\s+([а-яіїєґ]+)\s+(\d{4})\s*(?:р\.?|г\.?)?/i);
  let receivedAt = '';
  if (dateMatch) {
    const month = monthMap[dateMatch[2].toLowerCase()];
    if (month) receivedAt = dateMatch[3] + '-' + month + '-' + dateMatch[1].padStart(2, '0');
  }
  const supplierMatch = text.match(/Постачальник\s*:\s*([^\n\t]+)/i) || text.match(/Поставщик\s*:\s*([^\n\t]+)/i);
  const supplier = supplierMatch ? supplierMatch[1].replace(/[«»"“”]/g, '').trim().slice(0,160) : '';
  const lines = text.split('\n');
  const rows = [];
  const articlePattern = /^[A-ZА-ЯІЇЄҐ0-9][A-ZА-ЯІЇЄҐ0-9 .\/_-]{2,}$/i;
  for (const original of lines) {
    const line = original.trim();
    if (!line || !/\b\d+[,.]?\d*\s*(?:шт\.?|штук|pcs|од\.?|одиниц)/i.test(line)) continue;
    let parts = original.split('\t').map(x => x.trim()).filter(Boolean);
    if (parts.length < 3) parts = line.split(/\s{2,}/).map(x => x.trim()).filter(Boolean);
    if (parts.length < 3) continue;
    const qtyIndex = parts.findIndex((part, i) => i > 0 && /^\d+[,.]?\d*\s*(?:шт\.?|штук|pcs|од\.?|одиниц)?$/i.test(part));
    if (qtyIndex < 1) continue;
    const article = parts.slice(0, qtyIndex - 1).join(' ').replace(/^\d+\s*/, '').trim();
    const name = parts.slice(qtyIndex - 1, qtyIndex).join(' ').trim();
    const qtyText = parts[qtyIndex].match(/\d+[,.]?\d*/)?.[0] || '1';
    const quantity = Math.max(1, Math.floor(Number(qtyText.replace(',', '.')) || 1));
    if (!article || !name || !articlePattern.test(article)) continue;
    if (/^(артикул|код|товар|найменування|наименование|кількість|количество)$/i.test(article)) continue;
    rows.push({ article, name, quantity });
  }
  const unique = [];
  const seen = new Set();
  for (const row of rows) {
    const key = row.article + '|' + row.name + '|' + row.quantity;
    if (!seen.has(key)) { seen.add(key); unique.push(row); }
  }
  return { supplier, receivedAt, rows: unique };
}

function install() {
  const form = document.getElementById('buybackForm');
  if (!form || document.getElementById('buybackInvoiceImport')) return;
  const panel = document.createElement('section');
  panel.id = 'buybackInvoiceImport';
  panel.style.cssText = 'margin:16px 0;padding:15px;border:1px solid #343b46;border-radius:10px;background:#191d23';
  panel.innerHTML = `
    <h3 style="margin:0 0 8px;font-size:15px">Импорт приходной накладной 1С</h3>
    <p style="margin:0 0 10px;color:#9da7b4;font-size:12px">Вставь скопированную печатную форму целиком. Проверь поставщика, дату и позиции перед добавлением.</p>
    <textarea id="buybackInvoiceText" rows="7" placeholder="Вставь сюда текст приходной накладной из 1С…" style="box-sizing:border-box;width:100%;resize:vertical;padding:10px;border:1px solid #3b4350;border-radius:7px;background:#101317;color:#f3f4f6;font:12px/1.5 monospace"></textarea>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">
      <button type="button" id="buybackInvoiceParse" style="border:0;border-radius:7px;padding:9px 13px;background:#35465d;color:white;font-weight:700">Разобрать накладную</button>
      <button type="button" id="buybackInvoiceSave" disabled style="border:0;border-radius:7px;padding:9px 13px;background:#2867dc;color:white;font-weight:700;opacity:.5">Добавить все позиции</button>
    </div>
    <div id="buybackInvoiceStatus" role="status" style="margin-top:10px;font-size:12px;color:#b5bec9"></div>
    <div id="buybackInvoicePreview" style="overflow:auto;margin-top:10px"></div>`;
  form.insertAdjacentElement('afterend', panel);
  let parsed = null;
  const status = panel.querySelector('#buybackInvoiceStatus');
  const save = panel.querySelector('#buybackInvoiceSave');
  const preview = panel.querySelector('#buybackInvoicePreview');
  panel.querySelector('#buybackInvoiceParse').addEventListener('click', () => {
    parsed = parseInvoice(panel.querySelector('#buybackInvoiceText').value);
    save.disabled = !parsed.rows.length || !parsed.receivedAt;
    save.style.opacity = save.disabled ? '.5' : '1';
    status.style.color = parsed.rows.length && parsed.receivedAt ? '#8ed6a3' : '#f0bd74';
    status.textContent = !parsed.rows.length ? 'Не удалось найти позиции. Убедись, что скопирована вся таблица с артикулами, наименованиями и количеством.' : !parsed.receivedAt ? 'Позиции найдены, но не распознана дата документа. Проверь заголовок накладной.' : `Найдено позиций: ${parsed.rows.length}. Поставщик: ${parsed.supplier || 'не распознан'} · Дата: ${parsed.receivedAt}. Проверь список ниже.`;
    preview.innerHTML = parsed.rows.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;padding:7px;border-bottom:1px solid #3b4350">Артикул</th><th style="text-align:left;padding:7px;border-bottom:1px solid #3b4350">Наименование</th><th style="text-align:right;padding:7px;border-bottom:1px solid #3b4350">Кол-во</th></tr></thead><tbody>${parsed.rows.map(r => `<tr><td style="padding:7px;border-bottom:1px solid #303640;white-space:nowrap">${esc(r.article)}</td><td style="padding:7px;border-bottom:1px solid #303640">${esc(r.name)}</td><td style="padding:7px;text-align:right;border-bottom:1px solid #303640">${r.quantity}</td></tr>`).join('')}</tbody></table>` : '';
  });
  save.addEventListener('click', async () => {
    if (!parsed?.rows.length || !parsed.receivedAt || !currentUser) {
      status.textContent = !currentUser ? 'Нет активной авторизации. Обнови страницу и войди заново.' : 'Сначала разбери накладную и проверь позиции.';
      return;
    }
    save.disabled = true;
    panel.querySelector('#buybackInvoiceParse').disabled = true;
    let added = 0;
    try {
      for (const row of parsed.rows) {
        await addDoc(collection(db, 'buybackItems'), {
          article: row.article, name: row.name, quantity: row.quantity,
          receivedAt: parsed.receivedAt, supplier: parsed.supplier, comment: '',
          createdAt: serverTimestamp(), createdBy: currentUser.uid,
          createdByName: currentUser.displayName || currentUser.email || 'Сотрудник',
          status: 'active', soldAt: null, cancelledAt: null, returnedAt: null,
          createdOn: new Date().toISOString().slice(0,10), sentMilestones: [], updatedAt: serverTimestamp()
        });
        added++;
      }
      status.style.color = '#8ed6a3';
      status.textContent = `Готово: добавлено ${added} позиций. Таймер хранения рассчитывается от даты приёма ${parsed.receivedAt}.`;
      preview.innerHTML = '';
      panel.querySelector('#buybackInvoiceText').value = '';
      parsed = null;
    } catch (error) {
      status.style.color = '#f0bd74';
      status.textContent = `Добавлено ${added} из ${parsed.rows.length}. Ошибка: ${error?.message || error}. Не запускай импорт повторно, пока не проверишь список перекупного товара.`;
    } finally {
      panel.querySelector('#buybackInvoiceParse').disabled = false;
      save.disabled = true;
      save.style.opacity = '.5';
    }
  });
}

const observer = new MutationObserver(() => install());
observer.observe(document.documentElement, { childList: true, subtree: true });
install();
