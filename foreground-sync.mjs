// Coordinate native resume, visibility and network events without reloading the
// page or replacing its listeners. Only a server snapshot confirms freshness.
export function createForegroundSync({reconnect,onStateChange,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 let active=false,visible=true,online=true,blocked=false,pending=false,hiddenAt=null;
 let lastResume=-Infinity,job=null,generation=0,showTimer=null,waitTimer=null,retryTimer=null;
 let status='idle';
 const emit=value=>{status=value;onStateChange(visible?value:'idle');};
 const clear=()=>{for(const timer of [showTimer,waitTimer,retryTimer])if(timer!==null)clearTimer(timer);showTimer=waitTimer=retryTimer=null;};
 function begin(){
  if(!active||blocked||!visible)return;
  if(!online){emit('offline');return;}
  if(pending&&waitTimer!==null)return;
  pending=true;clear();
  showTimer=setTimer(()=>{showTimer=null;if(pending)emit('syncing');},400);
  waitTimer=setTimer(()=>{waitTimer=null;if(pending){emit('waiting');scheduleRetry();}},10000);
 }
 function scheduleRetry(){
  if(retryTimer!==null||!active||!visible||!online||blocked)return;
  retryTimer=setTimer(()=>{retryTimer=null;void refresh();},15000);
 }
 function refresh(){
  if(!active||!visible||!online||blocked)return Promise.resolve();
  if(job)return job;
  begin();const token=generation;
  const task=Promise.resolve().then(reconnect).catch(()=>{
   if(token!==generation)return;
   clear();pending=true;emit(online?'waiting':'offline');scheduleRetry();
  }).finally(()=>{if(job===task)job=null;});
  job=task;return task;
 }
 return {
  start(){active=true;blocked=false;begin();},
  snapshot(metadata){
   if(!active||blocked)return;
   if(metadata.fromCache){begin();return;}
   if(metadata.hasPendingWrites)return;
   pending=false;clear();emit('idle');
  },
  fail(permanent=false){
   if(!active)return;
   clear();pending=true;blocked=permanent;emit(permanent?'blocked':online?'waiting':'offline');
   if(!permanent)scheduleRetry();
  },
  hide(){if(!visible)return;visible=false;hiddenAt=now();clear();onStateChange('idle');},
  resume({force=false,backgroundMs=0}={}){
   const hiddenFor=Math.max(Number(backgroundMs)||0,hiddenAt===null?0:now()-hiddenAt);
   visible=true;hiddenAt=null;
   if(!active||blocked)return;
   if(!online){emit('offline');return;}
   if(!force&&now()-lastResume<2000)return;
   if(force||hiddenFor>=10000||status==='waiting'||status==='offline'){lastResume=now();void refresh();}
   else if(pending)begin();
  },
  network(connected){
   const wasOnline=online;online=connected;
   if(!active)return;
   if(!online){clear();pending=true;emit('offline');}
   else if(!wasOnline)this.resume({force:true});
  },
  reset(){generation++;active=false;blocked=false;pending=false;job=null;lastResume=-Infinity;clear();emit('idle');},
  repaint(){onStateChange(visible?status:'idle');}
 };
}
