// Modulo separato: nessuna configurazione Firebase e nessuna modifica a state/main.
// Il chiamante fornisce un riferimento Firestore al documento live e le funzioni SDK.
export function createRelatoreSync({ liveDoc, onSnapshot, setDoc, isAdmin = () => false, onPosition = () => {} }) {
  if (!liveDoc || typeof onSnapshot !== "function" || typeof setDoc !== "function") throw Error("Parametri Firebase mancanti");
  let closed = false;
  const unsubscribe = onSnapshot(liveDoc, snapshot => {
    if (closed || !snapshot.exists()) return;
    const data = snapshot.data();
    if (!data || typeof data.shareId !== "string" || !Number.isSafeInteger(data.paragraphIndex) || data.paragraphIndex < 0) return;
    onPosition({shareId: data.shareId, paragraphIndex: data.paragraphIndex, running: data.running === true, sessionId: String(data.sessionId || "")});
  });
  return {
    async publish({shareId, paragraphIndex, running = false, sessionId = ""}) {
      if (closed) throw Error("Sincronizzazione chiusa");
      if (!isAdmin()) throw Error("Solo l'amministratore puo' inviare i comandi");
      if (typeof shareId !== "string" || !shareId.trim() || !Number.isSafeInteger(paragraphIndex) || paragraphIndex < 0) throw Error("Posizione non valida");
      await setDoc(liveDoc, {shareId, paragraphIndex, running: Boolean(running), sessionId: String(sessionId), updatedAt: Date.now()});
    },
    close() {closed = true; unsubscribe();}
  };
}
