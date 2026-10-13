# QuizVegas

QuizVegas to webowa gra imprezowa dla 2–15 osób. Łączy teleturniej z obstawianiem w stylu kasyna. Jeden wspólny ekran (host, np. TV) pokazuje grę, a telefony graczy działają jak kontrolery. Całość działa w lokalnej sieci Wi-Fi, bez konta i bez internetu (poza opcjonalną czcionką).

## Zasady gry

Każde pytanie ma odpowiedź liczbową.

1. Na ekranie hosta pojawia się pytanie i timer.
2. Gracze wpisują odpowiedzi na telefonach. Odpowiedzi są ukryte, na ekranie widać tylko, kto już odpowiedział.
3. Unikalne odpowiedzi trafiają posortowane na ekran. Dochodzi do nich karta „mniej niż najniższa” (BANK).
4. Gracze obstawiają żetony na odpowiedź, która ich zdaniem jest poprawna. Karty skrajne mają wyższe mnożniki (x2, x3, x4…). Czas obstawiania jest stały i do końca można zmieniać zakłady.
5. Wygrywa odpowiedź najbliższa prawdy, ale nieprzekraczająca jej.

**Żetony:** każdy gracz ma dwa stałe żetony po $100 (nigdy ich nie traci) oraz gotówkę, którą może zamienić na żetony. Gotówkę można postawić tylko na karcie, na której leży już żeton stały. Przegrana gotówka przepada, więc gracz z $0 nadal wraca do gry dzięki żetonom stałym. Autor zwycięskiej odpowiedzi dostaje bonus $300.

## Uruchomienie

Wymagany jest [Node.js](https://nodejs.org) 18 lub nowszy.

```bash
git clone https://github.com/Stobini/QuizVegas.git
cd QuizVegas
npm install
npm start
```

- **Host (TV):** otwórz `http://localhost:3000/host.html` na komputerze, na którym działa serwer. Lobby pokazuje adres dla graczy i kod QR.
- **Gracze:** wejdź telefonem z tej samej sieci Wi-Fi na adres z lobby (np. `http://192.168.0.10:3000`).

Ekran hosta działa tylko z komputera z serwerem (localhost albo jego własny adres LAN), więc gracze nie mogą wystartować ani zrestartować gry.

## Konfiguracja

`data/config.json` (brakujące klucze mają wartości domyślne):

| Klucz | Domyślnie | Opis |
|---|---|---|
| `roundTime` | 30 | czas na odpowiedź (s) |
| `bettingTime` | 15 | czas obstawiania (s), stały |
| `resultTime` | 10 | czas pokazu wyniku (s) |
| `revealDelay` | 2500 | opóźnienie wyniku na telefonach względem TV (ms) |
| `maxRounds` | 10 | liczba pytań w grze |
| `maxPlayers` | 15 | limit graczy |
| `maxNickLength` | 16 | maks. długość nicku |
| `baseChipValue` | 100 | wartość żetonu stałego |
| `permChips` | 2 | liczba żetonów stałych |
| `writerBonus` | 300 | bonus autora zwycięskiej odpowiedzi |
| `serverPort` | 3000 | port serwera |

Pytania są losowane bez powtórzeń: serwer pamięta zadane pytania do restartu i losuje z jeszcze niewykorzystanych. Gdy baza się wyczerpie, zaczyna od nowa.

`data/questions.json` to lista pytań w formacie `{ "text": "…", "answer": 1912 }`, gdzie `answer` jest liczbą całkowitą. Wadliwe i zduplikowane pytania są pomijane przy starcie.

## Struktura projektu

```
QuizVegas/
├── server.js            # serwer Express + Socket.IO, fazy gry, reconnect
├── game-logic.js        # czysta logika: karty, zwycięzca, walidacja zakładów, rozliczenie
├── data/
│   ├── config.json      # ustawienia gry
│   └── questions.json   # baza pytań
├── public/
│   ├── host.html        # ekran wspólny (TV)
│   └── player.html      # ekran gracza (telefon)
├── test/
│   └── game-logic.test.js
├── package.json
├── LICENSE
└── README.md
```

## Testy

```bash
npm test
```

## Uwagi

- Serwer nie ufa klientowi: zakłady są walidowane po stronie serwera.
- Gracz po odświeżeniu strony wraca do gry z tym samym saldem. ID gracza jest kasowane po zakończeniu rozgrywki.
- Czcionka Space Grotesk ładuje się z Google Fonts. Bez internetu gra używa czcionki zastępczej.
- Kod QR wymaga paczki `qrcode` (instaluje ją `npm install`).

## Licencja

MIT
