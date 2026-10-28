const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('warehouseDesktop', {
  isDesktopApp: true,
  platform: process.platform
});
