const recovery={"share":{"speakerLanguage":"it","readingBlocks":null,"day":"Venerdì 27 novembre 2026","time":"20:45","translations":{"it":{"title":"INIZIO MEETING – MARCELO","body":""},"en":{"title":"OPENING OF THE MEETING – MARCELO","body":""},"fr":{"title":"OUVERTURE DE LA RENCONTRE – MARCELO","body":""},"es":{"title":"APERTURA DEL ENCUENTRO – MARCELO","body":""},"pt":{"title":"ABERTURA DO ENCONTRO – MARCELO","body":""}},"id":"s1793826361960-0","imageUrl":"","sectionId":"ven-sera","coupleName":"Marcelo","publicTextFile":"inizio-meeting-marcelo-2026.json"},"previousId":null,"nextId":"github-benvenuto-annalisa-venerdi-2026"};
export const INIZIO_RECOVERY_KEY='inizio-20261119-v1';
let busy=false,finished=false,failed=false;
export async function restoreInizio({firestore,doc,runTransaction,loadPublicText}) {
  if(busy||finished||failed)return false;
  busy=true;
  try {
    const source=await loadPublicText(recovery.share.publicTextFile);
    if(!['it','en','fr','es','pt'].every(lang=>source.translations?.[lang]?.title===recovery.share.translations[lang].title && source.translations[lang].body.length>100))
      throw Error('I testi di Inizio Marcelo non corrispondono: ripristino annullato.');
    const result=await runTransaction(firestore,async tx=>{
      const ref=doc(firestore,'state','main'),snapshot=await tx.get(ref);
      if(!snapshot.exists())throw Error('Archivio non disponibile.');
      const state=snapshot.data();
      if(state.contentRestorations?.[INIZIO_RECOVERY_KEY])return false;
      const matches=(state.shares||[]).filter(share=>share.id===recovery.share.id ||
        share.publicTextFile===recovery.share.publicTextFile ||
        share.translations?.it?.title===recovery.share.translations.it.title);
      if(matches.length>1 || (matches.length===1&&matches[0].id!==recovery.share.id))
        throw Error('Esiste già una condivisione con questo titolo: nessun duplicato creato.');
      const patch={contentRestorations:{...(state.contentRestorations||{}),[INIZIO_RECOVERY_KEY]:true}};
      if(!matches.length){
        if(!state.sections?.some(section=>section.id===recovery.share.sectionId))
          throw Error('La sezione originale non è disponibile: nessuna modifica.');
        const shares=[...(state.shares||[])];
        const next=shares.findIndex(share=>share.id===recovery.nextId);
        const previous=shares.findIndex(share=>share.id===recovery.previousId);
        const index=next>=0?next:previous>=0?previous+1:shares.length;
        shares.splice(index,0,structuredClone(recovery.share));
        patch.shares=shares;
      }
      tx.update(ref,patch);
      return true;
    });
    finished=true;
    return result;
  }catch(error){failed=true;throw error;}
  finally{busy=false;}
}

