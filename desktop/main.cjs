const { app, BrowserWindow, Tray, Menu, nativeImage, shell, session, Notification, ipcMain, clipboard, net, powerMonitor } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

const APP_URL = 'https://hlebish.github.io/warehouse_orders/';
const APP_ORIGIN = new URL(APP_URL).origin;
let mainWindow = null;
let tray = null;
let quitting = false;
let updateDownloaded = false;
let updateAvailable = false;
let updateCheckInProgress = false;
let manualUpdateCheckPending = false;
let updateInstallScheduled = false;
let showingOfflinePage = false;
let offlineRetryTimer = null;
let offlineRetryInProgress = false;
let offlinePageLoading = false;
let mainPageLoadFailed = false;
const activeNotifications = new Map();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // The login-startup copy is deliberately hidden; a manual second launch
    // should raise the existing window instead of creating another process.
    if (commandLine.includes('--hidden')) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.setAppUserModelId('ua.amp.warehouseorders');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
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

function openViberApp(context = '') {
  // Viber rejects the bare `viber://` URI. Its documented forward action
  // accepts text and opens the contact picker, so keep the clipboard photo
  // ready for the user to paste into the selected chat.
  const caption = `Фото из Заказы · Склад${context ? ` · ${context}` : ''}. Фото скопировано — вставьте его в чате через Ctrl+V.`.slice(0, 190);
  const shareUrl = `viber://forward?text=${encodeURIComponent(caption)}`;
  if (process.platform !== 'win32') return shell.openExternal(shareUrl);

  const viberPaths = [
    path.join(process.env.LOCALAPPDATA || '', 'Viber', 'Viber.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Rakuten Viber', 'Viber.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Rakuten Viber', 'Viber.exe')
  ];
  const executable = viberPaths.find(candidate => candidate && fs.existsSync(candidate));
  if (!executable) throw new Error('Не удалось найти установленный Viber. Фото уже скопировано — открой Viber вручную и нажми Ctrl+V.');

  // Launch the registered share action so an existing Viber window comes to
  // the foreground with its recipient picker, instead of opening a blank URI.
  return shell.openExternal(shareUrl).then(() => true).catch(() => new Promise((resolve, reject) => {
    // Keep a reliable fallback for installations where the URI handler is not
    // registered; this at least raises Viber and leaves the image on clipboard.
    const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  }));
}

function notifyDesktopUpdateStatus(body) {
  if (Notification.isSupported()) {
    new Notification({ title: 'Заказы · Склад', body, silent: true }).show();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('warehouse:update-status', String(body || ''));
  }
}

async function checkForDesktopUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) notifyDesktopUpdateStatus('Автообновление работает только в установленном приложении.');
    return;
  }
  if (updateCheckInProgress) {
    if (manual) manualUpdateCheckPending = true;
    return;
  }
  if (updateAvailable || updateDownloaded) return;
  manualUpdateCheckPending = manual;
  updateCheckInProgress = true;
  refreshTrayMenu();
  try {
    // Use the updater without its default "install on exit" toast; our own
    // status is clearer and installation is gated by real system inactivity.
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.warn('[Warehouse Orders] Could not check desktop updates:', String(error?.message || error));
    if (manualUpdateCheckPending) notifyDesktopUpdateStatus('Не удалось проверить обновления: ' + String(error?.message || error));
    manualUpdateCheckPending = false;
  } finally {
    updateCheckInProgress = false;
    refreshTrayMenu();
  }
}

async function appIsAwayAndReadyForUpdate() {
  if (!mainWindow || mainWindow.isDestroyed()) return true;
  const windowIsInactive = !mainWindow.isVisible() || mainWindow.isMinimized() || !mainWindow.isFocused();
  // Losing focus alone is not enough: the employee may simply be working in
  // another program. Wait until Windows has seen no keyboard/mouse input.
  if (!windowIsInactive || powerMonitor.getSystemIdleTime() < 180 || mainWindow.webContents.isLoading()) return false;
  return mainWindow.webContents.executeJavaScript(`(() => {
    const modal = document.getElementById('modalBackdrop');
    const active = document.activeElement;
    const editing = active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable);
    return (!modal || modal.hidden) && !editing;
  })()`).catch(() => false);
}

