import {LANGS,suggestBlocks,validateBlocks,locatePassage} from './reading-follow.mjs';
import {doc,runTransaction} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export function createReadingIntegration({db,e,getState,isAdmin,getView,refresh}) {
  const ref=doc(db,'state','regia_demo_20261019');
  const names={it:'Italiano',en:'English',fr:'Français',es:'Español',pt:'Português'};
  const locales={it:'it-IT',en:'en-US',fr:'fr-FR',es:'es-ES',pt:'pt-PT'};
  const buttonStyle={padding:'8px 14px',borderRadius:'16px',border:'1px solid rgba(200,169,110,.4)',background:'transparent',color:'#c8a96e',cursor:'pointer',fontSize:'14px'};
  let recognition=null,running=false,remotePaused=false,lastRemoteCommand=null,source='it',status='Microfono fermo.',tail='',pending=null,sending=false,timer=null,restart=null,session=null,dialog=null;
  function message(text){status=text;const p=document.getElementById('reading-status');if(p)p.textContent=text;}
  function stop(){running=false;remotePaused=false;pending=null;clearTimeout(timer);clearTimeout(restart);timer=null;if(recognition){recognition.onend=null;recognition.abort();recognition=null;}message('Microfono fermo.');}
  function active(){const s=getState();return (s.displayMode||'one')==='one'?(s.shares||[]).find(x=>x.id===s.activeShareId):null;}
  function valid(record,share){return record&&record.shareId===share?.id&&Array.isArray(record.blocks)&&record.blocks.length>0&&LANGS.every(l=>record.blocks.map(b=>b[l]||'').join('')===(share.translations?.[l]?.body||''));}
  function sync(){
    const s=getState(),share=active();
    if(running&&(!isAdmin()||getView()!=='admin')){stop();return;}
    if(running&&s.readingRemote?.command==='next'&&s.readingRemote?.previousSession===session&&valid(s.readingFollow,share)){
      session=s.readingFollow.session;lastRemoteCommand=s.readingRemote.id;pending=null;tail='';
      message('▶ Condivisione successiva · microfono computer ancora attivo.');return;
    }
    if(running&&(!valid(s.readingFollow,share)||s.readingFollow.session!==session)){stop();return;}
    const cmd=s.readingRemote;
    if(running&&cmd&&cmd.session===session&&cmd.id!==lastRemoteCommand){
      lastRemoteCommand=cmd.id;
      if(cmd.command==='pause'){remotePaused=true;pending=null;tail='';message(cmd.manual?'🆘 Modalità manuale attiva · usa AVANTI e INDIETRO.':'⏸ Lettura in pausa dal cellulare.');}
      if(cmd.command==='resume'){remotePaused=false;message('▶ Lettura ripresa dal tablet · microfono del computer attivo.');}
    }
  }
  async function remoteCommand(command){
    const s=getState(),share=active(),r=s.readingFollow;
    if(!isAdmin()||!valid(r,share))throw Error('Attiva e prepara prima una condivisione.');
    await runTransaction(db,async tx=>{
      const snap=await tx.get(ref),now=snap.data();
      if(now?.activeShareId!==share.id||now?.readingFollow?.session!==r.session)throw Error('Condivisione cambiata.');
      if(command==='manual' || command==='resume' || command==='pause'){
        if(command==='manual') tx.update(ref,{readingRemote:{session:r.session,command:'pause',id:crypto.randomUUID(),manual:true}});
        else tx.update(ref,{readingRemote:{session:r.session,command,id:crypto.randomUUID(),manual:command==='pause'?now.readingRemote?.manual===true:false}});
      }else if(command==='manual-forward' || command==='manual-back'){
        const delta=command==='manual-forward'?1:-1;
        const activeRecord=now.readingFollow;const bounded=Math.max(0,Math.min(activeRecord.blocks.length-1,(activeRecord.index??0)+delta));
        tx.update(ref,{readingFollow:{...activeRecord,index:bounded,revision:(activeRecord.revision||0)+1},readingRemote:{session:r.session,command:'pause',manual:true,id:crypto.randomUUID()}});
      }else if(command==='next'){
        const shares=now.shares||[],index=shares.findIndex(x=>x.id===share.id),next=shares[index+1];
        if(!next)throw Error('Non ci sono altre condivisioni in programma.');
        const blocks=next.readingBlocks;
        const ok=Array.isArray(blocks)&&blocks.length>0&&LANGS.every(l=>blocks.map(b=>b[l]||'').join('')===(next.translations?.[l]?.body||''));
        if(!ok)throw Error('Prima prepara i passaggi della prossima condivisione.');
        const nextSession=crypto.randomUUID();
        tx.update(ref,{displayMode:'one',activeShareId:next.id,readingFollow:{shareId:next.id,session:nextSession,blocks,index:0,revision:0},readingRemote:{previousSession:r.session,session:nextSession,command,id:crypto.randomUUID()}});
      }else throw Error('Comando sconosciuto.');
    });
    message('Comando inviato: '+command+'. Verifica sul computer.');
  }
  const action=fn=>async()=>{try{await fn();}catch(err){stop();message(err.code==='permission-denied'?'Salvataggio non autorizzato da Firebase. Accedi con il tuo account amministratore.':err.message||String(err));}};
  async function position(index,manual=false){
    const s=getState(),share=active(),record=s.readingFollow;if(!isAdmin()||!valid(record,share))throw Error('Attiva e prepara prima una condivisione.');
    pending=null;tail='';const bounded=Math.max(-1,Math.min(index,record.blocks.length-1));
    await runTransaction(db,async tx=>{const snap=await tx.get(ref),now=snap.data(),r=now?.readingFollow;if(now?.activeShareId!==share.id||r?.session!==record.session)throw Error('La condivisione attiva è cambiata.');tx.update(ref,{readingFollow:{...r,index:bounded,revision:(r.revision||0)+(manual?1:0)}});});
  }
  function queue(index){const r=getState().readingFollow;if(!r||index===r.index)return;pending={index,session:r.session,revision:r.revision||0,shareId:r.shareId};if(!timer)timer=setTimeout(flush,300);}
  async function flush(){timer=null;if(sending||!pending)return;const item=pending;pending=null;if(!running||remotePaused||!isAdmin())return;sending=true;try{await runTransaction(db,async tx=>{const snap=await tx.get(ref),s=snap.data(),r=s?.readingFollow;if(s?.activeShareId===item.shareId&&(s.displayMode||'one')==='one'&&r?.session===item.session&&(r.revision||0)===item.revision)tx.update(ref,{readingFollow:{...r,index:item.index}});});}catch(err){stop();message('Sincronizzazione interrotta: '+(err.message||err));}finally{sending=false;if(pending&&!timer)timer=setTimeout(flush,300);}}
  function start(){
    const record=getState().readingFollow;if(!isAdmin()||!valid(record,active()))throw Error('Prepara i passaggi della condivisione attiva.');
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Recognition)throw Error('Apri l’app in Chrome sul computer del relatore: questo browser non supporta il riconoscimento vocale.');
    stop();session=record.session;lastRemoteCommand=getState().readingRemote?.id||null;tail='';running=true;const r=recognition=new Recognition();r.lang=locales[source];r.continuous=true;r.interimResults=true;
    r.onstart=()=>message('Microfono attivo · Relatore: '+names[source]);
    r.onresult=event=>{if(remotePaused)return;const live=getState().readingFollow;if(!valid(live,active())){stop();return;}for(let i=event.resultIndex;i<event.results.length;i++){const text=event.results[i][0].transcript,combined=(tail+' '+text).trim();let index=locatePassage(text,live.blocks,source,Math.max(0,live.index));if(index===null)index=locatePassage(combined,live.blocks,source,Math.max(0,live.index));if(index!==null)queue(index);if(event.results[i].isFinal)tail=combined.split(/\s+/).slice(-12).join(' ');message('Microfono attivo · '+text);}};
    r.onerror=event=>{if(event.error==='no-speech')return;stop();message(event.error==='not-allowed'?'Microfono non autorizzato. Consenti il microfono a questa pagina e premi Avvia lettura.':'Microfono interrotto ('+event.error+'). Puoi usare Precedente e Successivo.');};
    r.onend=()=>{if(running)restart=setTimeout(()=>{try{r.start();}catch(err){stop();message(err.message);}},350);};
    try{r.start();}catch(err){stop();throw err;}
  }
  function prepare(){
    const share=active();if(!share)throw Error('Scegli “Una sola” e attiva la condivisione che il relatore leggerà.');stop();
    dialog?.remove();const current=getState().readingFollow;const cached={shareId:share.id,blocks:share.readingBlocks};const proposal=valid(current,share)?{blocks:current.blocks,mode:'saved'}:valid(cached,share)?{blocks:cached.blocks,mode:'saved'}:suggestBlocks(share.translations||{});
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
    const select=e('select',{style:{...buttonStyle,background:'#1a1a2e'},onChange:event=>{source=event.target.value;stop();}});for(const l of LANGS){const o=e('option',{value:l},names[l]);o.selected=l===source;select.append(o);}
    const btn=(text,fn)=>e('button',{style:buttonStyle,onClick:action(fn)},text);
    return e('div',{style:{padding:'14px 16px',borderRadius:'12px',background:'rgba(200,169,110,.06)',border:'1px solid rgba(200,169,110,.25)',marginBottom:'20px'}},
      e('h3',{style:{color:'#c8a96e',fontSize:'16px',marginBottom:'8px'}},'🎙️ Segui la lettura'),
      e('p',{style:{color:'#a09080',fontSize:'13px',marginBottom:'10px'}},share?'Condivisione attiva: '+(share.translations?.it?.title||''):'Scegli “Una sola” e attiva la condivisione da leggere.'),
      e('div',{style:{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center'}},e('label',{style:{fontSize:'13px',color:'#a09080'}},'Lingua del relatore: ',select),btn('▶ Avvia lettura',()=>valid(getState().readingFollow,active())?start():prepare()),btn('⏹ Ferma lettura',stop),btn('⏸ Pausa da tablet',()=>remoteCommand('pause')),btn('▶ Riprendi da tablet',()=>remoteCommand('resume')),btn('⏭ Prossima condivisione (prova)',()=>remoteCommand('next')),btn('🆘 Manuale',()=>remoteCommand('manual')),btn('← Manuale indietro',()=>remoteCommand('manual-back')),btn('Manuale avanti →',()=>remoteCommand('manual-forward')),btn('⚙ Prepara passaggi',prepare),btn('← Precedente',()=>{stop();return position((getState().readingFollow?.index||0)-1,true);}),btn('Successivo →',()=>{stop();return position((getState().readingFollow?.index??-1)+1,true);})),
      e('p',{id:'reading-status',role:'status',style:{color:'#c8a96e',fontSize:'13px',marginTop:'10px'}},status),
      valid(r,share)?e('p',{style:{fontSize:'12px',color:'#a09080',marginTop:'6px'}},r.index>=0?'Passaggio '+(r.index+1)+' di '+r.blocks.length:'Sottolineatura sospesa.'):null,
      e('p',{style:{fontSize:'12px',color:'#a09080',marginTop:'8px'}},'PROVA REGIA TABLET: sul computer premi una volta Avvia lettura e autorizza il microfono; dal tablet accedi come amministratore e usa Pausa/Riprendi da tablet. Il microfono deve restare attivo sul computer. Questa prova non avvia il microfono da remoto. Le coppie continuano a usare il QR abituale.'));
  }
  function remotePanel(){
    const state=getState(),share=active(),record=state.readingFollow;
    const shares=state.shares||[],idx=shares.findIndex(x=>x.id===share?.id),next=shares[idx+1],previous=shares[idx-1];
    const title=x=>x?.translations?.it?.title||'Nessuna';
    const btn=(label,command)=>e('button',{style:{...buttonStyle,width:'100%',fontSize:'17px',padding:'17px',background:'#232339'},onClick:action(()=>remoteCommand(command))},label);
    const line=(label,value)=>e('div',{style:{padding:'10px 12px',background:'#202032',borderRadius:'10px'}},
      e('p',{style:{fontSize:'11px',color:'#c8a96e',marginBottom:'4px'}},label),
      e('strong',{style:{fontSize:'16px',lineHeight:'1.4'}},value));
    return e('div',{style:{display:'grid',gap:'12px'}},
      e('h3',{style:{color:'#c8a96e'}} ,'📱 Regia remota'),
      e('p',{style:{color:'#a09080',fontSize:'13px',lineHeight:'1.6'}},'Il microfono rimane sul computer. Il cellulare controlla solo la regia.'),
      line('🔴 CONDIVISIONE ATTIVA · '+(idx>=0?idx+1:'—')+' di '+shares.length,title(share)),
      line('⏭ PROSSIMA CONDIVISIONE',title(next)),
      line('↩ PRECEDENTE NELL’ELENCO',title(previous)),
      record?line('📍 POSIZIONE NEL TESTO',String((record.index??0)+1)+' di '+record.blocks.length+' passaggi'):null,
      btn('⏸ PAUSA · '+title(share),'pause'),
      btn('▶ RIPRENDI · '+title(share),'resume'),
      next?btn('⏭ APRI LA PROSSIMA · '+title(next),'next'):e('p',{style:{color:'#a09080'}},'Ultima condivisione in elenco'),
      e('div',{style:{border:'1px solid #a66',borderRadius:'14px',padding:'13px',display:'grid',gap:'9px'}},
        e('strong',{},'🆘 EMERGENZA · GUIDA MANUALE'),
        btn('ATTIVA MODALITÀ MANUALE','manual'),
        btn('← PARAGRAFO PRECEDENTE','manual-back'),btn('PARAGRAFO SUCCESSIVO →','manual-forward'),
        e('p',{style:{fontSize:'12px',color:'#a09080'}},'I comandi manuali spostano il punto evidenziato nella condivisione attiva, non cambiano coppia. Per tornare alla voce premi RIPRENDI.')
      ),
      e('p',{id:'reading-status',style:{fontSize:'13px',color:'#c8a96e'}},status)
    );
  }
  let lastScroll='';
  function body(share,lang,content){
    const r=getState().readingFollow;const style={fontSize:'16px',lineHeight:'1.8',color:'#c8b89a',marginBottom:'16px',whiteSpace:'pre-wrap'};
    if(!valid(r,share))return e('p',{style},content?.body||'');
    const root=e('div',{style});r.blocks.forEach((b,i)=>root.append(e('span',{...(i===r.index?{'data-reading-active':'true'}:{}),style:i===r.index?{background:'rgba(200,169,110,.18)',textDecoration:'underline',textDecorationColor:'#e8c87a',textDecorationThickness:'3px',textUnderlineOffset:'5px'}:{}},b[lang])));
    const key=r.session+'|'+r.index+'|'+lang;if(getView()==='couple'&&key!==lastScroll){lastScroll=key;requestAnimationFrame(()=>root.querySelector('[data-reading-active]')?.scrollIntoView({behavior:'smooth',block:'center'}));}
    return root;
  }
  window.addEventListener('pagehide',stop);
  return {panel,remotePanel,body,sync,stop};
}
