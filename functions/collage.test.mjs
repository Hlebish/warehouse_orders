import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
test('a defect collage contains the photos without a text header',async()=>{
 const text=[],draws=[];const canvas={width:0,height:0,getContext:()=>({fillRect(){},fillText:value=>text.push(value),drawImage:(...args)=>draws.push(args)}),toBlob:callback=>callback(new Blob(['png'],{type:'image/png'}))};
 const context={document:{createElement:()=>canvas},fetchPhotoAsPng:async()=>new Blob(),createImageBitmap:async()=>({width:900,height:630,close(){}})};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('async function createDefectPhotoCollage('),source.indexOf('function openPhotoCollageTool(')),context);
 await context.createDefectPhotoCollage(['one','two']);assert.equal(text.length,0);assert.equal(draws.length,2);assert.equal(canvas.height,666);
 await context.createDefectPhotoCollage(['one','two'],'Клиент, выбранный вручную');assert.deepEqual(text,['Клиент, выбранный вручную']);
});
test('copying a defect photo group never forwards a private comment into the collage or Android caption',async()=>{
 const argumentsList=[],captions=[];
 const context={window:{},navigator:{userAgent:'Browser',clipboard:{write:async()=>{}}},ClipboardItem:class{constructor(data){this.data=data;}},createDefectPhotoCollage:async(...args)=>{argumentsList.push(args);return new Blob();},toast(){},console};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function copyPhotoGroup('),source.indexOf('async function copyPhotoToClipboard(')),context);
 await context.copyPhotoGroup(['a','b'],'Личный комментарий о дефекте');assert.equal(argumentsList[0].length,1);
 context.window.AndroidWarehouse={sharePhotosToViber:(_urls,caption)=>captions.push(caption)};await context.copyPhotoGroup(['a','b'],'Личный комментарий');assert.deepEqual(captions,['']);
});

test('the sidebar collage copies during the click and sends a generated PNG to Android',async()=>{
 const blob=new Blob(['png'],{type:'image/png'}),dataUrl='data:image/png;base64,cG5n';
 let finish,clipboardPayload,shared;
 const collage=new Promise(resolve=>{finish=resolve;});
 const context={
  modal:{dataset:{collageUrls:'["one","two"]'}},$:()=>({value:'Иван'}),toast(){},
  createDefectPhotoCollage:()=>collage,
  window:{AndroidWarehouse:{sharePhoto:data=>{shared=data;}}},
  navigator:{clipboard:{write:([item])=>{clipboardPayload=item.data['image/png'];return clipboardPayload;}}},
  ClipboardItem:class{constructor(data){this.data=data;}},
  photoDataUrl:async value=>{assert.equal(value,blob);return dataUrl;}
 };
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('async function exportPhotoCollage('),source.indexOf('function startBrowserPhotoCopy(')),context);
 const copy={dataset:{action:'copy-photo-collage'}},copying=context.exportPhotoCollage(copy);
 assert.equal(clipboardPayload,collage);
 assert.equal(copy.disabled,true);
 finish(blob);
 await copying;
 assert.equal(copy.disabled,false);
 const share={dataset:{action:'share-photo-collage'}};
 delete context.navigator.clipboard;
 await context.exportPhotoCollage(share);
 assert.equal(shared,dataUrl);
 assert.equal(share.disabled,false);
});
