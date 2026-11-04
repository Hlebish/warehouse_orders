const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('warehouseDesktop', {
  isDesktopApp: true,
  platform: process.platform,
  getAppVersion() {
    return ipcRenderer.invoke('warehouse:get-app-version');
  },
  onUpdateStatus(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, message) => callback(String(message || ''));
    ipcRenderer.on('warehouse:update-status', listener);
    return () => ipcRenderer.removeListener('warehouse:update-status', listener);
  },
  retryAppConnection() {
    ipcRenderer.send('warehouse:retry-app-connection');
  },
  onOfflineStatus(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, message) => callback(String(message || ''));
    ipcRenderer.on('warehouse:offline-status', listener);
    return () => ipcRenderer.removeListener('warehouse:offline-status', listener);
  },
  showNotification(payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    ipcRenderer.send('warehouse:show-notification', {
      title: String(data.title || 'Заказы · Склад'),
      body: String(data.body || 'Новое изменение.'),
      link: String(data.link || ''),
      notificationTag: String(data.notificationTag || '')
    });
  },
  sharePhotoToViber(url, context, openViber = true) {
    return ipcRenderer.invoke('warehouse:share-photo-to-viber', {
      url: String(url || ''),
      context: String(context || ''),
      openViber: openViber !== false
    });
  }
});
