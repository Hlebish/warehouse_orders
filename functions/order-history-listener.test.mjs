import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('the entries listener refreshes the chronology once when cached history is confirmed by the server',()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const start=source.indexOf('function watchOrderEntries('),end=source.indexOf('async function openPendingNotificationOrder(',start);
 let callback,rendered=0;
 const context={db:{},entryUnsubscribes:new Map(),serverEntriesLoaded:new Set(),state:{orders:[{id:'o',entries:[]}]},
  collection:()=>({}),onSnapshot(_ref,options,listener){assert.equal(options.includeMetadataChanges,true);callback=listener;return ()=>{};},
  serverCache:new Map(),saveOrdersCache(){},scheduleRender(){},initialCloudLoad:true,selectedId:'o',modal:{hidden:false,dataset:{orderDetail:'o'}},
  openOrder(){rendered++;},toast(){},entryFromCloud:(id,data)=>({id,...data}),asDate:value=>new Date(value)
 };
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);context.watchOrderEntries('o');
 callback({docs:[],metadata:{fromCache:true}});assert.equal(rendered,1);assert.equal(context.serverEntriesLoaded.has('o'),false);
 callback({docs:[],metadata:{fromCache:false}});assert.equal(rendered,2);assert.equal(context.serverEntriesLoaded.has('o'),true);
 callback({docs:[],metadata:{fromCache:false}});assert.equal(rendered,2);
});
