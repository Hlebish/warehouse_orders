import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=source.indexOf('function presenceLastSeenLabel(');
const end=source.indexOf('async function loadStaffDirectory(',start);
assert.ok(start>=0&&end>start,'Presence helpers must exist in the app');

function harness(){
 let now=new Date(2026,10,16,12,0).getTime();
 class Clock extends Date{
  constructor(...args){super(...(args.length?args:[now]));}
  static now(){return now;}
 }
 const node=()=>{
  const classes=new Set();
  return {textContent:'',title:'',classes,classList:{toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name);}}};
 };
 const label=node(),dot=node(),presence=new Map(),accessed=[];
 const elements=new Map([['directChatPresence',label],['directChatPresenceDot',dot],['staffPresenceList',null],['staffPresenceRailAvatars',null]]);
 const context={Date:Clock,directChatTarget:{uid:'alice'},staffPresence:presence,$:id=>{
  accessed.push(id);
  assert.ok(elements.has(id),'Presence rendering must not access messages or composer: '+id);
  return elements.get(id);
 }};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return {context,label,dot,presence,elements,accessed,now:()=>now,advance:duration=>{now+=duration;},render:()=>context.renderDirectChatPresence(),refresh:()=>context.renderStaffPanel()};
}

test('an open chat changes from online to last seen when the lease expires without another snapshot',()=>{
 const h=harness();
 h.presence.set('alice',{active:true,updatedAt:h.now()});
 h.refresh();
 assert.equal(h.label.textContent,'В сети');assert.equal(h.label.title,'Сейчас в сети');
 assert.equal(h.label.classes.has('is-online'),true);assert.equal(h.dot.classes.has('is-online'),true);
 h.advance(44999);h.refresh();assert.equal(h.label.textContent,'В сети');
 h.advance(1);h.refresh();
 assert.equal(h.label.textContent,'Был(а) в сети сегодня в 12:00');assert.equal(h.label.title,'Не в сети');
 assert.equal(h.label.classes.has('is-online'),false);assert.equal(h.dot.classes.has('is-online'),false);
 // The refresh works even though the staff drawer elements are unavailable.
 assert.ok(h.accessed.includes('staffPresenceList'));
});

test('live presence changes and switching peers use current records instead of the opening person snapshot',()=>{
 const h=harness();
 h.context.directChatTarget={uid:'alice',online:false,lastSeen:1};
 h.presence.set('alice',{active:true,updatedAt:h.now()});h.render();assert.equal(h.label.textContent,'В сети');
 h.presence.set('alice',{active:false,updatedAt:new Date(2026,10,16,9,5).getTime()});h.refresh();
 assert.equal(h.label.textContent,'Был(а) в сети сегодня в 09:05');
 h.presence.set('bob',{active:true,updatedAt:h.now()});
 h.context.directChatTarget={uid:'bob',online:false};h.refresh();assert.equal(h.label.textContent,'В сети');
 h.context.directChatTarget={uid:'alice',online:true};h.refresh();
 assert.equal(h.label.textContent,'Был(а) в сети сегодня в 09:05');
});

test('offline header displays last visits today, yesterday and on an older date',()=>{
 const h=harness();
 for(const [time,expected] of [
  [new Date(2026,10,16,9,5).getTime(),'Был(а) в сети сегодня в 09:05'],
  [new Date(2026,10,15,18,30).getTime(),'Был(а) в сети вчера в 18:30'],
  [new Date(2026,9,30,8,15).getTime(),'Был(а) в сети 30.10.2026 в 08:15']
 ]){
  h.presence.set('alice',{active:true,updatedAt:time});h.render();
  assert.equal(h.label.textContent,expected);assert.equal(h.label.title,'Не в сети');
 }
});

test('missing presence does not invent a visit time or retain the previous online indicator',()=>{
 const h=harness();
 h.presence.set('alice',{active:true,updatedAt:h.now()});h.render();
 h.presence.delete('alice');h.refresh();
 assert.equal(h.label.textContent,'Последний визит неизвестен');assert.equal(h.label.title,'Не в сети');
 assert.equal(h.label.classes.has('is-online'),false);assert.equal(h.dot.classes.has('is-online'),false);
});

test('closed chats, a missing peer or an absent decorative dot do not affect other UI',()=>{
 const h=harness();
 h.elements.set('directChatPresence',null);assert.doesNotThrow(h.refresh);
 h.elements.set('directChatPresence',h.label);h.context.directChatTarget=null;assert.doesNotThrow(h.refresh);
 h.context.directChatTarget={uid:'alice'};h.elements.set('directChatPresenceDot',null);
 h.presence.set('alice',{active:true,updatedAt:h.now()});assert.doesNotThrow(h.refresh);
 assert.equal(h.label.textContent,'В сети');
 assert.equal(h.accessed.some(id=>/Messages|Input|Form/.test(id)),false);
});
