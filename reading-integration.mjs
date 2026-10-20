import {createMicrophone} from './microphone-engine.mjs';
import {LANGS,suggestBlocks,validateBlocks,locatePassage} from './reading-follow.mjs?v=match-06b7d2ea';
import {doc,runTransaction} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export function createReadingIntegration({db,e,getState,isAdmin,getView,refresh}) {
  const ref=doc(db,'state','main');
  const names={it:'Italiano',en:'English',fr:'Français',es:'Español',pt:'Português'};
  const locales={it:'it-IT',en:'en-US',fr:'fr-FR',es:'es-ES',pt:'pt-PT'};
  function spokenLanguage(share){const code=share?.speakerLanguage||share?.sourceLanguage||share?.originalLanguage||share?.spokenLanguage;return locales[code]?code:null;}
  const buttonStyle={padding:'8px 14px',borderRadius:'16px',border:'1px solid rgba(200,169,110,.4)',background:'transparent',color:'#c8a96e',cursor:'pointer',fontSize:'14px'};
  let requestedPause=false,lastRemoteCommand=null,source='it',status='Microfono fermo.',tail='',pending=null,sending=false,timer=null,restart=null,session=null,dialog=null;
  function message(text){status=text;const p=document.getElementById('reading-status');if(p)p.textContent=text;}
  function stop(){requestedPause=false;pending=null;clearTimeout(timer);clearTimeout(restart);timer=null;mic.stop();}
  function active(){const s=getState();return (s.displayMode||'one')==='one'?(s.shares||[]).find(x=>x.id===s.activeShareId):null;}
  function valid(record,share){return record&&record.shareId===share?.id&&Array.isArray(record.blocks)&&record.blocks.length>0&&LANGS.every(l=>record.blocks.map(b=>b[l]||'').join('')===(share.translations?.[l]?.body||''));}
  async function acknowledge(id,confirmedMode){try{await runTransaction(db,async tx=>{const snap=await tx.get(ref),state=snap.data();if(state?.readingRemote?.id===id&&state?.readingRemoteAck?.id!==id)tx.update(ref,{readingRemoteAck:{id,mode:confirmedMode,session,at:Date.now()}});});}catch(err){message('Comando ricevuto ma conferma non registrata: '+(err.message||err));}}
  function orderedShares(state){
    const sections=[...(state.sections||[])].sort((a,b)=>(a.order||0)-(b.order||0));
    const rank=new Map(sections.map((x,i)=>[x.id,i]));
    return (state.shares||[]).map((x,i)=>({x,i})).sort((a,b)=>(rank.get(a.x.sectionId)??999)-(rank.get(b.x.sectionId)??999)||a.i-b.i).map(v=>v.x);
  }
  function usableBlocks(share){
    if(!share)return null;
    const ok=blocks=>Array.isArray(blocks)&&blocks.length>0&&LANGS.every(l=>blocks.map(b=>b[l]||'').join('')===(share.translations?.[l]?.body||''));
    if(ok(share.readingBlocks)&&!(share.readingBlocks.length===1&&(share.translations?.it?.body||'').length>260))return share.readingBlocks;
    try{const p=suggestBlocks(share.translations||{});if(ok(p.blocks))return p.blocks;}catch(e){}
    return null;
  }
  const mic=createMicrophone({
    Recognition:window.SpeechRecognition||window.webkitSpeechRecognition,
    onStatus:message,
    onTranscript:event=>{
      const live=getState().readingFollow,share=active();
      if(!valid(live,share))return;
      for(let i=event.resultIndex;i<event.results.length;i++){
        const words=event.results[i][0].transcript,combined=(tail+' '+words).trim();
        let index=locatePassage(words,live.blocks,source,Math.max(0,live.index));
        if(index===null)index=locatePassage(combined,live.blocks,source,Math.max(0,live.index));
        if(index!==null)queue(index);
        if(event.results[i].isFinal)tail=combined.split(/\\s+/).slice(-12).join(' ');
      }
    }
  });
  function sync(){
    if(!mic.active)return;
    if(!isAdmin()||getView()!=='admin'){stop();return;}
    const state=getState(),share=active(),follow=state.readingFollow,cmd=state.readingRemote;
    const changed=session!==follow?.session;
    if(changed){session=follow?.session||null;tail='';pending=null;}
    const language=spokenLanguage(share);
    if(language&&language!==source){source=language;mic.setLanguage(locales[source]);}
    if(cmd?.id&&cmd.id!==lastRemoteCommand){
      lastRemoteCommand=cmd.id;
      if(cmd.command==='pause'){requestedPause=true;}
      if(cmd.command==='resume'){requestedPause=false;}
      if(cmd.command==='next'||cmd.command==='previous'){
        acknowledge(cmd.id,'condivisione cambiata');
      }else if(cmd.command==='pause'||cmd.command==='resume'){
        acknowledge(cmd.id,cmd.command==='pause'?'pausa':'automatico');
      }
    }
    const shouldPause=requestedPause||!valid(follow,share);
    if(mic.paused!==shouldPause)mic.pause(shouldPause);
  }
  async function remoteCommand(command){
    const state=getState(),share=active();
    if(!isAdmin()||!share)throw Error('Seleziona una condivisione attiva.');
    await runTransaction(db,async tx=>{
      const snap=await tx.get(ref),now=snap.data();
      if(!now||now.activeShareId!==share.id)throw Error('La condivisione attiva è cambiata.');
      const current=now.readingFollow,sessionId=current?.session||null;
      if(command==='next'||command==='previous'){
        const items=orderedShares(now),index=items.findIndex(x=>x.id===share.id);
        const next=items[index+(command==='next'?1:-1)];
        if(!next)throw Error('Non ci sono altre condivisioni in questa direzione.');
        const blocks=usableBlocks(next),nextSession=crypto.randomUUID(),id=crypto.randomUUID();
        tx.update(ref,{displayMode:'one',activeShareId:next.id,
          readingFollow:blocks?{shareId:next.id,session:nextSession,blocks,index:0,revision:0}:null,
          readingRemote:{previousSession:sessionId,session:blocks?nextSession:null,command,id,manual:!blocks}});
      }else if(command==='pause'||command==='resume'||command==='manual'){
        if(command==='resume'&&!valid(current,share))throw Error('Prepara prima i passaggi di questa condivisione per il microfono.');
        tx.update(ref,{readingRemote:{session:sessionId,command:command==='manual'?'pause':command,manual:command==='manual',id:crypto.randomUUID()}});
      }else if(command==='manual-forward'||command==='manual-back'){
        if(!valid(current,share))throw Error('Passaggi non preparati.');
        const delta=command==='manual-forward'?1:-1,index=Math.max(0,Math.min(current.blocks.length-1,(current.index??0)+delta));
        if(index===(current.index??0))throw Error('Sei già al primo o ultimo passaggio.');
        tx.update(ref,{readingFollow:{...current,index,revision:(current.revision||0)+1},
          readingRemote:{session:sessionId,command:'pause',manual:true,id:crypto.randomUUID()}});
      }else throw Error('Comando sconosciuto.');
    });
    message('Comando registrato.');
  }
  const action=fn=>async()=>{try{await fn();}catch(err){message(err.code==='permission-denied'?'Salvataggio non autorizzato da Firebase. Accedi con il tuo account amministratore.':err.message||String(err));}};
  async function position(index,manual=false){
    const s=getState(),share=active(),record=s.readingFollow;if(!isAdmin()||!valid(record,share))throw Error('Attiva e prepara prima una condivisione.');
    pending=null;tail='';const bounded=Math.max(-1,Math.min(index,record.blocks.length-1));
    await runTransaction(db,async tx=>{const snap=await tx.get(ref),now=snap.data(),r=now?.readingFollow;if(now?.activeShareId!==share.id||r?.session!==record.session)throw Error('La condivisione attiva è cambiata.');tx.update(ref,{readingFollow:{...r,index:bounded,revision:(r.revision||0)+(manual?1:0)}});});
  }
  function queue(index){const r=getState().readingFollow;if(!r||index===r.index)return;pending={index,session:r.session,revision:r.revision||0,shareId:r.shareId};if(!timer)timer=setTimeout(flush,300);}
  async function flush(){timer=null;if(sending||!pending)return;const item=pending;pending=null;if(!mic.active||mic.paused||!isAdmin())return;sending=true;try{await runTransaction(db,async tx=>{const snap=await tx.get(ref),s=snap.data(),r=s?.readingFollow;if(s?.activeShareId===item.shareId&&(s.displayMode||'one')==='one'&&r?.session===item.session&&(r.revision||0)===item.revision )tx.update(ref,{readingFollow:{...r,index:item.index}});});}catch(err){message('Sincronizzazione temporaneamente non disponibile: '+(err.message||err));}finally{sending=false;if(pending&&!timer)timer=setTimeout(flush,300);}}
  function start(){
    const share=active(),record=getState().readingFollow;
    if(!isAdmin()||!valid(record,share))throw Error('Prepara i passaggi della condivisione attiva.');
    const lang=spokenLanguage(share);if(lang)source=lang;
    stop();session=record.session;lastRemoteCommand=getState().readingRemote?.id||null;
    tail='';requestedPause=false;mic.start(locales[source]);
  }
  function prepare(){
    const share=active();if(!share)throw Error('Scegli “Una sola” e attiva la condivisione che il relatore leggerà.');stop();
    dialog?.remove();const current=getState().readingFollow;const cached={shareId:share.id,blocks:share.readingBlocks};const stored=valid(current,share)?current:valid(cached,share)?cached:null;const proposal=stored?.blocks?.length>1||((share.translations?.it?.body||'').length<=260&&stored)?{blocks:stored.blocks,mode:'saved'}:suggestBlocks(share.translations||{});
    let lanes=Object.fromEntries(LANGS.map(l=>[l,proposal.blocks.map(b=>b[l])]));let confirmed=proposal.mode==='saved';
    const overlay=e('div',{style:{position:'fixed',inset:'0',background:'rgba(0,0,0,.85)',zIndex:'100',overflow:'auto',padding:'20px'}});
    const box=e('div',{style:{maxWidth:'1100px',margin:'auto',padding:'24px',background:'#171725',border:'1px solid #c8a96e',borderRadius:'16px'}});
    const grid=e('div',{}),feedback=e('p',{style:{color:'#ffb4ad',margin:'12px 0'},role:'alert'});
    const check=e('input',{type:'checkbox'});check.checked=confirmed;check.onchange=()=>{confirmed=check.checked;};
    function reset(){confirmed=false;check.checked=false;}
    function draw(){grid.replaceChildren();const count=Math.max(...LANGS.map(l=>lanes[l].length));for(let i=0;i<count;i++){const row=e('div',{style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(175px,1fr))',gap:'10px',padding:'14px 0',borderBottom:'1px solid #444'}});for(const l of LANGS){const cell=e('div',{},e('p',{style:{color:'#c8a96e',marginBottom:'6px'}},names[l]+' · '+(i+1)));if(i<lanes[l].length){const ta=e('textarea',{readonly:'',style:{width:'100%',height:'130px',background:'#0d0d1a',color:'#e8dcc8',padding:'8px',border:'1px solid #625536',borderRadius:'8px',fontSize:'14px',lineHeight:'1.5'}});ta.value=lanes[l][i];const split=e('button',{style:{...buttonStyle,fontSize:'12px',marginTop:'6px'},onClick:()=>{const p=ta.selectionStart;if(p>0&&p<ta.value.length){lanes[l].splice(i,1,ta.value.slice(0,p),ta.value.slice(p));reset();draw();}}},'Dividi al cursore');const merge=e('button',{style:{...buttonStyle,fontSize:'12px',marginTop:'6px'},onClick:()=>{if(i<lanes[l].length-1){lanes[l].splice(i,2,lanes[l][i]+lanes[l][i+1]);reset();draw();}}},'Unisci al seguente');merge.disabled=i===lanes[l].length-1;cell.append(ta,split,merge);}else cell.append(e('p',{},'Passaggio mancante'));row.append(cell);}grid.append(row);}}
    const close=()=>{overlay.remove();dialog=null;};
    const save=e('button',{style:{...buttonStyle,background:'#c8a96e',color:'#0d0d1a',fontWeight:'700'},onClick:async()=>{try{feedback.textContent='';if(!confirmed)throw Error('Controlla e conferma che le righe corrispondano nelle cinque lingue.');const count=lanes.it.length;if(!LANGS.every(l=>lanes[l].length===count))throw Error('Il numero di passaggi deve essere uguale nelle cinque lingue.');const blocks=lanes.it.map((_,i)=>Object.fromEntries(LANGS.map(l=>[l,lanes[l][i]])));validateBlocks(blocks,share.translations);if(new TextEncoder().encode(JSON.stringify(blocks)).length>300000)throw Error('Questa condivisione è troppo grande per la lettura sincronizzata.');save.disabled=true;await runTransaction(db,async tx=>{const snap=await tx.get(ref),s=snap.data(),latest=(s?.shares||[]).find(x=>x.id===share.id);if(s?.activeShareId!==share.id||(s.displayMode||'one')!=='one'||!latest)throw Error('La condivisione attiva è cambiata.');validateBlocks(blocks,latest.translations);const patch={shares:s.shares.map(item=>item.id===share.id?{...item,readingBlocks:blocks}:item),readingFollow:{shareId:share.id,session:crypto.randomUUID(),blocks,index:0,revision:0}};if(new TextEncoder().encode(JSON.stringify({...s,...patch})).length>800000)throw Error('Lo spazio per i passaggi sincronizzati è insufficiente. Nessun testo è stato modificato.');tx.update(ref,patch);});close();refresh();message('Passaggi salvati. Premi Avvia lettura e consenti il microfono.');}catch(err){save.disabled=false;feedback.textContent=err.code==='permission-denied'?'Firebase non autorizza il salvataggio. Verifica di usare l’account amministratore.':err.message||String(err);}}},'Salva passaggi');
    box.append(e('h3',{style:{color:'#c8a96e',marginBottom:'12px'}},'Prepara lettura · '+(share.translations?.it?.title||'')),e('p',{style:{color:'#c8b89a',fontSize:'14px',lineHeight:'1.6',marginBottom:'14px'}},'Ogni riga collega lo stesso passaggio nelle cinque lingue. Controlla la corrispondenza; i testi restano quelli caricati. Se una lingua ha paragrafi diversi, seleziona il punto nella casella e usa Dividi o Unisci.'),grid,e('label',{style:{display:'block',padding:'18px 0'}},check,' Ho controllato la corrispondenza dei passaggi.'),feedback,e('div',{style:{display:'flex',gap:'10px',flexWrap:'wrap'}},save,e('button',{style:buttonStyle,onClick:close},'Chiudi')));overlay.append(box);dialog=overlay;document.body.append(overlay);draw();
  }
  function panel(){
    const share=active(),r=getState().readingFollow;
    const select=e('select',{style:{...buttonStyle,background:'#1a1a2e'},onChange:event=>{source=event.target.value;if(mic.active){tail='';mic.setLanguage(locales[source]);}}});for(const l of LANGS){const o=e('option',{value:l},names[l]);o.selected=l===source;select.append(o);}
    const btn=(text,fn)=>e('button',{style:buttonStyle,onClick:action(fn)},text);
    return e('div',{style:{padding:'14px 16px',borderRadius:'12px',background:'rgba(200,169,110,.06)',border:'1px solid rgba(200,169,110,.25)',marginBottom:'20px'}},
      e('h3',{style:{color:'#c8a96e',fontSize:'16px',marginBottom:'8px'}},'🎙️ Segui la lettura'),
      e('p',{style:{color:'#a09080',fontSize:'13px',marginBottom:'10px'}},share?'Condivisione attiva: '+(share.translations?.it?.title||''):'Scegli “Una sola” e attiva la condivisione da leggere.'),
      e('div',{style:{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center'}},e('label',{style:{fontSize:'13px',color:'#a09080'}},'Lingua del relatore: ',select),btn('▶ Avvia lettura',()=>valid(getState().readingFollow,active())?start():prepare()),btn('⏹ Ferma lettura',stop),btn('⏸ Pausa da tablet',()=>remoteCommand('pause')),btn('▶ Riprendi da tablet',()=>remoteCommand('resume')),btn('⏭ Prossima condivisione (prova)',()=>remoteCommand('next')),btn('🆘 Manuale',()=>remoteCommand('manual')),btn('← Condivisione precedente',()=>remoteCommand('previous')),btn('Condivisione successiva →',()=>remoteCommand('next')),btn('⚙ Prepara passaggi',prepare),btn('← Precedente',()=>position((getState().readingFollow?.index||0)-1,true)),btn('Successivo →',()=>position((getState().readingFollow?.index??-1)+1,true))),
      e('p',{id:'reading-status',role:'status',style:{color:'#c8a96e',fontSize:'13px',marginTop:'10px'}},status),
      valid(r,share)?e('div',{style:{marginTop:'14px',padding:'14px',background:'#10101e',border:'1px solid #625536',borderRadius:'12px'}},
        e('p',{style:{color:'#c8a96e',fontSize:'13px',marginBottom:'10px'}},'📖 TESTO SINCRONIZZATO SUL COMPUTER · Passaggio '+((r.index??0)+1)+' di '+r.blocks.length),
        body(share,'it',share.translations?.it)
      ):null,
      e('p',{style:{fontSize:'12px',color:'#a09080',marginTop:'8px'}},'PROVA REGIA TABLET: sul computer premi una volta Avvia lettura e autorizza il microfono; dal tablet accedi come amministratore e usa Pausa/Riprendi da tablet. Il microfono deve restare attivo sul computer. Questa prova non avvia il microfono da remoto. Le coppie continuano a usare il QR abituale.'));
  }
  function remotePanel(){
    const state=getState(),share=active(),record=state.readingFollow,shares=orderedShares(state);
    const cmd=state.readingRemote,ack=state.readingRemoteAck;
    const confirmation=cmd?.id && ack?.id===cmd.id ? ('✅ ESEGUITO DAL COMPUTER · '+(ack?.mode||'')) : (cmd?.id?'⌛ COMANDO REGISTRATO · in attesa della conferma del computer':'Nessun comando inviato');
    const idx=shares.findIndex(x=>x.id===share?.id),previous=shares[idx-1],next=shares[idx+1];
    const summary=x=>x?((x.time||'Orario non indicato')+' · '+(x.coupleName||'Relatore da indicare')+'\n'+(x.translations?.it?.title||'Senza titolo')):'Nessuna';
    const row=(label,value)=>e('div',{style:{border:'1px solid #625536',borderRadius:'12px',padding:'14px',whiteSpace:'pre-line'}},
      e('p',{style:{fontSize:'12px',color:'#c8a96e',marginBottom:'6px'}},label),
      e('strong',{style:{fontSize:'16px',lineHeight:'1.5'}},value));
    const btn=(label,command,disabled=false)=>e('button',{...(disabled?{disabled:''}:{}),style:{...buttonStyle,width:'100%',fontSize:'17px',padding:'16px',background:'#232339',opacity:disabled?.45:1},onClick:action(()=>remoteCommand(command))},label);
    return e('div',{style:{display:'grid',gap:'12px'}},
      e('h3',{style:{color:'#c8a96e',fontSize:'19px'}},'📱 Regia · computer e cellulare'),
      e('p',{style:{color:'#a09080',fontSize:'13px'}},'Microfono sul computer. Stessi comandi da computer e cellulare.'),
      row('STATO DEL COMANDO',confirmation),
      row('⬅ PRECEDENTE',summary(previous)),
      row('🔴 IN CORSO · '+(idx+1)+' di '+shares.length,summary(share)),
      row('⏭ SUCCESSIVA',summary(next)),
      record?row('📍 PUNTO LETTURA',((record.index??0)+1)+' di '+record.blocks.length+'\n'+(record.blocks[record.index??0]?.it||'')):null,
      btn('⏸ PAUSA','pause'),btn('▶ RIPRENDI','resume'),
      btn('⬅ CONDIVISIONE PRECEDENTE','previous',!previous),
      btn('CONDIVISIONE SUCCESSIVA ➡','next',!next),
      e('div',{style:{border:'1px solid #b77',borderRadius:'14px',padding:'14px',display:'grid',gap:'10px'}},
        e('strong',{},'🆘 EMERGENZA · GUIDA MANUALE'),
        btn('ATTIVA GUIDA MANUALE','manual'),
        row('PASSAGGIO ATTUALE',record?((record.index??0)+1)+' / '+record.blocks.length+' · '+(record.blocks[record.index??0]?.it||''):'Nessun testo preparato'),
        btn('⬅ CONDIVISIONE PRECEDENTE','previous',!previous),btn('CONDIVISIONE SUCCESSIVA ➡','next',!next),
        e('p',{style:{fontSize:'12px',color:'#a09080'}},'EMERGENZA: questi comandi cambiano l’intera condivisione, inclusi relatore, orario, titolo e testo nelle cinque lingue. Per tornare al microfono premi RIPRENDI.')),
      e('p',{id:'reading-status',role:'status',style:{color:'#c8a96e',fontSize:'13px'}},status));
  }
  let lastScroll='';
  function body(share,lang,content){
    const r=getState().readingFollow;const style={fontSize:'16px',lineHeight:'1.8',color:'#c8b89a',marginBottom:'16px',whiteSpace:'pre-wrap'};
    if(!valid(r,share))return e('p',{style},content?.body||'');
    const root=e('div',{style});r.blocks.forEach((b,i)=>root.append(e('span',{...(i===r.index?{'data-reading-active':'true'}:{}),style:i===r.index&&r.blocks.length>1?{background:'rgba(200,169,110,.12)',borderLeft:'3px solid #e8c87a',paddingLeft:'5px'}:{}},b[lang])));
    const key=r.session+'|'+r.index+'|'+lang+'|'+getView();if(key!==lastScroll){lastScroll=key;requestAnimationFrame(()=>{if(root.isConnected)root.querySelector('[data-reading-active]')?.scrollIntoView({behavior:'smooth',block:'center'});});}
    return root;
  }
  window.addEventListener('pagehide',stop);
  return {panel,remotePanel,body,sync,stop};
}
