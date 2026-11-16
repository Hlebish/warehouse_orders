import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStaffConversations} from '../staff-conversations.mjs';

const now=Date.UTC(2026,10,16,12);
const person=(uid,displayName=uid,patch={})=>({uid,displayName,roleLabel:'Кладовщик',active:true,...patch});
const thread=(id,peer,at=now,patch={})=>({id,participants:['me',peer],lastMessage:'Последнее сообщение',lastMessageAt:at,lastSenderId:peer,...patch});
const notice=(id,peer,at=now,patch={})=>({id,authorId:peer,directChatThreadId:'me__'+peer,directMessageId:'message-'+id,createdAt:at,message:'Личное сообщение',read:false,...patch});
const build=options=>buildStaffConversations({viewerId:'me',now,...options});

test('active contacts, participant threads and incoming notices form one reachable list without the viewer',()=>{
 const result=build({directory:[person('me'),person('alice','Алиса'),person('inactive','Бывший сотрудник',{active:false})],
  threads:[thread('legacy-bob','bob'),thread('inactive-thread','inactive'),
   thread('foreign','outsider',now,{participants:['other','outsider']}),
   thread('group','third',now,{participants:['me','third','fourth']}),
   thread('duplicate-viewer','me'),thread('empty-peer','')],
  notices:[notice('new','carol'),notice('disabled','inactive'),notice('own','me')]});
 assert.deepEqual(new Set(result.allItems.map(item=>item.uid)),new Set(['alice','bob','carol']));
 assert.equal(result.totalPeople,3);assert.equal(result.unreadTotal,1);
 const bob=result.allItems.find(item=>item.uid==='bob'),carol=result.allItems.find(item=>item.uid==='carol');
 assert.equal(bob.displayName,'Сотрудник');assert.equal(bob.threadId,'legacy-bob');
 assert.equal(carol.newestNotice.id,'new');assert.equal(carol.focusMessageId,'message-new');
});

test('one peer combines multiple threads while opening the exact newest unread notification',()=>{
 const directory=new Map([['alice',person('alice','Алиса')]]);
 const threads=new Map([
  ['old-pair',thread('old-pair','alice',now-5000,{lastMessage:'Старое сообщение'})],
  ['new-pair',thread('new-pair','alice',now,{lastMessage:'Последнее исходящее',lastSenderId:'me'})]
 ]);
 const old=notice('old','alice',now-4000,{directChatThreadId:'old-pair'});
 const latest=notice('latest','alice',now-2000,{directChatThreadId:'legacy-pair',directMessageId:'target-message'});
 const result=build({directory,threads,notices:[old,latest,notice('read','alice',now+1000,{read:true})]});
 assert.equal(result.allItems.length,1);
 const row=result.allItems[0];
 assert.equal(row.unreadCount,2);assert.equal(row.preview,'Вы: Последнее исходящее');
 assert.equal(row.lastActivity,now);assert.equal(row.threadId,'legacy-pair');
 assert.equal(row.focusMessageId,'target-message');assert.equal(row.newestNotice,latest);
});

test('numeric server fallback times and Firestore timestamp forms sort consistently',()=>{
 const result=build({directory:['numeric','millis','date','seconds'].map(uid=>person(uid)),threads:[
  thread('numeric-thread','numeric',now-4000),
  thread('millis-thread','millis',{toMillis:()=>now-1000}),
  thread('date-thread','date',{toDate:()=>new Date(now-3000)}),
  thread('seconds-thread','seconds',{seconds:(now-2000)/1000})
 ]});
 assert.deepEqual(result.items.map(item=>item.uid),['millis','seconds','date','numeric']);
 assert.deepEqual(result.items.map(item=>item.lastActivity),[now-1000,now-2000,now-3000,now-4000]);
});

test('duplicate message notifications count once and read, own or non-private notices do not count',()=>{
 const result=build({directory:[person('alice')],notices:[
  notice('first','alice',now,{directMessageId:'same-message',isUrgent:true}),
  notice('duplicate','alice',now,{directMessageId:'same-message',isUrgent:true}),
  notice('next','alice',now+1000),notice('read','alice',now,{read:true}),notice('own','me'),
  notice('general','alice',now,{directChatThreadId:''}),notice('missing-author','alice',now,{authorId:''})
 ]});
 assert.equal(result.unreadTotal,2);assert.equal(result.items[0].unreadCount,2);
 assert.equal(result.items[0].urgentCount,1);assert.equal(result.items[0].newestNotice.id,'next');
});

