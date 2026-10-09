# PumpAPI-latency

Mały, bezzależnościowy pomiar latencji do serwera HTTP(S) albo portu TCP (Node.js ≥ 18).
*A tiny zero-dependency latency probe for HTTP(S) and TCP endpoints: DNS / TCP / TLS / TTFB, cold vs keep-alive vs after idle.*

## Po co, skoro jest `ping`

`ping` (ICMP) często wprowadza w błąd:
- wiele serwerów i chmur blokuje albo obniża priorytet ICMP;
- za CDN/anycastem odpowiada najbliższy węzeł brzegowy, a nie maszyna, z którą rozmawia Twoja aplikacja;
- aplikację obchodzi czas **żądania**, a ten zależy też od TLS, ponownego użycia połączenia i bezczynności.

`latency-probe` mierzy to, co widzi klient HTTP(S):

| faza | co znaczy |
|---|---|
| `dns` | rozwiązanie nazwy (0, gdy cel to adres IP albo wynik jest w cache) |
| `tcp` | nawiązanie połączenia TCP ≈ **1 RTT** |
| `tls` | uzgodnienie TLS ≈ 1 RTT (TLS 1.3) albo 2 RTT (TLS 1.2) |
| `ttfb` | od wysłania żądania na gotowym połączeniu do pierwszego bajtu odpowiedzi ≈ RTT + czas serwera |
| `calosc` | całe żądanie, łącznie z nawiązaniem połączenia (w trybie `cold`) |

Scenariusze:
- **cold** — każde żądanie na nowym połączeniu (pierwsze żądanie po starcie aplikacji);
- **warm** — wszystkie żądania na jednym połączeniu keep-alive (stan ustalony aplikacji, która trzyma połączenie);
- **idle** — połączenie keep-alive, potem przerwa N sekund i jedno żądanie: czy serwer/sieć zamknęły połączenie i ile kosztuje odtworzenie.

## Użycie

```bash
git clone https://github.com/tel5marpl-stack/PumpAPI-latency && cd PumpAPI-latency
node latency.js https://example.com
node latency.js https://example.com --tryb cold,warm,idle --idle 15,60,180 --n 30
node latency.js tcp://example.com:443 --n 50          # sam TCP connect (zamiennik ping)
node latency.js https://a.example https://b.example --json > wynik.json
node latency.js --help
```

Opcje: `--n` (próbek na scenariusz, domyślnie 20), `--tryb cold,warm,idle`, `--idle 15,60`, `--odstep <ms>`,
`--timeout <ms>`, `--metoda GET|HEAD`, `--insecure` (bez weryfikacji certyfikatu), `--json`.

Przykładowy wynik (serwer lokalny):

```
http://127.0.0.1:18765/
  cold (nowe połączenie na każde żądanie) — próbek 5, błędów 0, HTTP {"200":5}
  faza            min      p50      p90      p99      max  średnia   [ms]
  dns             0.0      0.0      0.0      0.0      0.0      0.0
  tcp             0.6      1.3      8.6      8.6      8.6      2.6
  tls               —
  ttfb            3.9      4.8      7.4      7.4      7.4      5.1
  calosc          5.4      5.8     17.1     17.1     17.1      8.1
  warm (jedno połączenie keep-alive) — próbek 5, błędów 0, HTTP {"200":5}, ponownie użytych połączeń 5/5
  faza            min      p50      p90      p99      max  średnia   [ms]
  ttfb            3.5      4.1      4.5      4.5      4.5      4.0
  calosc          3.7      4.2      5.0      5.0      5.0      4.2
```

## Przykład: PumpAPI

```bash
# Trade API (żądania kupna/sprzedaży) — liczy się „warm ttfb” (połączenie keep-alive) i „tcp” (≈ RTT)
node latency.js https://api.pumpapi.io --tryb cold,warm,idle --idle 15,60,180 --n 30
# strumień danych (WebSocket) — sam TCP connect do portu 443
node latency.js tcp://stream.pumpapi.io:443 --n 30
```

Serwery PumpAPI stoją we Frankfurcie — z maszyny w tym samym mieście `tcp` p50 powinien wynosić pojedyncze ms; z Ameryki ~100–200 ms.
Kod zwracany przez Trade API na żądanie GET bez parametrów nie ma znaczenia — mierzymy czas, nie treść.

## Porównanie lokalizacji (np. przed wyborem VPS)

Uruchom ten sam pomiar z każdej kandydującej maszyny i porównaj `p50`/`p90`:
- `tcp` p50 to praktycznie RTT do serwera;
- `warm ttfb` to koszt jednego żądania w aplikacji trzymającej połączenie — zwykle najważniejsza liczba;
- duży rozrzut `p90`/`p99` względem `p50` = niestabilna trasa albo przeciążenie;
- `idle` pokazuje, po jakim czasie bezczynności połączenie znika (warto wtedy wysyłać podtrzymanie).

```bash
node latency.js https://cel.example --n 50 --json > $(hostname)-$(date +%F).json
```

## Test

```bash
node test.js     # lokalne serwery HTTP, HTTPS (self-signed, wymaga openssl) i TCP; bez sieci zewnętrznej
```

## Licencja

MIT
