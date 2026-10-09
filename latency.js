#!/usr/bin/env node
'use strict';

/**
 * latency-probe — pomiar latencji do serwera HTTP(S) albo portu TCP, bez zależności (Node ≥ 18).
 *
 * Dla HTTP(S) mierzy osobno fazy: DNS, TCP connect, TLS handshake, czas do pierwszego bajtu (TTFB) i całość,
 * w trzech scenariuszach:
 *   cold  — każde żądanie na NOWYM połączeniu (DNS + TCP + TLS + żądanie),
 *   warm  — żądania na jednym połączeniu keep-alive (sam czas żądania ≈ RTT + czas serwera),
 *   idle  — połączenie keep-alive, potem N sekund bezczynności i żądanie (czy połączenie przeżyło i ile kosztuje).
 * Dla tcp://host:port mierzy sam czas nawiązania połączenia TCP (≈ 1 RTT) — zamiennik `ping`, gdy ICMP jest blokowany.
 *
 * Użycie: node latency.js <cel> [<cel> ...] [opcje]   (pomoc: --help)
 */

const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns');
const { performance } = require('perf_hooks');

const POMOC = `latency-probe — pomiar latencji HTTP(S)/TCP bez zależności

Użycie:
  node latency.js <cel> [<cel> ...] [opcje]

Cel:
  https://host[:port][/ścieżka]   fazy DNS/TCP/TLS/TTFB, połączenie zimne, ciepłe, po bezczynności
  http://host[:port][/ścieżka]    to samo bez TLS
  tcp://host:port                 sam TCP connect (zamiennik ping, gdy ICMP jest blokowany)

Opcje:
  --n <liczba>          próbek na scenariusz (domyślnie 20)
  --tryb <lista>        cold,warm,idle — które scenariusze (domyślnie cold,warm)
  --idle <sekundy>      lista przerw dla trybu idle, np. 15,60,180 (domyślnie 15,60)
  --odstep <ms>         przerwa między próbkami (domyślnie 200)
  --timeout <ms>        limit jednego żądania (domyślnie 10000)
  --metoda <GET|HEAD>   metoda HTTP (domyślnie GET)
  --insecure            nie sprawdzaj certyfikatu TLS
  --json                wynik jako JSON (do porównań między serwerami)
  --help                ta pomoc

Przykłady:
  node latency.js https://example.com
  node latency.js https://example.com --tryb cold,warm,idle --idle 15,60,180 --n 30
  node latency.js tcp://example.com:443 --n 50
  node latency.js https://a.example https://b.example --json > wynik.json
`;

function argumenty(argv) {
    const o = { cele: [], n: 20, tryb: ['cold', 'warm'], idle: [15, 60], odstep: 200, timeout: 10000, metoda: 'GET', insecure: false, json: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const nast = () => { if (i + 1 >= argv.length) throw new Error(`brak wartości dla ${a}`); return argv[++i]; };
        if (a === '--help' || a === '-h') o.pomoc = true;
        else if (a === '--n') o.n = liczba(nast(), a, 1);
        else if (a === '--tryb') o.tryb = nast().split(',').map((s) => s.trim()).filter(Boolean);
        else if (a === '--idle') o.idle = nast().split(',').map((s) => liczba(s, a, 0));
        else if (a === '--odstep') o.odstep = liczba(nast(), a, 0);
        else if (a === '--timeout') o.timeout = liczba(nast(), a, 1);
        else if (a === '--metoda') o.metoda = nast().toUpperCase();
        else if (a === '--insecure') o.insecure = true;
        else if (a === '--json') o.json = true;
        else if (a.startsWith('--')) throw new Error(`nieznana opcja ${a}`);
        else o.cele.push(a);
    }
    for (const t of o.tryb) if (!['cold', 'warm', 'idle'].includes(t)) throw new Error(`nieznany tryb ${t} (cold, warm, idle)`);
    if (!['GET', 'HEAD'].includes(o.metoda)) throw new Error('--metoda: GET albo HEAD');
    return o;
}

function liczba(s, nazwa, min) {
    const n = Number(s);
    if (!Number.isFinite(n) || n < min) throw new Error(`${nazwa}: niepoprawna liczba "${s}"`);
    return n;
}

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));

