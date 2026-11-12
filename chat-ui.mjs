export const PHOTO_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v13H4Z"/><circle cx="12" cy="13" r="4"/></svg>';
export const SEND_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14"/></svg>';
const ids=direct=>direct?{form:'directChatForm',input:'directChatInput',photos:'directChatPhotoInput',send:'directChatSend',preview:'directChatPhotoPreview',urgent:'directChatUrgent',status:'directChatStatus'}:{form:'chatForm',input:'chatInput',photos:'chatPhotoInput',send:'chatSendButton',preview:'chatPhotoPreview',urgent:'chatUrgent',status:'chatStatus'};
export function composerHtml(direct=false){
 const id=ids(direct);
 return `<form id="${id.form}" class="${direct?'direct-chat-form':'chat-form'} chat-composer">
 ${direct?'':'<div id="chatReplyPreview" class="chat-reply-preview" hidden></div>'}
 <div id="${id.preview}" class="chat-photo-preview" hidden></div>
 <div class="chat-composer-row"><button type="button" class="chat-photo-button" data-composer-photo aria-label="Прикрепить фото" title="Прикрепить фото">${PHOTO_ICON}</button><input id="${id.photos}" type="file" accept="image/*" multiple hidden>
 <div class="chat-input-wrap"><textarea id="${id.input}" maxlength="1000" rows="1" placeholder="${direct?'Личное сообщение…':'Сообщение в общий чат…'}" aria-label="Текст сообщения" autocomplete="off"></textarea>${direct?'':'<div id="chatMentionSuggestions" class="chat-mention-suggestions" hidden></div>'}</div>
 <button id="${id.send}" type="submit" class="chat-send-button" aria-label="Отправить сообщение" title="Отправить сообщение">${SEND_ICON}</button></div>
 <div class="chat-composer-tools"><label class="${direct?'direct-chat-urgent-toggle':'chat-urgent-toggle'}"><input id="${id.urgent}" type="checkbox"><span>Срочно</span></label><span class="chat-composer-hint">${direct?'До 5 фото · можно без текста':'@ — упоминание · до 5 фото'}</span></div>
 <p id="${id.status}" class="chat-composer-status" role="status" aria-live="polite" hidden></p>
 </form>`;
}
export function validChatPhotos(files){
 if(files.length>5)return 'Можно прикрепить до пяти фотографий.';
 if(files.some(file=>!file.type.startsWith('image/')||file.size>8*1024*1024))return 'Выберите изображения размером до 8 МБ каждое.';
 return '';
}
export function chatTime(value){const date=value?.toDate?.()||new Date(value||0);return Number.isFinite(date.getTime())&&date.getTime()>0?date.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):'…';}
export function chatDay(value){const date=value?.toDate?.()||new Date(value||0);return Number.isFinite(date.getTime())&&date.getTime()>0?date.toLocaleDateString('ru',{day:'numeric',month:'long',year:'numeric'}):'Сегодня';}
export function bindChatComposer(form,direct=false){
 const id=ids(direct),input=form.querySelector('textarea'),picker=form.querySelector('input[type="file"]'),preview=form.querySelector('#'+id.preview),status=form.querySelector('#'+id.status);
 let files=[],urls=[],busy=false;
 const release=()=>{urls.forEach(url=>URL.revokeObjectURL(url));urls=[];};
 const resize=()=>{input.style.height='auto';input.style.height=Math.min(112,Math.max(40,input.scrollHeight))+'px';};
 const setStatus=(message,error=false)=>{status.hidden=!message;status.textContent=message;status.classList.toggle('is-error',error);};
 const paint=()=>{
  release();preview.replaceChildren();preview.hidden=!files.length;
  files.forEach((file,index)=>{
   const item=document.createElement('span'),img=document.createElement('img'),remove=document.createElement('button');
   const url=URL.createObjectURL(file);urls.push(url);img.src=url;img.alt=file.name||'Фото '+(index+1);
   remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Убрать фото '+(index+1));remove.disabled=busy;
   remove.addEventListener('click',()=>{files.splice(index,1);paint();setStatus('');});item.append(img,remove);preview.append(item);
  });
 };
 const add=next=>{const combined=[...files,...next],error=validChatPhotos(combined);if(error){setStatus(error,true);return;}files=combined;paint();setStatus('');};
 picker.addEventListener('change',()=>{if(!busy)add([...picker.files]);picker.value='';});
 form.querySelector('[data-composer-photo]').addEventListener('click',()=>picker.click());
 input.addEventListener('paste',event=>{const images=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(images.length){event.preventDefault();if(!busy)add(images);}});
 input.addEventListener('input',resize);resize();
 const observer=new MutationObserver(()=>{if(!form.isConnected){release();observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});
 return {getFiles:()=>[...files],setStatus,setBusy(value){busy=value;form.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=value);form.setAttribute('aria-busy',String(value));},clear(){files=[];input.value='';paint();resize();},isBusy:()=>busy};
}
