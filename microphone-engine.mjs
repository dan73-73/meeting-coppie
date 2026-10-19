// Independent microphone lifecycle. Changing the displayed share never stops listening.
export function createMicrophone({Recognition,onTranscript,onStatus}) {
  let wanted=false,paused=false,language='it-IT',instance=null,epoch=0,retry=null;
  const clear=()=>{if(retry!==null){clearTimeout(retry);retry=null;}};
  function dispose(){clear();const old=instance;instance=null;epoch++;if(old){old.onend=null;old.onerror=null;old.onresult=null;old.onstart=null;try{old.abort();}catch{}}}
  function launch(){
    if(!wanted||!Recognition)return;
    clear();const token=++epoch;let r;
    try{r=new Recognition();instance=r;r.lang=language;r.continuous=true;r.interimResults=true;}
    catch(e){onStatus('Impossibile inizializzare il microfono: '+e.message);return;}
    r.onstart=()=>{if(token===epoch)onStatus(paused?'Microfono acceso · lettura in pausa':'Microfono in ascolto');};
    r.onresult=event=>{if(token!==epoch||!wanted||paused)return;onTranscript(event);};
    r.onerror=event=>{
      if(token!==epoch||!wanted)return;
      if(['not-allowed','service-not-allowed','audio-capture'].includes(event.error)){wanted=false;dispose();onStatus('Permesso microfono o dispositivo non disponibile: '+event.error);return;}
      onStatus('Riconoscimento in riavvio: '+event.error);
    };
    r.onend=()=>{
      if(token!==epoch||!wanted)return;
      instance=null;
      retry=setTimeout(()=>{retry=null;if(token===epoch&&wanted)launch();},650);
    };
    try{r.start();}catch(e){if(token!==epoch||!wanted)return;instance=null;onStatus('Riprovo ad avviare il microfono');retry=setTimeout(()=>{retry=null;if(token===epoch&&wanted)launch();},1200);}
  }
  return {
    start(lang){if(!Recognition)throw Error('Riconoscimento vocale non supportato dal browser.');wanted=true;paused=false;language=lang||language;dispose();launch();},
    stop(){wanted=false;paused=false;dispose();onStatus('Microfono fermo.');},
    pause(value){paused=!!value;onStatus(paused?'Lettura in pausa; microfono in ascolto.':'Lettura ripresa.');},
    setLanguage(lang){if(!lang||lang===language)return;language=lang;if(wanted){dispose();launch();}},
    get active(){return wanted;},
    get paused(){return paused;},
    get language(){return language;}
  };
}
