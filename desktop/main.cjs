const { app, BrowserWindow, Tray, Menu, nativeImage, shell, session, Notification, ipcMain } = require('electron');
const path = require('node:path');

const APP_URL = 'https://hlebish.github.io/warehouse_orders/';
const APP_ORIGIN = new URL(APP_URL).origin;
let mainWindow = null;
let tray = null;
let quitting = false;

app.setAppUserModelId('ua.amp.warehouseorders');
app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: ['--hidden'] });

function isGoogleAuthUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && (
      url.hostname === 'accounts.google.com' ||
      url.hostname === 'apis.google.com' ||
      url.hostname === 'sklad-18f38.firebaseapp.com' ||
      url.hostname === 'identitytoolkit.googleapis.com'
    );
  } catch {
    return false;
  }
}


ipcMain.on('warehouse:show-notification', (event, payload = {}) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  const title = String(payload.title || 'Заказы · Склад').slice(0, 160);
  const body = String(payload.body || 'Новое изменение.').slice(0, 1000);
  const link = String(payload.link || APP_URL);
  const safeLink = link.startsWith(APP_URL) ? link : APP_URL;
  if (!Notification.isSupported()) {
    if (mainWindow) mainWindow.webContents.send('warehouse:notification-fallback');
    return;
  }
  const notification = new Notification({ title, body, silent: false });
  notification.on('click', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
    if (safeLink !== APP_URL) mainWindow.loadURL(safeLink);
  });
  notification.show();
});

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
      // A persistent partition keeps Firebase's local auth/session data between launches.
      partition: 'persist:warehouse-orders',
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

  // OAuth needs its own in-app popup. All other off-site windows (including the
  // warehouse map) are opened in the user's default browser, never inside this app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || isGoogleAuthUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          title: 'Вход через Google',
          webPreferences: {
            partition: 'persist:warehouse-orders',
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        }
      };
    }
    if (url.startsWith(APP_URL)) return { action: 'allow' };
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Links navigated in the main window must not replace the warehouse UI.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(APP_URL)) return;
    event.preventDefault();
    if (url.startsWith('https://')) shell.openExternal(url);
  });
}

function createTray() {
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
  session.fromPartition('persist:warehouse-orders').setPermissionRequestHandler((webContents, permission, callback) => {
    callback(['notifications', 'audio', 'media'].includes(permission));
  });
  createWindow();
  createTray();
  app.on('activate', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* Keep the tray app alive on Windows. */ });
