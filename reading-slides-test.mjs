import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

// I file immagini stanno nell'archivio ZIP statico, non nel documento Firebase.
// Un archivio viene scaricato una sola volta per sessione e riutilizzato.
const archives=new Map();
const urls=new Map();
const LANGS=['it','fr','es','en','pt'];
export const slideArchiveUrl=name=>
  new URL('./slide-archives/'+encodeURIComponent(name),import.meta.url).href;

export async function checkSlideArchive(name,expectedNumbers) {
  if(!/^[a-zA-Z0-9_-]+\.zip$/.test(name))
    throw Error('Nome archivio non valido: usare solo lettere, numeri, - e _.');
  const url=slideArchiveUrl(name);
  let promise=archives.get(url);
  if(!promise){
    promise=(async()=>{
      const raw='https://raw.githubusercontent.com/dan73-73/meeting-coppie/main/slide-archives/'+encodeURIComponent(name);
      let lastError=null;
      for(const address of [url,raw]){
        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),12000);
        try{
          const response=await fetch(address,{cache:'no-cache',signal:controller.signal});
          if(!response.ok)throw Error('HTTP '+response.status);
          const zip=await JSZip.loadAsync(await response.blob());
          return zip;
        }catch(err){lastError=err;}finally{clearTimeout(timeout);}
      }
      throw Error('Non riesco a scaricare lo ZIP da GitHub: '+(lastError?.message||lastError));
    })();
    archives.set(url,promise);
    promise.catch(()=>archives.delete(url));
  }
  const zip=await promise;
  for(const num of expectedNumbers){
    for(const lang of LANGS){
      const key=lang+'/slide_'+String(num).padStart(2,'0')+'.webp';
      if(!zip.file(key))throw Error('Archivio incompleto: manca '+key);
    }
  }
  return true;
}
async function resolveImage(archive,lang,number) {
  const key=archive+'|'+lang+'|'+number;
  if(urls.has(key))return urls.get(key);
  await checkSlideArchive(archive,[number]);
  const zip=await archives.get(slideArchiveUrl(archive));
  const file=zip.file(lang+'/slide_'+String(number).padStart(2,'0')+'.webp');
  const objectUrl=URL.createObjectURL(await file.async('blob'));
  urls.set(key,objectUrl);
  return objectUrl;
}
export function slideAt(share,lang,blockIndex,createElement) {
  const slides=Array.isArray(share?.inlineSlides)?share.inlineSlides:[];
  return slides.filter(s=>Number.isInteger(s?.afterBlock)&&s.afterBlock===blockIndex)
    .map(s=>{
      const embedded=s.images?.[lang];
      const archive=share.publicTextFile==='italia-centro-roby-silvia.json' ? 'ITALIA_CENTRO_MEETING_slides_5_LINGUE_CORRETTE.zip' : share.slideArchive;
      const allowed=typeof embedded==='string'&&/^(https:\/\/|data:image\/webp;base64,)/i.test(embedded);
      if(!allowed&&!archive)return null;
      const image=createElement('img',{
        ...(allowed?{src:embedded}:{}),
        alt:s.alt?.[lang]||('Slide '+(s.number||'')),
        loading:'lazy',style:{display:'block',width:'100%',height:'auto',objectFit:'contain',borderRadius:'8px'}
      });
      if(!allowed&&archive){
        image.setAttribute('data-archive-slide',String(s.number));
        resolveImage(archive,lang,s.number)
          .then(url=>{if(image.isConnected)image.src=url;})
          .catch(err=>{if(image.isConnected)image.alt='Slide non disponibile: '+(err.message||err);});
      }
      return createElement('figure',{'data-reading-slide':'true',
        style:{margin:'18px 0 24px',padding:'10px',background:'rgba(255,255,255,.05)',
          border:'1px solid rgba(200,169,110,.2)',borderRadius:'12px',whiteSpace:'normal'}},image);
    }).filter(Boolean);
}
