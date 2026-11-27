import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhotoTransfer} from '../photo-transfer.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const ticks=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await Promise.resolve();}assert.fail('queued operation did not start');}
const photo=size=>new Blob(['x'.repeat(size)],{type:'image/jpeg'});

test('uploads the first ready photo while preparing the next, with bounded work and stable result order',async()=>{
 const files=Array.from({length:4},(_,id)=>({id})),preparing=new Map(),uploading=new Map(),blobs=new Map();
 let decoding=0,peakDecoding=0,network=0,peakNetwork=0;
 const pipeline=createPhotoTransfer({prepare:async file=>{
  decoding++;peakDecoding=Math.max(peakDecoding,decoding);
  const gate=deferred();preparing.set(file.id,gate);
  try{const blob=await gate.promise;blobs.set(file.id,blob);return blob;}finally{decoding--;}
 }});
 const work=pipeline.transfer(files,async(blob,index)=>{
  assert.equal(blob,blobs.get(index),'coordinator must pass the prepared Blob unchanged');
  network++;peakNetwork=Math.max(peakNetwork,network);
  const gate=deferred();uploading.set(index,gate);
  try{return await gate.promise;}finally{network--;}
 });
 await until(()=>preparing.has(0));preparing.get(0).resolve(photo(10));
 await until(()=>uploading.has(0)&&preparing.has(1));
 assert.equal(preparing.size,2,'first upload starts before the remaining photos have been prepared');
 preparing.get(1).resolve(photo(20));await until(()=>uploading.has(1)&&preparing.has(2));
 preparing.get(2).resolve(photo(30));await until(()=>preparing.has(3));preparing.get(3).resolve(photo(40));
 await ticks();assert.equal(uploading.size,2,'ready files wait for an available network slot');
 uploading.get(1).resolve('url-1');await until(()=>uploading.has(2));
 uploading.get(2).resolve('url-2');await until(()=>uploading.has(3));
 uploading.get(3).resolve('url-3');uploading.get(0).resolve('url-0');
 assert.deepEqual(await work,['url-0','url-1','url-2','url-3']);
 assert.equal(peakDecoding,1);assert.equal(peakNetwork,2);
});

test('multiple transfers and warm calls share the same preparation and network limits',async()=>{
 const files=Array.from({length:6},(_,id)=>({id})),attempts=new Map(),uploads=[];
 let decoding=0,peakDecoding=0,network=0,peakNetwork=0;
 const pipeline=createPhotoTransfer({prepare:async file=>{
  decoding++;peakDecoding=Math.max(peakDecoding,decoding);attempts.set(file.id,(attempts.get(file.id)||0)+1);
  await Promise.resolve();decoding--;return photo(file.id+1);
 }});
 const upload=group=>async(_blob,index)=>{
  network++;peakNetwork=Math.max(peakNetwork,network);
  const gate=deferred();uploads.push(gate);
  try{await gate.promise;return group+index;}finally{network--;}
 };
 const warm=pipeline.warm([files[0]]);
 const first=pipeline.transfer(files.slice(0,3),upload('a'));
 const second=pipeline.transfer(files.slice(3),upload('b'));
 await until(()=>uploads.length===2);
 assert.equal(network,2);
 for(let i=0;i<6;i++){await until(()=>uploads.length>i);uploads[i].resolve();await ticks();}
 assert.deepEqual(await first,['a0','a1','a2']);assert.deepEqual(await second,['b0','b1','b2']);await warm;
 assert.equal(peakDecoding,1);assert.equal(peakNetwork,2);
 assert.equal(attempts.size,6);assert.ok([...attempts.values()].every(count=>count===1));
});

test('previews, warming and sending reuse the same preparation promise and Blob',async()=>{
 const file={},gate=deferred(),blob=photo(100);let attempts=0,received;
 const pipeline=createPhotoTransfer({prepare:()=>{attempts++;return gate.promise;}});
 const first=pipeline.prepare(file),second=pipeline.prepare(file),warm=pipeline.warm([file]);
 assert.equal(first,second);
 const sending=pipeline.transfer([file],async value=>{received=value;return 'url';});
 gate.resolve(blob);await warm;assert.equal(await first,blob);assert.deepEqual(await sending,['url']);
 assert.equal(received,blob);assert.equal(attempts,1);assert.equal(await pipeline.prepare(file),blob);
});

test('failed warming is handled and evicted so an actual submission can retry decoding',async()=>{
 const file={};let attempts=0;
 const pipeline=createPhotoTransfer({prepare:async()=>{if(++attempts===1)throw Error('decode failed');return photo(10);}});
 await pipeline.warm([file]);
 assert.deepEqual(await pipeline.transfer([file],async()=> 'retried-url'),['retried-url']);
 assert.equal(attempts,2);
});

