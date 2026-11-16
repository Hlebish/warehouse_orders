import test from 'node:test';
import assert from 'node:assert/strict';
import {createDirectChatHistory} from '../direct-chat-history.mjs';

const message=(id,time,patch={})=>({id,createdAt:new Date(time*1000),text:'Сообщение '+id,...patch});
const ids=state=>state.messages.map(item=>item.id);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function harness(pages=[]){
 const calls=[],changes=[],errors=[];
 const history=createDirectChatHistory({loadPage:async cursor=>{calls.push(cursor);const next=pages.shift();if(next instanceof Error)throw next;return typeof next==='function'?next(cursor):next;},onChange:state=>changes.push(state),onError:error=>errors.push(error)});
 return {history,calls,changes,errors};
}

test('older pages append without duplicates and new recent windows retain messages that fell out of the limit',async()=>{
 const h=harness([{messages:[message('b',2),message('a',1)],cursor:'a',hasMore:false}]);
 h.history.updateRecent([message('d',4),message('c',3)],{cursor:'c',hasMore:true});
 await h.history.loadOlder();assert.deepEqual(h.calls,['c']);
 h.history.updateRecent([message('e',5),message('d',4,{text:'Изменённое'})]);
 assert.deepEqual(ids(h.history.getState()),['a','b','c','d','e']);
 assert.equal(h.history.getState().allMessages.find(item=>item.id==='d').text,'Изменённое');
 assert.equal(h.history.getState().hasMore,false);
});

test('server pagination can be seeded after an incomplete cache snapshot',async()=>{
 const h=harness([{messages:[message('a',1)],cursor:'a',hasMore:false}]);
 h.history.updateRecent([message('cached',3)]);
 assert.equal(h.history.getState().hasMore,true);
 h.history.updateRecent([message('server',2),message('a',1)],{cursor:'a',hasMore:false});
 await h.history.loadOlder();assert.deepEqual(h.calls,[]);
});

test('search scans all older pages, reports progress and matches articles and text without case sensitivity',async()=>{
 const h=harness([
  {messages:[message('b',2,{text:'Артикул AbC-42'})],cursor:'b',hasMore:true},
  {messages:[message('a',1,{text:'Ремень',article:'ABC-42'})],cursor:'a',hasMore:false}
 ]);
 h.history.updateRecent([message('c',3)],{cursor:'c',hasMore:true});
 await h.history.setSearch(' aBc-42 ');
 assert.deepEqual(h.calls,['c','b']);assert.deepEqual(ids(h.history.getState()),['a','b']);
 assert.equal(h.history.getState().searching,false);
 assert.ok(h.changes.some(state=>state.searching&&state.loading));
 await h.history.setSearch('');assert.deepEqual(ids(h.history.getState()),['a','b','c']);
});

test('clearing or changing search cancels its old scan without parallel fetches',async()=>{
 const request=deferred(),h=harness([()=>request.promise,{messages:[message('a',1,{text:'Новый запрос'})],cursor:'a',hasMore:false}]);
 h.history.updateRecent([message('c',3)],{cursor:'c',hasMore:true});
 const old=h.history.setSearch('старый');await settle();
 const cleared=h.history.setSearch('');
 request.resolve({messages:[message('b',2)],cursor:'b',hasMore:true});
 await Promise.all([old,cleared]);assert.deepEqual(h.calls,['c']);assert.equal(h.history.getState().searching,false);
 const next=h.history.setSearch('новый');await next;
 assert.deepEqual(h.calls,['c','b']);assert.deepEqual(ids(h.history.getState()),['a']);
});

test('a changed query shares its in-flight page and only the current query continues scanning',async()=>{
 const request=deferred(),h=harness([()=>request.promise,{messages:[message('a',1,{text:'Искомое'})],cursor:'a',hasMore:false}]);
 h.history.updateRecent([message('c',3)],{cursor:'c',hasMore:true});
 const first=h.history.setSearch('другой');await settle();const second=h.history.setSearch('искомое');
 request.resolve({messages:[message('b',2)],cursor:'b',hasMore:true});await Promise.all([first,second]);
 assert.deepEqual(h.calls,['c','b']);assert.deepEqual(ids(h.history.getState()),['a']);
});

