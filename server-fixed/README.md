# Server a canone fisso — prova isolata

**Stato: implementazione di prova salvata, non ancora installata sul VPS o attivata nell'app pubblica.**

## Cosa cambia

Il server importa UNA VOLTA il documento pubblico Firestore `state/main` se non esiste ancora un archivio locale. Poi conserva programma, punto di lettura e comandi su disco. I telefoni ricevono aggiornamenti SSE dal server. Per un cambio del solo punto della lettura invia un evento breve; alla connessione o riconnessione invia lo stato completo.

PC, tablet e partecipanti della versione di prova non usano Firestore per leggere o scrivere lo stato. L'accesso amministratore continua a usare Firebase Authentication. Il server verifica il token con Google e consente scritture esclusivamente all'UID amministratore esistente, con una breve cache di verifica (60 secondi). Il database Firebase originale non viene modificato dal server.

Il canone del VPS e i suoi servizi inclusi sono quelli del riepilogo d'ordine, da confermare con IVA e rinnovo. Questo progetto non attiva acquisti o piani Blaze. La pagina principale resta invariata finché il collaudo non è concluso.

## Controlli

`npm test`: 75 connessioni simultanee, stato iniziale, indici avanti e indietro, cambio sessione, riconnessione, 14.400 aggiornamenti a 75 destinatari (equivalente al numero di aggiornamenti di otto ore a uno ogni due secondi, eseguito a velocità accelerata), scritture anonime respinte, conflitti concorrenti respinti, comandi pausa/riprendi/stop e salvataggio prima della conferma. È una simulazione software, non una prova durata otto ore o sui telefoni e Wi-Fi della sala.

Il bootstrap è stato provato con il database reale (37 condivisioni) e il successivo riavvio ha riletto il file locale. Non sono state eseguite scritture nel database originale. Il token reale dell'amministratore e la latenza verso il VPS richiedono il collaudo dopo l'attivazione.

## Installazione

1. Confermare nel riepilogo d'ordine canone totale, IVA, durata e rinnovi del VPS. Servono Docker Compose, disco persistente e HTTPS.
2. Associare un hostname HTTPS al server; verificare prima se quello fornito dal gestore è utilizzabile. Aprire 80/443; non esporre 8080.
3. Da questa directory eseguire `RELAY_DOMAIN=nome-server.example docker compose up -d --build`.
4. Controllare `/health` e confrontare il contenuto importato con il database prima del passaggio. Il volume `meeting_data` conserva lo stato: **non eliminarlo e non ricrearlo da una vecchia copia durante il meeting**.
5. Impostare l'URL HTTPS in `fixed-sync.mjs` e pubblicare la pagina separata `meeting-coppie-server-prova.html`, `fixed-firestore.mjs` e `reading-integration-fixed.mjs`. Quest'ultima è una copia dell'integrazione attuale con il solo trasporto sostituito.
6. Provare login amministratore, scritture autorizzate, microfono, pausa/riprendi/stop, PC + tablet, cinque lingue, slide, riconnessione e riavvio del server. Verificare che durante la prova i contatori Firestore non aumentino a ogni avanzamento.
7. Durante il collaudo non modificare contemporaneamente il programma della vecchia app: i due archivi sono indipendenti dopo l'importazione.
8. Per andare in produzione serve un passaggio controllato con importazione finale dei contenuti aggiornati e sostituzione dei riferimenti nella pagina principale. Così è possibile conservare URL e QR esistenti. Il passaggio non è ancora stato effettuato.

## Ripristino e limiti

Lo stato viene scritto in un file temporaneo, sincronizzato e rinominato prima della risposta. Aggiornamenti concorrenti sono protetti da una versione verificata dal server e ritentati dal client. Il volume persistente deve essere incluso nel backup del VPS. Il server è un singolo nodo; una sua indisponibilità interrompe la sincronizzazione finché non riparte. Il client mostra l'interruzione e si riconnette allo stato corrente. Nessuna garanzia di disponibilità ulteriore rispetto al servizio acquistato è implicita nei test locali.

Sono pubblici gli stessi contenuti del documento già leggibile da Firebase: non aggiungere password o segreti al programma. Nessuna chiave privata o credenziale dell'amministratore è presente nel repository. La chiave pubblica dell'app Firebase identifica il progetto; non autorizza le scritture. La capacità SSE configurata è 150 connessioni.
