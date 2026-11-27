import test from 'node:test';
import assert from 'node:assert/strict';
import {mapArticleQuery,warehouseMapUrl,validMapCells,warehouseMapPageUrl} from '../warehouse-map-panel.mjs';

test('map links retain every part of a spaced article and remove its product description',()=>{
 for(const [line,code] of [['FP 4819 311 Крыло','FP 4819 311'],['OPT BP-12485 Гальмівні колодки','OPT BP-12485'],['S BD S875 Гальмівні колодки','S BD S875'],['КН3755 280 Капот','КН3755 280'],['APAU1603-2 Фильтр','APAU1603-2'],['apau1603 Cabin filter','apau1603']]){
  assert.equal(mapArticleQuery(line),code);
  assert.equal(new URL(warehouseMapUrl(line)).searchParams.get('article'),code);
 }
 assert.equal(mapArticleQuery('  '),'');
});

test('3D links include exact valid storage cells and preserve article fallback',()=>{const url=new URL(warehouseMapUrl('FP 4819 311 Крыло',['S1-A-2','S3-K-7','S1-K-2','S3-K-7','invalid']));assert.equal(url.pathname,'/warehouse_orders_3d/');assert.equal(url.searchParams.get('article'),'FP 4819 311');assert.deepEqual(url.searchParams.getAll('cell'),['S1-A-2','S3-K-7']);assert.deepEqual(validMapCells(['S5-H-10','s2-a-1']),['S5-H-10','S2-A-1']);assert.deepEqual(new URL(warehouseMapUrl('APBM2802')).searchParams.getAll('cell'),[]);});

test('mobile 3D navigation uses a top-level map URL with validated return site and order id',()=>{const url=new URL(warehouseMapPageUrl('APBM2802',['S3-K-7'],'order-42','https://hlebish.github.io'));assert.equal(url.pathname,'/warehouse_orders_3d/');assert.equal(url.searchParams.get('cell'),'S3-K-7');assert.equal(url.searchParams.get('returnSite'),'github');assert.equal(url.searchParams.get('returnOrder'),'order-42');assert.equal(new URL(warehouseMapPageUrl('APBM2802',[],'x','https://sklad-18f38.web.app')).searchParams.get('returnSite'),'firebase');assert.equal(new URL(warehouseMapPageUrl('APBM2802',[],'x','https://evil.example')).searchParams.get('returnSite'),'github');});
