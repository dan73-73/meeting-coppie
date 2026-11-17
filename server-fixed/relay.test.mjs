import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelay} from './relay.mjs';

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
   for(const p of phones)assert.ok((await p.event()).startsWith('event: state'));
   for(const index of [1,0,1]){
     push({...initial,readingFollow:{...initial.readingFollow,index}});
     for(const p of phones){const event=await p.event();assert.ok(event.startsWith('event: progress'));assert.ok(event.length<120);assert.ok(event.includes('"index":'+index));}
   }
   const reconnected=await phone();assert.ok((await reconnected.event()).includes('"index":1'));
   push({...initial,readingFollow:{session:'second',index:0,blocks:['new']}});
   for(const p of phones)assert.ok((await p.event()).startsWith('event: state'));
   assert.equal((await fetch(url+'/events',{method:'POST'})).status,405);
   console.log('75 live SSE clients: initial state, 225 cursor deliveries, backwards recovery, new session and reconnection passed.');
 }finally{controllers.forEach(c=>c.abort());server.closeAllConnections();await new Promise(r=>server.close(r));}
});
