const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
let connection;
let queue = Promise.resolve();
function open() {
  if (!connection) connection = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Хранилище черновиков недоступно')); return; }
    const request = indexedDB.open('warehouse-drafts-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { connection = null; throw error; });
  return connection;
}
function serial(operation) {
  const next = queue.catch(() => {}).then(operation);
  queue = next;
  return next;
}
async function change(key, value, remove = false) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite');
    const store = transaction.objectStore('drafts');
    if (remove) store.delete(key); else store.put({savedAt: Date.now(), value}, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Не удалось сохранить черновик'));
  });
}
export function draftKey(userId, orderId, kind, replyId = '') {
  return JSON.stringify([String(userId), String(orderId), kind, String(replyId)]);
}
export const drafts = {
  put: (key, value) => serial(() => change(key, value)),
  remove: key => serial(() => change(key, null, true)),
  get: key => serial(async () => {
    const db = await open();
    const stored = await new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!stored) return null;
    if (Date.now() - stored.savedAt > MAX_AGE) { await change(key, null, true); return null; }
    return stored.value;
  })
};
