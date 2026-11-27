export function mapArticleQuery(value) {
  const parts = String(value || '').normalize('NFKC').trim().split(/\s+/).filter(Boolean);
  const code = [];
  for (const part of parts) {
    if (code.length && !/\d/.test(part) && !/^[A-ZА-ЯІЇЄҐ]{1,4}$/u.test(part)) break;
    code.push(part);
  }
  return code.join(' ');
}
export function validMapCells(addresses = []) {
  return [...new Set((Array.isArray(addresses)?addresses:[]).map(v=>String(v||'').trim().toUpperCase()).filter(v=>/^S[1-5]-[A-HJK]-(?:[1-9]|10)$/.test(v)&&!/^S1-[FGHJK]-/.test(v)))];
}
export function warehouseMapUrl(article, addresses = []) {
  return 'https://hlebish.github.io/warehouse_orders_3d/?article=' + encodeURIComponent(mapArticleQuery(article)) + validMapCells(addresses).map(cell=>'&cell='+encodeURIComponent(cell)).join('');
}
export function createWarehouseMapPanel() {
  let panel = null, previousFocus = null, previousOverflow = '', pendingBack = false;
  function remove() {
    if (!panel) return false;
    panel.querySelector('iframe').src = 'about:blank';
    panel.remove(); panel = null;
    document.body.style.overflow = previousOverflow;
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
    return true;
  }
  function close() {
    if (!panel) return pendingBack;
    // Destroy the frame before traversing history: the map installs its own
    // popup guards, which must not intercept a return to the order.
    remove(); pendingBack = true; history.back();
    return true;
  }
  return {
    isOpen: () => panel !== null,
    close,
    handlePopState() { if (pendingBack) { pendingBack = false; return true; } return remove(); },
    open(article, orderNumber = '', addresses = []) {
      if (!mapArticleQuery(article)) return;
      if (panel) { panel.querySelector('iframe').src = warehouseMapUrl(article, addresses); return; }
      previousFocus = document.activeElement;
      previousOverflow = document.body.style.overflow;
      panel = document.createElement('section');
      panel.className = 'warehouse-map-panel';
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Карта склада 3D');
      const header = document.createElement('header');
      const back = document.createElement('button'); back.type = 'button';
      back.textContent = '← К заказу' + (orderNumber ? ' № ' + orderNumber : '');
      back.addEventListener('click', close);
      const title = document.createElement('span'); title.textContent = 'Карта склада 3D';
      header.append(back, title);
      const frame = document.createElement('iframe');
      frame.title = 'Карта склада 3D: ' + mapArticleQuery(article); frame.src = warehouseMapUrl(article, addresses);
      frame.addEventListener('load', () => {
        try {
          frame.contentWindow.addEventListener('popstate', () => { if (panel?.contains(frame)) close(); });
        } catch { /* Native Back and the visible button also work across origins. */ }
      });
      panel.append(header, frame); document.body.append(panel);
      document.body.style.overflow = 'hidden';
      history.pushState({...history.state, warehouseMapPanel: true}, '', location.href);
      back.focus({preventScroll: true});
    }
  };
}
