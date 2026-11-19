const recovery={"share":{"time":"","readingBlocks":null,"speakerLanguage":"it","sectionId":"sab-sera","id":"github-preghiera-sabato-ti-do-tutto-signore-2026","day":"Sabato 28 novembre 2026","readingSegmentationVersion":2,"publicSlidePositions":[],"imageUrl":"","inlineSlides":[],"publicTextFile":"preghiera-sabato-ti-do-tutto-signore-2026.json","slideArchive":null,"coupleName":"Preghiera","translations":{"it":{"title":"Preghiera – Ti do tutto, Signore","body":""},"en":{"title":"Prayer – I Give You Everything, Lord","body":""},"fr":{"title":"Prière – Je te donne tout, Seigneur","body":""},"es":{"title":"Oración – Te lo doy todo, Señor","body":""},"pt":{"title":"Oração – Dou-Te Tudo, Senhor","body":""}}},"previousId":"github-annalisa-nascita-comunita-portogallo-sabato-sera-2026","nextId":"github-marcelo-apertura-sabato-mattina-comunita-2026"};
export const PRAYER_RECOVERY_KEY='prayer-20261119-v1';
let busy=false,finished=false,failed=false;
export async function restorePrayer({firestore,doc,runTransaction,loadPublicText}) {
  if(busy||finished||failed)return false;
  busy=true;
  try {
    const source=await loadPublicText(recovery.share.publicTextFile);
    if(!['it','en','fr','es','pt'].every(lang=>source.translations?.[lang]?.title===recovery.share.translations[lang].title && source.translations[lang].body.length>100))
      throw Error('I testi della preghiera non corrispondono: ripristino annullato.');
    const result=await runTransaction(firestore,async tx=>{
      const ref=doc(firestore,'state','main'),snapshot=await tx.get(ref);
      if(!snapshot.exists())throw Error('Archivio non disponibile.');
      const state=snapshot.data();
      if(state.contentRestorations?.[PRAYER_RECOVERY_KEY])return false;
      const matches=(state.shares||[]).filter(share=>share.id===recovery.share.id ||
        share.publicTextFile===recovery.share.publicTextFile ||
        share.translations?.it?.title===recovery.share.translations.it.title);
      if(matches.length>1 || (matches.length===1&&matches[0].id!==recovery.share.id))
        throw Error('Esiste già una preghiera con questo titolo: nessun duplicato creato.');
      const patch={contentRestorations:{...(state.contentRestorations||{}),[PRAYER_RECOVERY_KEY]:true}};
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
