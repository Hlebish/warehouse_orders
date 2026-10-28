const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warehouseDesktop', {
  isDesktopApp: true,
  platform: process.platform,
  showNotification(payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    ipcRenderer.send('warehouse:show-notification', {
      title: String(data.title || 'Заказы · Склад'),
      body: String(data.body || 'Новое изменение.'),
      link: String(data.link || '')
    });
  }
});
