const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

function importEndpoint() {
  const source = readFileSync(join(__dirname, 'index.js'), 'utf8');
  const start = source.indexOf('exports.import1COrder =');
  const end = source.indexOf('// Admin-only backfill', start);
  const limit = source.match(/const ORDER_ARTICLE_LIMIT = \d+;/)?.[0];
  assert.ok(start >= 0 && end > start && limit);
  const writes = [], exports = {};
  const context = {
    exports, onRequest: (_options, fn) => fn, oneCImportKey: { value: () => 'import-secret' },
    Timestamp: { fromDate: date => date }, FieldValue: { serverTimestamp: () => 'server-timestamp' },
    logger: { info() {}, error() {} },
    db: {
      collection: () => ({ doc: id => ({ id }) }),
      runTransaction: fn => fn({ get: async () => ({ exists: false }), create: (ref, data) => writes.push({ ref, data }) })
    }
  };
  vm.createContext(context);
  vm.runInContext(limit + '\n' + source.slice(start, end), context);
  return {
    writes,
    async call(count) {
      const req = { method: 'POST', get: () => 'import-secret', body: { number: '101', client: 'Клиент', articles: Array.from({ length: count }, (_, i) => ({ article: 'SKU-' + i, quantity: 1 })) } };
      const res = { code: 200, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await exports.import1COrder(req, res);
      return res;
    }
  };
}

test('1C import preserves all 101 and 500 order lines instead of truncating them', async () => {
  for (const count of [101, 500]) {
    const api = importEndpoint(), response = await api.call(count);
    assert.equal(response.code, 200);
    assert.equal(api.writes.length, 1);
    assert.equal(api.writes[0].data.articles.length, count);
    assert.equal(api.writes[0].data.articles.at(-1).article, 'SKU-' + (count - 1));
  }
});

test('1C import rejects empty and oversized orders before writing anything', async () => {
  for (const count of [0, 501]) {
    const api = importEndpoint(), response = await api.call(count);
    assert.equal(response.code, 400);
    assert.equal(api.writes.length, 0);
    assert.match(response.body.error, /between 1 and 500/);
  }
});
