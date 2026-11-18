export const MARK_FRIDAY_ID='s1793894800504-0';
export const MARK_FRIDAY_FILE='mark-maria-luisa-venerdi-archivio-2026.json';
const LANGS=['it','en','fr','es','pt'];
let busy=false,completed=false,failed=false;
export async function archiveMarkFriday({firestore,doc,runTransaction,loadPublicText,compactPublicShare}) {
  if(busy||completed||failed)return false;
  busy=true;
  try {
    const archive=await loadPublicText(MARK_FRIDAY_FILE);
    if(archive.id!==MARK_FRIDAY_ID || !archive.readingBlocks?.length || !LANGS.every(lang=>
      archive.readingBlocks.map(block=>block[lang]||'').join('')===archive.translations?.[lang]?.body))
      throw Error('Archivio Mark e Maria Luisa venerdì non valido: nessun dato rimosso.');
    const saved=await runTransaction(firestore,async tx=>{
      const ref=doc(firestore,'state','main'),snapshot=await tx.get(ref);
      if(!snapshot.exists())throw Error('Archivio app non disponibile.');
      const state=snapshot.data(),current=state.shares?.find(share=>share.id===MARK_FRIDAY_ID);
      if(!current)return false;
      if(current.publicTextFile===MARK_FRIDAY_FILE)return true;
      // Non interrompere una lettura attiva; riprovare quando viene disattivata.
      if(state.activeShareId===MARK_FRIDAY_ID || state.readingFollow?.shareId===MARK_FRIDAY_ID)return false;
      if(!LANGS.every(lang=>current.translations?.[lang]?.body===archive.translations[lang].body &&
        current.translations[lang].title===archive.translations[lang].title))
        throw Error('I testi Mark e Maria Luisa venerdì sono cambiati: collegamento annullato per conservarli.');
      if(JSON.stringify(current.inlineSlides)!==JSON.stringify(archive.inlineSlides) ||
        current.slideArchive!==archive.slideArchive ||
        JSON.stringify(current.readingBlocks)!==JSON.stringify(archive.readingBlocks))
        throw Error('Passaggi o slide cambiati: archiviazione annullata.');
      const compact=compactPublicShare({...current,publicTextFile:MARK_FRIDAY_FILE});
      tx.update(ref,{shares:state.shares.map(share=>share.id===MARK_FRIDAY_ID?compact:share)});
      return true;
    });
    completed=saved;
    return saved;
  }catch(error){failed=true;throw error;}
  finally{busy=false;}
}


