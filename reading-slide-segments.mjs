import {LANGS,validateBlocks,punctuationSections} from './reading-follow.mjs?v=punctuation-20261106a';

// Le slide delimitano le sezioni. I passaggi della lettura vengono suddivisi
// solo sui confini delle frasi, senza alterare neppure uno spazio dei testi.
function sentences(text,lang) {
  const value=String(text||'');
  if (!value) return [];
  if (typeof Intl!=='undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter(lang,{granularity:'sentence'}).segment(value)]
      .map(part=>part.segment);
  }
  return value.match(/[^.!?]+[.!?]+(?:\\s+|$)|[^.!?]+$/gu)||[value];
}
function arrangeSentences(text,lang,count) {
  if(count===1)return [text];
  const parts=sentences(text,lang);
  if(parts.length<count)return punctuationSections(text,count);
  const groups=[];
  let start=0;
  // Cerca il punto di fine frase più vicino alla lunghezza ideale,
  // lasciando almeno una frase per ciascun passaggio ancora da creare.
  for(let i=1;i<count;i++){
    const needed=count-i,ideal=text.length*i/count;
    let best=start+1,score=Infinity,chars=0;
    for(let k=0;k<parts.length;k++){
      chars+=parts[k].length;
      if(k+1<=start || parts.length-(k+1)<needed)continue;
      const error=Math.abs(chars-ideal);
      if(error<score){best=k+1;score=error;}
    }
    groups.push(parts.slice(start,best).join(''));
    start=best;
  }
  groups.push(parts.slice(start).join(''));
  if(groups.some(g=>!g.trim())||groups.join('')!==text)
    throw Error('Suddivisione non valida in '+lang);
  return groups;
}

export function refineReadingForSlides(oldBlocks, inlineSlides, translations) {
  validateBlocks(oldBlocks,translations);
  if(!Array.isArray(inlineSlides)||!inlineSlides.length)
    return {blocks:oldBlocks,inlineSlides:inlineSlides||[],changed:false};
  const slideEnds=[...new Set(inlineSlides.filter(s=>s.afterBlock>=0).map(s=>s.afterBlock))].sort((a,b)=>a-b);
  if(inlineSlides.some(s=>!Number.isInteger(s.afterBlock)||s.afterBlock < -1||s.afterBlock>=oldBlocks.length))
    throw Error('Posizione slide non valida.');
  const ends=[...new Set([...slideEnds,oldBlocks.length-1])].sort((a,b)=>a-b);
  const blocks=[],mapping=new Map();
  let start=0;
  for(const end of ends){
    const section=oldBlocks.slice(start,end+1);
    const all=Object.fromEntries(LANGS.map(lang=>[lang,section.map(b=>b[lang]).join('')]));
    const n=Math.min(40,Math.max(1,Math.ceil(all.it.length/175)),
      ...LANGS.map(lang=>sentences(all[lang],lang).filter(s=>s.trim()).length));
    const pieces=Object.fromEntries(LANGS.map(lang=>[lang,arrangeSentences(all[lang],lang,n)]));
    for(let i=0;i<n;i++)
      blocks.push(Object.fromEntries(LANGS.map(lang=>[lang,pieces[lang][i]])));
    mapping.set(end,blocks.length-1);
    start=end+1;
  }
  validateBlocks(blocks,translations);
  const slides=inlineSlides.map(s=>({...s,afterBlock:s.afterBlock===-1?-1:mapping.get(s.afterBlock)}));
  return {blocks,inlineSlides:slides,changed:true};
}
