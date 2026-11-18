export const FORMAZIONE_ID='s1791397777272-0';
export const FORMAZIONE_FILE='formazione-comunita-2026.json';
const LANGS=['it','en','fr','es','pt'];
let busy=false,completed=false,failed=false;
export async function archiveFormazione({firestore,doc,runTransaction,loadPublicText,compactPublicShare}) {
  if(busy||completed||failed)return false;
  busy=true;
  try {
    const archive=await loadPublicText(FORMAZIONE_FILE);
    if(archive.id!==FORMAZIONE_ID || !archive.readingBlocks?.length || !LANGS.every(lang=>
      archive.readingBlocks.map(block=>block[lang]||'').join('')===archive.translations?.[lang]?.body))
      throw Error('Archivio Formazione non valido: nessun dato rimosso.');
    const saved=await runTransaction(firestore,async tx=>{
      const ref=doc(firestore,'state','main'),snapshot=await tx.get(ref);
      if(!snapshot.exists())throw Error('Archivio app non disponibile.');
      const state=snapshot.data(),current=state.shares?.find(share=>share.id===FORMAZIONE_ID);
      if(!current)return false;
      if(current.publicTextFile===FORMAZIONE_FILE)return true;
      // Non interrompere una lettura attiva; riprovare quando viene disattivata.
      if(state.activeShareId===FORMAZIONE_ID || state.readingFollow?.shareId===FORMAZIONE_ID)return false;
      if(!LANGS.every(lang=>current.translations?.[lang]?.body===archive.translations[lang].body &&
        current.translations[lang].title===archive.translations[lang].title))
        throw Error('I testi Formazione sono cambiati: collegamento annullato per conservarli.');
      const compact=compactPublicShare({...current,publicTextFile:FORMAZIONE_FILE});
      tx.update(ref,{shares:state.shares.map(share=>share.id===FORMAZIONE_ID?compact:share)});
      return true;
    });
    completed=saved;
    return saved;
  }catch(error){failed=true;throw error;}
  finally{busy=false;}
}
