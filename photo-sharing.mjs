export const VIBER_CHAT_URL='viber://chats';

export function photoFile(blob,collage=false){return new File([blob],collage?'defect-collage.png':'photo.png',{type:'image/png'});}
export function canSharePhoto(file,nav){try{return typeof nav?.share==='function'&&(!nav.canShare||nav.canShare({files:[file]}));}catch{return false;}}
export function isMobilePhotoSharing(nav){
 return nav?.userAgentData?.mobile===true||/Android|iPhone|iPad|iPod|Mobile/i.test(nav?.userAgent||'')||(/Macintosh/i.test(nav?.userAgent||'')&&nav?.maxTouchPoints>1);
}
export function photoDataUrl(file){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));
  reader.onerror=()=>reject(new Error('Не удалось подготовить фотографию.'));reader.readAsDataURL(file);
 });
}

export async function deliverSharedPhoto(file,target,{native,desktop,nav,readDataUrl=photoDataUrl,clipboardItem=globalThis.ClipboardItem,openViber,notify=()=>{}}){
 if((target==='viber'&&native?.sharePhotoToViber)||(target==='apps'&&native?.sharePhoto)){
  if(file.size>20*1024*1024)throw new Error('Изображение больше 20 МБ. Скачайте его или выберите фотографии по отдельности.');
 }
 if(target==='viber'&&native?.sharePhotoToViber){
  native.sharePhotoToViber(await readDataUrl(file),'');notify('Выберите получателя в Viber и нажмите «Отправить».');return;
 }
 if(target==='apps'&&native?.sharePhoto){native.sharePhoto(await readDataUrl(file));return;}
 if((target==='viber'||target==='copy')&&desktop?.sharePhotoToViber){
  // Older Windows clients launch a text-forwarding URI. Copy only until the
  // installed client explicitly supports opening Viber without a message.
  const launch=target==='viber'&&desktop.opensViberWithoutMessage===true;
  const result=await desktop.sharePhotoToViber(await readDataUrl(file),'',launch);
  if(!result?.copied)throw new Error('Не удалось скопировать фото.');
  if(target==='copy'){notify('Фото скопировано.');return;}
  const opened=launch&&result.viberOpened;
  const message=opened?(result.viberFocused===false?'Фото скопировано. Нажмите значок Viber на панели задач, выберите чат и вставьте фото через Ctrl+V.':'Фото скопировано. В Viber выберите чат, нажмите Ctrl+V и отправьте фото.'):'Фото скопировано. Откройте Viber, выберите чат, нажмите Ctrl+V и отправьте фото.';
  notify(message);return {manualPaste:true,message};
 }
 // The Viber button on a desktop browser must not open the Windows share
 // panel. Mobile Viber and explicit other-apps actions can use Web Share.
 if(target!=='copy'&&(target!=='viber'||isMobilePhotoSharing(nav))&&canSharePhoto(file,nav)){
  await nav.share({files:[file]});return;
 }
 if(!nav?.clipboard?.write||typeof clipboardItem!=='function')throw new Error('В этом браузере отправка фото недоступна. Скачайте изображение и прикрепите его в нужном приложении.');
 await nav.clipboard.write([new clipboardItem({'image/png':file})]);
 if(target==='viber'){
  try{await openViber?.();}catch{/* The image remains available for a manual paste. */}
  const message='Фото скопировано. В Viber откройте нужный чат, нажмите Ctrl+V и отправьте фото.';
  notify(message);return {manualPaste:true,message};
 }
 notify('Фото скопировано.');
}

