# PumpAPI-latency

**Sprawdź, jak szybko Twój serwer rozmawia z API — zanim zapłacisz za VPS albo zaczniesz zgadywać, skąd biorą się opóźnienia.**
*Find out how fast your server talks to an API — before you pay for a VPS or start guessing where your delays come from.*

## O co chodzi / What this is for

Gdy aplikacja wysyła żądania do zdalnego API (np. zlecenia, płatności albo webhooki), liczy się każda milisekunda między
„wysłałem” a „serwer odpowiedział”. Ten czas zależy przede wszystkim od tego, **gdzie stoi Twoja maszyna** względem serwera API.
`PumpAPI-latency` to jeden plik w Node.js bez żadnych zależności. Uruchamiasz go na maszynie, którą chcesz sprawdzić, i w kilka
sekund widzisz, ile naprawdę trwa każde żądanie i z czego ten czas się składa.

*When your application sends requests to a remote API (orders, payments, webhooks…), every millisecond between "sent" and
"the server answered" counts — and it depends mostly on **where your machine is** relative to the API server.
`PumpAPI-latency` is a single zero-dependency Node.js file: run it on the machine you want to evaluate and within seconds
you see how long each request really takes and where that time goes.*

Typowe zastosowania / Typical uses:
- **wybór VPS albo regionu chmury** — uruchom ten sam pomiar na kilku kandydatach i wybierz najszybszy /
  **choosing a VPS or cloud region** — run the same measurement on several candidates and pick the fastest;
- **diagnoza opóźnień** — czy winna jest sieć (RTT), TLS, czy wolna odpowiedź serwera /
  **diagnosing delays** — is it the network (RTT), TLS, or a slow server response;
- **sprawdzenie keep-alive** — czy warto trzymać połączenie otwarte i po jakim czasie bezczynności serwer je zamyka /
  **checking keep-alive** — whether keeping a connection open pays off and after how much idle time the server drops it;
- **zamiennik `ping`**, gdy ICMP jest blokowany albo odpowiada węzeł CDN zamiast serwera /
  **a `ping` replacement** when ICMP is blocked or a CDN edge answers instead of the real server.

