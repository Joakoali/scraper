import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, assertPublicUrl, safeFetch } from '../api/_lib/safe-fetch.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('isPrivateIp reconoce rangos privados, loopback, link-local y metadata', () => {
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1',
    '169.254.169.254', '0.0.0.0', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '2a00:1450::1']) assert.equal(isPrivateIp(ip), false, ip);
});

test('assertPublicUrl rechaza protocolos raros, IPs privadas y hosts que resuelven a privadas', async () => {
  await assert.rejects(assertPublicUrl('ftp://negocio.es/', publicLookup), { code: 'BLOCKED_TARGET' });
  await assert.rejects(assertPublicUrl('http://127.0.0.1/', publicLookup), { code: 'BLOCKED_TARGET' });
  await assert.rejects(assertPublicUrl('http://interno.test/', async () => [{ address: '10.0.0.5', family: 4 }]), { code: 'BLOCKED_TARGET' });
  assert.equal((await assertPublicUrl('https://negocio.es/x', publicLookup)).hostname, 'negocio.es');
});

test('safeFetch sigue redirecciones públicas y devuelve la URL final', async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal);
    return url === 'http://negocio.es/'
      ? new Response(null, { status: 301, headers: { location: 'https://negocio.es/' } })
      : new Response('<html>ok</html>', { status: 200 });
  };
  const r = await safeFetch('http://negocio.es/', { fetchImpl, lookupImpl: publicLookup });
  assert.deepEqual(r, { status: 200, url: 'https://negocio.es/', html: '<html>ok</html>' });
});

test('safeFetch revalida cada salto: una redirección a una IP interna se bloquea', async () => {
  const fetchImpl = async () => new Response(null, { status: 302, headers: { location: 'http://interno.test/' } });
  const lookupImpl = async (h) => [{ address: h === 'interno.test' ? '10.0.0.5' : '93.184.216.34', family: 4 }];
  await assert.rejects(safeFetch('https://negocio.es/', { fetchImpl, lookupImpl }), { code: 'BLOCKED_TARGET' });
});

test('safeFetch corta el cuerpo en maxBytes', async () => {
  const fetchImpl = async () => new Response('x'.repeat(5000), { status: 200 });
  const r = await safeFetch('https://negocio.es/', { fetchImpl, lookupImpl: publicLookup, maxBytes: 1000 });
  assert.equal(r.html.length, 1000);
});
