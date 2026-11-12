const test = require('node:test');
const assert = require('node:assert/strict');
const {resolveBuybackArticle, buybackArticleQuantities} = require('./buyback-articles');
const stock = new Set(['APHD4307','APHD43070','APHD4307A']);
test('imported descriptions do not prevent sale matching',()=>{
  assert.equal(resolveBuybackArticle('APHD4307 Капот Honda',stock),'APHD4307');
  assert.equal(resolveBuybackArticle('АР-HD 4307 Капот Honda',stock),'APHD4307');
});
test('different SKU lengths and suffixes stay distinct',()=>{
  assert.equal(resolveBuybackArticle('APHD43070 Капот',stock),'APHD43070');
  assert.equal(resolveBuybackArticle('APHD4307A Капот',stock),'APHD4307A');
  assert.notEqual(resolveBuybackArticle('APHD4307-A Капот',new Set(['APHD4307'])),'APHD4307');
  assert.notEqual(resolveBuybackArticle('APHD43070 Капот',new Set(['APHD4307'])),'APHD4307');
});
test('quantities aggregate plain and imported order lines for the same SKU',()=>{
  assert.equal(buybackArticleQuantities([{article:'APHD4307 Капот Honda',quantity:2},{article:'APHD4307',quantity:1}],stock).get('APHD4307'),3);
});
test('descriptions without a real inventory prefix never match',()=>{
  assert.notEqual(resolveBuybackArticle('Капот Honda APHD4307',stock),'APHD4307');
});

test('order 3109 screenshot: spaced OPT SKU matches without its Ukrainian description',()=>{
  const {normalizeBuybackArticle}=require('./buyback-articles');
  const inventoryCode=normalizeBuybackArticle('OPT BP-12485');
  const orderLine='OPT BP-12485 Гальмівні колодки дискові';
  assert.notEqual(normalizeBuybackArticle(orderLine),inventoryCode,'the previous whole-line comparison misses this item');
  assert.equal(resolveBuybackArticle(orderLine,new Set([inventoryCode])),inventoryCode);
  assert.notEqual(resolveBuybackArticle('OPT BP-124850 Гальмівні колодки дискові',new Set([inventoryCode])),inventoryCode);
});

test('order 3106 screenshot: multipart SKUs keep all numeric and letter segments',()=>{
  const {normalizeBuybackArticle}=require('./buyback-articles');
  const pairs=[['KH3755 280','Капот'],['FP 4819 311','Крило'],['FP 4819 R1-E','Фара передня'],['FP 4823 900-P','Бампер'],['FP 4819 203','Панель'],['FP 4819 210','Полоска пластикова']];
  const known=new Set(pairs.map(([code])=>normalizeBuybackArticle(code)));
  for(const [code,name] of pairs)assert.equal(resolveBuybackArticle(code+' '+name,known),normalizeBuybackArticle(code));
  assert.notEqual(resolveBuybackArticle('FP 4819 311 Крило',new Set(['FP4819210'])),'FP4819210');
});

test('removed defects exclude only their own position when SKUs repeat',()=>{
 const {buybackShippableArticles}=require('./buyback-articles');
 const lines=[{article:'A',quantity:1},{article:'A',quantity:2}];
 assert.deepEqual(buybackShippableArticles(lines,[{kind:'defect',decision:'Удалена из заказа',articleIndex:0}]),[lines[1]]);
 assert.deepEqual(buybackShippableArticles(lines,[{kind:'defect',decision:'Подтверждён',articleIndex:0}]),lines);
});
