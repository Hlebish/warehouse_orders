const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMapArticle, lineContainsExactArticle, lookupArticleInMap } = require('./warehouse-map-lookup');

test('normalizes article codes without changing alphanumeric identity', () => {
  assert.equal(normalizeMapArticle(' ap-hd 4307 '), 'APHD4307');
});

test('matches a whole article token, not a longer neighboring code', () => {
  assert.equal(lineContainsExactArticle('APHD4307 — капот Honda', 'APHD4307'), true);
  assert.equal(lineContainsExactArticle('APHD43070 — капот Honda', 'APHD4307'), false);
  assert.equal(lineContainsExactArticle('AP-HD-4307 — капот Honda', 'APHD4307'), true);
  assert.equal(lineContainsExactArticle('Описание без артикула', 'APHD4307'), false);
});

test('returns every exact storage address and no inventory contents', () => {
  const cells = {
    S1: { A: { '1': 'APHD4307 — капот Honda\nAPBM1203 — крыло BMW' } },
    S5: { K: { '10': 'APHD4307 — второй экземпляр' } },
    S6: { A: { '1': 'APHD4307 — invalid street' } },
    S2: { Z: { '1': 'APHD4307 — invalid shelf' } }
  };
  const result = lookupArticleInMap(cells, {}, 'AP-HD-4307');
  assert.deepEqual(result.locations.map(x => x.address), ['S1-A-1', 'S5-K-10']);
  assert.equal(result.unaddressed, false);
  assert.equal(Object.hasOwn(result, 'content'), false);
});

test('lookup rejects longer neighboring codes and empty queries', () => {
  const cells = { S1: { A: { '1': 'APHD43070 — соседний артикул' } } };
  assert.deepEqual(lookupArticleInMap(cells, {}, 'APHD4307').locations, []);
  assert.deepEqual(lookupArticleInMap(cells, {}, '').locations, []);
  assert.equal(lineContainsExactArticle('APHD4307', ''), false);
});

test('flags an article in the unaddressed list', () => {
  const result = lookupArticleInMap({}, { item1: { article: 'AP-H D4307' } }, 'AP-H D4307');
  assert.deepEqual(result.locations, []);
  assert.equal(result.unaddressed, true);
});

const addresses = (cells, article) => lookupArticleInMap(cells, {}, article).locations.map(x => x.address);
const steel = 'APBM2802';
const aluminium = 'APBM2802A';
const separateCells = { S1: { A: { '1': steel + ' стальное крыло', '2': aluminium + ' алюминиевое крыло' } } };

test('steel and aluminium find only their own separate cells', () => {
  assert.deepEqual(addresses(separateCells, steel), ['S1-A-1']);
  assert.deepEqual(addresses(separateCells, aluminium), ['S1-A-2']);
});

test('both articles independently find a shared cell', () => {
  const cells = { S1: { A: { '3': steel + ' сталь\n' + aluminium + ' алюминий' } } };
  assert.deepEqual(addresses(cells, steel), ['S1-A-3']);
  assert.deepEqual(addresses(cells, aluminium), ['S1-A-3']);
});

test('unaddressed aluminium does not mark steel as unaddressed', () => {
  const cells = { S1: { A: { '1': steel } } };
  const unaddressed = { item: { article: 'ap-bm 28 02-a алюминий' } };
  assert.equal(lookupArticleInMap(cells, unaddressed, steel).unaddressed, false);
  assert.equal(lookupArticleInMap(cells, unaddressed, aluminium).unaddressed, true);
  assert.deepEqual(addresses(cells, aluminium), []);
});

test('separators, case and descriptions preserve exact AP code identity', () => {
  for (const value of ['ap-bm 28-02a Fender', 'AP BM 2802-A — крыло', 'APBM2802 A алюминий', 'APBM2802A']) {
    assert.equal(normalizeMapArticle(value), aluminium);
    assert.equal(lineContainsExactArticle(value, aluminium), true);
    assert.equal(lineContainsExactArticle(value, steel), false);
  }
  assert.equal(normalizeMapArticle('APBM 28 02 Steel wing'), steel);
  for (const line of ['APBM28020', 'APBM2802AB', 'APBM 2802-A2', 'APBM2802A0']) {
    assert.equal(lineContainsExactArticle(line, steel), false);
    assert.equal(lineContainsExactArticle(line, aluminium), false);
  }
  assert.equal(lineContainsExactArticle('APBM2802 — Aluminium description', aluminium), false);
  assert.equal(lineContainsExactArticle('APBM2802 — Aluminium description', steel), true);
  assert.equal(lineContainsExactArticle('FP 4819 311 Крыло', 'FP4819311'), true);
});

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function createLookupHandler(cells, unaddressed) {
  // Evaluate the actual HTTP handler with only authentication and database IO stubbed.
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const start = source.indexOf('exports.lookupWarehouseMapAddress = onRequest(');
  const end = source.indexOf('// Admin-only temporary password reset', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    exports: {}, onRequest: (_, handler) => handler,
    WAREHOUSE_MAP_ALLOWED_ORIGINS: new Set(), normalizeMapArticle, lookupArticleInMap,
    logger: { info() {}, error() {} },
    getAuth: () => ({ verifyIdToken: async () => ({ uid: 'fixture' }) }),
    db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ active: true }) }) }) }) },
    getWarehouseMapApp: () => ({}),
    getDatabase: () => ({ ref: () => ({ child: key => ({ get: async () => ({ exists: () => true, val: () => key === 'cells' ? cells : unaddressed }) }) }) })
  };
  vm.runInNewContext(source.slice(start, end), context);
  return async articles => {
    const req = { method: 'POST', body: { articles }, get: key => key === 'authorization' ? 'Bearer fixture' : '' };
    const res = { code: 0, body: null, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await context.exports.lookupWarehouseMapAddress(req, res);
    assert.equal(res.code, 200);
    return JSON.parse(JSON.stringify(res.body));
  };
}