async function installDownloadedUpdateWhenSafe() {
  if (!app.isPackaged || !updateDownloaded || updateInstallScheduled) return;
  if (!await appIsAwayAndReadyForUpdate()) return;
  updateInstallScheduled = true;
  setTimeout(async () => {
    updateInstallScheduled = false;
    if (!updateDownloaded || !await appIsAwayAndReadyForUpdate()) return;
    notifyDesktopUpdateStatus('Устанавливаем обновление в фоне. Приложение перезапустится.');
    quitting = true;
    // NSIS runs silently; reopen the app after installation completes.
    autoUpdater.quitAndInstall(true, true);
  }, 5000);
}

ipcMain.on('warehouse:show-notification', (event, payload = {}) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  const title = String(payload.title || 'Заказы · Склад').slice(0, 160);
  const body = String(payload.body || 'Новое изменение.').slice(0, 1000);
  const link = String(payload.link || APP_URL);
  const notificationTag = String(payload.notificationTag || '');
  const safeLink = link.startsWith(APP_URL) ? link : APP_URL;
  if (!Notification.isSupported()) {
    if (mainWindow) mainWindow.webContents.send('warehouse:notification-fallback');
    return;
  }
  const previous = notificationTag ? activeNotifications.get(notificationTag) : null;
  previous?.close();
  // The page plays the site's bundled MP3. Keep Windows' default notification
  // chime disabled so employees hear the same sound as in the website.
  const notification = new Notification({ title, body, silent: true });
  if (notificationTag) activeNotifications.set(notificationTag, notification);
  notification.on('close', () => {
    if (notificationTag && activeNotifications.get(notificationTag) === notification) activeNotifications.delete(notificationTag);
  });
  notification.on('click', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
    if (safeLink !== APP_URL) mainWindow.loadURL(safeLink);
  });
  notification.show();
});

