// Set only after the fixed-price server has HTTPS and passes the live checks.
export const FIXED_RELAY_URL='';
export function subscribeFixedState(url,onState,onStatus=()=>{}){
  const address=new URL(url);
  if(address.protocol!=='https:')throw Error('La sincronizzazione richiede HTTPS.');
  const events=new EventSource(new URL('/events',address));
  let state=null;
  events.addEventListener('state',event=>{
    try{state=JSON.parse(event.data);onState(state);onStatus('Sincronizzazione collegata.');}
    catch{onStatus('Errore ricezione programma.');}
  });
  events.addEventListener('progress',event=>{
    try{
      const change=JSON.parse(event.data);
      if(!state?.readingFollow||state.readingFollow.session!==change.session)return;
      state={...state,readingFollow:{...state.readingFollow,index:change.index}};
      onState(state);
    }catch{onStatus('Errore ricezione lettura.');}
  });
  events.onerror=()=>onStatus('Collegamento interrotto. Riconnessione in corso…');
  return ()=>events.close();
}
