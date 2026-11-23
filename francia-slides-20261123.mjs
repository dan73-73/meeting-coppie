export const FRANCE_SLIDES_ID='github-francia-benigne-philibert-2026';
export const FRANCE_SLIDES_FILE='francia-benigne-philibert-2026.json';
export const FRANCE_SLIDES_ARCHIVE='FRANCIA_BENIGNE_PHILIBERT_MEETING_slides_5_LINGUE.zip';
export const FRANCE_SLIDE_POSITIONS=[-1,2,4,5,6,7,8,9,10,11,12,13,14,15,15,16,17,18]
  .map((afterBlock,index)=>({number:index+1,afterBlock}));
const LANGS=['it','en','fr','es','pt'];
const TEXT_HASHES={"it":"fc959cd079825f8c4ef39bd2a089fb8a1096d0c3bde89d92468fb92499fb6305","en":"8cfcf1942145853db630009e4ff3d419a01f50f5219747bbd6bab067d024d7aa","fr":"b490d26c3df827966d6103038cef99865c64648cb94fddbbc838de0a025a7a3d","es":"19ec9e4413674dc6b85946fc196dbd8ad578c51e6c7c868bfc77ad94577be2ee","pt":"b06b303d170a7746915a45203030421194a719246c39071732639393902442f3"};
let busy=false,completed=false,failed=false;
const samePositions=value=>JSON.stringify(value)===JSON.stringify(FRANCE_SLIDE_POSITIONS);
export async function linkFranceSlides({firestore,doc,runTransaction,loadPublicText,checkSlideArchive}) {
  if(busy||completed||failed)return false;
  busy=true;
  try {
    const source=await loadPublicText(FRANCE_SLIDES_FILE);
    if(source.id!==FRANCE_SLIDES_ID)throw Error('La condivisione francese non corrisponde: nessuna modifica.');
    for(const lang of LANGS) {
      const body=source.translations?.[lang]?.body;
      if(typeof body!=='string')throw Error('Testo francese incompleto nelle cinque lingue.');
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
      const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
      if(hash!==TEXT_HASHES[lang])throw Error('Il testo della presentazione francese è cambiato: collegamento annullato.');
    }
    await checkSlideArchive(FRANCE_SLIDES_ARCHIVE,FRANCE_SLIDE_POSITIONS.map(p=>p.number));
    const saved=await runTransaction(firestore,async tx=>{
      const ref=doc(firestore,'state','main'),snapshot=await tx.get(ref);
      if(!snapshot.exists())throw Error('Programma non disponibile.');
      const state=snapshot.data();
      const matches=(state.shares||[]).filter(s=>s.id===FRANCE_SLIDES_ID);
      if(matches.length!==1)throw Error('Presentazione francese assente o duplicata: nessuna modifica.');
      const current=matches[0];
      if(current.slideArchive===FRANCE_SLIDES_ARCHIVE && samePositions(current.publicSlidePositions))return true;
      // Attendere la disattivazione. Non modificare mai una lettura in corso.
      if(state.activeShareId===FRANCE_SLIDES_ID || state.readingFollow?.shareId===FRANCE_SLIDES_ID)return false;
      if(current.publicTextFile!==FRANCE_SLIDES_FILE ||
        !LANGS.every(lang=>current.translations?.[lang]?.title===source.translations[lang].title &&
          (!current.translations[lang].body || current.translations[lang].body===source.translations[lang].body)))
        throw Error('La presentazione francese è stata modificata: collegamento annullato per conservarla.');
      if(current.slideArchive && current.slideArchive!==FRANCE_SLIDES_ARCHIVE)
        throw Error('Esiste già un altro archivio slide: nessuna sostituzione eseguita.');
      if((current.inlineSlides||[]).length || (current.publicSlidePositions||[]).length)
        throw Error('Esistono già posizioni slide diverse: nessuna sostituzione eseguita.');
      const updated={...current,slideArchive:FRANCE_SLIDES_ARCHIVE,
        publicSlidePositions:FRANCE_SLIDE_POSITIONS.map(p=>({...p}))};
      tx.update(ref,{shares:state.shares.map(share=>share.id===FRANCE_SLIDES_ID?updated:share)});
      return true;
    });
    completed=saved;
    return saved;
  }catch(error){failed=true;throw error;}
  finally{busy=false;}
}
