// Offline final import: run with the relay stopped and the persistent data volume mounted.
import {readFile,writeFile,rename,open} from 'node:fs/promises';
if(process.env.IMPORT_FINAL_FIREBASE!=='YES')throw Error('Explicit final import flag required');
const filename=process.env.STATE_FILE||'/data/meeting-state.json';
const previous=JSON.parse(await readFile(filename,'utf8'));
if(!Array.isArray(previous.state?.shares)||!Number.isInteger(previous.version))throw Error('Existing archive invalid');
const response=await fetch('https://firestore.googleapis.com/v1/projects/meeting---coppie/databases/(default)/documents/state/main',{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Final import failed: '+response.status);
const document=await response.json();
function decode(v){
 if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));
 if(v.arrayValue)return (v.arrayValue.values||[]).map(decode);
 if('integerValue'in v)return Number(v.integerValue);
 for(const k of ['stringValue','doubleValue','booleanValue','nullValue','timestampValue'])if(k in v)return v[k];
 throw Error('Unsupported Firestore value');
}
const state=Object.fromEntries(Object.entries(document.fields).map(([k,v])=>[k,decode(v)]));
if(!Array.isArray(state.shares)||!state.shares.length)throw Error('Source archive empty or invalid');
const backup=filename+'.before-final-'+Date.now()+'.json';
await writeFile(backup,JSON.stringify(previous),{mode:0o600,flag:'wx'});
const next={state,version:previous.version+1};
await writeFile(filename+'.tmp',JSON.stringify(next),{mode:0o600});
const handle=await open(filename+'.tmp','r+');try{await handle.sync();}finally{await handle.close();}
await rename(filename+'.tmp',filename);
console.log(JSON.stringify({importedShares:state.shares.length,version:next.version,backup}));
