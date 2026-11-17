# Sincronizzazione a canone fisso — versione di prova

Stato: prova tecnica, non attivata nell'app pubblica. Non è una migrazione completata.

Il servizio Node mantiene UN ascoltatore pubblico Firestore `state/main` e distribuisce gli aggiornamenti ai telefoni con SSE. Per i soli cambi di indice invia un messaggio breve. All'ingresso o dopo una riconnessione invia il programma completo. Il server non accetta modifiche: PC e telecomando continuano a usare l'autenticazione e le regole Firebase esistenti.

Questo riduce il fattore di moltiplicazione delle letture Firestore: i partecipanti non aprono ascoltatori individuali. Firebase resta necessario per PC, telecomando e il solo server; non si può promettere consumo zero o eliminazione dei limiti Spark. Anche le scritture restano soggette alla quota quotidiana. Una prova completa deve misurare letture, scritture e traffico su una giornata equivalente al sabato.

## Validazione eseguita

`npm test`: 75 connessioni SSE contemporanee, 225 consegne degli indici avanti/indietro, nuova sessione, riconnessione con posizione aggiornata, rifiuto POST. Non è un test sui dispositivi reali né sulla rete della sede.

## Installazione prevista

1. Attivare un VPS europeo con prezzo complessivo, IVA, durata e rinnovo confermati nel riepilogo d'ordine. Il prezzo di listino "da" non è un preventivo finale.
2. Installare Docker con Compose, associare un hostname HTTPS al server. Aprire 80/443; non esporre direttamente 8080.
3. Da questa directory: `RELAY_DOMAIN=nome-server.example docker compose up -d --build`.
4. Verificare `/health` con `ready:true`, poi connessione pubblica al database e 75 client sul server remoto.
5. Impostare l'URL HTTPS in `fixed-sync.mjs`, pubblicare soltanto la pagina `meeting-coppie-server-prova.html` e il modulo per la prova. Visitare la pagina con `#couple` per ricevere SSE. All'avvio senza configurazione la prova non passa automaticamente a 75 ascoltatori Firebase.
6. Collaudare da PC e tablet i comandi, tutte le lingue, slide, interruzioni e riavvio del servizio. La prima ricezione dopo un riavvio dipende da Firebase.
7. Solo dopo il collaudo, integrare il trasporto nella pagina principale mantenendo l'URL e QR abituali. Durante questa prova la pagina principale è invariata.

Non sono previste modifiche ai dati di condivisioni o slide, né acquisti automatizzati. Nel server la memoria non è un archivio autorevole: a ogni avvio viene riletta da Firebase. Gli eventi sono pubblici come il database attualmente leggibile; non aggiungere segreti al documento condiviso. Il massimo predefinito di connessioni SSE è 150.
