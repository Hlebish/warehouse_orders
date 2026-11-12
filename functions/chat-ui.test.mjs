import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {validChatPhotos,chatDay,chatTime} from '../chat-ui.mjs';
const require=createRequire(import.meta.url),{directPushEventId}=require('./direct-push-id');
test('chat selection accepts camera images and rejects an oversized batch without silently dropping photos',()=>{
 const image={type:'image/jpeg',size:1000};
 assert.equal(validChatPhotos(Array(5).fill(image)),'');
 assert.match(validChatPhotos(Array(6).fill(image)),/пяти/);
 assert.match(validChatPhotos([{type:'application/pdf',size:10}]),/изображения/);
 assert.match(validChatPhotos([{type:'image/png',size:8*1024*1024+1}]),/8 МБ/);
});
test('chat dates accept both legacy string dates and Firestore timestamps',()=>{
 const value='2026-11-12T10:05:00Z',timestamp={toDate:()=>new Date(value)};
 assert.equal(chatDay(timestamp),chatDay(value));assert.equal(chatTime(timestamp),chatTime(value));assert.equal(chatTime(null),'…');
});
test('retries of a private-message notification retain the event identity and keep other messages distinct',()=>{
 const id=directPushEventId('a__b','message','a','b');
 assert.equal(directPushEventId('a__b','message','a','b'),id);
 for(const args of [['a__b','other','a','b'],['a__c','message','a','c'],['a__b','message','b','a']])assert.notEqual(directPushEventId(...args),id);
});
