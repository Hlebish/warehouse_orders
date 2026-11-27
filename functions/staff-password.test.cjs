const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { randomBytes } = require('node:crypto');

function endpoint({ actor = { active: true, admin: true }, target = { active: true }, authError, updateError } = {}) {
  const source = readFileSync(join(__dirname, 'index.js'), 'utf8');
  const start = source.indexOf('exports.setStaffTemporaryPassword =');
  const end = source.indexOf('/* Generator accounting:', start);
  assert.ok(start >= 0 && end > start);
  const updates = [], logs = [], verifications = [], exports = {};
  const auth = {
    async verifyIdToken(token, checkRevoked) {
      verifications.push({ token, checkRevoked });
      if (authError) throw authError;
      return { uid: 'administrator' };
    },
    async updateUser(uid, data) {
      updates.push({ uid, ...data });
      if (updateError) throw updateError;
    }
  };
  const context = {
    exports, randomBytes, onRequest: (_options, fn) => fn,
    require: name => {
      assert.equal(name, 'firebase-admin/auth');
      return { getAuth: () => auth };
    },
    db: { collection: name => {
      assert.equal(name, 'users');
      return { doc: uid => ({ get: async () => {
        const profile = uid === 'administrator' ? actor : target;
        return { exists: profile !== null, data: () => profile };
      } }) };
    } },
    logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return {
    updates, logs, verifications,
    async call({ token = 'admin-token', origin = 'https://hlebish.github.io', uid = 'employee', method = 'POST', action, passwordMode = 'random-v1' } = {}) {
      const headers = {};
      const req = { method, body: { uid, action, passwordMode }, get: key => ({ origin, authorization: token ? 'Bearer ' + token : '' })[key] };
      const res = { code: 200, headers, set(key, value) { headers[key] = value; return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
      await exports.setStaffTemporaryPassword(req, res);
      return res;
    }
  };
}

test('authorized resets issue distinct strong passwords only in the non-cacheable response', async () => {
  const api = endpoint();
  const first = await api.call(), second = await api.call();
  assert.equal(first.code, 200);
  assert.equal(first.body.ok, true);
  assert.match(first.body.temporaryPassword, /^Aa1![A-Za-z0-9_-]{20}$/);
  assert.notEqual(first.body.temporaryPassword, second.body.temporaryPassword);
  assert.equal(api.updates[0].uid, 'employee');
  assert.equal(api.updates[0].password, first.body.temporaryPassword);
  assert.equal(first.headers['Cache-Control'], 'no-store, max-age=0');
  assert.deepEqual(api.verifications[0], { token: 'admin-token', checkRevoked: true });
  assert.ok(!JSON.stringify(api.logs).includes(first.body.temporaryPassword));
});

test('unauthenticated, disabled and non-administrator callers cannot reset or retrieve a password', async () => {
  for (const [options, request, expected] of [
    [{}, { token: '' }, 401],
    [{ actor: { active: true, role: 'manager' } }, {}, 403],
    [{ actor: { active: false, admin: true } }, {}, 403],
    [{ actor: null }, {}, 403],
    [{ authError: Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' }) }, {}, 401],
    [{}, { origin: 'https://untrusted.example' }, 403]
  ]) {
    const api = endpoint(options), response = await api.call(request);
    assert.equal(response.code, expected);
    assert.equal(response.body.temporaryPassword, undefined);
    assert.equal(api.updates.length, 0);
  }
});

test('reset rejects self, missing or disabled target accounts without creating a secret', async () => {
  for (const [options, request, expected] of [
    [{}, { uid: 'administrator' }, 400],
    [{}, { uid: '' }, 400],
    [{ target: null }, {}, 404],
    [{ target: { active: false } }, {}, 400]
  ]) {
    const api = endpoint(options), response = await api.call(request);
    assert.equal(response.code, expected);
    assert.equal(response.body.temporaryPassword, undefined);
    assert.equal(api.updates.length, 0);
  }
});

test('failed password updates return no secret and omit SDK request details from logs', async () => {
  const api = endpoint({ updateError: Object.assign(new Error('sensitive request contents'), { code: 'auth/internal-error' }) });
  const response = await api.call();
  assert.equal(response.code, 500);
  assert.equal(response.body.temporaryPassword, undefined);
  assert.ok(!JSON.stringify(api.logs).includes('sensitive request contents'));
  assert.ok(!JSON.stringify(api.logs).includes(api.updates[0].password));
});

test('capability probe and outdated clients never change employee credentials', async () => {
  const api = endpoint();
  const capabilities = await api.call({ action: 'capabilities', uid: '' });
  assert.equal(capabilities.code, 200);
  assert.equal(capabilities.body.passwordMode, 'random-v1');
  assert.equal(capabilities.body.temporaryPassword, undefined);
  const outdated = await api.call({ passwordMode: '' });
  assert.equal(outdated.code, 409);
  assert.equal(api.updates.length, 0);
});
