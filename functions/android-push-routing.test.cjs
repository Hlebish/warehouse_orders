const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'index.js'),'utf8');
const code=source.slice(source.indexOf('async function collectTokens('),source.indexOf('exports.import1COrder'));
function harness(settings={}){
 const tokens=[
 {token:'pc',installationId:'pc',appId:'warehouse_orders',updatedAt:'2026-11-24T12:00:00Z'},
 {token:'phone',installationId:'phone',appId:'warehouse_orders_android',updatedAt:'2026-11-24T11:00:00Z'},
 {token:'webview',installationId:'phone',appId:'warehouse_orders',updatedAt:'2026-11-24T11:59:00Z'}];
 const user={id:'recipient',exists:true,data:()=>({active:true,...settings}),ref:{collection:()=>({get:async()=>({docs:tokens.map(data=>({data:()=>data,ref:{}}))})})}};
 const db={collection:()=>({where:()=>({get:async()=>({docs:[user]})}),doc:()=>({get:async()=>user})})};
 const ctx={db,notificationCategoryEnabled:(s,c)=>s[c]!==false,canAccessBuybackProfile:()=>false};
 vm.createContext(ctx);vm.runInContext(code,ctx);return ctx.collectTokens;
}
test('group and direct reach Android and PC even with one-device preference',async()=>{
 const collect=harness();
 for(const args of [['chat','','sender'],['replies','recipient','sender',false,false,true]]){
  const tokens=await collect(...args);assert.deepEqual(Array.from(tokens,x=>x.token).sort(),['pc','phone']);
 }
});
test('order device preference and disabled group chat setting remain respected',async()=>{
 assert.deepEqual(Array.from(await harness()('orders','','sender'),x=>x.token),['pc']);
 assert.equal((await harness({notificationSettings:{chat:false}})('chat','','sender')).length,0);
 assert.equal((await harness()('chat','','sender',false,false,false,[],['recipient'])).length,0);
});
