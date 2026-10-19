export const LANGS = ['it','en','fr','es','pt'];
export function words(text) {
  return String(text).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}
export function splitText(text, lang, mode='sentence') {
  if (!text) return [];
  if (mode==='paragraph') {
    const parts=text.match(/[\s\S]+?(?:\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*|$)/g)||[text];
    const out=[];let prefix='';
    for(const part of parts) {
      if(!part.trim()){if(out.length)out[out.length-1]+=part;else prefix+=part;}
      else{out.push(prefix+part);prefix='';}
    }
    return out.length?out:[text];
  }
  if (globalThis.Intl?.Segmenter) return [...new Intl.Segmenter(lang,{granularity:'sentence'}).segment(text)].map(x=>x.segment);
  return [text];
}
// Divide each translation into corresponding small, readable sections.
// Slices preserve every character; boundaries prefer spaces, never alter the text.
export function shortSections(text, count) {
  const str=String(text||'');
  if(!str.length)return Array(count).fill('');
  const pieces=[],min=0;
  let start=0;
  for(let i=1;i<count;i++){
    const remaining=count-i,ideal=Math.round(str.length*i/count);
    let best=-1,score=Infinity;
    const lower=Math.max(start+1,ideal-36),upper=Math.min(str.length-remaining,ideal+36);
    for(let p=lower;p<=upper;p++){
      if(!/\\s/u.test(str[p-1]||''))continue;
      const value=Math.abs(p-ideal);
      if(value<score){best=p;score=value;}
    }
    const cut=best>=0?best:Math.min(str.length-remaining,Math.max(start+1,ideal));
    pieces.push(str.slice(start,cut));start=cut;
  }
  pieces.push(str.slice(start));return pieces;
}
export function suggestBlocks(translations) {
  const original=translations.it?.body||'';
  const n=Math.max(1,Math.min(200,Math.round(original.length/130)));
  const lengths=LANGS.map(l=>(translations[l]?.body||'').length);
  if(n>=2&&LANGS.every((_,i)=>lengths[i]>=n*12)){
    const parts=Object.fromEntries(LANGS.map(l=>[l,shortSections(translations[l]?.body||'',n)]));
    return {mode:'short',blocks:Array.from({length:n},(_,i)=>Object.fromEntries(LANGS.map(l=>[l,parts[l][i]])))};
  }
  return {mode:'manual',blocks:[Object.fromEntries(LANGS.map(l=>[l,translations[l]?.body||'']))]};
}
export function validateBlocks(blocks,translations) {
  if (!Array.isArray(blocks) || !blocks.length) throw new Error('Aggiungi almeno un passaggio.');
  for (const l of LANGS) {
    if (blocks.some(b=>!b[l]?.trim())) throw new Error('Ogni passaggio deve avere il testo nelle cinque lingue.');
    if (blocks.map(b=>b[l]).join('')!==(translations[l]?.body || '')) throw new Error('Il testo '+l+' è cambiato: dividi o unisci i passaggi senza modificare le parole.');
  }
  return true;
}
// Ordered approximate matching of the last spoken words against short text windows.
// A conservative threshold and ambiguity margin prevent jumping on generic words.
export function scorePassage(spoken,text) {
  const a=words(spoken).slice(-12), b=words(text);
  if(a.length<4 || b.length<4) return 0;
  let best=0;
  for(let start=0;start<b.length;start++) {
    const window=b.slice(start,start+a.length+4);
    let dp=new Array(window.length+1).fill(0);
    for(const token of a) {
      const next=[0];
      for(let j=0;j<window.length;j++) next[j+1]=token===window[j]?dp[j]+1:Math.max(dp[j+1],next[j]);
      dp=next;
    }
    best=Math.max(best,dp[window.length]/a.length);
  }
  return best;
}
export function locatePassage(spoken,blocks,lang,current) {
  if(words(spoken).length<4) return null;
  const candidates=blocks.map((b,i)=>({i,score:scorePassage(spoken,b[lang])})).filter(x=>x.i>=Math.max(0,current) && x.i<=current+3).sort((a,b)=>b.score-a.score || a.i-b.i);
  const best=candidates[0];
  if(!best || best.score<0.76 || (candidates[1] && best.score-candidates[1].score<0.15)) return null;
  return best.i;
}