/** Jedno żądanie HTTP(S) z pomiarem faz; `agent` decyduje, czy połączenie jest nowe, czy ponownie użyte. */
function zadanie(url, agent, o) {
    return new Promise((resolve) => {
        const lib = url.protocol === 'https:' ? https : http;
        const t0 = performance.now();
        const t = { dns: null, tcp: null, tls: null, ttfb: null, calosc: null, ponowne: false, status: null, blad: null };
        let tLookup = null, tConnect = null, tSecure = null;
        const req = lib.request(url, { method: o.metoda, agent, timeout: o.timeout, rejectUnauthorized: !o.insecure,
            headers: { 'user-agent': 'latency-probe/1.0', connection: 'keep-alive' } });
        req.on('socket', (s) => {
            if (req.reusedSocket || !s.connecting) { t.ponowne = true; return; }
            s.once('lookup', () => { tLookup = performance.now(); });
            s.once('connect', () => { tConnect = performance.now(); });
            s.once('secureConnect', () => { tSecure = performance.now(); });
        });
        req.on('response', (res) => {
            t.ttfb = performance.now();
            t.status = res.statusCode;
            res.on('data', () => {});
            res.on('end', () => {
                const koniec = performance.now();
                if (!t.ponowne) {
                    t.dns = tLookup !== null ? tLookup - t0 : 0;                       // IP w adresie → brak lookup
                    t.tcp = tConnect !== null ? tConnect - (tLookup !== null ? tLookup : t0) : null;
                    t.tls = tSecure !== null && tConnect !== null ? tSecure - tConnect : null;
                }
                const start = t.ponowne ? t0 : (tSecure !== null ? tSecure : (tConnect !== null ? tConnect : t0));
                t.ttfb = t.ttfb - start;                                                // od wysłania żądania na gotowym połączeniu
                t.calosc = koniec - t0;
                resolve(t);
            });
        });
        req.on('timeout', () => req.destroy(new Error(`timeout ${o.timeout} ms`)));
        req.on('error', (e) => { t.blad = e.message; t.calosc = performance.now() - t0; resolve(t); });
        req.end();
    });
}

/** Sam TCP connect: DNS rozwiązany raz wcześniej, żeby mierzyć czysty RTT. */
function polaczenieTcp(host, port, o) {
    return new Promise((resolve) => {
        const t0 = performance.now();
        const s = net.connect({ host, port });
        const zakoncz = (blad) => { const ms = performance.now() - t0; s.destroy(); resolve({ tcp: blad ? null : ms, blad: blad || null }); };
        s.setTimeout(o.timeout, () => zakoncz(`timeout ${o.timeout} ms`));
        s.once('connect', () => zakoncz(null));
        s.once('error', (e) => zakoncz(e.message));
    });
}

function statystyki(wartosci) {
    const v = wartosci.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const p = (q) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
    const srednia = v.reduce((a, b) => a + b, 0) / v.length;
    return { n: v.length, min: v[0], p50: p(0.5), p90: p(0.9), p99: p(0.99), max: v[v.length - 1], srednia };
}

async function mierzHttp(url, o) {
    const wynik = { cel: url.href, scenariusze: {} };
    const opcjeAgenta = { keepAlive: true, maxSockets: 1, rejectUnauthorized: !o.insecure };
    const Agent = url.protocol === 'https:' ? https.Agent : http.Agent;

    if (o.tryb.includes('cold')) {
        const probki = [];
        for (let i = 0; i < o.n; i++) {
            const agent = new Agent({ keepAlive: false, rejectUnauthorized: !o.insecure });
            probki.push(await zadanie(url, agent, o));
            agent.destroy();
            if (o.odstep) await czekaj(o.odstep);
        }
        wynik.scenariusze.cold = podsumuj(probki, ['dns', 'tcp', 'tls', 'ttfb', 'calosc']);
    }
    if (o.tryb.includes('warm')) {
        const agent = new Agent(opcjeAgenta);
        await zadanie(url, agent, o);                                  // rozgrzanie: nawiązanie połączenia (nie liczone)
        const probki = [];
        for (let i = 0; i < o.n; i++) { probki.push(await zadanie(url, agent, o)); if (o.odstep) await czekaj(o.odstep); }
        agent.destroy();
        wynik.scenariusze.warm = podsumuj(probki, ['ttfb', 'calosc']);
        wynik.scenariusze.warm.ponowneUzycie = probki.filter((p) => p.ponowne).length;
    }
    if (o.tryb.includes('idle')) {
        wynik.scenariusze.idle = [];
        for (const s of o.idle) {
            const agent = new Agent({ ...opcjeAgenta, keepAliveMsecs: 1000 });
            await zadanie(url, agent, o);
            if (!o.json) process.stderr.write(`  idle ${s} s… `);
            await czekaj(s * 1000);
            const p = await zadanie(url, agent, o);
            agent.destroy();
            if (!o.json) process.stderr.write(`${p.blad ? 'błąd' : (p.ponowne ? 'połączenie przeżyło' : 'nowe połączenie')}\n`);
            wynik.scenariusze.idle.push({ idleS: s, ponowne: p.ponowne, calosc: p.calosc, ttfb: p.ttfb, dns: p.dns, tcp: p.tcp, tls: p.tls, blad: p.blad, status: p.status });
        }
    }
    return wynik;
}

