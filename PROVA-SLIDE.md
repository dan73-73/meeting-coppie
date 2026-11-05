# Prova: slide multilingue tra i paragrafi

Questa modifica è sperimentale e non altera l'app pubblicata sul ramo main.

Il contenuto delle slide è **soltanto visivo**. Il microfono continua a riconoscere esclusivamente `readingFollow.blocks` (testo delle relazioni) come prima.

Per ciascuna condivisione, il campo facoltativo `inlineSlides` è una lista di immagini esterne HTTPS. Esempio illustrativo (indirizzi da sostituire con quelli reali):

```json
{
  "inlineSlides": [
    {
      "number": 1,
      "afterBlock": -1,
      "images": {
        "it": "https://example.org/slide1-it.png",
        "fr": "https://example.org/slide1-fr.png",
        "es": "https://example.org/slide1-es.png",
        "en": "https://example.org/slide1-en.png",
        "pt": "https://example.org/slide1-pt.png"
      }
    }
  ]
}
```

`afterBlock=-1` indica prima del primo passaggio; `0` indica dopo il primo passaggio; e così via. Non viene inserito testo nei passaggi riconosciuti dal microfono. Ogni lingua usa la propria immagine.

La nuova funzione è usata solo da `reading-integration.mjs` e mostra le immagini se i passaggi di lettura sono stati preparati e allineati. Altrimenti resta il testo normale senza immagini.

Prima del rilascio:
1. Convertire tutte le 18 pagine PDF in immagini leggibili sui cellulari per ciascuna delle cinque lingue.
2. Caricare le immagini su URL HTTPS stabili.
3. Allineare i paragrafi delle cinque traduzioni, poi assegnare a ciascuna slide l'indice `afterBlock` appropriato; verificare contro i documenti TEXT.
4. Inserire il campo `inlineSlides` nella condivisione di Mark e Maria Luisa tramite un editor amministrativo sicuro (non ancora presente) o una migrazione autorizzata.
5. Provare da almeno due cellulari con lingue diverse e ascolto automatico attivo, inclusa la connessione instabile. Non pubblicare senza collaudo.

Nessuna modifica a `microphone-engine.mjs`, `reading-follow.mjs` o a `state/main` è compresa in questa prova.
