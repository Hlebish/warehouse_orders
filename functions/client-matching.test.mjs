import test from 'node:test';
import assert from 'node:assert/strict';
import {findClientCandidates,clientPhone,clientAddress} from '../client-directory.mjs';
test('offers multiple surname and abbreviated company matches without selecting one',()=>{
 const rows=[{id:'empty',name:'ФОП Коваленко Олександр'},{id:'one',name:'Коваленко Александр',phone:'+380 67 111 22 33'},{id:'two',name:'Коваленко О.',address:'ул. Центральная, 10'},{id:'other',name:'Мельник Игорь'}];
 const matches=findClientCandidates(rows,'ФОП Коваленко Олександр');
 assert.deepEqual(new Set(matches.map(x=>x.client.id)),new Set(['empty','one','two']));assert.equal(matches[0].hasContacts,true);
 const company=findClientCandidates([{id:'a',name:'Авто Сервіс',phone:'12345'}],'ТОВ «Авто-Сервіс»');assert.equal(company[0].client.id,'a');
});
test('matches aliases, phone formats and legacy contact fields, and excludes hidden records',()=>{
 const rows=[{id:'a',name:'Компания Альфа',aliases:['Магазин у Андрея'],telephone:'+380 (67) 123-45-67',deliveryAddress:'Проспект 12'},{id:'hidden',name:'Магазин у Андрея',hiddenFromDirectory:true},{id:'history:andrey',name:'Магазин у Андрея'}];
 assert.equal(findClientCandidates(rows,'Магазин у Андрея')[0].client.id,'a');
 assert.equal(findClientCandidates(rows,'0671234567')[0].client.id,'a');
 assert.equal(clientPhone(rows[0]),'+380 (67) 123-45-67');assert.equal(clientAddress(rows[0]),'Проспект 12');
 assert.equal(findClientCandidates(rows,'Совсем другой клиент').length,0);
});
test('manual search finds an entirely different name and short queries do not suggest everyone',()=>{
 const rows=[{id:'a',name:'Техно-Центр',address:'Адрес'}];assert.equal(findClientCandidates(rows,'Техно')[0].client.id,'a');assert.deepEqual(findClientCandidates(rows,'ФОП'),[]);assert.deepEqual(findClientCandidates(rows,''),[]);
 assert.deepEqual(findClientCandidates([{id:'a',name:'A',phones:['1234','5678']}],'3456'),[]);
});