Nazwa pochodzi od pierwszego zastosowania (pomiar do [PumpAPI](https://pumpapi.io), którego serwery stoją we Frankfurcie),
ale narzędzie działa z **dowolnym** adresem HTTP(S) albo portem TCP.
*The name comes from its first use case (measuring [PumpAPI](https://pumpapi.io), whose servers are in Frankfurt),
but the tool works with **any** HTTP(S) URL or TCP port.*

## Szybki start / Quick start

Na maszynie, którą chcesz sprawdzić (np. kandydujący VPS) / On the machine you want to test (e.g. a candidate VPS):

```bash
git clone https://github.com/tel5marpl-stack/PumpAPI-latency && cd PumpAPI-latency

# Trade API: połączenie zimne, keep-alive i po bezczynności / cold, keep-alive and after idle
node latency.js https://api.pumpapi.io --tryb cold,warm,idle --idle 15,60,180 --n 30

# Strumień danych (WebSocket): sam TCP connect do portu 443 / data stream (WebSocket): TCP connect to port 443 only
node latency.js tcp://stream.pumpapi.io:443 --n 30
```

Porównuj między maszynami `tcp` p50 (≈ RTT) i `warm ttfb` (koszt jednego żądania na utrzymanym połączeniu).
*Compare `tcp` p50 (≈ RTT) and `warm ttfb` (cost of one request on a kept-alive connection) across machines.*

Wymagania / Requirements: Node.js ≥ 18. Nic więcej — żadnego `npm install` / nothing else — no `npm install`.

## Dlaczego nie `ping` / Why not just `ping`

`ping` (ICMP) często wprowadza w błąd / `ping` (ICMP) is often misleading:
- wiele serwerów i chmur blokuje albo obniża priorytet ICMP / many servers and clouds block or deprioritise ICMP;
- za CDN/anycastem odpowiada najbliższy węzeł brzegowy, a nie maszyna, z którą rozmawia aplikacja /
  behind a CDN/anycast the nearest edge answers, not the machine your application talks to;
- aplikację obchodzi czas **żądania**, który zależy też od TLS, ponownego użycia połączenia i bezczynności /
  an application cares about **request** time, which also depends on TLS, connection reuse and idle time.

## Co jest mierzone / What is measured

| faza / phase | znaczenie / meaning |
|---|---|
| `dns` | rozwiązanie nazwy (0 dla adresu IP albo cache) / name resolution (0 for an IP address or cache hit) |
| `tcp` | nawiązanie połączenia TCP ≈ **1 RTT** / TCP connect ≈ **1 RTT** |
| `tls` | uzgodnienie TLS ≈ 1 RTT (TLS 1.3) albo 2 RTT (TLS 1.2) / TLS handshake ≈ 1 RTT (TLS 1.3) or 2 RTT (TLS 1.2) |
| `ttfb` | od wysłania żądania na gotowym połączeniu do pierwszego bajtu ≈ RTT + czas serwera / from sending the request on a ready connection to the first byte ≈ RTT + server time |
| `calosc` | całe żądanie, z nawiązaniem połączenia w trybie `cold` / the whole request, including connection setup in `cold` mode |

Scenariusze / Scenarios:
- **cold** — każde żądanie na nowym połączeniu / every request on a new connection;
- **warm** — wszystkie żądania na jednym połączeniu keep-alive / all requests on one keep-alive connection;
- **idle** — połączenie keep-alive, przerwa N sekund i jedno żądanie: czy połączenie przeżyło i ile kosztuje odtworzenie /
  keep-alive connection, N seconds of silence, one request: did the connection survive and what does re-establishing cost.

## Polecenia / Commands

```bash
# pomoc / help
node latency.js --help

# podstawowy pomiar (cold + warm) / basic measurement (cold + warm)
node latency.js https://example.com

# wszystkie scenariusze, 30 próbek / all scenarios, 30 samples
node latency.js https://example.com --tryb cold,warm,idle --idle 15,60,180 --n 30
node latency.js https://example.com --mode cold,warm,idle --idle 15,60,180 --n 30

# sam TCP connect (zamiennik ping) / TCP connect only (ping replacement)
node latency.js tcp://example.com:443 --n 50

# kilka celów naraz, wynik JSON / several targets at once, JSON output
node latency.js https://a.example https://b.example --json > wynik.json

# wolniej i z metodą HEAD / slower pacing and HEAD method
node latency.js https://example.com --odstep 1000 --metoda HEAD
node latency.js https://example.com --interval 1000 --method HEAD

# zapis wyniku z nazwą maszyny i datą / save the result named after the machine and date
node latency.js https://api.pumpapi.io --n 50 --json > $(hostname)-$(date +%F).json

# test narzędzia (lokalne serwery, bez sieci zewnętrznej) / self-test (local servers, no external network)
node test.js
```

## Opcje / Options

| opcja PL | option EN | znaczenie / meaning | domyślnie / default |
|---|---|---|---|
| `--n` | `--n` | próbek na scenariusz / samples per scenario | 20 |
| `--tryb` | `--mode` | `cold`, `warm`, `idle` (lista po przecinku / comma list) | `cold,warm` |
| `--idle` | `--idle` | przerwy w sekundach dla `idle` / idle pauses in seconds | `15,60` |
| `--odstep` | `--interval` | przerwa między próbkami (ms) / delay between samples (ms) | 200 |
| `--timeout` | `--timeout` | limit jednego żądania (ms) / per-request timeout (ms) | 10000 |
| `--metoda` | `--method` | `GET` albo `HEAD` / `GET` or `HEAD` | `GET` |
| `--insecure` | `--insecure` | bez weryfikacji certyfikatu TLS / skip TLS certificate check | — |
| `--json` | `--json` | wynik jako JSON / JSON output | — |

Kod HTTP zwracany przez serwer (np. 404 na `GET /`) nie ma znaczenia — mierzony jest czas, nie treść.
*The HTTP status the server returns (e.g. 404 on `GET /`) does not matter — the tool measures time, not content.*

## Przykładowy wynik / Sample output

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

## Jak czytać wynik / How to read the result

- `tcp` p50 to praktycznie RTT do serwera / `tcp` p50 is practically the RTT to the server;
- `warm ttfb` to koszt jednego żądania w aplikacji trzymającej połączenie — zwykle najważniejsza liczba /
  `warm ttfb` is the cost of one request in an application that keeps the connection open — usually the key number;
- duży rozrzut `p90`/`p99` względem `p50` = niestabilna trasa albo przeciążenie /
  a large `p90`/`p99` spread versus `p50` means an unstable route or congestion;
- `idle` pokazuje, po jakim czasie bezczynności połączenie znika (warto wtedy wysyłać podtrzymanie) /
  `idle` shows after how much silence the connection is dropped (send keep-alives if so).

Orientacyjnie: maszyna w tym samym mieście co serwer → `tcp` p50 w pojedynczych ms; inny kraj w Europie → ~10–30 ms;
Ameryka ↔ Europa → ~100–200 ms.
*Rule of thumb: same city as the server → single-digit ms `tcp` p50; another European country → ~10–30 ms;
America ↔ Europe → ~100–200 ms.*

## Licencja / License

MIT