test('upload failure stops queued uploads and waits for all uploads already in flight',async()=>{
 const gates=[],firstError=Error('network failed');let settled=false;
 const pipeline=createPhotoTransfer({prepare:async()=>photo(10)});
 const work=pipeline.transfer(Array.from({length:5},()=>({})),()=>{const gate=deferred();gates.push(gate);return gate.promise;});
 work.then(()=>{settled=true;},()=>{settled=true;});
 const rejected=assert.rejects(work,error=>error===firstError);
 await until(()=>gates.length===2);gates[0].reject(firstError);await ticks();
 assert.equal(settled,false,'the other network request is still running');
 assert.equal(gates.length,2,'queued files must not start uploading after failure');
 gates[1].resolve('completed-in-flight');await rejected;
 assert.equal(settled,true);assert.equal(gates.length,2);
 assert.deepEqual(await pipeline.transfer([{}],async()=> 'next-attempt'),['next-attempt'],'failure must release shared network slots');
});

test('a preparation failure also waits for the first upload and prevents further uploads',async()=>{
 const files=[{id:0},{id:1},{id:2}],badDecode=deferred(),network=deferred();let uploads=0,settled=false;
 const pipeline=createPhotoTransfer({prepare:async file=>file.id===1?badDecode.promise:photo(10)});
 const work=pipeline.transfer(files,async()=>{uploads++;return network.promise;});
 work.then(()=>{settled=true;},()=>{settled=true;});
 const rejected=assert.rejects(work,/decode failed/);
 await until(()=>uploads===1);badDecode.reject(Error('decode failed'));await ticks();
 assert.equal(settled,false);assert.equal(uploads,1);
 network.resolve('in-flight-url');await rejected;assert.equal(uploads,1);
});

test('an upload failure waits for a preparation already running before rejecting',async()=>{
 const decoding=deferred(),uploading=deferred();let uploads=0,settled=false,secondStarted=false;
 const pipeline=createPhotoTransfer({prepare:async file=>{if(file.id){secondStarted=true;return decoding.promise;}return photo(10);}});
 const work=pipeline.transfer([{id:0},{id:1}],async()=>{uploads++;return uploading.promise;});
 work.then(()=>{settled=true;},()=>{settled=true;});
 const rejected=assert.rejects(work,/upload failed/);
 await until(()=>uploads===1&&secondStarted);uploading.reject(Error('upload failed'));await ticks();
 assert.equal(settled,false,'the running decode is still owned by this attempt');
 decoding.resolve(photo(20));await rejected;assert.equal(uploads,1);
});

test('progress counts known compressed sizes, stays monotonic and reaches 100 only after upload completion',async()=>{
 const files=[{id:0},{id:1}],secondDecode=deferred(),gates=[deferred(),deferred()],reports=[],progress=[];
 const pipeline=createPhotoTransfer({prepare:async file=>file.id?secondDecode.promise:photo(10)});
 const work=pipeline.transfer(files,(_blob,index,report)=>{reports[index]=report;return gates[index].promise;},{onProgress:state=>progress.push(state)});
 await until(()=>reports[0]);reports[0](5,10);
 assert.equal(progress.at(-1).bytesTransferred,5);assert.equal(progress.at(-1).percent,25);
 assert.equal(progress.at(-1).totalBytes,10);assert.equal(progress.at(-1).allPrepared,false);
 secondDecode.resolve(photo(100));await until(()=>reports[1]);
 assert.equal(progress.at(-1).percent,25);assert.equal(progress.at(-1).totalBytes,110);assert.equal(progress.at(-1).allPrepared,true);
 reports[0](2,10);assert.equal(progress.at(-1).bytesTransferred,5);
 reports[0](1000,10);gates[0].resolve('url-0');await ticks();
 reports[1](100,100);assert.ok(progress.at(-1).percent<100);
 gates[1].resolve('url-1');assert.deepEqual(await work,['url-0','url-1']);
 assert.deepEqual(progress.at(-1),{prepared:2,total:2,completed:2,bytesTransferred:110,totalBytes:110,allPrepared:true,percent:100});
 assert.ok(progress.every((state,index)=>!index||state.percent>=progress[index-1].percent));
 const count=progress.length;reports[1](0,100);assert.equal(progress.length,count,'late SDK progress must not change a settled transfer');
});

test('observer errors do not retry uploads or deadlock shared queues',async()=>{
 let calls=0;const pipeline=createPhotoTransfer({prepare:async()=>photo(3)});
 assert.deepEqual(await pipeline.transfer([{}],async()=>{calls++;return 'url';},{onProgress(){throw Error('render failed');}}),['url']);
 assert.deepEqual(await pipeline.transfer([{}],async()=>{calls++;return 'next';},{onProgress:async()=>{throw Error('async render failed');}}),['next']);
 assert.equal(calls,2);
});

test('rejects more than five photos before preparing or uploading anything',async()=>{
 let preparations=0,uploads=0;const pipeline=createPhotoTransfer({prepare:async()=>{preparations++;return photo(1);}});
 await assert.rejects(pipeline.transfer(Array.from({length:6},()=>({})),async()=>{uploads++;}),/пяти фотографий/);
 assert.equal(preparations,0);assert.equal(uploads,0);
 const progress=[];assert.deepEqual(await pipeline.transfer([],async()=>{}, {onProgress:value=>progress.push(value)}),[]);
 assert.equal(progress.at(-1).percent,100);
});