function podsumuj(probki, fazy) {
    const out = { probek: probki.length, bledy: probki.filter((p) => p.blad).length, statusy: {} };
    for (const p of probki) if (p.status) out.statusy[p.status] = (out.statusy[p.status] || 0) + 1;
    const pierwszyBlad = probki.find((p) => p.blad);
    if (pierwszyBlad) out.pierwszyBlad = pierwszyBlad.blad;
    for (const f of fazy) out[f] = statystyki(probki.filter((p) => !p.blad).map((p) => p[f]));
    return out;
}

async function mierzTcp(url, o) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const port = Number(url.port);
    if (!port) throw new Error(`${url.href}: podaj port (tcp://host:port)`);
    const t0 = performance.now();
    const adres = await dns.promises.lookup(host);
    const dnsMs = performance.now() - t0;
    const probki = [];
    for (let i = 0; i < o.n; i++) { probki.push(await polaczenieTcp(adres.address, port, o)); if (o.odstep) await czekaj(o.odstep); }
    const bledy = probki.filter((p) => p.blad);
    return { cel: url.href, adres: adres.address, dnsMs, scenariusze: { tcp: { probek: probki.length, bledy: bledy.length,
        ...(bledy.length ? { pierwszyBlad: bledy[0].blad } : {}), tcp: statystyki(probki.map((p) => p.tcp)) } } };
}

const ms = (x) => (x === null || x === undefined ? '—' : `${x.toFixed(1)}`);

function drukuj(w) {
    console.log(`\n${w.cel}${w.adres ? ` (${w.adres}, DNS ${ms(w.dnsMs)} ms)` : ''}`);
    const naglowek = `  ${'faza'.padEnd(10)} ${['min', 'p50', 'p90', 'p99', 'max', 'średnia'].map((h) => h.padStart(8)).join(' ')}   [ms]`;
    for (const [nazwa, sc] of Object.entries(w.scenariusze)) {
        if (nazwa === 'idle') {
            console.log('  idle (keep-alive, potem przerwa i jedno żądanie):');
            for (const p of sc) console.log(`    po ${String(p.idleS).padStart(4)} s: ${p.blad ? `błąd: ${p.blad}` : `${p.ponowne ? 'połączenie przeżyło' : 'NOWE połączenie'}, całość ${ms(p.calosc)} ms, TTFB ${ms(p.ttfb)} ms`
                + (!p.ponowne && !p.blad ? ` (TCP ${ms(p.tcp)}, TLS ${ms(p.tls)})` : '')}`);
            continue;
        }
        const opis = { cold: 'cold (nowe połączenie na każde żądanie)', warm: 'warm (jedno połączenie keep-alive)', tcp: 'tcp connect' }[nazwa] || nazwa;
        console.log(`  ${opis} — próbek ${sc.probek}, błędów ${sc.bledy}${Object.keys(sc.statusy || {}).length ? `, HTTP ${JSON.stringify(sc.statusy)}` : ''}`
            + (nazwa === 'warm' ? `, ponownie użytych połączeń ${sc.ponowneUzycie}/${sc.probek}` : ''));
        if (sc.pierwszyBlad) console.log(`    pierwszy błąd: ${sc.pierwszyBlad}`);
        console.log(naglowek);
        for (const f of ['dns', 'tcp', 'tls', 'ttfb', 'calosc']) {
            const s = sc[f];
            if (s === undefined) continue;
            if (s === null) { console.log(`  ${f.padEnd(10)} ${'—'.padStart(8)}`); continue; }
            console.log(`  ${f.padEnd(10)} ${[s.min, s.p50, s.p90, s.p99, s.max, s.srednia].map((x) => ms(x).padStart(8)).join(' ')}`);
        }
    }
}

async function main() {
    let o;
    try { o = argumenty(process.argv.slice(2)); } catch (e) { console.error(`błąd: ${e.message}\n\n${POMOC}`); process.exit(2); }
    if (o.pomoc || !o.cele.length) { console.log(POMOC); process.exit(o.pomoc ? 0 : 2); }
    const wyniki = [];
    for (const c of o.cele) {
        let url;
        try { url = new URL(c.includes('://') ? c : `https://${c}`); } catch (_) { console.error(`błąd: niepoprawny cel "${c}"`); process.exitCode = 2; continue; }
        try {
            if (!o.json) process.stderr.write(`mierzę ${url.href}…\n`);
            const w = url.protocol === 'tcp:' ? await mierzTcp(url, o) : await mierzHttp(url, o);
            w.czas = new Date().toISOString();
            wyniki.push(w);
            if (!o.json) drukuj(w);
        } catch (e) { console.error(`błąd (${url.href}): ${e.message}`); process.exitCode = 1; }
    }
    if (o.json) console.log(JSON.stringify(wyniki, null, 2));
}

if (require.main === module) main();
module.exports = { argumenty, statystyki, zadanie, mierzHttp, mierzTcp };
