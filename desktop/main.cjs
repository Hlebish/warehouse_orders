const { app, BrowserWindow, Tray, Menu, nativeImage, shell, session } = require('electron');
const path = require('node:path');

const APP_URL = 'https://hlebish.github.io/warehouse_orders/';
let mainWindow = null;
let tray = null;
let quitting = false;

app.setAppUserModelId('ua.amp.warehouseorders');
app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: ['--hidden'] });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: !process.argv.includes('--hidden'),
    autoHideMenuBar: true,
    backgroundColor: '#0a111d',
    title: 'Заказы · Склад',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(APP_URL);
  mainWindow.on('close', event => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('page-title-updated', event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://hlebish.github.io/warehouse_orders/')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  // Use the standard application icon when no packaged icon is supplied.
  const image = nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setToolTip('Заказы · Склад — уведомления работают в фоне');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть заказы', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: 'Перезагрузить приложение', click: () => { if (mainWindow) mainWindow.webContents.reload(); } },
    { type: 'separator' },
    { label: 'Выйти полностью', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

app.whenReady().then(() => {
  // Keep app notifications enabled and let Chromium use the installed site's service worker.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(['notifications', 'audio', 'media'].includes(permission));
  });
  createWindow();
  createTray();
  app.on('activate', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', event => { /* Keep the tray app alive on Windows. */ });
