# QuizVegas

QuizVegas to webowa gra wieloosobowa. Projekt łączy mechanikę teleturnieju z systemem obstawiania w stylu kasyna. 

Architektura opiera się na jednym wspólnym ekranie (host - odpalany np. na TV) oraz klientach mobilnych (telefony graczy działające jako kontrolery). Całość działa w lokalnej sieci wifi.

## Zasady gry
Gra polega na odpowiadaniu na pytania, których wynikiem jest zawsze liczba.
1. Na ekranie wyświetlanie jest pytanie.
2. Gracze wpisują odpowiedzi na swoich telefonach.
3. Wszystkie unikalne odpowiedzi trafiają posortowane na główny ekran (dochodzi do nich też opcja "mniej niż najniższa odpowiedź").
4. Gracze obstawiają swoje dwa żetony oraz wygraną gotówkę (w przypadku błędnej odpowiedzi gotówka przepada) na odpowiedź, która ich zdaniem jest poprawna. Skrajne wartości dostają wyższe mnożniki (x2, x3, x4).
5. Wygrywa odpowiedź najbliższa prawdy, ale nieprzekraczająca poprawnej wartości.


## Uruchomienie lokalne

Żeby odpalić projekt u siebie:
1. Pobierz Node.js (nodejs.org)
2. Pobierz repozytorium i uruchom serwer:

```
git clone [https://github.com/TwojaNazwa/ryzyk-fizyk.git](https://github.com/TwojaNazwa/ryzyk-fizyk.git)
cd ryzyk-fizyk
npm install
node server.js
```
Ekran główny jak i gracze muszą być połączeni do tej samej sieci wifi.

Serwer domyślnie nasłuchuje na porcie 3000.

Ekran główny: http://localhost:3000/host.html

Ekrany graczy: Wejdź na telefonie z tej samej sieci Wi-Fi pod adres IP swojego komputera (np. http://192.168.0.10:3000).

##Konfiguracja

Baza pytań oraz ustawienia czasów i limitów rund znajdują się w folderze data/ (questions.json i config.json). Projekt zawiera już pulę około 200 przykładowych pytań.

Licencja
MIT