test('urgent peers precede unread peers, then recent conversations and alphabetical contacts',()=>{
 const result=build({directory:[person('anna','Анна'),person('boris','Борис'),person('recent','Свежая переписка'),
  person('unread','Непрочитанный'),person('urgent','Срочный')],
  threads:[thread('recent-thread','recent',now)],
  notices:[notice('normal','unread',now-1000),notice('critical','urgent',now-9000,{isUrgent:'true'})]});
 assert.deepEqual(result.items.map(item=>item.uid),['urgent','unread','recent','anna','boris']);
 for(const flag of [true,'true',1]){
  assert.equal(build({notices:[notice('urgent','alice',now,{isUrgent:flag})]}).items[0].urgentCount,1);
 }
});

test('presence expires at 45 seconds without discarding last-seen information',()=>{
 const presence=new Map([
  ['fresh',{active:true,updatedAt:now-44999,activity:'Печатает сообщение'}],
  ['expired',{active:true,updatedAt:now-45000}],
  ['offline',{active:false,updatedAt:now-5000}]
 ]);
 const result=build({directory:['fresh','expired','offline','unknown'].map(uid=>person(uid)),presence});
 const rows=new Map(result.items.map(item=>[item.uid,item]));
 assert.equal(result.onlineCount,1);assert.equal(rows.get('fresh').online,true);
 assert.equal(rows.get('fresh').activity,'Печатает сообщение');
 assert.equal(rows.get('expired').online,false);assert.equal(rows.get('expired').lastSeen,now-45000);
 assert.equal(rows.get('offline').online,false);assert.equal(rows.get('offline').lastSeen,now-5000);
 assert.equal(rows.get('unknown').online,false);assert.equal(rows.get('unknown').lastSeen,0);
});

test('search covers names, roles and message previews without changing totals',()=>{
 const options={directory:[person('alice','Алиса',{roleLabel:'Главный бухгалтер'}),person('bob','Борис')],
  threads:[thread('alice-thread','alice',now,{lastMessage:'Артикул ABC-123 готов'})],
  notices:[notice('incoming','bob',now-1000)],presence:new Map([['alice',{active:true,updatedAt:now}]])};
 for(const search of ['АЛИСА','главный  бухгалтер','abc-123']){
  const result=build({...options,search});
  assert.deepEqual(result.items.map(item=>item.uid),['alice']);
  assert.equal(result.unreadTotal,1);assert.equal(result.onlineCount,1);assert.equal(result.totalPeople,2);
  assert.equal(result.allItems.length,2);
 }
 const none=build({...options,search:'нет такого сотрудника'});
 assert.equal(none.items.length,0);assert.equal(none.totalPeople,2);assert.equal(none.unreadTotal,1);
});

test('unread filtering hides read contacts while preserving full roster counts and matching search',()=>{
 const options={directory:[person('alice','Алиса'),person('bob','Борис')],notices:[notice('incoming','bob')]};
 const unread=build({...options,unreadOnly:true});
 assert.deepEqual(unread.items.map(item=>item.uid),['bob']);assert.equal(unread.allItems.length,2);
 assert.equal(unread.totalPeople,2);assert.equal(unread.unreadTotal,1);
 assert.equal(build({...options,unreadOnly:true,search:'Алиса'}).items.length,0);
 assert.equal(build({...options,unreadOnly:true,search:'Борис'}).items.length,1);
});

test('a newer notification supplies preview and recency while an outgoing thread keeps its prefix',()=>{
 const directory=[person('alice'),person('bob')];
 const result=build({directory,threads:[thread('alice-thread','alice',now-1000,{lastMessage:'Старый текст'}),
  thread('bob-thread','bob',now,{lastMessage:'  Отправленное\nсообщение  ',lastSenderId:'me'})],
  notices:[notice('latest','alice',now+1000,{message:'  Новый\nвходящий текст  '})]});
 const rows=new Map(result.items.map(item=>[item.uid,item]));
 assert.equal(rows.get('alice').preview,'Новый входящий текст');assert.equal(rows.get('alice').lastActivity,now+1000);
 assert.equal(rows.get('bob').preview,'Вы: Отправленное сообщение');
});
