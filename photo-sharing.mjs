export function photoFile(blob,collage=false){return new File([blob],collage?'defect-collage.png':'photo.png',{type:'image/png'});}
export function canSharePhoto(file,nav){try{return typeof nav?.share==='function'&&(!nav.canShare||nav.canShare({files:[file]}));}catch{return false;}}
export function photoDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Не удалось подготовить фотографию.'));reader.readAsDataURL(file);});}
export async function deliverSharedPhoto(file,target,{native,desktop,nav,readDataUrl=photoDataUrl,openViber,notify=()=>{}}){
 if((target==='viber'&&native?.sharePhotoToViber)||(target==='apps'&&native?.sharePhoto)){if(file.size>20*1024*1024)throw new Error('Изображение больше 20 МБ. Скачайте его или выберите фотографии по отдельности.');}
 if(target==='viber'&&native?.sharePhotoToViber){native.sharePhotoToViber(await readDataUrl(file),'');notify('Выберите получателя в Viber и нажмите «Отправить».');return;}
 if(target==='apps'&&native?.sharePhoto){native.sharePhoto(await readDataUrl(file));return;}
 if((target==='viber'||target==='copy')&&desktop?.sharePhotoToViber){const result=await desktop.sharePhotoToViber(await readDataUrl(file),'',target==='viber');if(!result?.copied)throw new Error('Не удалось скопировать фото.');notify(target==='viber'?(result.viberOpened===false?'Фото скопировано. Откройте Viber, выберите чат и вставьте фото через Ctrl+V.':'Фото скопировано. В Viber выберите чат и вставьте его через Ctrl+V.'):'Фото скопировано.');return;}
 if(target!=='copy'&&canSharePhoto(file,nav)){await nav.share({files:[file]});return;}
 if(!nav?.clipboard?.write||typeof ClipboardItem==='undefined')throw new Error('В этом браузере отправка фото недоступна. Скачайте изображение и прикрепите его в нужном приложении.');
 await nav.clipboard.write([new ClipboardItem({'image/png':file})]);
 if(target==='viber'){openViber?.();notify('Фото скопировано. В Viber выберите чат и вставьте его через Ctrl+V.');}
 else notify('Фото скопировано.');
}
export function createPhotoSharing({prepare,notify=()=>{}}){
 let overlay=null,previousFocus=null,pendingBack=false;
 const remove=()=>{if(!overlay)return false;overlay.remove();overlay=null;if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});return true;};
 const close=()=>{if(!overlay)return pendingBack;remove();pendingBack=true;history.back();return true;};
 return {close,isOpen:()=>!!overlay,handlePopState(){if(pendingBack){pendingBack=false;return true;}return remove();},open(source){
  if(overlay||pendingBack)return;
  const collage=Array.isArray(source);previousFocus=document.activeElement;
  const panel=document.createElement('div');overlay=panel;panel.className='photo-share-overlay';
  const dialog=document.createElement('section');dialog.className='photo-share-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',collage?'Поделиться коллажем':'Поделиться фотографией');
  const head=document.createElement('header'),title=document.createElement('b'),cancel=document.createElement('button');title.textContent=collage?'Поделиться коллажем':'Поделиться фотографией';cancel.type='button';cancel.textContent='×';cancel.setAttribute('aria-label','Закрыть');cancel.addEventListener('click',close);head.append(title,cancel);
  const status=document.createElement('p');status.className='photo-share-status';status.setAttribute('role','status');status.textContent=collage?'Собираю коллаж из фотографий…':'Подготавливаю фотографию…';
  const actions=document.createElement('div');actions.className='photo-share-options';
  dialog.append(head,status,actions);panel.append(dialog);document.body.append(panel);history.pushState({...history.state,photoShare:true},'',location.href);cancel.focus();
  panel.addEventListener('click',event=>{if(event.target===panel)close();});
  panel.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const controls=[...panel.querySelectorAll('button:not(:disabled)')];const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});
  const add=(label,help,run)=>{const button=document.createElement('button');button.type='button';const name=document.createElement('b'),hint=document.createElement('span');name.textContent=label;hint.textContent=help;button.append(name,hint);button.addEventListener('click',async()=>{
   const controls=[...actions.querySelectorAll('button')];controls.forEach(node=>node.disabled=true);status.textContent='Открываю отправку…';
   try{await run();if(overlay===panel)close();}catch(error){if(error?.name==='AbortError'){if(overlay===panel)close();return;}if(panel.isConnected){status.textContent=error.message||'Не удалось открыть отправку. Попробуйте ещё раз.';controls.forEach(node=>node.disabled=false);}}
  });actions.append(button);};
  void prepare(source).then(blob=>{
   if(overlay!==panel)return;const file=photoFile(blob,collage),native=window.AndroidWarehouse,desktop=window.warehouseDesktop;
   status.textContent=collage?'Готово. В коллаже только фотографии.':'Выберите, куда отправить фото.';
   const send=target=>deliverSharedPhoto(file,target,{native,desktop,nav:navigator,notify,openViber:()=>{const link=document.createElement('a');link.href='viber://forward?text='+encodeURIComponent('Фото скопировано — вставьте его в чат');link.click();}});
   const direct=!!native?.sharePhotoToViber;
   add('Viber',direct?'Выбрать получателя и отправить фото':canSharePhoto(file,navigator)?'Выберите Viber в окне отправки':'Скопировать фото и открыть Viber',()=>send('viber'));
   if(native?.sharePhoto||canSharePhoto(file,navigator))add('Другие приложения','Открыть системное окно отправки',()=>send('apps'));
   if(desktop?.sharePhotoToViber||(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'))add('Скопировать фото','Вставить в сообщение из буфера обмена',()=>send('copy'));
   add('Скачать изображение',file.name,async()=>{const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);});
  }).catch(error=>{if(panel.isConnected)status.textContent=error.message||'Не удалось подготовить фото. Проверьте подключение.';});
 }};
}
export function photoShareButton(url){const button=document.createElement('button');button.type='button';button.className='photo-share-button';button.dataset.sharePhoto=url;button.textContent='↗ Поделиться';return button;}
export function decoratePhotoSharing(root){
 root?.querySelectorAll('img[data-photo],.chat-photo-grid img,.photo-grid img').forEach(img=>{
  if(img.closest('.shareable-photo'))return;
  const url=img.dataset.photo||img.closest('[data-photo]')?.dataset.photo||img.currentSrc||img.src;
  if(!url)return;
  if(img.closest('.order-photo-share')?.querySelector('[data-share-photo]'))return;
  const target=img.closest('button.chat-photo-open,a')||img,figure=document.createElement('figure');figure.className='shareable-photo';target.replaceWith(figure);figure.append(target,photoShareButton(url));
 });
}
