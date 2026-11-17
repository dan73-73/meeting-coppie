import http from 'node:http';
const clone=x=>structuredClone(x);
function patchState(state,patch){
 const result=clone(state);
 for(const [path,value] of Object.entries(patch)){
  const keys=path.split('.');
  if(keys.some(k=>!k||['__proto__','prototype','constructor'].includes(k)))throw Error('Invalid field');
  let target=result;
  for(const key of keys.slice(0,-1)){if(!target[key]||typeof target[key]!=='object')target[key]={};target=target[key];}
  target[keys.at(-1)]=value;
 }
 return result;
}
export function createRelay({origin,maxClients=150,initialState=null,initialVersion=0,authorize=async()=>false,persist=async()=>{}}){
 let state=clone(initialState),version=initialVersion,serialized=state?JSON.stringify(state):null;
 let mutation=Promise.resolve();
 const clients=new Set();
 function push(next){
  const previous=state,encoded=JSON.stringify(next);
  if(encoded===serialized)return;
  const mask=s=>JSON.stringify({...s,readingFollow:s.readingFollow?{...s.readingFollow,index:0}:null});
  const progress=previous?.readingFollow&&next?.readingFollow&&mask(previous)===mask(next);
  state=clone(next);serialized=encoded;version++;
  const event=progress?'progress':'state';
  const body=progress?JSON.stringify({index:next.readingFollow.index,session:next.readingFollow.session}):serialized;
  for(const res of clients){
   if(res.writableLength>2*1024*1024){res.destroy();continue;}
   res.write(`id: ${version}\nevent: ${event}\ndata: ${body}\n\n`);
  }
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, If-Match');
  res.setHeader('Access-Control-Allow-Methods','GET, PATCH, PUT, OPTIONS');
  res.setHeader('Vary','Origin');res.setHeader('Cache-Control','no-store');
  const respond=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(req.url==='/health'&&req.method==='GET'){respond(state?200:503,{ready:!!state,clients:clients.size,version});return;}
  if(req.url==='/state'&&req.method==='GET'){respond(state?200:503,{state,version});return;}
  if(req.url==='/state'&&['PATCH','PUT'].includes(req.method)){
   try{
    if(!await authorize(req.headers.authorization||'')){respond(401,{error:'Accesso amministratore necessario'});return;}
    const chunks=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;if(bytes>2*1024*1024){respond(413,{error:'Dati troppo grandi'});return;}chunks.push(chunk);}
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!payload||typeof payload!=='object'||Array.isArray(payload)){respond(400,{error:'Dati non validi'});return;}
    const perform=async()=>{
     if(String(version)!==req.headers['if-match']){respond(409,{error:'Stato aggiornato, riprova'});return;}
     const next=req.method==='PUT'?payload:patchState(state,payload);
     if(!Array.isArray(next.shares)){respond(400,{error:'Programma non valido'});return;}
     // Persist before acknowledging or broadcasting a change.
     await persist({state:next,version:version+(JSON.stringify(next)!==serialized?1:0)});
     push(next);respond(200,{version});
    };
    const result=mutation.then(perform);mutation=result.catch(()=>{});await result;
   }catch{if(!res.headersSent)respond(500,{error:'Salvataggio non riuscito'});}
   return;
  }
  if(req.url!=='/events'||req.method!=='GET'){respond(404,{error:'Not found'});return;}
  if(!state||clients.size>=maxClients){respond(503,{error:'Non disponibile'});return;}
  res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write(`id: ${version}\nevent: state\ndata: ${serialized}\n\n`);clients.add(res);
  const heartbeat=setInterval(()=>{if(res.writableLength>2*1024*1024)res.destroy();else res.write(': alive\n\n');},15000);
  req.on('close',()=>{clearInterval(heartbeat);clients.delete(res);});
 });
 return {server,push};
}
