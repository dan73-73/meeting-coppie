import {LANGS,shortSections,validateBlocks} from './reading-follow.mjs';

// Produce passaggi brevi mantenendo parola per parola i testi nelle cinque lingue.
// Le slide sono ancorate alla fine dei passaggi originali, non al riconoscimento vocale.
export function refineReadingForSlides(oldBlocks, inlineSlides, translations) {
  validateBlocks(oldBlocks, translations);
  if (!Array.isArray(inlineSlides) || !inlineSlides.length)
    return {blocks:oldBlocks, inlineSlides:inlineSlides||[], changed:false};
  const blocks=[], ends=[];
  for (const original of oldBlocks) {
    const count=Math.max(1,Math.ceil((original.it||'').length/95));
    const pieces=Object.fromEntries(LANGS.map(lang=>[lang,shortSections(original[lang],count)]));
    for(let i=0;i<count;i++) {
      const part=Object.fromEntries(LANGS.map(lang=>[lang,pieces[lang][i]]));
      if(LANGS.some(lang=>!part[lang]?.trim())) throw Error('Passaggio troppo corto: controllare le cinque lingue.');
      blocks.push(part);
    }
    ends.push(blocks.length-1);
  }
  validateBlocks(blocks,translations);
  const slides=inlineSlides.map(slide=>{
    const old=slide.afterBlock;
    if(!Number.isInteger(old) || old < -1 || old>=ends.length)
      throw Error('Posizione di una slide non valida.');
    return {...slide, afterBlock:old===-1?-1:ends[old]};
  });
  return {blocks, inlineSlides:slides,changed:blocks.length!==oldBlocks.length};
}
