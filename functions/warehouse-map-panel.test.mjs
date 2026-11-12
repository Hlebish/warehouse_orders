import test from 'node:test';
import assert from 'node:assert/strict';
import {mapArticleQuery,warehouseMapUrl} from '../warehouse-map-panel.mjs';

test('map links retain every part of a spaced article and remove its product description',()=>{
 for(const [line,code] of [['FP 4819 311 Крыло','FP 4819 311'],['OPT BP-12485 Гальмівні колодки','OPT BP-12485'],['S BD S875 Гальмівні колодки','S BD S875'],['КН3755 280 Капот','КН3755 280'],['APAU1603-2 Фильтр','APAU1603-2'],['apau1603 Cabin filter','apau1603']]){
  assert.equal(mapArticleQuery(line),code);
  assert.equal(new URL(warehouseMapUrl(line)).searchParams.get('article'),code);
 }
 assert.equal(mapArticleQuery('  '),'');
});
