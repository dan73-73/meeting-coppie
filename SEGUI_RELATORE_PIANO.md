# Segui il relatore — progetto di prova

Questa è una branch di sviluppo: la versione pubblica (main) resta invariata.

## Stato verificato
- Applicazione statica HTML con Firebase Firestore (documento state/main) e Firebase Auth.
- Cinque lingue it, fr, en, es, pt; sezioni, libreria, importazione e modalità di visualizzazione già presenti.
- I dati effettivamente caricati in Firestore non sono stati letti o modificati.

## Requisiti
1. Conservare QR, accesso, selezione lingua, sezioni e condivisioni.
2. Operatore seleziona condivisione attiva, anche fuori scaletta; cambio con conferma.
3. Memorizzare lingua originale per condivisione e mappatura dei paragrafi tra le cinque lingue.
4. Riconoscimento vocale dal computer operatore, con avvio/pausa, selezione manuale del paragrafo e blocco dei salti incerti.
5. Sincronizzare il solo puntatore di avanzamento ai partecipanti; ciascun telefono mostra il testo nella lingua scelta e può disattivare l'autoscorrimento.
6. La modalità normale deve continuare a funzionare quando microfono, riconoscimento o rete non sono disponibili.

## Precauzioni prima dell'implementazione
- NON sovrascrivere state/main senza migrazione e backup: saveState usa setDoc su tutto il documento.
- Definire regole Firebase che limitino le scritture agli amministratori autenticati.
- Verificare disponibilità, costo e affidabilità del riconoscimento per tutte le lingue.
- Verificare la segmentazione delle traduzioni caricate; la corrispondenza dei paragrafi non è garantita automaticamente.
- Testare con più dispositivi e con testi reali; nessuna modifica va pubblicata senza collaudo.
