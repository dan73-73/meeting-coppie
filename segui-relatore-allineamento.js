// Utilita' di allineamento dei paragrafi, senza accesso a database o credenziali.
export function paragraphs(body) {
 return String(body || "").replace(/\r\n/g, "\n").split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
}
export function alignTranslations(share) {
 const languages = ["it", "en", "fr", "es", "pt"];
 const byLanguage = Object.fromEntries(languages.map(l => [l, paragraphs(share?.translations?.[l]?.body)]));
 const count = Math.max(0, ...languages.map(l => byLanguage[l].length));
 return {
  aligned: languages.every(l => byLanguage[l].length === count),
  counts: Object.fromEntries(languages.map(l => [l, byLanguage[l].length])),
  segments: Array.from({length:count}, (_,i) => Object.fromEntries(languages.map(l => [l, byLanguage[l][i] || ""])))
 };
}
