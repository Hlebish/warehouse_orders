# Заказы · Склад — Windows

This is a Windows desktop wrapper around the existing hosted Warehouse Orders app. It does not duplicate or migrate the Firebase database.

## Build locally
1. Install Node.js 22 or newer.
2. In this folder run `npm install`.
3. Run `npm start` for development or `npm run dist` to build the NSIS installer.

The installer is built automatically by GitHub Actions when desktop files change. Download the `warehouse-orders-windows-installer` artifact from the workflow run.

## Behavior
- Opens the current hosted app and keeps its existing Firebase login/data flow.
- Starts with Windows login.
- Closing the window hides it to the system tray; choose “Выйти полностью” to quit.
- Notifications require Windows notification permissions and an internet connection.

Note: the app wrapper does not guarantee audible custom sounds while the app is suspended or Windows Focus/Do Not Disturb is enabled. Verify notification sound behavior on the target PC before relying on it operationally.
