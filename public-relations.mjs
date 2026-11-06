// Archivio relazioni autorizzate alla pubblicazione - importazioni GitHub Pages.
// Le relazioni non attive restano come metadati compatti in Firebase.
// La condivisione attiva viene materializzata nel database per il modulo di lettura.
const cache=new Map();
const LANGS=['it','en','fr','es','pt'];
export const REGION_ITALIA_FILE='region-italia-nicola-antonella.json';
export function publicTextUrl(filename){
  if(!/^[a-z0-9][a-z0-9_-]*\.json$/i.test(filename))throw Error('Nome archivio testi non valido.');
  return new URL('./relazioni-pubbliche/'+filename,import.meta.url).href;
}
export async function loadPublicText(filename){
  if(cache.has(filename))return cache.get(filename);
  const promise=(async()=>{
    const url=publicTextUrl(filename);
    const abort=new AbortController();
    const timeout=setTimeout(()=>abort.abort(),12000);
    try{
      const response=await fetch(url,{cache:'no-cache',signal:abort.signal});
      if(!response.ok)throw Error('Archivio testi non disponibile (HTTP '+response.status+').');
      const parsed=await response.json();
      if(!Array.isArray(parsed.shares)||parsed.shares.length!==1)
        throw Error('Archivio testi non contiene una sola relazione.');
      const share=parsed.shares[0];
      if(!LANGS.every(lang=>typeof share.translations?.[lang]?.body==='string'&&share.translations[lang].body.length>100))
        throw Error('Archivio testi incompleto: occorrono cinque lingue.');
      return share;
    }finally{clearTimeout(timeout);}
  })();
  cache.set(filename,promise);
  promise.catch(()=>cache.delete(filename));
  return promise;
}
export function compactPublicShare(share){
  if(!share?.publicTextFile)return share;
  return {...share,
    translations:Object.fromEntries(LANGS.map(lang=>[lang,{title:share.translations?.[lang]?.title||'',body:''}])),
    readingBlocks:null
  };
}
export function preparePublicSave(state){
  return {...state,shares:(state.shares||[]).map(s=>
    s.publicTextFile&&s.id!==state.activeShareId?compactPublicShare(s):s)};
}
export function hydratePublicShare(meta,archive,blocks){
  const translations=archive.translations;
  return {...meta,translations,readingBlocks:meta.readingBlocks?.length?meta.readingBlocks:blocks(translations)};
}
export function publicTextMatches(current,archive){
  return LANGS.every(l=>current.translations?.[l]?.body===archive.translations?.[l]?.body &&
    current.translations[l].title===archive.translations[l].title);
}
