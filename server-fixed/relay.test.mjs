import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelay} from './relay.mjs';
import http from 'node:http';

test('UTF-8 texts stay exact when a character crosses incoming request chunks',async()=>{
 const {server}=createRelay({origin:'https://dan73-73.github.io',initialState:{shares:[]},authorize:async()=>true});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port+'/state';
 const state={shares:[{body:'expérimentées · città · português · 🌍'}]};
 const data=Buffer.from(JSON.stringify(state));const boundary=data.indexOf(Buffer.from('é'))+1;
 try{
  const status=await new Promise((resolve,reject)=>{
   const req=http.request(url,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'0'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
   req.on('error',reject);req.write(data.subarray(0,boundary));
   setTimeout(()=>req.end(data.subarray(boundary)),30);
  });
  assert.equal(status,200);
  assert.deepEqual((await (await fetch(url)).json()).state,state);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('75 phones receive complete state once, small forward/backward updates, and reconnect',async()=>{
 const {server,push}=createRelay({origin:'https://dan73-73.github.io'});
 const initial={shares:[{id:'a',body:'testo '.repeat(40000)}],activeShareId:'a',readingFollow:{session:'first',index:0,blocks:['a','b']},readingRemote:{id:'pause',command:'pause'}};
 push(initial);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 const controllers=[];
 async function phone(){
   const control=new AbortController();controllers.push(control);
   const res=await fetch(url+'/events',{signal:control.signal});
   assert.equal(res.headers.get('access-control-allow-origin'),'https://dan73-73.github.io');
   const reader=res.body.getReader();let buffer='';
   return {async event(){while(!buffer.includes('\n\n')){const {value,done}=await reader.read();assert.equal(done,false);buffer+=new TextDecoder().decode(value);}const end=buffer.indexOf('\n\n');const event=buffer.slice(0,end);buffer=buffer.slice(end+2);return event;}};
 }
 try{
   const phones=await Promise.all(Array.from({length:75},phone));
   for(const p of phones)assert.ok((await p.event()).includes('event: state'));
   for(const index of [1,0,1]){
     push({...initial,readingFollow:{...initial.readingFollow,index}});
     for(const p of phones){const event=await p.event();assert.ok(event.includes('event: progress'));assert.ok(event.length<120);assert.ok(event.includes('"index":'+index));}
   }
   const reconnected=await phone();assert.ok((await reconnected.event()).includes('"index":1'));
   push({...initial,readingFollow:{session:'second',index:0,blocks:['new']}});
   for(const p of phones)assert.ok((await p.event()).includes('event: state'));
   assert.equal((await fetch(url+'/state',{method:'PATCH',body:'{}'})).status,401);
   console.log('75 live SSE clients: initial state, 225 cursor deliveries, backwards recovery, new session and reconnection passed.');
 }finally{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('Eight hours at one update every two seconds: 75 receivers, 1,080,000 deliveries',async()=>{
 const {server,push}=createRelay({origin:'https://dan73-73.github.io',initialState:{shares:[],readingFollow:{session:'day',revision:0,index:0}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 const controllers=[];
 const phones=await Promise.all(Array.from({length:75},async()=>{
  const c=new AbortController();controllers.push(c);const r=await fetch(url+'/events',{signal:c.signal});
  const reader=r.body.getReader();let buffer='';
  return async function nextEvent(){while(!buffer.includes('\n\n')){const x=await reader.read();assert.equal(x.done,false);buffer+=new TextDecoder().decode(x.value);}const end=buffer.indexOf('\n\n');const message=buffer.slice(0,end);buffer=buffer.slice(end+2);if(message.startsWith(':'))return nextEvent();return message;};
 }));
 try{
  await Promise.all(phones.map(read=>read()));
  for(let index=1;index<=14400;index++){
   push({shares:[],readingFollow:{session:'day',revision:0,index}});
   for(const read of phones)assert.ok((await read()).includes('"index":'+index));
  }
 }finally{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('Authorized commands persist; stale concurrent updates and anonymous writes rejected',async()=>{
 const saves=[];
 const {server}=createRelay({origin:'https://dan73-73.github.io',initialState:{shares:[{id:'kept'}],readingFollow:{session:'s',index:0}},authorize:async h=>h==='Bearer test-admin',persist:async x=>saves.push(structuredClone(x))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/state';
 const change=(patch,version)=>fetch(url,{method:'PATCH',headers:{Authorization:'Bearer test-admin','Content-Type':'application/json','If-Match':String(version)},body:JSON.stringify(patch)});
 try{
  assert.equal((await fetch(url,{method:'PUT',body:'{}'})).status,401);
  const pair=await Promise.all([change({'readingFollow.index':8},0),change({'readingFollow.index':9},0)]);
  assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);
  let snapshot=await (await fetch(url)).json();assert.equal(snapshot.version,1);assert.equal(snapshot.state.shares[0].id,'kept');
  assert.equal((await change({readingRemote:{id:'p',command:'pause'}},1)).status,200);
  assert.equal((await change({readingRemote:{id:'r',command:'resume'}},2)).status,200);
  assert.equal((await change({readingRemote:{id:'s',command:'stop'}},3)).status,200);
  snapshot=await (await fetch(url)).json();assert.equal(snapshot.state.readingRemote.command,'stop');
  assert.deepEqual(saves.at(-1),snapshot);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