test('real HTTP handler returns both articles and removes only equivalent duplicates', async () => {
  const lookup = createLookupHandler(separateCells, {});
  const result = await lookup([steel, aluminium, 'ap-bm 28 02-a Fender', 'AP BM 2802']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(x => [x.article, x.locations.map(y => y.address)]), [
    [steel, ['S1-A-1']], [aluminium, ['S1-A-2']]
  ]);
});

test('browser sends full articles and maps each HTTP response to the correct order line', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const start = source.indexOf('const WAREHOUSE_MAP_LOOKUP_URL=');
  const end = source.indexOf('async function loadWarehouseMapAddresses(', start);
  assert.ok(start >= 0 && end > start);
  const user = { getIdToken: async () => 'fixture' };
  const calls = [];
  const lookup = createLookupHandler({ S1: { A: { '1': steel } } }, { item: { article: aluminium } });
  const context = {
    auth: { currentUser: user }, console, setTimeout,
    fetch: async (_, request) => {
      const { articles } = JSON.parse(request.body);
      calls.push(articles);
      const data = await lookup(articles);
      return { ok: true, json: async () => data };
    }
  };
  vm.runInNewContext(source.slice(start, end), context);
  const alias = 'ap-bm 28 02-a Fender';
  const result = await context.lookupWarehouseMapAddresses([steel, aluminium, alias, steel]);
  assert.deepEqual(calls, [[steel, aluminium, alias]]);
  assert.equal(result.get(steel), '📍 S1-A-1');
  assert.equal(result.get(aluminium), '📦 Без адреса');
  assert.equal(result.get(alias), '📦 Без адреса');
});

test('leading product description does not hide an exact article', () => {
  const cells = { S1: { A: { '1': 'Крыло APBM2802', '2': 'Крыло ap-bm 28-02a алюминий', '3': 'Крыло APBM28020', '4': 'XAPBM2802' } } };
  assert.deepEqual(addresses(cells, steel), ['S1-A-1']);
  assert.deepEqual(addresses(cells, aluminium), ['S1-A-2']);
  assert.equal(normalizeMapArticle('Крыло APBM2802'), steel);
  assert.equal(lookupArticleInMap({}, { item: { article: 'Крыло APBM2802A' } }, steel).unaddressed, false);
});

test('year ranges remain description in cells, batch requests and client response mapping', async () => {
  const cells = { S1: { A: { '1': 'APBM2802 2020–2024', '2': 'Крыло APBM2802A 2020-2024', '3': 'APBM28020 2020–2024' } } };
  for (const range of ['2020–2024', '2020-2024', '2020 — 2024', '2020', '1999-2004']) {
    assert.equal(normalizeMapArticle('AP BM 28 02 ' + range), steel);
    assert.equal(normalizeMapArticle('APBM2802A ' + range), aluminium);
    assert.equal(lineContainsExactArticle('APBM2802A ' + range, steel), false);
  }
  assert.deepEqual(addresses(cells, steel), ['S1-A-1']);
  assert.deepEqual(addresses(cells, aluminium), ['S1-A-2']);
  assert.equal(lineContainsExactArticle('APBM28022020', steel), false);
  const lookup = createLookupHandler(cells, {});
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const start = source.indexOf('const WAREHOUSE_MAP_LOOKUP_URL=');
  const end = source.indexOf('async function loadWarehouseMapAddresses(', start);
  assert.ok(start >= 0 && end > start);
  const user = { getIdToken: async () => 'fixture' };
  const calls = [];
  const context = { auth: { currentUser: user }, console, setTimeout, fetch: async (_, req) => {
    const articles = JSON.parse(req.body).articles;
    calls.push(articles);
    return { ok: true, json: async () => lookup(articles) };
  } };
  vm.runInNewContext(source.slice(start, end), context);
  const inputs = ['Крыло APBM2802 2020–2024', 'APBM2802A 2020-2024', steel, aluminium];
  const response = await lookup(inputs);
  assert.deepEqual(response.results.map(x => x.locations.map(y => y.address)), [['S1-A-1'], ['S1-A-2']]);
  const result = await context.lookupWarehouseMapAddresses(inputs);
  assert.deepEqual(calls, [inputs]);
  assert.deepEqual(inputs.map(x => result.get(x)), ['📍 S1-A-1', '📍 S1-A-2', '📍 S1-A-1', '📍 S1-A-2']);
});
