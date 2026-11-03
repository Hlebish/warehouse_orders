const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warehouseDesktop', {
  isDesktopApp: true,
  platform: process.platform,
  showNotification(payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    ipcRenderer.send('warehouse:show-notification', {
      title: String(data.title || 'Заказы · Склад'),
      body: String(data.body || 'Новое изменение.'),
      link: String(data.link || ''),
      notificationTag: String(data.notificationTag || '')
    });
  },
  sharePhotoToViber(url, context) {
    return ipcRenderer.invoke('warehouse:share-photo-to-viber', {
      url: String(url || ''),
      context: String(context || '')
    });
  }
});
