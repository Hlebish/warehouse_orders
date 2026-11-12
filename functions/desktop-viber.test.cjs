const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(require.resolve('../desktop/main.cjs'),'utf8');
const opener=source.slice(source.indexOf('function openViberApp()'),source.indexOf('function notifyDesktopUpdateStatus('));
const handler=source.slice(source.indexOf("ipcMain.handle('warehouse:share-photo-to-viber'"),source.indexOf('let loadedAssetVersion'));

function harness({packaged=true,output='{"opened":true,"focused":true}',failure=null}={}){
 const calls=[];let receive;
 const webContents={mainFrame:{}};
 const context={app:{isPackaged:packaged},process:{platform:'win32',resourcesPath:'C:\\app\\resources',env:{SystemRoot:'C:\\Windows'}},
  __dirname:'C:\\repo\\desktop',path:path.win32,Buffer,console:{warn(){}},
  shell:{openExternal:()=>assert.fail('must not forward text or invoke Windows share UI')},
  execFile:(executable,args,options,callback)=>{calls.push({executable,args,options});callback(failure,output);},
  ipcMain:{handle:(_name,callback)=>{receive=callback;}},mainWindow:{webContents},
  nativeImage:{createFromBuffer:bytes=>({isEmpty:()=>!bytes.length})},
  clipboard:{writeImage:()=>calls.push('image')}
 };
 vm.createContext(context);vm.runInContext(opener+handler,context);
 return {calls,open:()=>context.openViberApp(),share:payload=>receive({sender:webContents,senderFrame:webContents.mainFrame},payload)};
}

test('Windows restores Viber through a packaged helper with no message or photo URL arguments',async()=>{
 const h=harness();const result=await h.open();assert.equal(result.focused,true);
 assert.equal(h.calls[0].args.at(-1),'C:\\app\\resources\\focus-viber.ps1');
 assert.equal(h.calls[0].options.windowsHide,true);
 assert.equal(h.calls[0].options.timeout,12000);
 assert.ok(h.calls[0].executable.endsWith('WindowsPowerShell\\v1.0\\powershell.exe'));
 assert.ok(!JSON.stringify(h.calls).includes('forward?text'));
});
test('development launches use the checked-in helper outside an asar archive',async()=>{
 const h=harness({packaged:false});await h.open();assert.equal(h.calls[0].args.at(-1),'C:\\repo\\desktop\\focus-viber.ps1');
});
test('the image is copied before foreground activation and copy-only never launches anything',async()=>{
 const h=harness();const result=await h.share({url:'data:image/png;base64,aW1hZ2U=',openViber:true,context:'PRIVATE COMMENT'});
 assert.equal(h.calls[0],'image');assert.equal(result.copied,true);assert.equal(result.viberOpened,true);assert.equal(result.viberFocused,true);
 assert.ok(!JSON.stringify(h.calls).includes('PRIVATE COMMENT'));
 h.calls.length=0;await h.share({url:'data:image/png;base64,aW1hZ2U=',openViber:false});assert.deepEqual(h.calls,['image']);
});
test('an activation failure preserves the copied photo and reports that Viber was not opened',async()=>{
 const h=harness({failure:Error('cannot launch')});const result=await h.share({url:'data:image/png;base64,aW1hZ2U='});
 assert.equal(result.copied,true);assert.equal(result.viberOpened,false);assert.equal(result.viberFocused,false);
});
test('a background Viber result is reported without claiming foreground success',async()=>{
 const h=harness({output:'{"opened":true,"focused":false}'});const result=await h.share({url:'data:image/png;base64,aW1hZ2U='});
 assert.equal(result.viberOpened,true);assert.equal(result.viberFocused,false);
});
test('helper packaging places the PowerShell file outside app.asar',()=>{
 const config=JSON.parse(fs.readFileSync(require.resolve('../desktop/package.json'),'utf8'));
 assert.ok(config.build.extraResources.some(item=>item.from==='focus-viber.ps1'&&item.to==='focus-viber.ps1'));
});
