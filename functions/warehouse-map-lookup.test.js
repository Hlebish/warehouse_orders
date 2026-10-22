const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMapArticle, lineContainsExactArticle, lookupArticleInMap } = require('./warehouse-map-lookup');

test('normalizes article codes without changing alphanumeric identity', () => {
  assert.equal(normalizeMapArticle(' ap-hd 4307 '), 'APHD4307');
});

test('matches a whole article token, not a longer neighboring code', () => {
  assert.equal(lineContainsExactArticle('APHD4307 — капот Honda', 'APHD4307'), true);
  assert.equal(lineContainsExactArticle('APHD43070 — капот Honda', 'APHD4307'), false);
  assert.equal(lineContainsExactArticle('Описание без артикула', 'APHD4307'), false);
});

test('returns every exact storage address and no inventory contents', () => {
  const cells = {
    S1: { A: { '1': 'APHD4307 — капот Honda\nAPBM1203 — крыло BMW' } },
    S5: { K: { '10': 'APHD4307 — второй экземпляр' } },
    S6: { A: { '1': 'APHD4307 — invalid street' } },
    S2: { Z: { '1': 'APHD4307 — invalid shelf' } }
  };
  const result = lookupArticleInMap(cells, {}, 'APHD4307');
  assert.deepEqual(result.locations.map(x => x.address), ['S1-A-1', 'S5-K-10']);
  assert.equal(result.unaddressed, false);
  assert.equal(Object.hasOwn(result, 'content'), false);
});

test('flags an article in the unaddressed list', () => {
  const result = lookupArticleInMap({}, { item1: { article: 'AP-H D4307' } }, 'APHD4307');
  assert.deepEqual(result.locations, []);
  assert.equal(result.unaddressed, true);
});