test('manual loading, search and message focus share one request and can find a message beyond the recent window',async()=>{
 const request=deferred(),h=harness([()=>request.promise,{messages:[message('a',1)],cursor:'a',hasMore:false}]);
 h.history.updateRecent([message('c',3)],{cursor:'c',hasMore:true});
 const older=h.history.loadOlder(),focus=h.history.ensureMessage('a');await settle();
 assert.deepEqual(h.calls,['c']);request.resolve({messages:[message('b',2)],cursor:'b',hasMore:true});
 await older;assert.equal((await focus).id,'a');assert.deepEqual(h.calls,['c','b']);
 assert.equal(await h.history.ensureMessage('missing'),null);assert.deepEqual(h.calls,['c','b']);
});

test('a live edit received while an older page is loading cannot be replaced by its stale page copy',async()=>{
 const request=deferred(),h=harness([()=>request.promise]);
 h.history.updateRecent([message('b',2)],{cursor:'b',hasMore:true});const pending=h.history.loadOlder();await settle();
 h.history.updateRecent([message('b',2,{text:'Новый текст',readBy:['alice','bob']})]);
 request.resolve({messages:[message('b',2,{text:'Устаревший текст'}),message('a',1)],cursor:'a',hasMore:false});await pending;
 const saved=h.history.getState().allMessages.find(item=>item.id==='b');assert.equal(saved.text,'Новый текст');assert.deepEqual(saved.readBy,['alice','bob']);
});

test('ordering accepts dates, ISO strings and Firebase timestamps, with lexical IDs resolving equal dates',()=>{
 const h=harness();h.history.updateRecent([
  message('z',4,{createdAt:{toMillis:()=>3000}}),message('Z',4,{createdAt:{toDate:()=>new Date(3000)}}),
  message('b',2,{createdAt:'1970-01-01T00:00:02.000Z'}),message('a',1),message('pending',4,{createdAt:null})
 ],{hasMore:false});
 assert.deepEqual(ids(h.history.getState()),['a','b','Z','z','pending']);
});

test('a failed page preserves history and cursor and can be retried without reopening',async()=>{
 const h=harness([new Error('offline'),{messages:[message('a',1)],cursor:'a',hasMore:false}]);
 h.history.updateRecent([message('b',2)],{cursor:'b',hasMore:true});
 await h.history.setSearch('сообщение');assert.equal(h.history.getState().error.message,'offline');
 assert.equal(h.errors.length,1);assert.deepEqual(ids(h.history.getState()),['b']);
 await h.history.setSearch('сообщение');assert.deepEqual(h.calls,['b','b']);
 assert.deepEqual(ids(h.history.getState()),['a','b']);assert.equal(h.history.getState().error,null);
});

test('an empty or non-progressing page cannot cause an infinite history search',async()=>{
 const h=harness([{messages:[],cursor:'b',hasMore:true}]);h.history.updateRecent([message('b',2)],{cursor:'b',hasMore:true});
 await h.history.setSearch('missing');assert.equal(h.calls.length,1);assert.equal(h.history.getState().hasMore,false);
 const bad=harness([{messages:[message('b',2)],cursor:'b',hasMore:true}]);bad.history.updateRecent([message('b',2)],{cursor:'b',hasMore:true});
 await bad.history.setSearch('missing');assert.equal(bad.calls.length,1);assert.match(bad.history.getState().error.message,/продолжить/);
});

test('disposal stops future page requests and prevents pending results from updating the abandoned chat',async()=>{
 const request=deferred(),h=harness([()=>request.promise]);h.history.updateRecent([message('c',3)],{cursor:'c',hasMore:true});
 const search=h.history.setSearch('message');await settle();const changes=h.changes.length;
 h.history.dispose();request.resolve({messages:[message('b',2)],cursor:'b',hasMore:true});await search;
 await h.history.loadOlder();assert.deepEqual(h.calls,['c']);assert.equal(h.changes.length,changes);
 assert.equal(await h.history.ensureMessage('c'),null);
});
