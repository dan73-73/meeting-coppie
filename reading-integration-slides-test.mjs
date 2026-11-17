import {createRecoveryMatcher} from './reading-recovery.mjs';
import {createMicrophone} from './microphone-engine.mjs';
import {slideAt} from './reading-slides-test.mjs?v=italia-centro-five-languages-20261107';
import {LANGS,suggestBlocks,shortenLongReadingBlocks,validateBlocks} from './reading-follow.mjs?v=punctuation-20261106a';
import {refineReadingForSlides,preparePublicSlideReading} from './reading-slide-segments.mjs?v=public-slides-20261106';
import {doc,runTransaction,updateDoc} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {loadPublicText,hydratePublicShare,compactPublicShare} from './public-relations.mjs?v=public-text-pilot-1';

export function createReadingIntegration({db,e,getState,isAdmin,getView,refresh}) {
  const ref=doc(db,'state','main');
  const names={it:'Italiano',en:'English',fr:'Français',es:'Español',pt:'Português'};
  const locales={it:'it-IT',en:'en-US',fr:'fr-FR',es:'es-ES',pt:'pt-PT'};
  function spokenLanguage(share){const code=share?.speakerLanguage||share?.sourceLanguage||share?.originalLanguage||share?.spokenLanguage;return locales[code]?code:null;}
  const buttonStyle={padding:'8px 14px',borderRadius:'16px',border:'1px solid rgba(200,169,110,.4)',background:'transparent',color:'#c8a96e',cursor:'pointer',fontSize:'14px'};
  let microphoneHost=false,requestedPause=false,lastRemoteCommand=null,source='it',status='Microfono fermo.',pending=null,sending=false,timer=null,restart=null,session=null,dialog=null,localIndex=null,localRevision=null;
  function message(text){status=text;const p=document.getElementById('reading-status');if(p)p.textContent=text;}
  function stop(){requestedPause=false;pending=null;localIndex=null;localRevision=null;clearTimeout(timer);clearTimeout(restart);timer=null;mic.stop();}
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
  let matcher=null,matcherBlocks=null,matcherLanguage=null;
  const mic=createMicrophone({
    Recognition:window.SpeechRecognition||window.webkitSpeechRecognition,
    onStatus:message,
    onTranscript:event=>{
      const live=getState().readingFollow,share=active();
      if(!valid(live,share))return;
      if(matcherBlocks!==live.blocks||matcherLanguage!==source){
        matcher=createRecoveryMatcher(live.blocks,source);
        matcherBlocks=live.blocks;matcherLanguage=source;
      }
      for(let i=event.resultIndex;i<event.results.length;i++){
        const cursor=localRevision===(live.revision||0)&&localIndex!==null?localIndex:(live.index??0);
        const index=matcher(event.results[i][0].transcript,Math.max(0,cursor));
        if(index!==null)queue(index);
      }
    }
  });
  const splitAttempted=new Set();
  let automaticSplitRunning=false;
  function needsShortening(share) {
    return share?.readingSegmentationVersion!==2 && Array.isArray(share?.inlineSlides) && share.inlineSlides.length>0 &&
      Array.isArray(share?.readingBlocks) && share.readingBlocks.length>0;
  }
  function sync(){
    const share=active();
    if(!mic.active && !automaticSplitRunning && isAdmin() && needsShortening(share) && !splitAttempted.has(share.id)){
      splitAttempted.add(share.id);
      automaticSplitRunning=true;
      message('Preparazione automatica dei passaggi brevi…');
      shortenHighlightedPassages()
        .catch(err=>message('Errore nella preparazione automatica: '+(err?.message||err)))
        .finally(()=>{automaticSplitRunning=false;});
    }
    if(!isAdmin()||getView()!=='admin'){if(mic.active)stop();return;}
    const state=getState(),follow=state.readingFollow,cmd=state.readingRemote;
    // Only the computer on which reading was started answers microphone commands.
    if(!mic.active){
      if(microphoneHost&&cmd?.id&&cmd.id!==lastRemoteCommand&&['pause','resume','stop'].includes(cmd.command)){
        lastRemoteCommand=cmd.id;
        acknowledge(cmd.id,cmd.command==='stop'?'microfono fermo':'microfono fermo · premi Avvia lettura sul computer');
      }
      return;
    }
    const changed=session!==follow?.session;
    if(changed){session=follow?.session||null;pending=null;localIndex=null;localRevision=null;}
    const language=spokenLanguage(share);
    if(language&&language!==source){
      source=language;pending=null;localIndex=null;localRevision=null;
      mic.setLanguage(locales[source]);
      message('Lingua del relatore aggiornata: '+names[source]+'.');
    }
    if(cmd?.id&&cmd.id!==lastRemoteCommand){
      lastRemoteCommand=cmd.id;
      if(['pause','resume','stop'].includes(cmd.command)&&cmd.session!==follow?.session){
        acknowledge(cmd.id,'comando scaduto · invialo di nuovo');return;
      }
      if(cmd.command==='stop'){stop();acknowledge(cmd.id,'microfono fermo');return;}
      if(cmd.command==='pause'){requestedPause=true;}
      if(cmd.command==='resume'){requestedPause=false;}
      if(cmd.command==='pause'||cmd.command==='resume'){
        pending=null;localIndex=null;localRevision=null;
        mic.pause(requestedPause);
        acknowledge(cmd.id,mic.paused?'pausa':'automatico');
      }
      if(cmd.command==='next'||cmd.command==='previous'){
        acknowledge(cmd.id,'condivisione cambiata');
      }
    }
    const shouldPause=requestedPause;
    if(mic.paused!==shouldPause){
      pending=null;localIndex=null;localRevision=null;
      mic.pause(shouldPause);
    }
  }
  async function remoteCommand(command){
    const state=getState(),share=active();
    if(!isAdmin()||!share)throw Error('Seleziona una condivisione attiva.');
    let externalNext=null,externalTargetId=null;
    if(command==='next'||command==='previous'){
      const ordered=orderedShares(state),index=ordered.findIndex(x=>x.id===share.id);
      const target=ordered[index+(command==='next'?1:-1)];
      if(target?.publicTextFile){
        externalNext=await loadPublicText(target.publicTextFile);
        externalTargetId=target.id;
      }
    }
    await runTransaction(db,async tx=>{
      const snap=await tx.get(ref),now=snap.data();
      if(!now||now.activeShareId!==share.id)throw Error('La condivisione attiva è cambiata.');
      const current=now.readingFollow,sessionId=current?.session||null;
      if(command==='next'||command==='previous'){
        const items=orderedShares(now),index=items.findIndex(x=>x.id===share.id);
        const next=items[index+(command==='next'?1:-1)];
        if(!next)throw Error('Non ci sono altre condivisioni in questa direzione.');
        if(next.publicTextFile&&(!externalNext||externalTargetId!==next.id))
          throw Error('Testo pubblico non preparato: cambio condivisione annullato.');
        const prepared=next.publicTextFile
          ? hydratePublicShare(next,externalNext,translations=>shortenLongReadingBlocks(suggestBlocks(translations).blocks,translations,105))
          : next;
        if(next.publicTextFile){
          if(next.publicSlidePositions?.length){
            const refined=preparePublicSlideReading(prepared.translations,next.publicSlidePositions);
            prepared.readingBlocks=refined.readingBlocks;
            prepared.inlineSlides=refined.inlineSlides;
            prepared.readingSegmentationVersion=2;
          }else{
            prepared.readingBlocks=shortenLongReadingBlocks(usableBlocks(prepared)||suggestBlocks(prepared.translations).blocks,prepared.translations,105);
          }
        }
        const blocks=usableBlocks(prepared),nextSession=crypto.randomUUID(),id=crypto.randomUUID();
        const patch={displayMode:'one',activeShareId:next.id,
          readingFollow:blocks?{shareId:next.id,session:nextSession,blocks,index:0,revision:0}:null,
          readingRemote:{previousSession:sessionId,session:blocks?nextSession:null,command,id,manual:!blocks}};
        if((now.shares||[]).some(s=>s.publicTextFile))
          patch.shares=now.shares.map(s=>s.id===next.id?prepared:compactPublicShare(s));
        tx.update(ref,patch);
      }else if(command==='pause'||command==='resume'||command==='manual'||command==='stop'){
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
    pending=null;localIndex=null;localRevision=null;const bounded=Math.max(-1,Math.min(index,record.blocks.length-1));
    await runTransaction(db,async tx=>{const snap=await tx.get(ref),now=snap.data(),r=now?.readingFollow;if(now?.activeShareId!==share.id||r?.session!==record.session)throw Error('La condivisione attiva è cambiata.');tx.update(ref,{readingFollow:{...r,index:bounded,revision:(r.revision||0)+(manual?1:0)}});});
  }
  // Non leggere il documento con tutte le immagini per ogni nuova frase.
  // Aggiorna solo il campo index, senza transazioni sulle slide.
  function queue(index){
    const r=getState().readingFollow;if(!r)return;
    const rev=r.revision||0;
    const current=localRevision===rev&&localIndex!==null?localIndex:(r.index??0);
    if(index===current||index<0||index>=r.blocks.length)return;
    localIndex=index;localRevision=rev;
    pending={index,session:r.session,revision:rev,shareId:r.shareId};
    if(!timer&&!sending)timer=setTimeout(flush,80);
  }
  async function flush(){
    timer=null;if(sending||!pending)return;
    const item=pending;pending=null;
    const state=getState(),r=state.readingFollow;
    if(!mic.active||mic.paused||!isAdmin()||
       state.activeShareId!==item.shareId||
       r?.session!==item.session||(r.revision||0)!==item.revision)return;
    sending=true;
    try{
      await updateDoc(ref,{'readingFollow.index':item.index});
      message('Lettura sincronizzata · passaggio '+(item.index+1));
    }catch(err){
      message('Errore invio lettura: '+(err.code||err.message||err));
      // Non avanzare artificialmente il cursore se il salvataggio è fallito.
      localIndex=r.index??0;
    }finally{
      sending=false;
      if(pending&&!timer)timer=setTimeout(flush,0);
    }
  }
  function start(){
    const share=active(),record=getState().readingFollow;
    if(!isAdmin()||!valid(record,share))throw Error('Prepara i passaggi della condivisione attiva.');
    if(needsShortening(share))throw Error('La suddivisione automatica non è completata. Controlla il messaggio sotto i pulsanti.');
    const lang=spokenLanguage(share);if(lang)source=lang;
    stop();microphoneHost=true;localIndex=record.index??0;localRevision=record.revision||0;session=record.session;lastRemoteCommand=getState().readingRemote?.id||null;
    requestedPause=false;mic.start(locales[source]);
  }
  async function shortenHighlightedPassages(){
    if(!isAdmin())throw Error('Accesso amministratore necessario.');
    const selected=active();
    if(!selected)throw Error('Nessuna relazione attiva.');
    await runTransaction(db,async tx=>{
      const snap=await tx.get(ref),s=snap.data();
      const share=(s?.shares||[]).find(x=>x.id===selected.id);
      if(!share)throw Error('La relazione non è più presente.');
      if(s.activeShareId!==selected.id||(s.displayMode||'one')!=='one')
        throw Error('La relazione attiva è cambiata.');
      if(!needsShortening(share))return;
      const result=refineReadingForSlides(share.readingBlocks,share.inlineSlides,share.translations);
      if(!result.changed)return;
      const shares=s.shares.map(x=>x.id===share.id?{...x,readingBlocks:result.blocks,inlineSlides:result.inlineSlides,readingSegmentationVersion:2}:x);
      const patch={shares};
      if(s.readingFollow?.shareId===share.id) {
        const oldIndex=Math.max(0,s.readingFollow.index||0);
        // L'operazione viene effettuata a microfono fermo; la lettura riparte dall'inizio.
        patch.readingFollow={...s.readingFollow,session:crypto.randomUUID(),
          blocks:result.blocks,index:0,revision:(s.readingFollow.revision||0)+1};
      }
      if(new TextEncoder().encode(JSON.stringify({...s,...patch})).length>850000)
        throw Error('Spazio dati insufficiente: nessuna modifica salvata.');
      tx.update(ref,patch);
    });
    refresh();
    message('Passaggi brevi pronti. Le slide non sono state spostate.');
  }
  // Correzione circoscritta alla formazione comunità, senza cambiare nessuna parola.
  async function fixFormazioneHighlight(){
    if(!isAdmin())throw Error('Accesso amministratore richiesto.');
    stop();
    const selected=active();
    if(!selected||selected.translations?.it?.title!=='Formazione Comunità 2026')
      throw Error('Attiva prima Formazione Comunità 2026. Nessun dato modificato.');
    await runTransaction(db,async tx=>{
      const snap=await tx.get(ref),state=snap.data();
      if(!state||state.activeShareId!==selected.id||(state.displayMode||'one')!=='one')
        throw Error('La condivisione attiva è cambiata.');
      const live=(state.shares||[]).find(x=>x.id===selected.id);
      if(!live||live.translations?.it?.title!=='Formazione Comunità 2026')
        throw Error('La condivisione non corrisponde. Nessun salvataggio.');
      if(Array.isArray(live.inlineSlides)&&live.inlineSlides.length||Array.isArray(live.publicSlidePositions)&&live.publicSlidePositions.length)
        throw Error('Questa relazione contiene slide: occorre preservarne prima le posizioni. Nessun dato modificato.');
      const base=valid(state.readingFollow,live)?state.readingFollow.blocks:
        (Array.isArray(live.readingBlocks)&&live.readingBlocks.length?live.readingBlocks:suggestBlocks(live.translations).blocks);
      validateBlocks(base,live.translations);
      const blocks=shortenLongReadingBlocks(base,live.translations,105);
      if(blocks.length<=base.length)throw Error('I passaggi risultano già brevi. Nessuna modifica necessaria.');
      const patch={shares:state.shares.map(x=>x.id===live.id?{...x,readingBlocks:blocks}:x),
        readingFollow:{shareId:live.id,session:crypto.randomUUID(),blocks,index:0,revision:(state.readingFollow?.revision||0)+1}};
      if(new TextEncoder().encode(JSON.stringify({...state,...patch})).length>800000)
        throw Error('Spazio dati insufficiente. Nessun dato modificato.');
      tx.update(ref,patch);
    });
    refresh();message('Suddivisione completata nelle cinque lingue: rileggi dal primo passaggio.');
    alert('Evidenziazione corretta per Formazione Comunità 2026. Tutte e cinque le lingue conservate; lettura riposizionata all’inizio.');
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
    const savedLanguage=spokenLanguage(share);
    const displayLanguage=savedLanguage||source;
    const languageLabel=e('strong',{style:{fontSize:'14px',color:'#e8c87a'}},savedLanguage?names[savedLanguage]:'Da impostare dalla matita');
    const btn=(text,fn)=>e('button',{style:buttonStyle,onClick:action(fn)},text);
    return e('div',{style:{padding:'14px 16px',borderRadius:'12px',background:'rgba(200,169,110,.06)',border:'1px solid rgba(200,169,110,.25)',marginBottom:'20px'}},
      e('h3',{style:{color:'#c8a96e',fontSize:'16px',marginBottom:'8px'}},'🎙️ Segui la lettura'),
      e('p',{style:{color:'#a09080',fontSize:'13px',marginBottom:'10px'}},share?'Condivisione attiva: '+(share.translations?.it?.title||''):'Scegli “Una sola” e attiva la condivisione da leggere.'),
      e('div',{style:{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center'}},e('span',{style:{fontSize:'13px',color:'#a09080'}},'Lingua del relatore: ',languageLabel),btn('▶ Avvia lettura',()=>valid(getState().readingFollow,active())?start():prepare()),btn('⏹ Ferma lettura',stop),btn('⏸ Pausa da tablet',()=>remoteCommand('pause')),btn('▶ Riprendi da tablet',()=>remoteCommand('resume')),btn('⏭ Prossima condivisione (prova)',()=>remoteCommand('next')),btn('🆘 Manuale',()=>remoteCommand('manual')),btn('← Condivisione precedente',()=>remoteCommand('previous')),btn('Condivisione successiva →',()=>remoteCommand('next')),btn('⚙ Prepara passaggi',prepare),...(share?.translations?.it?.title==='Formazione Comunità 2026'?[btn('✂ Correggi evidenziazione formazione',fixFormazioneHighlight)]:[]),btn('← Precedente',()=>position((getState().readingFollow?.index||0)-1,true)),btn('Successivo →',()=>position((getState().readingFollow?.index??-1)+1,true))),
      e('p',{id:'reading-status',role:'status',style:{color:'#c8a96e',fontSize:'13px',marginTop:'10px'}},status),
      valid(r,share)?e('div',{style:{marginTop:'14px',padding:'14px',background:'#10101e',border:'1px solid #625536',borderRadius:'12px'}},
        e('p',{style:{color:'#c8a96e',fontSize:'13px',marginBottom:'10px'}},'📖 TESTO SINCRONIZZATO SUL COMPUTER · Passaggio '+((r.index??0)+1)+' di '+r.blocks.length),
        body(share,displayLanguage,share.translations?.[displayLanguage])
      ):null,
      e('p',{style:{fontSize:'12px',color:'#a09080',marginTop:'8px'}},'LINGUA: seleziona e salva la lingua del relatore con la matita nel Programma. Il microfono riconoscerà quella lingua; puoi cambiarla di nuovo per fare prove. Dal tablet puoi usare Pausa/Riprendi, ma il microfono resta sul computer. Le coppie continuano a usare il QR abituale.'));
  }
  // Il tablet aggiorna solo il codice della lingua della condivisione attiva.
  // Il PC riceve la modifica attraverso l'ascoltatore Firebase esistente;
  // sync() applica il nuovo locale al microfono senza cambiare i testi.
  async function setRemoteSpeakerLanguage(shareId,code){
    if(!isAdmin())throw Error('Accesso amministratore richiesto.');
    if(!locales[code])throw Error('Lingua non valida.');
    await runTransaction(db,async tx=>{
      const snap=await tx.get(ref),state=snap.data();
      if(!state||state.activeShareId!==shareId)
        throw Error('La condivisione attiva è cambiata. Ricarica il telecomando.');
      const current=(state.shares||[]).find(x=>x.id===shareId);
      if(!current)throw Error('Condivisione non trovata.');
      if(current.speakerLanguage===code)return;
      tx.update(ref,{shares:state.shares.map(x=>x.id===shareId?{...x,speakerLanguage:code}:x)});
    });
  }
  let remoteLanguageBusy=false;
  let remoteFullTextOpen=false;
  function remotePanel(){
    const state=getState(),share=active(),record=state.readingFollow,shares=orderedShares(state);
    const displayLang=spokenLanguage(share)||'it';
    const cmd=state.readingRemote,ack=state.readingRemoteAck;
    const confirmation=cmd?.id && ack?.id===cmd.id ? ((ack?.mode?.includes('premi Avvia')||ack?.mode?.includes('scaduto')?'⚠ RISPOSTA DEL COMPUTER · ':'✅ ESEGUITO DAL COMPUTER · ')+(ack?.mode||'')) : (cmd?.id?'⌛ COMANDO REGISTRATO · in attesa della conferma del computer':'Nessun comando inviato');
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
      (() => {
        const currentLanguage=spokenLanguage(share);
        let selectedLanguage=currentLanguage||'it';
        const langSelect=e('select',{
          ...(share?{}:{disabled:''}),
          style:{width:'100%',padding:'13px',fontSize:'17px',background:'#232339',color:'#f1e7cf',border:'1px solid #c8a96e',borderRadius:'10px'},
          onChange:ev=>{selectedLanguage=ev.target.value;}
        },...Object.entries(names).map(([code,label])=>e('option',{value:code,...(code===selectedLanguage?{selected:''}:{})},label)));
        const msg=e('p',{role:'status',style:{fontSize:'12px',color:'#c8a96e',minHeight:'18px'}},
          currentLanguage?'Lingua salvata: '+names[currentLanguage]+'. Il cambio verrà applicato sul PC quando il microfono è attivo.':'Seleziona la lingua parlata dal relatore e salva.');
        const save=e('button',{
          ...(share&&!remoteLanguageBusy?{}:{disabled:''}),
          style:{...buttonStyle,width:'100%',padding:'14px',fontWeight:'700',background:'#c8a96e',color:'#151522',opacity:share&&!remoteLanguageBusy?1:.45},
          onClick:async()=>{
            save.disabled=true;msg.textContent='Salvataggio lingua in corso…';
            try{
              await setRemoteSpeakerLanguage(share.id,selectedLanguage);
              msg.textContent='✅ Lingua salvata: '+names[selectedLanguage]+'. Il microfono del PC riceverà la modifica.';
            }catch(err){
              msg.textContent='Lingua non modificata: '+(err.message||err);
            }finally{save.disabled=false;}
          }
        },'💾 Applica lingua al relatore');
        return e('div',{style:{border:'1px solid rgba(200,169,110,.55)',borderRadius:'12px',padding:'15px',display:'grid',gap:'10px'}},
          e('strong',{style:{fontSize:'16px',color:'#e8c87a'}},'🌐 Lingua parlata dal relatore'),
          e('p',{style:{fontSize:'13px',color:'#a09080'}},'Puoi cambiarla da tablet o cellulare. Il microfono resta sul computer; la lingua letta dalle coppie non cambia.'),
          langSelect,save,msg);
      })(),
      e('button',{style:{...buttonStyle,width:'100%',padding:'14px',background:'rgba(200,169,110,.14)',fontWeight:'600'},onClick:()=>{remoteFullTextOpen=!remoteFullTextOpen;refresh();}},remoteFullTextOpen?'📖 Nascondi condivisione completa':'📖 Visualizza condivisione completa'),
      remoteFullTextOpen&&share?e('div',{style:{background:'#141423',border:'1px solid #8f7747',borderRadius:'12px',padding:'16px',maxHeight:'62vh',overflowY:'auto',overscrollBehavior:'contain'}},
        e('h3',{style:{color:'#e8c87a',fontSize:'17px',marginBottom:'12px'}},share.translations?.[displayLang]?.title||share.translations?.it?.title||'Condivisione in corso'),
        e('div',{style:{fontSize:'15px',lineHeight:'1.85',color:'#f0e4cc',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},
          ...(valid(record,share)?record.blocks.map((block,i)=>e('span',{'data-remote-reading-block':String(i),style:i===record.index&&record.blocks.length>1?{background:'rgba(232,200,117,.34)',borderRadius:'3px',boxDecorationBreak:'clone'}:{}},block[displayLang]||'')):[e('span',{},share.translations?.[displayLang]?.body||'Testo non disponibile')]))
      ):null,
      record?e('div',{id:'remote-reading-progress'},row('📍 PUNTO LETTURA',((record.index??0)+1)+' di '+record.blocks.length+'\n'+(record.blocks[record.index??0]?.[displayLang]||''))):null,
      btn('⏸ PAUSA','pause'),btn('▶ RIPRENDI','resume'),btn('⏹ FERMA LETTURA','stop'),
      e('p',{style:{fontSize:'13px',color:'#c8a96e'}},'Pausa sospende il seguito del testo; Riprendi lo riattiva. Ferma spegne il microfono: per riavviarlo premi Avvia lettura sul computer.'),
      btn('⬅ CONDIVISIONE PRECEDENTE','previous',!previous),
      btn('CONDIVISIONE SUCCESSIVA ➡','next',!next),
      e('div',{style:{border:'1px solid #b77',borderRadius:'14px',padding:'14px',display:'grid',gap:'10px'}},
        e('strong',{},'🆘 EMERGENZA · GUIDA MANUALE'),
        btn('ATTIVA GUIDA MANUALE','manual'),
        e('div',{id:'remote-manual-progress'},row('PASSAGGIO ATTUALE',record?((record.index??0)+1)+' / '+record.blocks.length+' · '+(record.blocks[record.index??0]?.[displayLang]||''):'Nessun testo preparato')),
        btn('⬅ CONDIVISIONE PRECEDENTE','previous',!previous),btn('CONDIVISIONE SUCCESSIVA ➡','next',!next),
        e('p',{style:{fontSize:'12px',color:'#a09080'}},'EMERGENZA: questi comandi cambiano l’intera condivisione, inclusi relatore, orario, titolo e testo nelle cinque lingue. Per tornare al microfono premi RIPRENDI.')),
      e('p',{id:'reading-status',role:'status',style:{color:'#c8a96e',fontSize:'13px'}},status));
  }
  function updateRemoteProgress(){
    const r=getState().readingFollow,lang=spokenLanguage(active())||'it';
    const progress=document.getElementById('remote-reading-progress');
    if(!r||!progress)return false;
    const text=r.blocks[r.index??0]?.[lang]||'';
    progress.querySelector('strong').textContent=((r.index??0)+1)+' di '+r.blocks.length+'\n'+text;
    const manual=document.getElementById('remote-manual-progress');
    if(manual)manual.querySelector('strong').textContent=((r.index??0)+1)+' / '+r.blocks.length+' · '+text;
    document.querySelectorAll('[data-remote-reading-block]').forEach(node=>{
      node.style.background=Number(node.getAttribute('data-remote-reading-block'))===r.index?'rgba(232,200,117,.34)':'';
    });
    return true;
  }
  let lastScroll='';
  function body(share,lang,content){
    const r=getState().readingFollow;const style={fontSize:'16px',lineHeight:'1.8',color:'#c8b89a',marginBottom:'16px',whiteSpace:'pre-wrap'};
    if(!valid(r,share)&&!share?.readingBlocks?.length)return e('p',{style},content?.body||'');
    const root=e('div',{style});
    // Le slide sono elementi visivi, mai aggiunti ai readingBlocks riconosciuti dal microfono.
    root.append(...slideAt(share,lang,-1,e));
    (valid(r,share)?r.blocks:share.readingBlocks).forEach((b,i)=>{
      root.append(e('span',{'data-reading-block':String(i),...(valid(r,share)&&i===r.index?{'data-reading-active':'true'}:{}),style:valid(r,share)&&i===r.index&&r.blocks.length>1?{background:'rgba(232,200,117,.38)',borderRadius:'3px',boxDecorationBreak:'clone'}:{}},b[lang]));
      root.append(...slideAt(share,lang,i,e));
    });
    const key=valid(r,share)?r.session+'|'+r.index+'|'+lang+'|'+getView():lastScroll;if(key!==lastScroll){lastScroll=key;requestAnimationFrame(()=>{if(root.isConnected)root.querySelector('[data-reading-active]')?.scrollIntoView({behavior:'smooth',block:'center'});});}
    return root;
  }
  function updateHighlight(shareId,index){
    const state=getState(),share=(state.shares||[]).find(x=>x.id===shareId),r=state.readingFollow;
    if(!valid(r,share))return false;
    const blocks=document.querySelectorAll('[data-reading-block]');
    if(blocks.length!==r.blocks.length)return false;
    let selected=null;
    for(const node of blocks){
      const isActive=Number(node.getAttribute('data-reading-block'))===index;
      if(isActive){
        node.setAttribute('data-reading-active','true');
        node.style.background='rgba(232,200,117,.38)';
        node.style.borderRadius='3px';
        node.style.boxDecorationBreak='clone';
        selected=node;
      }else{
        node.removeAttribute('data-reading-active');
        node.style.background='';
        node.style.borderRadius='';
        node.style.boxDecorationBreak='';
      }
    }
    if(selected)requestAnimationFrame(()=>{
      if(selected.isConnected)selected.scrollIntoView({behavior:'smooth',block:'center'});
    });
    return true;
  }
  window.addEventListener('pagehide',stop);
  return {panel,remotePanel,body,sync,stop,updateHighlight,updateRemoteProgress};
}
