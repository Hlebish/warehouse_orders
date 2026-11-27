const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function client({ legacy = false, authorized = true, changeSession = false } = {}) {
  const source = readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const start = source.indexOf('const staffPasswordResetsInFlight=');
  const end = source.indexOf('\nasync function toggleStaff(', start);
  assert.ok(start >= 0 && end > start);
  const requests = [], notices = [], dialogs = [], handlers = {}, nodes = {};
  const control = { dataset: { action: 'reset-staff-password:employee' }, disabled: false, isConnected: true };
  const secret = 'Aa1!synthetic-test-password';
  const context = {
    canManageUsers: authorized,
    signedInUser: { uid: 'administrator', getIdToken: async () => 'synthetic-token' },
    document: { querySelectorAll: () => [control] },
    confirm: () => true,
    fetch: async (_url, request) => {
      const body = JSON.parse(request.body);
      requests.push(body);
      if (body.action === 'capabilities') return {
        ok: !legacy, status: legacy ? 400 : 200,
        json: async () => legacy ? { error: 'Valid employee uid required' } : { passwordMode: 'random-v1' }
      };
      if (changeSession) context.signedInUser = { uid: 'another-employee' };
      return { ok: true, json: async () => ({ ok: true, temporaryPassword: secret }) };
    },
    showModal: (...args) => dialogs.push(args),
    button: () => '',
    toast: message => notices.push(message),
    navigator: { clipboard: { writeText: async () => {} } },
    $: id => nodes[id] ||= { value: '', addEventListener: (event, fn) => { handlers[id + ':' + event] = fn; } }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return { context, requests, notices, dialogs, nodes, control, secret, source };
}

function bindDialogLifecycle(app) {
  Object.assign(app.context, {
    modal: { hidden: false }, orderReturnModalSnapshot: null, selectedId: null, modalHistoryEntry: false,
    generatorScreen: { close() {}, isOpen: () => false }, directChatOpenRequest: 0,
    persistOrderFormDraft() {}, persistOpenEntryDraft() {}, activeOrderFormDraft: null, activeEntryDraft: null,
    chatUnsubscribe: null, directChatUnsubscribe: null,
    clearArchiveLookup() {}, settleFullOrderHistory() {}, inspectionItems: { stop() {} }, foregroundDataSync: { reset() {} },
    serverEntriesLoaded: new Set(), directPhotoCache: new Map(), directPhotoRequests: new Map(), flushOrdersCache() {},
    ordersRetryTimer: null, profileUnsubscribe: null, ordersUnsubscribe: null, chatBadgeUnsubscribe: null,
    chatUnreadReceiptUnsubscribe: null, notificationsUnsubscribe: null, entryUnsubscribes: new Map(), defectEntryUnsubscribes: new Map(),
    serverCache: new Map(), state: { orders: [], notices: [] }
  });
  app.context.document.body = { classList: { remove() {} }, style: {} };
  const closeStart = app.source.indexOf('function closeModal('), closeEnd = app.source.indexOf('function button(', closeStart);
  const stopStart = app.source.indexOf('function stopCloud('), stopEnd = app.source.indexOf('\n', stopStart);
  assert.ok(closeStart >= 0 && closeEnd > closeStart && stopStart >= 0 && stopEnd > stopStart);
  vm.runInContext(app.source.slice(closeStart, closeEnd) + '\n' + app.source.slice(stopStart, stopEnd), app.context);
}

test('an older server is detected without resetting an employee to its shared password', async () => {
  const app = client({ legacy: true });
  await app.context.resetStaffPassword('employee');
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].action, 'capabilities');
  assert.equal(app.requests[0].uid, undefined);
  assert.equal(app.dialogs.length, 0);
  assert.match(app.notices[0], /серверную функцию/);
  assert.equal(app.control.disabled, false);
});
test('a generated password is displayed in its dedicated field and never in a toast', async () => {
  const app = client();
  await app.context.resetStaffPassword('employee');
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].passwordMode, 'random-v1');
  assert.equal(app.requests[1].uid, 'employee');
  assert.equal(app.nodes.staffTemporaryPassword.value, app.secret);
  assert.equal(app.dialogs.length, 1);
  assert.ok(!JSON.stringify(app.notices).includes(app.secret));
  assert.ok(!JSON.stringify(app.dialogs).includes(app.secret));
});
test('repeated activation while a reset is running does not create another password', async () => {
  const app = client();
  await Promise.all([app.context.resetStaffPassword('employee'), app.context.resetStaffPassword('employee')]);
  assert.equal(app.requests.length, 2);
  assert.equal(app.dialogs.length, 1);
  assert.equal(app.control.disabled, false);
});
test('a non-administrator cannot call the password endpoint', async () => {
  const app = client({ authorized: false });
  await app.context.resetStaffPassword('employee');
  assert.equal(app.requests.length, 0);
});
test('a response cannot reveal an administrator password reset to a different session', async () => {
  const app = client({ changeSession: true });
  await app.context.resetStaffPassword('employee');
  assert.equal(app.requests.length, 2);
  assert.equal(app.dialogs.length, 0);
  assert.ok(!JSON.stringify(app.notices).includes(app.secret));
});
test('closing the password dialog erases the secret from its retained DOM field', async () => {
  const app = client();
  await app.context.resetStaffPassword('employee');
  bindDialogLifecycle(app);
  app.context.closeModal();
  assert.equal(app.nodes.staffTemporaryPassword.value, '');
  assert.equal(app.context.modal.hidden, true);
});
test('authorization loss erases and closes the password dialog without restoring an earlier administrator dialog', async () => {
  const app = client();
  await app.context.resetStaffPassword('employee');
  bindDialogLifecycle(app);
  app.context.orderReturnModalSnapshot = { title: 'Earlier administrator dialog' };
  app.context.signedInUser = null;
  app.context.stopCloud();
  assert.equal(app.nodes.staffTemporaryPassword.value, '');
  assert.equal(app.context.modal.hidden, true);
  assert.equal(app.context.orderReturnModalSnapshot, null);
});
