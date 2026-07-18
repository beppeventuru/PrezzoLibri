# PrezzoLibri

MVP locale per stimare un prezzo di vendita di libri usati su Vinted Italia.
È un progetto nuovo e indipendente: non usa né modifica `LibreriaCasa`.

## Versione online

Il frontend in `public/` è predisposto per GitHub Pages. Il backend online usa un progetto Supabase indipendente:

1. eseguire `supabase/schema.sql` nel SQL Editor;
2. creare un utente Auth con email `<username>@prezzolibri.local`;
3. distribuire le funzioni `isbn-lookup` e `marketplace-search`;
4. impostare `OPENAI_API_KEY` e `OPENAI_MODEL` come segreti della funzione;
5. inserire URL del progetto e chiave anon pubblica in `public/config.js`.

La chiave OpenAI non deve mai essere inserita in `public/config.js` o nel repository.

## Funzionamento

1. Inserimento o lettura del barcode ISBN da una foto (quando supportato dal browser).
2. Lettura gratuita del barcode con BarcodeDetector o ZXing, come in LibreriaCasa.
3. Recupero dei metadati da Google Books, con Open Library come fallback.
4. Ricerca web automatica su Vinted, eBay, AbeBooks, Subito e Amazon tramite OpenAI.
5. Controllo umano di ISBN, edizione, formato e condizioni.
6. Registrazione di annunci attivi o vendite concluse.
7. Calcolo di prezzo per vendita rapida, consigliato e massimo realistico.

L'app non esegue scraping, non usa endpoint interni dei marketplace e non pubblica annunci.
I risultati dei siti devono essere verificati: alcuni marketplace ampliano automaticamente
una ricerca ISBN e possono mostrare edizioni diverse.

## Avvio

Prima copia `.env.example` in `.env` e inserisci la tua chiave in `OPENAI_API_KEY`.
Imposta inoltre `APP_USERNAME` e `APP_PASSWORD`: tutte le API dell'app saranno protette da una sessione locale.

```powershell
cd C:\Users\Utente\Documents\Playground\PrezzoLibri
& C:\Users\Utente\Documents\Playground\tools\node\node.exe server.mjs
```

Aprire `http://localhost:4180`.

Per l'accesso dalla stessa rete Wi-Fi, impostare `HOST=0.0.0.0` in `.env` e aprire dal telefono `http://IP-DEL-PC:4180`.

## Test

```powershell
& C:\Users\Utente\Documents\Playground\tools\node\node.exe --test
```

## Modello di valutazione iniziale

- Le vendite concluse pesano più degli annunci attivi.
- Le corrispondenze ISBN esatte pesano più delle corrispondenze testuali.
- Vinted e vendite personali sono più rappresentativi del mercato di destinazione.
- Amazon e AbeBooks sono segnali secondari e non determinano da soli il prezzo.
- Un prezzo molto alto con bassa pertinenza non deve dominare la stima.

I pesi sono regole sperimentali trasparenti in `src/pricing.mjs`, non certezze di mercato.

## Limiti attuali

- L'app non può verificare automaticamente se un annuncio Vinted corrisponde davvero all'ISBN.
- Foto e barcode dipendono dal supporto `BarcodeDetector` del browser.
- Non è ancora presente OCR alternativo per leggere le cifre stampate.
- Non sono ancora gestite modifica ed esclusione di un confronto già salvato.
- Google Books e Open Library richiedono accesso a Internet; l'app resta comunque utilizzabile manualmente.
