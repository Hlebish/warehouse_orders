const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'index.js'),'utf8');
const code=source.slice(source.indexOf('async function collectTokens('),source.indexOf('exports.import1COrder'));
function harness(settings={},otherUsers=[],otherTokens=[]){
 const tokens=[
 {token:'pc',installationId:'pc',appId:'warehouse_orders',updatedAt:'2026-11-24T12:00:00Z'},
 {token:'phone',installationId:'phone',appId:'warehouse_orders_android',updatedAt:'2026-11-24T11:00:00Z'},
 {token:'webview',installationId:'phone',appId:'warehouse_orders',updatedAt:'2026-11-24T11:59:00Z'}];
 const profiles=[{id:'recipient',active:true,...settings},...otherUsers];
 const users=profiles.map(({id,...profile})=>({id,exists:true,data:()=>profile}));
 const registrations=[...tokens.map(data=>({uid:'recipient',...data})),...otherTokens].map(({uid,...data},i)=>({data:()=>data,ref:{path:'users/'+uid+'/pushTokens/'+i,parent:{parent:{id:uid}}}}));
 const db={collection:()=>({where:()=>({get:async()=>({docs:users.filter(user=>user.data().active)})}),doc:id=>({get:async()=>users.find(user=>user.id===id)||{exists:false}})}),collectionGroup:()=>({get:async()=>({docs:registrations})})};
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

test('ordinary own order and chat pushes never select any author device',async()=>{
 const collect=harness({},[{id:'sender',active:true}],[{uid:'sender',token:'mine',installationId:'mine',appId:'warehouse_orders_android',updatedAt:'2026-11-24T13:00:00Z'}]);
 for(const category of ['orders','assembly','defects','status','editing','comments','questions','decisions','chat','replies','likes']){
  const tokens=await collect(category,'','sender');
  assert.ok(tokens.length>0);
  assert.ok(tokens.every(t=>t.userId==='recipient'));
 }
 assert.equal((await collect('replies','sender','sender',false,false,true)).length,0);
 assert.deepEqual(Array.from(await collect('chat','sender','sender',true),t=>t.token),['mine']);
});
test('stale colleague registration cannot deliver a push to the author phone or browser',async()=>{
 const collect=harness({},[{id:'sender',active:true}],[
  {uid:'sender',token:'phone',installationId:'phone',appId:'warehouse_orders_android',updatedAt:'2026-11-24T13:00:00Z'},
  {uid:'sender',token:'new-pc',installationId:'pc',appId:'warehouse_orders',updatedAt:'2026-11-24T13:00:00Z'}
 ]);
 assert.equal((await collect('chat','','sender')).length,0);
 assert.equal((await collect('replies','recipient','sender',false,false,true)).length,0);
 assert.deepEqual(Array.from(await collect('chat','','recipient'),t=>t.token).sort(),['new-pc','phone']);
});
test('a newer colleague registration wins over an older author registration',async()=>{
 const collect=harness({},[{id:'sender',active:true}],[{uid:'sender',token:'phone',installationId:'phone',appId:'warehouse_orders_android',updatedAt:'2026-11-24T10:00:00Z'}]);
 assert.deepEqual(Array.from(await collect('chat','','sender'),t=>t.token).sort(),['pc','phone']);
});
test('ambiguous or inactive device ownership is not routed to a stale active account',async()=>{
 for(const owner of [{id:'other',active:true},{id:'other',active:false}]){
  const collect=harness({},[owner],[{uid:'other',token:'pc',installationId:'pc',appId:'warehouse_orders',updatedAt:owner.active?'2026-11-24T12:00:00Z':'2026-11-24T13:00:00Z'}]);
  assert.deepEqual(Array.from(await collect('chat','recipient','sender'),t=>t.token),['phone']);
 }
});
