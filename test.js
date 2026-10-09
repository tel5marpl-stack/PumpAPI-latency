'use strict';
// Test bez sieci zewnętrznej i bez zależności: lokalny serwer HTTP, HTTPS (certyfikat self-signed z openssl) i TCP.
// Uruchom: node test.js
const assert = require('assert');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { argumenty, statystyki, mierzHttp, mierzTcp } = require('./latency');

let ok = 0;
const sprawdz = (c, m) => { assert.ok(c, m); ok++; };

(async () => {
    // statystyki
    const s = statystyki([5, 1, 3, 2, 4, null, NaN]);
    sprawdz(s.n === 5 && s.min === 1 && s.max === 5 && s.p50 === 3 && s.srednia === 3, 'statystyki: min/p50/max/średnia, null i NaN pominięte');
    sprawdz(statystyki([]) === null, 'statystyki: brak danych → null');
    // argumenty
    const a = argumenty(['https://x.example', '--n', '5', '--tryb', 'cold,idle', '--idle', '1,2', '--json']);
    sprawdz(a.n === 5 && a.tryb.join() === 'cold,idle' && a.idle.join() === '1,2' && a.json, 'argumenty');
    assert.throws(() => argumenty(['--n', '0']), /niepoprawna/); ok++;
    assert.throws(() => argumenty(['--tryb', 'zly']), /nieznany tryb/); ok++;

    const o = { n: 3, tryb: ['cold', 'warm', 'idle'], idle: [0.2], odstep: 0, timeout: 3000, metoda: 'GET', insecure: true, json: true };

    // HTTP
    const srvHttp = http.createServer((req, res) => setTimeout(() => res.end('ok'), 5));
    srvHttp.keepAliveTimeout = 10000;
    await new Promise((r) => srvHttp.listen(0, '127.0.0.1', r));
    const wh = await mierzHttp(new URL(`http://127.0.0.1:${srvHttp.address().port}/`), o);
    sprawdz(wh.scenariusze.cold.probek === 3 && wh.scenariusze.cold.bledy === 0, 'http cold: 3 próbki bez błędów');
    sprawdz(wh.scenariusze.cold.tcp && wh.scenariusze.cold.tls === null, 'http cold: TCP zmierzony, TLS brak');
    sprawdz(wh.scenariusze.cold.ttfb.min >= 4, `http cold: TTFB obejmuje 5 ms serwera (${wh.scenariusze.cold.ttfb.min.toFixed(1)})`);
    sprawdz(wh.scenariusze.warm.ponowneUzycie === 3, 'http warm: wszystkie żądania na tym samym połączeniu');
    sprawdz(wh.scenariusze.idle[0].ponowne === true, 'http idle 0,2 s < keepAliveTimeout: połączenie przeżyło');
    srvHttp.close();

    // HTTPS (self-signed)
    const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'latency-probe-'));
    let maOpenssl = true;
    try {
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(kat, 'k.pem'), '-out', path.join(kat, 'c.pem'),
            '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    } catch (_) { maOpenssl = false; }
    if (maOpenssl) {
        const srvHttps = https.createServer({ key: fs.readFileSync(path.join(kat, 'k.pem')), cert: fs.readFileSync(path.join(kat, 'c.pem')) }, (req, res) => res.end('ok'));
        await new Promise((r) => srvHttps.listen(0, '127.0.0.1', r));
        const ws = await mierzHttp(new URL(`https://127.0.0.1:${srvHttps.address().port}/`), { ...o, tryb: ['cold', 'warm'] });
        sprawdz(ws.scenariusze.cold.bledy === 0 && ws.scenariusze.cold.tls && ws.scenariusze.cold.tls.min > 0, 'https cold: TLS handshake zmierzony');
        sprawdz(ws.scenariusze.warm.ponowneUzycie === 3, 'https warm: keep-alive');
        const bez = await mierzHttp(new URL(`https://127.0.0.1:${srvHttps.address().port}/`), { ...o, tryb: ['cold'], insecure: false, n: 1 });
        sprawdz(bez.scenariusze.cold.bledy === 1, 'https: certyfikat self-signed bez --insecure → błąd, nie cichy sukces');
        srvHttps.close();
    } else console.log('  (pominięto HTTPS — brak openssl)');
    fs.rmSync(kat, { recursive: true, force: true });

    // TCP
    const srvTcp = net.createServer((s) => s.end());
    await new Promise((r) => srvTcp.listen(0, '127.0.0.1', r));
    const wt = await mierzTcp(new URL(`tcp://127.0.0.1:${srvTcp.address().port}`), { ...o, n: 5 });
    sprawdz(wt.scenariusze.tcp.probek === 5 && wt.scenariusze.tcp.bledy === 0 && wt.scenariusze.tcp.tcp.n === 5, 'tcp: 5 połączeń');
    srvTcp.close();
    const zamkniety = await mierzTcp(new URL('tcp://127.0.0.1:1'), { ...o, n: 1 });
    sprawdz(zamkniety.scenariusze.tcp.bledy === 1, 'tcp: zamknięty port → błąd w wyniku');

    console.log(`✓ ${ok} sprawdzeń OK`);
})().catch((e) => { console.error(e); process.exit(1); });
