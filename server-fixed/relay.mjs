import http from 'node:http';
export function createRelay({origin, maxClients=150}) {
  let state=null,serialized=null;
  const clients=new Set();
  function push(next){
    const previous=state;
    const encoded=JSON.stringify(next);
    if(encoded===serialized)return;
    const mask=s=>JSON.stringify({...s,readingFollow:s.readingFollow?{...s.readingFollow,index:0}:null});
    const progress=previous?.readingFollow&&next?.readingFollow&&mask(previous)===mask(next);
    state=next;serialized=encoded;
    const event=progress?'progress':'state';
    const body=progress?JSON.stringify({index:next.readingFollow.index,session:next.readingFollow.session}):serialized;
    for(const res of clients){
      if(res.writableLength>2*1024*1024){res.destroy();continue;}
      res.write(`event: ${event}\ndata: ${body}\n\n`);
    }
  }
  const server=http.createServer((req,res)=>{
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    if(req.url==='/health'){res.writeHead(state?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify({ready:!!state,clients:clients.size}));return;}
    if(req.url!=='/events'){res.writeHead(404);res.end();return;}
    if(!state||clients.size>=maxClients){res.writeHead(503);res.end();return;}
    res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write(`event: state\ndata: ${serialized}\n\n`);
    clients.add(res);
    const heartbeat=setInterval(()=>{if(res.writableLength>2*1024*1024)res.destroy();else res.write(': alive\n\n');},15000);
    req.on('close',()=>{clearInterval(heartbeat);clients.delete(res);});
  });
  return {server,push};
}
