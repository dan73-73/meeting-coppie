import {mkdir,readFile,writeFile,rename,open} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createRelay} from './relay.mjs';
const PROJECT='meeting---coppie',ADMIN='S80JhCm2aJUqLpCNgzbX8NTp5v03';
const API_KEY='AIzaSyAnPaUs4KvPsaT0g2M8MH_AdUe9H9zRW5o';
const filename=process.env.STATE_FILE||'/data/meeting-state.json';
async function persist(data){
 await mkdir(dirname(filename),{recursive:true});
 const temp=filename+'.tmp';
 await writeFile(temp,JSON.stringify(data),{mode:0o600});
 const handle=await open(temp,'r+');try{await handle.sync();}finally{await handle.close();}
 await rename(temp,filename);
}
function decode(v){
 if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));
 if(v.arrayValue)return (v.arrayValue.values||[]).map(decode);
 if('integerValue'in v)return Number(v.integerValue);
 for(const k of ['stringValue','doubleValue','booleanValue','nullValue','timestampValue'])if(k in v)return v[k];
 throw Error('Unsupported Firestore value');
}
let saved;
try{saved=JSON.parse(await readFile(filename,'utf8'));}
catch(err){
 if(err.code!=='ENOENT')throw err;
 // Single bootstrap read. Subsequent meeting changes use only the local server.
 const response=await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/state/main`);
 if(!response.ok)throw Error('Initial import failed: '+response.status);
 const document=await response.json();
 saved={state:Object.fromEntries(Object.entries(document.fields).map(([k,v])=>[k,decode(v)])),version:0};
 await persist(saved);
}
if(!Array.isArray(saved.state?.shares))throw Error('Saved state invalid');
const tokens=new Map();
async function authorize(header){
 if(!header.startsWith('Bearer '))return false;
 const token=header.slice(7);
 if(tokens.get(token)>Date.now())return true;
 const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+API_KEY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)return false;
 const result=await response.json();
 if(result.users?.length!==1||result.users[0].localId!==ADMIN||result.users[0].disabled)return false;
 for(const [key,expires] of tokens)if(expires<=Date.now())tokens.delete(key);
 tokens.set(token,Date.now()+60000);return true;
}
const relay=createRelay({origin:'https://dan73-73.github.io',initialState:saved.state,initialVersion:saved.version,authorize,persist});
relay.server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('Meeting fixed server ready; Firestore is not used for live synchronization.'));