ipcMain.handle('warehouse:share-photo-to-viber', async (event, payload = {}) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Запрос на передачу фото отклонён.');
  }

  const rawPhotoUrl = String(payload.url || '');
  let photo;
  const dataImage = rawPhotoUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z\d+/]+=*)$/i);
  if (dataImage) {
    photo = Buffer.from(dataImage[2], 'base64');
    if (!photo.length || photo.length > 25 * 1024 * 1024) throw new Error('Фото пустое или больше 25 МБ.');
  }

  let photoUrl;
  if (!photo) {
    try {
      photoUrl = new URL(rawPhotoUrl);
    } catch {
      throw new Error('Некорректная ссылка на фото.');
    }
    const allowedHosts = new Set(['firebasestorage.googleapis.com', 'storage.googleapis.com']);
    if (photoUrl.protocol !== 'https:' || !allowedHosts.has(photoUrl.hostname)) {
      throw new Error('Поддерживаются только фото из хранилища заказов.');
    }

    const response = await net.fetch(photoUrl.href, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Не удалось загрузить фото (HTTP ${response.status}).`);
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) throw new Error('Ссылка не вернула изображение.');
    const maxPhotoBytes = 25 * 1024 * 1024;
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxPhotoBytes) throw new Error('Фото больше 25 МБ.');
    photo = Buffer.from(await response.arrayBuffer());
    if (!photo.length || photo.length > maxPhotoBytes) throw new Error('Фото пустое или больше 25 МБ.');
  }
  const image = nativeImage.createFromBuffer(photo);
  if (image.isEmpty()) throw new Error('Не удалось прочитать файл изображения.');

  clipboard.writeImage(image);
  let viberOpened = false;
  if (payload.openViber !== false) {
    try {
      viberOpened = await openViberApp(String(payload.context || '').slice(0, 100));
    } catch (error) {
      console.warn('[Warehouse Orders] Could not open Viber:', String(error?.message || error));
    }
  }
  return { copied: true, viberOpened, context: String(payload.context || '').slice(0, 200) };
});

let loadedAssetVersion = '';
let checkingForSiteUpdates = false;

async function readPublishedAssetVersion() {
  const response = await fetch(APP_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Site check returned HTTP ${response.status}`);
  const html = await response.text();
  const appVersion = html.match(/app\.js\?v=([^"'&]+)/)?.[1] || '';
  const styleVersion = html.match(/styles\.css\?v=([^"'&]+)/)?.[1] || '';
  return `${appVersion}|${styleVersion}`;
}

async function checkForSiteUpdates() {
  if (!mainWindow || mainWindow.isDestroyed() || showingOfflinePage || mainWindow.webContents.isLoading() || checkingForSiteUpdates) return;
  checkingForSiteUpdates = true;
  try {
    const publishedVersion = await readPublishedAssetVersion();
    if (!loadedAssetVersion) {
      loadedAssetVersion = publishedVersion;
      return;
    }
    if (publishedVersion === loadedAssetVersion) return;

    // Never reload while the employee is editing a form or has an open modal;
    // retry on the next check so unsaved work is not discarded.
    const canReload = await mainWindow.webContents.executeJavaScript(`(() => {
      const modal = document.getElementById('modal');
      const active = document.activeElement;
      const editing = active && (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) ||
        active.isContentEditable
      );
      return (!modal || modal.hidden) && !editing;
    })()`).catch(() => false);

    if (canReload) {
      loadedAssetVersion = publishedVersion;
      mainWindow.webContents.reload();
    }
  } catch (error) {
    console.warn('[Warehouse Orders] Automatic update check failed:', String(error?.message || error));
  } finally {
    checkingForSiteUpdates = false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    // Open the main warehouse window maximized so it uses the full desktop area.
    autoHideMenuBar: true,
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

  mainWindow.maximize();
  mainWindow.webContents.on('console-message', (_event, details) => {
    if (details.level >= 2) console.warn('[Warehouse Orders renderer]', details.message);
  });
  mainWindow.webContents.on('did-start-loading', () => { mainPageLoadFailed = false; });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    console.error('[Warehouse Orders] Page load failed:', code, description, validatedURL);
    if (!isMainFrame || code === -3 || !String(validatedURL || '').startsWith(APP_URL)) return;
    mainPageLoadFailed = true;
    showOfflineStartupPage();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainPageLoadFailed && mainWindow?.webContents.getURL().startsWith(APP_URL)) {
      showingOfflinePage = false;
      if (offlineRetryTimer) clearInterval(offlineRetryTimer);
      offlineRetryTimer = null;
    }
  });
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

  mainWindow.loadURL(APP_URL).catch(error => {
    console.info('[Warehouse Orders] Initial page unavailable:', String(error?.message || error));
    showOfflineStartupPage();
  });
}

function showOfflineStartupPage() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showingOfflinePage = true;
  if (!offlineRetryTimer) offlineRetryTimer = setInterval(retryAppConnection, 5000);
  const currentUrl = mainWindow.webContents.getURL();
  if (offlinePageLoading || (currentUrl.startsWith('file:') && currentUrl.endsWith('/offline.html'))) return;
  offlinePageLoading = true;
  mainWindow.loadFile(path.join(__dirname, 'offline.html')).catch(error => {
    console.error('[Warehouse Orders] Could not show offline page:', String(error?.message || error));
  }).finally(() => { offlinePageLoading = false; });
}

async function retryAppConnection() {
  if (!showingOfflinePage || offlineRetryInProgress || !mainWindow || mainWindow.isDestroyed()) return;
  const target = mainWindow;
  offlineRetryInProgress = true;
  let navigationTimeout;
  target.webContents.send('warehouse:offline-status', 'Переподключаемся… Приложение откроется в этом окне.');
  try {
    const response = await net.fetch(APP_URL, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (target.isDestroyed() || target !== mainWindow) return;
    // Keep retrying until did-finish-load confirms successful site navigation.
    // Both a failed navigation and a hung WebView must return to the retry screen.
    await Promise.race([
      target.loadURL(APP_URL),
      new Promise((_, reject) => {
        navigationTimeout = setTimeout(() => reject(new Error('Превышено время загрузки приложения')), 20000);
      })
    ]);
  } catch (error) {
    if (target.isDestroyed() || target !== mainWindow) return;
    showOfflineStartupPage();
    console.info('[Warehouse Orders] Still waiting for network:', String(error?.message || error));
    target.webContents.send('warehouse:offline-status', 'Соединение пока не восстановлено. Повторяем попытки каждые 5 секунд.');
  } finally {
    if (navigationTimeout) clearTimeout(navigationTimeout);
    offlineRetryInProgress = false;
  }
}


function showTestNotification() {
  if (!Notification.isSupported()) {
    shell.openExternal('ms-settings:notifications');
    return;
  }
  const notification = new Notification({
    title: 'Заказы · Склад',
    body: 'Проверка уведомлений Windows. Если ты видишь это сообщение, системные уведомления работают.',
    silent: false
  });
  notification.show();
}

function refreshTrayMenu() {
  if (!tray) return;
  const updateAction = updateDownloaded
    ? { label: 'Обновление установится, когда приложение будет неактивно', enabled: false }
    : { label: updateAvailable ? 'Обновление скачивается…' : updateCheckInProgress ? 'Проверяем обновления…' : 'Проверить обновления', enabled: !updateAvailable && !updateCheckInProgress, click: () => checkForDesktopUpdates(true) };
  const items = [
    { label: 'Открыть заказы', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    updateAction,
    { label: 'Проверить уведомления Windows', click: () => showTestNotification() },
    { label: 'Перезагрузить приложение', click: () => { if (mainWindow) mainWindow.webContents.reload(); } },
    { type: 'separator' },
    { label: 'Выйти полностью', click: () => { quitting = true; app.quit(); } }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.ico');
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('Заказы · Склад — уведомления работают в фоне');
  refreshTrayMenu();
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  ipcMain.handle('warehouse:get-app-version', () => app.getVersion());
  ipcMain.on('warehouse:retry-app-connection', event => {
    if (mainWindow && event.sender === mainWindow.webContents) retryAppConnection();
  });
  session.fromPartition('persist:warehouse-orders').setPermissionRequestHandler((webContents, permission, callback) => {
    callback(['notifications', 'audio', 'media'].includes(permission));
  });
  createWindow();
  createTray();
  autoUpdater.autoDownload = true;
  // Updates are downloaded quietly; installation is scheduled for a safe,
  // unfocused moment and the NSIS installer runs without a wizard.
  // Never start the NSIS installer just because the app was closed normally.
  // Our explicit silent install runs only after the workstation is idle.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', error => {
    updateAvailable = false;
    console.warn('[Warehouse Orders] App update failed:', String(error?.message || error));
    if (manualUpdateCheckPending) notifyDesktopUpdateStatus('Не удалось проверить или загрузить обновление: ' + String(error?.message || error));
    manualUpdateCheckPending = false;
    refreshTrayMenu();
  });
  autoUpdater.on('update-not-available', () => {
    updateAvailable = false;
    if (manualUpdateCheckPending) notifyDesktopUpdateStatus('Обновлений нет. Установлена версия ' + app.getVersion() + '.');
    manualUpdateCheckPending = false;
    refreshTrayMenu();
  });
  autoUpdater.on('update-available', info => {
    updateAvailable = true;
    console.info('[Warehouse Orders] Desktop update available:', info.version);
    refreshTrayMenu();
    notifyDesktopUpdateStatus('Найдено обновление ' + info.version + '. Оно загружается в фоне.');
    manualUpdateCheckPending = false;
  });
  autoUpdater.on('update-downloaded', info => {
    updateAvailable = false;
    updateDownloaded = true;
    refreshTrayMenu();
    notifyDesktopUpdateStatus('Обновление ' + info.version + ' загружено. Оно установится в фоне, когда окном приложения не пользуются.');
    installDownloadedUpdateWhenSafe();
  });
  checkForDesktopUpdates();
  setInterval(checkForDesktopUpdates, 120000);
  setInterval(installDownloadedUpdateWhenSafe, 15000);
  // Check for published site changes every two minutes. Reloads are deferred while editing.
  mainWindow.webContents.once('did-finish-load', () => {
    readPublishedAssetVersion().then(version => { loadedAssetVersion = version; }).catch(error => {
      console.warn('[Warehouse Orders] Could not read initial site version:', String(error?.message || error));
    });
  });
  setInterval(checkForSiteUpdates, 120000);
  app.on('activate', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* Keep the tray app alive on Windows. */ });
