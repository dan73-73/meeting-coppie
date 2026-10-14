# Sincronizzazione tra dispositivi — requisiti di sicurezza

La prova corrente usa BroadcastChannel: funziona soltanto tra schede della stessa origine sullo stesso dispositivo. Non e' una sincronizzazione di rete.

## Architettura prevista

- Documento separato `live/relatore` per la sola posizione corrente: shareId, paragraphIndex, running, updatedAt, sessionId.
- Il documento `state/main` con le condivisioni resta intatto.
- I partecipanti possono leggere lo stato live, non scriverlo.
- Soltanto l'amministratore autenticato puo' modificare lo stato live.
- La vista partecipanti mostra solo la condivisione che l'applicazione principale rende visibile.
- In caso di errore o interruzione, il testo statico resta disponibile.
- Non pubblicare una funzione live senza testare regole Firestore, sincronizzazione tra dispositivi, costi e allineamento testi.

## Verifiche prima dell'attivazione

1. Esportare una copia dei dati reali da Firebase tramite account autorizzato.
2. Verificare le regole Firestore per la collezione live e per state/main.
3. Testare l'accesso di un partecipante anonimo e la scrittura amministratore.
4. Testare cambi relatore, pausa, ripresa e riconnessione di piu' telefoni.
5. Non aggiornare il QR o il branch principale finche' la prova non supera tutti i controlli.
