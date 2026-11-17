import {getAuth} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {FIXED_RELAY_URL} from './fixed-sync.mjs';
let latest=null,latestVersion=-1;
function endpoint(path){if(!FIXED_RELAY_URL)throw Error('Server di prova non ancora configurato.');const u=new URL(FIXED_RELAY_URL);if(u.protocol!=='https:')throw Error('Server HTTPS necessario');return new URL(path,u);}
export const getFirestore=app=>({app});
export function doc(db,...parts){if(parts.join('/')!=='state/main')throw Error('Documento non supportato');return {db};}
const snapshot=(state,version)=>({exists:()=>!!state,data:()=>structuredClone(state),version});
async function request(path,options){const r=await fetch(endpoint(path),{cache:'no-store',...options});const data=await r.json();if(!r.ok){const err=Error(data.error||'Errore server');err.code=r.status===401?'permission-denied':r.status===409?'conflict':'unavailable';throw err;}return data;}
export async function getDoc(){const data=await request('/state');if(data.version>=latestVersion){latest=data.state;latestVersion=data.version;}return snapshot(data.state,data.version);}
async function write(ref,kind,data,version){const user=getAuth(ref.db.app).currentUser;if(!user)throw Object.assign(Error('Accedi come amministratore'),{code:'permission-denied'});return request('/state',{method:kind,headers:{Authorization:'Bearer '+await user.getIdToken(),'Content-Type':'application/json','If-Match':String(version)},body:JSON.stringify(data)});}
export async function runTransaction(db,operation){
 for(let attempt=0;attempt<8;attempt++){
  let read=null,mutation=null;
  const tx={get:async ref=>{if(mutation)throw Error('Leggi prima di scrivere');read=await getDoc(ref);return read;},set:(ref,data)=>{mutation={ref,data,kind:'PUT'};},update:(ref,data)=>{mutation={ref,data,kind:'PATCH'};}};
  const result=await operation(tx);
  if(!mutation)return result;
  if(!read)throw Error('Transazione senza lettura');
  try{await write(mutation.ref,mutation.kind,mutation.data,read.version);return result;}
  catch(err){if(err.code!=='conflict'||attempt===7)throw err;}
 }
}
export const setDoc=(ref,data)=>runTransaction(ref.db,async tx=>{await tx.get(ref);tx.set(ref,data);});
export async function updateDoc(ref,patch){
 // Cursor writes use the last confirmed stream version; conflicts refetch and retry.
 for(let attempt=0;attempt<8;attempt++){
  if(!latest)await getDoc(ref);
  const state=latest,version=latestVersion;
  try{return await write(ref,'PATCH',patch,version);}
  catch(err){
   if(err.code!=='conflict'||attempt===7)throw err;
   await getDoc(ref);
   if(state.readingFollow?.session!==latest.readingFollow?.session||state.readingFollow?.revision!==latest.readingFollow?.revision)
    throw Error('Lettura cambiata; aggiornamento annullato');
  }
 }
}
export function onSnapshot(ref,callback,onError=console.error){
 const stream=new EventSource(endpoint('/events'));
 stream.addEventListener('state',event=>{try{latest=JSON.parse(event.data);latestVersion=Number(event.lastEventId);callback(snapshot(latest,latestVersion));}catch(err){onError(err);}});
 stream.addEventListener('progress',event=>{try{const change=JSON.parse(event.data);if(latest?.readingFollow?.session!==change.session){stream.close();onError(Error('Sessione incoerente: ricarica la pagina'));return;}latest={...latest,readingFollow:{...latest.readingFollow,index:change.index}};latestVersion=Number(event.lastEventId);callback(snapshot(latest,latestVersion));}catch(err){onError(err);}});
 stream.onerror=()=>{const p=document.getElementById('fixed-connection-status');if(p){p.hidden=false;p.textContent='Sincronizzazione interrotta. Riconnessione in corso…';}};
 stream.onopen=()=>{const p=document.getElementById('fixed-connection-status');if(p)p.hidden=true;};
 return ()=>stream.close();
}