export function createPhotoSharing({prepare,notify=()=>{}}){
 let overlay=null,previousFocus=null,pendingBack=false;
 const remove=()=>{
  if(!overlay)return false;overlay.remove();overlay=null;
  if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});return true;
 };
 const close=()=>{if(!overlay)return pendingBack;remove();pendingBack=true;history.back();return true;};
 return {
  close,isOpen:()=>!!overlay,
  handlePopState(){if(pendingBack){pendingBack=false;return true;}return remove();},
  open(source){
   if(overlay||pendingBack)return;
   const collage=Array.isArray(source);previousFocus=document.activeElement;
   const panel=document.createElement('div');overlay=panel;panel.className='photo-share-overlay';
   const dialog=document.createElement('section');dialog.className='photo-share-dialog';
   dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',collage?'Поделиться коллажем':'Поделиться фотографией');
   const head=document.createElement('header'),title=document.createElement('b'),cancel=document.createElement('button');
   title.textContent=collage?'Поделиться коллажем':'Поделиться фотографией';
   cancel.type='button';cancel.textContent='×';cancel.setAttribute('aria-label','Закрыть');cancel.addEventListener('click',close);head.append(title,cancel);
   const status=document.createElement('p');status.className='photo-share-status';status.setAttribute('role','status');
   status.textContent=collage?'Собираю коллаж из фотографий…':'Подготавливаю фотографию…';
   const actions=document.createElement('div');actions.className='photo-share-options';
   dialog.append(head,status,actions);panel.append(dialog);document.body.append(panel);
   history.pushState({...history.state,photoShare:true},'',location.href);cancel.focus();
   panel.addEventListener('click',event=>{if(event.target===panel)close();});
   panel.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...panel.querySelectorAll('button:not(:disabled),a[href]')],first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
   });
   let desktop,send;
   const label=(control,name,help)=>{
    const text=document.createElement('b'),hint=document.createElement('span');text.textContent=name;hint.textContent=help;control.append(text,hint);
   };
   const showPasteSteps=message=>{
    status.textContent=message;actions.replaceChildren();
    if(desktop?.opensViberWithoutMessage===true){
     add('Открыть Viber ещё раз','Выберите чат и вставьте фото через Ctrl+V',()=>send('viber'));
    }else if(!desktop){
     // This link provides a fresh click if clipboard permission delayed the
     // first protocol launch. It has no outgoing message or share-panel URL.
     const link=document.createElement('a');link.href=VIBER_CHAT_URL;
     label(link,'Открыть Viber','Выберите чат и вставьте фото через Ctrl+V');actions.append(link);
    }
    add('Скопировать фото ещё раз','Если буфер обмена уже изменился',async()=>{await send('copy');return {manualPaste:true,message};});
    add('Готово','Вернуться к заказу или чату',async()=>{});
    if(document.hasFocus())actions.firstElementChild?.focus();
   };
   const add=(name,help,run)=>{
    const button=document.createElement('button');button.type='button';label(button,name,help);
    button.addEventListener('click',async()=>{
     const controls=[...actions.querySelectorAll('button')];controls.forEach(node=>node.disabled=true);status.textContent='Подготавливаю отправку…';
     try{
      const result=await run();if(overlay!==panel)return;
      if(result?.manualPaste){showPasteSteps(result.message);return;}close();
     }catch(error){
      if(error?.name==='AbortError'){if(overlay===panel)close();return;}
      if(panel.isConnected){status.textContent=error.message||'Не удалось открыть отправку. Попробуйте ещё раз.';controls.forEach(node=>node.disabled=false);}
     }
    });actions.append(button);
   };
   void prepare(source).then(blob=>{
    if(overlay!==panel)return;
    const file=photoFile(blob,collage),native=window.AndroidWarehouse;desktop=window.warehouseDesktop;
    status.textContent=collage?'Готово. В коллаже только фотографии.':'Выберите, куда отправить фото.';
    send=target=>deliverSharedPhoto(file,target,{
     native,desktop,nav:navigator,notify,
     openViber:()=>{const link=document.createElement('a');link.href=VIBER_CHAT_URL;document.body.append(link);link.click();link.remove();}
    });
    const direct=!!native?.sharePhotoToViber,mobilePicker=isMobilePhotoSharing(navigator)&&canSharePhoto(file,navigator);
    add('Viber',direct?'Выбрать получателя и отправить фото':mobilePicker?'Выберите Viber в окне отправки':'Фото копируется. В чате Viber нажмите Ctrl+V, затем «Отправить»',()=>send('viber'));
    if(native?.sharePhoto||mobilePicker)add('Другие приложения','Открыть системное окно отправки',()=>send('apps'));
    if(desktop?.sharePhotoToViber||(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'))add('Скопировать фото','Вставить в сообщение из буфера обмена',()=>send('copy'));
    add('Скачать изображение',file.name,async()=>{
     const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
    });
   }).catch(error=>{if(panel.isConnected)status.textContent=error.message||'Не удалось подготовить фото. Проверьте подключение.';});
  }
 };
}

export function photoShareButton(url){
 const button=document.createElement('button');button.type='button';button.className='photo-share-button';button.dataset.sharePhoto=url;button.textContent='↗ Поделиться';return button;
}
export function decoratePhotoSharing(root){
 root?.querySelectorAll('img[data-photo],.chat-photo-grid img,.photo-grid img').forEach(img=>{
  if(img.closest('.shareable-photo'))return;
  const url=img.dataset.photo||img.closest('[data-photo]')?.dataset.photo||img.currentSrc||img.src;if(!url)return;
  if(img.closest('.order-photo-share')?.querySelector('[data-share-photo]'))return;
  const target=img.closest('button.chat-photo-open,a')||img,figure=document.createElement('figure');figure.className='shareable-photo';target.replaceWith(figure);figure.append(target,photoShareButton(url));
 });
}
