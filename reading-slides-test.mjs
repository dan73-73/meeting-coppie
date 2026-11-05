// Solo presentazione visiva: NON aggiungere il testo delle slide ai readingBlocks.
export function slideAt(share, lang, blockIndex, createElement) {
  const slides = Array.isArray(share?.inlineSlides) ? share.inlineSlides : [];
  return slides.filter(s => Number.isInteger(s?.afterBlock) && s.afterBlock === blockIndex)
    .map(s => {
      const url = s.images?.[lang];
      if (typeof url !== 'string' || !(/^(https:\/\/|data:image\/webp;base64,)/i.test(url))) return null;
      const image = createElement('img', {
        src: url, alt: s.alt?.[lang] || ('Slide '+(s.number||'')),
        loading: 'lazy',
        style: {display:'block',width:'100%',height:'auto',maxHeight:'none',objectFit:'contain',borderRadius:'8px'}
      });
      return createElement('figure', {
        'data-reading-slide':'true',
        style: {margin:'18px 0 24px',padding:'10px',background:'rgba(255,255,255,.05)',border:'1px solid rgba(200,169,110,.2)',borderRadius:'12px',whiteSpace:'normal'}
      }, image);
    }).filter(Boolean);
}
