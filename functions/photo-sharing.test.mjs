import test from 'node:test';
import assert from 'node:assert/strict';
import {photoFile,canSharePhoto,deliverSharedPhoto,VIBER_CHAT_URL} from '../photo-sharing.mjs';

const image=()=>photoFile(new Blob(['image bytes'],{type:'image/png'}));
const data='data:image/png;base64,aW1hZ2UgYnl0ZXM=';

test('Android receives the actual photo or collage with no caption or private comment',async()=>{
 const calls=[],file=photoFile(new Blob(['collage bytes']),true);
 await deliverSharedPhoto(file,'viber',{
  native:{sharePhotoToViber:(...args)=>calls.push(args)},
  readDataUrl:async received=>{assert.equal(received,file);return data;}
 });
 assert.deepEqual(calls,[[data,'']]);
 assert.equal(file.name,'defect-collage.png');
 assert.equal(file.type,'image/png');
});

test('Android other-apps action passes an image to the system picker',async()=>{
 const calls=[];
 await deliverSharedPhoto(image(),'apps',{
  native:{sharePhotoToViber:()=>assert.fail('Viber must not be forced'),sharePhoto:url=>calls.push(url)},
  readDataUrl:async()=>data
 });
 assert.deepEqual(calls,[data]);
});

test('browser sharing includes a file and never forwards message text or a Storage URL',async()=>{
 const calls=[],file=image();
 await deliverSharedPhoto(file,'viber',{nav:{userAgent:'Android',canShare:payload=>payload.files[0]===file,share:async payload=>calls.push(payload)}});
 assert.deepEqual(calls,[{files:[file]}]);
 assert.equal(file.name,'photo.png');
});

test('Windows copies the image and launches Viber only for the Viber action',async()=>{
 const calls=[],notices=[];
 const options={desktop:{opensViberWithoutMessage:true,sharePhotoToViber:async(...args)=>{calls.push(args);return {copied:true,viberOpened:true};}},readDataUrl:async()=>data,notify:text=>notices.push(text)};
 await deliverSharedPhoto(image(),'viber',options);
 await deliverSharedPhoto(image(),'copy',options);
 assert.deepEqual(calls,[[data,'',true],[data,'',false]]);
 assert.match(notices[0],/Ctrl\+V/);
 assert.equal(notices[1],'Фото скопировано.');
});

test('a failed copy leaves an error instead of claiming success',async()=>{
 await assert.rejects(deliverSharedPhoto(image(),'viber',{
  desktop:{sharePhotoToViber:async()=>({copied:false})},readDataUrl:async()=>data,
  notify:()=>assert.fail('must not claim success')
 }),/скопировать/);
});

test('missing Viber on Windows gives the manual launch instruction',async()=>{
 const notices=[];
 await deliverSharedPhoto(image(),'viber',{
  desktop:{sharePhotoToViber:async()=>({copied:true,viberOpened:false})},
  readDataUrl:async()=>data,notify:text=>notices.push(text)
 });
 assert.match(notices[0],/Откройте Viber/);
});

test('a collage over the Android limit is rejected before crossing the bridge',async()=>{
 await assert.rejects(deliverSharedPhoto({size:20*1024*1024+1},'viber',{
  native:{sharePhotoToViber:()=>assert.fail('must not send oversized image')},
  readDataUrl:async()=>assert.fail('must not allocate a base64 copy')
 }),/20 МБ/);
});

test('cancelled system sharing propagates cancellation without copying or opening Viber',async()=>{
 const error=new DOMException('Cancelled','AbortError');
 await assert.rejects(deliverSharedPhoto(image(),'apps',{
  nav:{share:async()=>{throw error;},canShare:()=>true,clipboard:{write:()=>assert.fail('cancel must not copy')}},
  openViber:()=>assert.fail('cancel must not open Viber')
 }),received=>received===error);
});

test('unsupported file sharing degrades safely even if canShare throws',()=>{
 assert.equal(canSharePhoto(image(),{share(){},canShare(){throw new TypeError('Unsupported');}}),false);
 assert.equal(canSharePhoto(image(),{}),false);
});

test('an older Windows client copies only and cannot launch the old text-forwarding flow',async()=>{
 const calls=[];
 await deliverSharedPhoto(image(),'viber',{
  desktop:{sharePhotoToViber:async(...args)=>{calls.push(args);return {copied:true,viberOpened:false};}},
  readDataUrl:async()=>data
 });
 assert.deepEqual(calls,[[data,'',false]]);
});

test('desktop-browser Viber bypasses the Windows share panel and copies PNG before opening Viber',async()=>{
 const calls=[],file=image();
 const result=await deliverSharedPhoto(file,'viber',{
  clipboardItem:class{constructor(items){this.items=items;}},
  nav:{userAgent:'Windows',canShare:()=>true,share:()=>assert.fail('must not open Windows share UI'),clipboard:{write:async items=>{assert.equal(items[0].items['image/png'],file);calls.push('image');}}},
  openViber:()=>calls.push('open')
 });
 assert.deepEqual(calls,['image','open']);
 assert.equal(result.manualPaste,true);
 assert.equal(VIBER_CHAT_URL,'viber://chats');
});

test('clipboard rejection does not open Viber with a missing photo',async()=>{
 await assert.rejects(deliverSharedPhoto(image(),'viber',{
  clipboardItem:class{constructor(items){this.items=items;}},
  nav:{clipboard:{write:async()=>{throw Error('Clipboard denied');}}},
  openViber:()=>assert.fail('must not open before a successful copy')
 }),/Clipboard denied/);
});
