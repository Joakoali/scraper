# Lead Finder: leads de verdad para Flexora — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el Lead Finder descarte cadenas, cerrados y negocios sin contacto, analice cada web en profundidad y ordene por una nota de oportunidad para Flexora, con búsqueda por zonas y un proxy cerrado.

**Architecture:** Sigue siendo una página estática (`index.html`) más una función de Vercel (`api/proxy.js`). La lógica pura del navegador vive en `lib/leads.js`, un módulo ES que se sirve estático y se testea en Node. La lógica pura del servidor vive en `api/_lib/*.js`, que Vercel no expone como función. Toda la red se inyecta, así que los tests no salen a internet.

**Tech Stack:** HTML + JS vanilla (ES modules), Vercel Node Functions (Node 24), `node:test` sin dependencias.

**Spec:** `docs/superpowers/specs/2026-11-17-leads-de-verdad-design.md`

## Global Constraints

- Node 24, **cero dependencias de runtime**. Tests con `node:test` y `node:assert/strict`; se corren con `npm test` (`node --test`).
- `package.json` con `"type": "module"`. Todo el código nuevo es ESM.
- Las 8 primeras columnas del CSV, exactas y en este orden: `Nombre, Dirección, Rating, Reseñas, Web, PageSpeed Mobile, Teléfono, Emails`. Los emails van unidos con `" | "`. Columnas nuevas al final: `Nota, Ángulo, Problemas, Instagram, Google Maps, Tipo`.
- Places: solo `places:searchText`; `pageSize: 20`; hasta 3 páginas por zona; `locationRestriction.rectangle`; field mask con `nextPageToken`.
- Análisis por web: máximo 3 páginas, timeout 8 s por página, 1,5 MB por página, máximo 5 redirecciones.
- Pesos y umbrales de la nota: exactamente los de la sección 5.7 del spec. Lead bueno: nota ≥ 50.
- Textos de la UI en español con voseo, como los actuales ("Ingresá…"). La estética no cambia: se reutilizan las variables y clases CSS existentes.
- Rama `leads-flexora`. Un commit por task. Cada mensaje termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nunca hacer `git push` sin el OK explícito de Joako.

## Review Focus

1. **Webs que bloquean bots** (403, 429, 503 o página de desafío de Cloudflare): tienen que quedar como "no se pudo revisar" (`blocked: true`), nunca como "web caída". Test en Task 3.
2. **Key sin PageSpeed Insights API habilitada** (PageSpeed devuelve 403 con key): reintenta sin key, no la vuelve a usar y avisa; la búsqueda no se rompe. Test en Task 6.
3. **Datos con comillas, comas, `<` o `&`** (nombres de Google, emails o URLs scrapeadas): la tarjeta los muestra como texto y el CSV no se desarma. Tests en Task 5 (`escapeHtml`) y Task 6 (`toCSV`).
4. **Places falla a mitad de las zonas** (cuota, 429): se conserva lo ya juntado, se avisa y no se consultan más zonas. Si falla la primera, se corta como hoy. Test en Task 2.
5. **`websiteUri` con parámetros de tracking o mayúsculas** (`HTTP://WWW.Negocio.es/?utm_source=gmb`): no cuenta como ficha de cadena y el dominio se calcula bien. Tests en Task 3 (`hostOf`) y Task 4 (`isLocatorUrl`).

---

### Task 1: Proxy cerrado, fetch seguro y servidor local

**Files:**
- Modify: `package.json`
- Create: `api/_lib/safe-fetch.js`, `api/_lib/origin.js`, `scripts/dev.js`
- Modify: `api/proxy.js`
- Test: `test/safe-fetch.test.js`, `test/origin.test.js`, `test/proxy.test.js`

**Interfaces:**
- Produces:
  - `isPrivateIp(ip: string): boolean`
  - `assertPublicUrl(url: string, lookupImpl?): Promise<URL>`. Lanza un `Error` con `code = 'BLOCKED_TARGET'` si el protocolo no es http/https o si alguna IP resuelta es privada.
  - `safeFetch(url: string, opts?: { timeoutMs = 8000, maxBytes = 1_500_000, maxRedirects = 5, fetchImpl = fetch, lookupImpl }): Promise<{ status: number, url: string, html: string }>`. `lookupImpl(hostname) → Promise<Array<{ address: string, family: number }>>`; por defecto, `dns.promises.lookup(hostname, { all: true })`.
  - `isSameOrigin(headers: Record<string, string | undefined>): boolean`
  - El handler default de `api/proxy.js`.

- [ ] **Step 1: Configurar los tests**

En `package.json`, agregar `"type": "module"` y `"scripts": { "test": "node --test", "dev": "node scripts/dev.js" }`.

- [ ] **Step 2: Escribir los tests que fallan**

```js
// test/safe-fetch.test.js
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
```

```js
// test/origin.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOrigin } from '../api/_lib/origin.js';

test('isSameOrigin acepta same-origin y rechaza otros sitios', () => {
  const host = 'scraper.vercel.app';
  assert.equal(isSameOrigin({ host, 'sec-fetch-site': 'same-origin', origin: 'https://scraper.vercel.app' }), true);
  assert.equal(isSameOrigin({ host, 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(isSameOrigin({ host, origin: 'https://otro-sitio.com' }), false);
  assert.equal(isSameOrigin({ host }), true); // curl sin headers: limitación aceptada en el spec 5.8
});
```

```js
// test/proxy.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/proxy.js';

function mockRes() {
  return { statusCode: 200, body: undefined, headers: {},
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end() { return this; } };
}
const req = (query, headers = {}) => ({ method: 'POST', query, headers: { host: 'scraper.vercel.app', ...headers }, body: {} });

test('proxy rechaza pedidos de otros sitios con 403', async () => {
  const res = mockRes();
  await handler(req({ endpoint: 'places:searchText' }, { 'sec-fetch-site': 'cross-site' }), res);
  assert.equal(res.statusCode, 403);
});

test('proxy solo acepta places:searchText', async () => {
  const res = mockRes();
  await handler(req({ endpoint: 'places:searchNearby' }), res);
  assert.equal(res.statusCode, 400);
});

test('proxy sin parámetros devuelve 400 y no manda CORS abierto', async () => {
  const res = mockRes();
  await handler(req({}), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL con `Cannot find module` para `api/_lib/safe-fetch.js` y `api/_lib/origin.js`, y fallas en `proxy.test.js` (hoy responde con CORS `*` y acepta cualquier endpoint).

- [ ] **Step 4: Implementar `api/_lib/safe-fetch.js`**

- `isPrivateIp`: IPv4 en 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 y 0.0.0.0; IPv6 `::1`, `fc00::/7`, `fe80::/10` e IPv4 mapeada (`::ffff:a.b.c.d`, que se evalúa como IPv4).
- `assertPublicUrl`: si el hostname es una IP literal se chequea directo; si no, se chequean todas las direcciones que devuelve `lookupImpl`.
- `safeFetch`: en cada salto llama a `assertPublicUrl` y después a `fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers })`. Si recibe 3xx con `location`, resuelve la URL relativa y repite; con más de `maxRedirects` saltos lanza error.
  - Headers: `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36`, `Accept: text/html,application/xhtml+xml` y `Accept-Language: es-ES,es;q=0.9`.
  - El cuerpo se lee con `response.body.getReader()` hasta `maxBytes`, se cancela el resto y se decodifica con `TextDecoder('utf-8')`.

- [ ] **Step 5: Implementar `api/_lib/origin.js` y modificar `api/proxy.js`**

- `isSameOrigin`: si existe `sec-fetch-site` y no es `same-origin`, devuelve `false`. Si existe `origin` y su host no es `headers.host`, devuelve `false`. En cualquier otro caso, `true`.
- `api/proxy.js`:
  - Se quitan los tres `Access-Control-*` y el manejo de `OPTIONS`.
  - Primero va el chequeo de origen (403 `{ error: 'Forbidden' }`).
  - Modo `endpoint`: solo `places:searchText` (si no, 400) y solo `POST`. El reenvío a Google no cambia.
  - Modo `scrape`: mismo comportamiento que hoy, pero con `safeFetch(targetUrl)` en vez del `fetch` directo. Se reemplaza en Task 3.

- [ ] **Step 6: Crear `scripts/dev.js`**

Servidor local sin dependencias (`node:http`), puerto `process.env.PORT || 3000`.
- `/api/*` llama al handler de `api/proxy.js` con el mismo shim que da Vercel:
  - `req.query`, armado desde `URLSearchParams`;
  - `req.body`, con `JSON.parse` si el content-type es json;
  - `res.status(code)` encadenable y `res.json(obj)`.
- Todo lo demás se sirve como estático desde la raíz del repo (`/` → `index.html`), con content-type para html, js, css, json, svg y png. Se rechaza cualquier path que, una vez resuelto, quede fuera de la raíz.

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS en los 9 tests.

- [ ] **Step 8: Verificar a mano**

Run: `npm run dev` y, en otra terminal, `curl -s -o /dev/null -w "%{http_code}" -H "Sec-Fetch-Site: cross-site" "http://localhost:3000/api/proxy?scrape=https://example.com"`
Expected: `403`. En `http://localhost:3000`, Joako hace una búsqueda con su key y la herramienta funciona como antes: aparecen leads y emails.

- [ ] **Step 9: Commit**

```bash
git add package.json api/ scripts/dev.js test/
git commit -m "Proxy cerrado: solo mismo origen, solo searchText y fetch seguro contra SSRF"
```

- [ ] **Step 10: Checkpoint de deploy (requiere el OK de Joako)**

Pedirle a Joako el OK para `git push -u origin leads-flexora`. En la preview de Vercel, verificar que `/` carga y que una búsqueda funciona: eso confirma que la función anda con `"type": "module"` y que se sirven los archivos de la raíz. Si la preview no aparece, avisar a Joako: puede que el proyecto no esté conectado a GitHub.

---

### Task 2: Búsqueda por zonas y paginación arreglada

**Files:**
- Create: `lib/leads.js`
- Modify: `index.html` (selector "Resultados máx." → "Zonas", búsqueda, `<script type="module">`)
- Test: `test/search.test.js`

**Interfaces:**
- Produces (en `lib/leads.js`):
  - `PLACES_FIELD_MASK: string`, con exactamente estos campos: `places.id, places.displayName, places.formattedAddress, places.rating, places.userRatingCount, places.websiteUri, places.nationalPhoneNumber, places.businessStatus, places.types, places.primaryType, places.googleMapsUri, nextPageToken` (separados por coma, sin espacios).
  - `buildZones(center: { lat, lng }, radiusM: number, n: 1 | 2 | 3): Zone[]`, con `Zone = { low: { latitude, longitude }, high: { latitude, longitude } }`, en orden por filas desde el suroeste.
  - `buildSearchBody(sector: string, zone: Zone, pageToken?: string | null): object`
  - `estimateQueries(n: 1 | 2 | 3): number`, que es `n * n * 3`.
  - `collectPlaces(zones: Zone[], fetchPage: (zone, pageToken | null) => Promise<{ places?, nextPageToken?, error?: { message } }>, onProgress?: (zoneIndex, total) => void): Promise<{ places: object[], error: string | null }>`
  - `mapLimit(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]>`, que conserva el orden.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// test/search.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLACES_FIELD_MASK, buildZones, buildSearchBody, estimateQueries, collectPlaces, mapLimit } from '../lib/leads.js';

const close = (a, b) => Math.abs(a - b) < 1e-4;

test('el field mask pide nextPageToken y los campos nuevos', () => {
  for (const f of ['nextPageToken', 'places.businessStatus', 'places.types', 'places.primaryType', 'places.googleMapsUri'])
    assert.ok(PLACES_FIELD_MASK.split(',').includes(f), f);
});

test('buildZones arma un cuadrado de medio lado = radio y lo parte en n×n', () => {
  const c = { lat: 41.3851, lng: 2.1734 };
  const [one] = buildZones(c, 10000, 1);
  assert.ok(close(one.low.latitude, 41.3851 - 10000 / 111320));
  assert.ok(close(one.high.longitude, 2.1734 + 10000 / (111320 * Math.cos(41.3851 * Math.PI / 180))));
  const nine = buildZones(c, 10000, 3);
  assert.equal(nine.length, 9);
  assert.deepEqual(nine[0].low, one.low);
  assert.ok(close(nine[8].high.latitude, one.high.latitude) && close(nine[8].high.longitude, one.high.longitude));
  assert.ok(close(nine[1].low.longitude, nine[0].high.longitude)); // zonas contiguas
});

test('buildSearchBody usa pageSize y locationRestriction, sin maxResultCount', () => {
  const zone = buildZones({ lat: 41, lng: 2 }, 5000, 1)[0];
  const b = buildSearchBody('dentista clínica dental', zone, null);
  assert.deepEqual(b, { textQuery: 'dentista clínica dental', pageSize: 20, languageCode: 'es', locationRestriction: { rectangle: zone } });
  assert.equal(buildSearchBody('x', zone, 'tok').pageToken, 'tok');
});

test('estimateQueries = zonas × 3 páginas', () => {
  assert.deepEqual([1, 2, 3].map(estimateQueries), [3, 12, 27]);
});

test('collectPlaces pide hasta 3 páginas por zona y deduplica por id', async () => {
  const calls = [];
  const pages = { first: { places: [{ id: 'a' }, { id: 'b' }], nextPageToken: 't1' },
    t1: { places: [{ id: 'c' }, { id: 'a' }], nextPageToken: 't2' }, t2: { places: [{ id: 'd' }], nextPageToken: 't3' } };
  const r = await collectPlaces([{}, {}], async (zone, tok) => { calls.push(tok); return pages[tok ?? 'first']; });
  assert.deepEqual(r.places.map(p => p.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(calls, [null, 't1', 't2', null, 't1', 't2']);
  assert.equal(r.error, null);
});

test('collectPlaces conserva lo juntado y corta si una zona falla', async () => {
  const r = await collectPlaces([{ n: 1 }, { n: 2 }, { n: 3 }], async (z) =>
    z.n === 2 ? { error: { message: 'Quota exceeded' } } : { places: [{ id: `p${z.n}` }] });
  assert.deepEqual(r.places.map(p => p.id), ['p1']);
  assert.equal(r.error, 'Quota exceeded');
});

test('mapLimit respeta el límite y conserva el orden', async () => {
  let running = 0, max = 0;
  const out = await mapLimit([30, 10, 20, 5], 2, async (ms, i) => {
    running++; max = Math.max(max, running);
    await new Promise(r => setTimeout(r, ms)); running--; return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3]);
  assert.equal(max, 2);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL en `search.test.js` con `Cannot find module '../lib/leads.js'`.

- [ ] **Step 3: Implementar las funciones de búsqueda en `lib/leads.js`**

- Grados de latitud = `m / 111320`; de longitud = `m / (111320 · cos(lat))`.
- `collectPlaces` recorre las zonas en secuencia, sin pausas entre páginas. Ante el primer `error`, devuelve lo juntado más `error.message` y no consulta más zonas.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Conectar `index.html`**

- `<script>` pasa a `<script type="module">` con `import { … } from './lib/leads.js'`. Los `onclick`/`onchange` inline pasan a `addEventListener`.
- El select `#maxResults` se reemplaza por `#zones`, con las opciones `1` "1 zona", `2` "4 zonas" y `3` "9 zonas" (seleccionada: `1`). Debajo va `<div id="queryEstimate">`, que se actualiza al cambiar el select con el texto `Hasta ${estimateQueries(n)} consultas a Google (1.000 gratis al mes, después ~35 USD cada 1.000)`. Se reutiliza el estilo de `.warning`.
- `placesSearch` y el loop de páginas se reemplazan por `buildZones(coords, radius, n)` + `collectPlaces`. El `fetchPage` hace `POST /api/proxy?endpoint=places%3AsearchText` con `X-Goog-FieldMask: PLACES_FIELD_MASK` y `buildSearchBody(sector, zone, token)`.
- Durante la búsqueda, el estado muestra `Buscando… zona i/N`.
- Errores:
  - `error` sin ningún resultado: mismo mensaje de error que hoy y corte.
  - `error` con resultados: se sigue, y el estado final agrega `⚠ Búsqueda cortada: <mensaje>`.
- Por ahora siguen igual `isNoise` y el análisis actual (PageSpeed + `?scrape=`).

- [ ] **Step 6: Verificar a mano**

Run: `npm run dev`. Joako busca "Dentistas" en Barcelona con 1 zona.
Expected: llegan más de 20 negocios (hasta 60), lo que prueba que la paginación anda. Con 4 zonas llegan más, sin repetidos.

- [ ] **Step 7: Commit**

```bash
git add lib/leads.js index.html test/search.test.js
git commit -m "Busqueda por zonas con locationRestriction y paginacion arreglada"
```

---

### Task 3: Análisis de web en profundidad

**Files:**
- Create: `lib/domain.js`, `api/_lib/analyze.js`
- Modify: `lib/leads.js` (agrega `EMPTY_ANALYSIS`, `UNREVIEWED_ANALYSIS`), `api/proxy.js` (`?analyze=` reemplaza a `?scrape=`), `index.html` (usa `?analyze=`)
- Test: `test/domain.test.js`, `test/analyze.test.js`

**Interfaces:**
- Consumes: `safeFetch` (Task 1). `api/_lib/analyze.js` importa `EMPTY_ANALYSIS` y `UNREVIEWED_ANALYSIS` desde `../../lib/leads.js` y `hostOf`/`registrableDomain` desde `../../lib/domain.js`, para que la forma del análisis se defina una sola vez.
- Produces:
  - En `lib/domain.js`:
    - `hostOf(url: string): string | null`: hostname en minúsculas, sin `www.` inicial; `null` si la URL es inválida.
    - `registrableDomain(host: string): string`: últimas 2 etiquetas, o 3 si las 2 últimas son `com.es`, `org.es`, `nom.es`, `gob.es`, `edu.es`, `co.uk`, `org.uk`, `com.ar`, `com.mx`, `com.br` o `com.co`.
  - En `lib/leads.js`:
    - `EMPTY_ANALYSIS`, congelado: `{ reachable: false, blocked: false, parked: false, finalUrl: null, https: false, sslBroken: false, viewport: false, copyrightYear: null, generator: null, metaPixel: false, googleAds: false, gtm: false, emails: [], instagram: null }`.
    - `UNREVIEWED_ANALYSIS = { ...EMPTY_ANALYSIS, blocked: true }`.
  - En `api/_lib/analyze.js`:
    - `classifyEmail(email, siteDomain): 'propio' | 'gratuito' | 'otro'`
    - `extractEmails(html: string, siteDomain: string): Array<{ email: string, kind }>`, con un máximo de 5, ordenados propio → gratuito → otro y, dentro de cada tipo, por orden de aparición.
    - `detectSignals(html: string, currentYear = new Date().getFullYear()): { viewport, copyrightYear, generator, metaPixel, googleAds, gtm, instagram, parked, challenge }`
    - `findInternalLinks(html: string, baseUrl: string): string[]`, con un máximo de 2.
    - `analyzeSite(url: string, { fetchPage = safeFetch } = {}): Promise<Analysis>`, con la forma de `EMPTY_ANALYSIS`. Nunca lanza.
  - `GET /api/proxy?analyze=<url>` → 200 con `Analysis`; 400 si falta la URL.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// test/domain.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, registrableDomain } from '../lib/domain.js';

test('hostOf normaliza mayúsculas, www y tracking', () => {
  assert.equal(hostOf('HTTP://WWW.Negocio.es/?utm_source=gmb'), 'negocio.es');
  assert.equal(hostOf('no es una url'), null);
});

test('registrableDomain respeta sufijos de 2 niveles', () => {
  assert.equal(registrableDomain('mail.negocio.es'), 'negocio.es');
  assert.equal(registrableDomain('www.negocio.com.es'), 'negocio.com.es');
  assert.equal(registrableDomain('negocio.co.uk'), 'negocio.co.uk');
});
```

```js
// test/analyze.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmail, extractEmails, detectSignals, findInternalLinks, analyzeSite } from '../api/_lib/analyze.js';

const cfEncode = (s, key = 0x42) =>
  key.toString(16).padStart(2, '0') + [...s].map(c => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');

test('classifyEmail: propio (incluye subdominios), gratuito y otro', () => {
  assert.equal(classifyEmail('ventas@mail.negocio.es', 'negocio.es'), 'propio');
  for (const e of ['x@gmail.com', 'x@hotmail.es', 'x@outlook.com', 'x@telefonica.net']) assert.equal(classifyEmail(e, 'negocio.es'), 'gratuito', e);
  assert.equal(classifyEmail('hola@agenciaweb.com', 'negocio.es'), 'otro');
});

test('extractEmails junta mailto, cfemail, entidades y texto, y descarta basura', () => {
  const html = `
    <a href="mailto:Info@Negocio.es?subject=Hola">Escribinos</a>
    <span data-cfemail="${cfEncode('reservas@negocio.es')}">[email&#160;protected]</span>
    contacto&#64;negocio.es
    <img src="logo@2x.png"><img srcset="hero@3x.webp 3x">
    info@tudominio.com email@example.com 5f2a9c8e7d6b4a3f1e0d@sentry.io noreply@negocio.es
    u003epedidos@gmail.com
    Diseño web: hola@agenciaweb.com`;
  assert.deepEqual(extractEmails(html, 'negocio.es'), [
    { email: 'info@negocio.es', kind: 'propio' },
    { email: 'reservas@negocio.es', kind: 'propio' },
    { email: 'contacto@negocio.es', kind: 'propio' },
    { email: 'pedidos@gmail.com', kind: 'gratuito' },
    { email: 'hola@agenciaweb.com', kind: 'otro' },
  ]);
});

test('extractEmails no descarta por substring: "test" o "cdn" dentro de un dominio real valen', () => {
  assert.deepEqual(extractEmails('hola@contestaciones.es info@cdnclinica.es', 'otra.es').map(e => e.email),
    ['hola@contestaciones.es', 'info@cdnclinica.es']);
});

test('detectSignals en una web moderna', () => {
  const html = `<html><head><meta name="viewport" content="width=device-width">
    <meta name="generator" content="WordPress 6.4.2"><title>Negocio</title>
    <script>fbq('init','123');</script><script>gtag('config','AW-123456789')</script>
    <script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCD12"></script></head>
    <body><a href="https://www.instagram.com/negocio_bcn/">IG</a><a href="https://instagram.com/p/xyz">post</a>
    <footer>© 2015 - 2024 Negocio</footer></body></html>`;
  assert.deepEqual(detectSignals(html, 2026), { viewport: true, copyrightYear: 2024, generator: 'WordPress 6.4.2',
    metaPixel: true, googleAds: true, gtm: true, instagram: 'https://instagram.com/negocio_bcn', parked: false, challenge: false });
});

test('detectSignals en una web vieja y sin año', () => {
  const s = detectSignals('<html><body><table>Hola</table><p>&copy; 2016 Negocio</p></body></html>', 2026);
  assert.equal(s.viewport, false);
  assert.equal(s.copyrightYear, 2016);
  assert.equal(s.metaPixel || s.googleAds || s.gtm, false);
  assert.equal(detectSignals('<footer>Copyright <script>document.write(y)</script></footer>', 2026).copyrightYear, null);
  assert.equal(detectSignals('<footer>© 2099</footer>', 2026).copyrightYear, null);
});

test('detectSignals: aparcado y desafío anti-bot, sin falsos positivos', () => {
  assert.equal(detectSignals('<title>Este dominio está a la venta</title>').parked, true);
  assert.equal(detectSignals('<title>Próximamente</title>').parked, true);
  assert.equal(detectSignals('<title>Tienda</title><p>Próximamente nuevos productos</p>').parked, false);
  assert.equal(detectSignals('<script>window._cf_chl_opt={}</script>').challenge, true);
  assert.equal(detectSignals('<title>Just a moment...</title>').challenge, true);
  assert.equal(detectSignals('<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>').challenge, false);
});

test('findInternalLinks: uno de contacto y uno legal, mismo host, nunca externos', () => {
  const html = `<a href="/quienes-somos">Nosotros</a><a href="https://www.negocio.es/aviso-legal">Aviso legal</a>
    <a href="contacto.html">Contacto</a><a href="https://otro.com/contacto">x</a><a href="/contact-us">Contact</a>`;
  assert.deepEqual(findInternalLinks(html, 'https://negocio.es/'),
    ['https://negocio.es/contacto.html', 'https://www.negocio.es/aviso-legal']);
  assert.deepEqual(findInternalLinks('<a href="/privacidad">Privacidad</a><a href="/quienes-somos">Q</a>', 'https://negocio.es/'),
    ['https://negocio.es/privacidad', 'https://negocio.es/quienes-somos']);
});

function fakeFetch(map) {
  const seen = [];
  const fn = async (url) => {
    seen.push(url);
    const v = map[url];
    if (!v) throw new Error('fetch failed');
    if (v instanceof Error) throw v;
    return { url, ...v };
  };
  fn.seen = seen;
  return fn;
}
const home = '<meta name="viewport" content="width=device-width"><a href="/contacto">Contacto</a><a href="/aviso-legal">Aviso legal</a>';

test('analyzeSite: web sana, saca emails de contacto y baja como máximo 3 páginas', async () => {
  const fetchPage = fakeFetch({
    'https://negocio.es/': { status: 200, html: home },
    'https://negocio.es/contacto': { status: 200, html: 'info@negocio.es' },
    'https://negocio.es/aviso-legal': { status: 200, html: 'Titular: legal@negocio.es' },
  });
  const a = await analyzeSite('https://negocio.es/', { fetchPage });
  assert.equal(a.reachable, true); assert.equal(a.https, true); assert.equal(a.viewport, true);
  assert.deepEqual(a.emails.map(e => e.email), ['info@negocio.es', 'legal@negocio.es']);
  assert.equal(fetchPage.seen.length, 3);
});

test('analyzeSite: http sin https disponible → https false', async () => {
  const a = await analyzeSite('http://viejo.es/', { fetchPage: fakeFetch({ 'http://viejo.es/': { status: 200, html: '<p>hola</p>' } }) });
  assert.equal(a.reachable, true); assert.equal(a.https, false); assert.equal(a.sslBroken, false);
});

test('analyzeSite: https falla y http responde → SSL roto', async () => {
  const a = await analyzeSite('https://roto.es/', { fetchPage: fakeFetch({ 'http://roto.es/': { status: 200, html: '<p>hola</p>' } }) });
  assert.equal(a.reachable, true); assert.equal(a.sslBroken, true); assert.equal(a.https, false);
});

test('analyzeSite: bloqueo anti-bot → blocked, nunca caída', async () => {
  for (const r of [{ status: 403, html: '' }, { status: 503, html: '' }, { status: 200, html: '<script>window._cf_chl_opt={}</script>' }]) {
    const a = await analyzeSite('https://protegido.es/', { fetchPage: fakeFetch({ 'https://protegido.es/': r }) });
    assert.equal(a.blocked, true); assert.equal(a.reachable, false);
  }
  const ssrf = Object.assign(new Error('blocked'), { code: 'BLOCKED_TARGET' });
  assert.equal((await analyzeSite('https://interno.es/', { fetchPage: fakeFetch({ 'https://interno.es/': ssrf }) })).blocked, true);
});

test('analyzeSite: caída (no responde o 404) y aparcada', async () => {
  for (const map of [{}, { 'https://caida.es/': { status: 404, html: '' } }]) {
    const a = await analyzeSite('https://caida.es/', { fetchPage: fakeFetch(map) });
    assert.equal(a.reachable, false); assert.equal(a.blocked, false);
  }
  const p = await analyzeSite('https://venta.es/', { fetchPage: fakeFetch({ 'https://venta.es/': { status: 200, html: '<title>Domain is for sale</title>' } }) });
  assert.equal(p.parked, true);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL con `Cannot find module` para `lib/domain.js` y `api/_lib/analyze.js`.

- [ ] **Step 3: Implementar `lib/domain.js` y las constantes de análisis en `lib/leads.js`**

- [ ] **Step 4: Implementar `api/_lib/analyze.js`**

Decisiones que los tests no fijan del todo:
- **Emails:**
  - Fuentes, en este orden: `mailto:` (con `decodeURIComponent`, cortando en `?`), `data-cfemail` (el primer byte hex es la clave XOR) y regex `[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}` sobre el HTML con `&#64;`, `&#x40;` y `&commat;` → `@`.
  - Normalizar a minúsculas y quitar el prefijo `/^u00[0-9a-f]{2}/`.
  - Descartar:
    - extensión de archivo `/\.(png|jpe?g|gif|webp|svg|css|js|ico|avif)$/` o `@[23]x`;
    - parte local `noreply`, `no-reply`, `donotreply`, `do-not-reply`, `bounce`, `mailer-daemon` o `postmaster`;
    - parte local `/^[a-f0-9]{16,}$/`;
    - dominio igual o subdominio de: `sentry.io`, `wixpress.com`, `wix.com`, `wordpress.com`, `wordpress.org`, `cloudflare.com`, `schema.org`, `w3.org`, `google.com`, `googleapis.com`, `facebook.com`, `example.com`, `example.org`, `domain.com`, `email.com`, `tudominio.com`, `tuempresa.com`, `midominio.com`, `dominio.com`, `ejemplo.com`, `yourdomain.com`, `yourcompany.com`, `test.com`.
- **Gratuitos:** `/^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|protonmail|proton)\.[a-z.]+$/` y `telefonica.net`.
- **Copyright:**
  - Años `(19|20)\d\d` que aparezcan hasta 20 caracteres después de `©`, `&copy;`, `&#169;` o `copyright` (sin distinguir mayúsculas).
  - Se toma el máximo que sea ≤ `currentYear`; si no hay ninguno, `null`.
- **Píxeles y tags:**
  - píxel de Meta: `/connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init/i`;
  - Google Ads: `/\bAW-\d{6,}|googleadservices\.com|googleads\.g\.doubleclick\.net/i`;
  - GTM: `/googletagmanager\.com\/gtm\.js|\bGTM-[A-Z0-9]{4,}/`. `gtag/js` es GA4 y no cuenta como GTM.
- **Instagram:** el primer `instagram.com/<handle>` cuyo handle no sea `p`, `reel`, `reels`, `explore`, `accounts` ni `stories`, normalizado a `https://instagram.com/<handle>`.
- **Aparcado:**
  - Frases fuertes en cualquier parte: `domain is for sale`, `buy this domain`, `dominio está a la venta`, `dominio en venta`, `sedoparking`, `parkingcrew`, `hugedomains`, `this site is parked`, `account suspended`, `cuenta suspendida`, `welcome to nginx`, `apache2 ubuntu default page`.
  - Frases débiles solo dentro de `<title>`: `en construcción`, `en construccion`, `próximamente`, `proximamente`, `coming soon`, `under construction`, `index of /`.
- **Desafío anti-bot:** `_cf_chl_opt`, `<title>Just a moment...`, `Attention Required! | Cloudflare`.
- **Links internos:** se toman los `<a href>` con su texto, resueltos contra `baseUrl`. Mismo host ignorando `www.`; se excluyen `#`, `mailto:`, `tel:`, `.pdf` y la propia `baseUrl`. Hay una categoría por prioridad:
  1. contacto: `/contact|contacto|contactar/i`;
  2. legal: `/aviso[-\s_]?legal|legal|privacidad/i`;
  3. nosotros: `/qui[eé]nes[-\s_]?somos/i`.
  
  De cada categoría se toma el primer link y se devuelven los 2 de mayor prioridad.
- **`analyzeSite`:**
  1. `fetchPage(url)`. Si el error es `BLOCKED_TARGET`, el resultado es `blocked` directamente, sin probar http. Si falla por otro motivo y la URL era https, se prueba la variante http: si responde, `sslBroken = true`.
  2. Status 403, 429 o 503, o `challenge`, también dan `blocked`. Otro status ≥ 400 da `EMPTY_ANALYSIS`.
  3. Si la URL final es http y no hay `sslBroken`, se prueba `https://<host>/`: si responde con menos de 400, `https = true`.
  4. Señales de la portada; emails e Instagram de todas las páginas, con `siteDomain = registrableDomain(hostOf(finalUrl))`.
  5. Se envuelve todo en try/catch: ante cualquier excepción inesperada devuelve `UNREVIEWED_ANALYSIS`.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Cambiar el proxy y la página**

- `api/proxy.js`: se borra el modo `scrape` (con su regex y su blocklist) y se agrega `analyze`. Si falta la URL o no es http(s): 400. Si no: `res.status(200).json(await analyzeSite(url))`.
- `index.html`: `extractEmails(website)` pasa a `analyze(website)`, que hace `GET /api/proxy?analyze=…`; si la red falla, devuelve `UNREVIEWED_ANALYSIS`. Se guarda `lead.analysis` y, para que la tarjeta actual siga andando, `lead.emails = analysis.emails.map(e => e.email)`. `getPageSpeed` queda como está hasta Task 6.

- [ ] **Step 7: Verificar a mano**

Run: `npm run dev`. Joako repite la búsqueda de Task 2.
Expected: más leads con email que antes, sin `@2x.png` ni emails de plantilla.

- [ ] **Step 8: Commit**

```bash
git add lib/ api/ index.html test/domain.test.js test/analyze.test.js
git commit -m "Analisis de web: emails limpios, HTTPS, movil, antiguedad, publicidad y bloqueos"
```

---

### Task 4: Filtros duros y detección de cadenas

**Files:**
- Modify: `lib/leads.js`, `index.html`
- Test: `test/filters.test.js`

**Interfaces:**
- Consumes: `hostOf` y `registrableDomain` (Task 3); `EMPTY_ANALYSIS` y `UNREVIEWED_ANALYSIS` (Task 3).
- Produces (en `lib/leads.js`):
  - `SOCIAL_HOSTS`, `KNOWN_CHAINS` y `NOISE_KEYWORDS` (esta última se mueve desde `index.html` sin cambios).
  - `isSocialWeb(url: string): boolean`
  - `normalizeName(name: string): string`
  - `citySlug(city: string): string`, que es `normalizeName(city)` con espacios → `-`.
  - `isLocatorUrl(url: string, slug: string): boolean`
  - `findChains(places: object[], slug: string): Set<string>`, que devuelve place ids.
  - `toLead(place): Lead`, con `Lead = { id, name, address, rating: number | null, reviews: number, website: string | null, socialWeb: boolean, phone: string | null, mapsUrl: string | null, type: string | null, status: string | null, analysis: Analysis | null, pagespeed: number | null }`.
  - `hasOwnWeb(lead): boolean`, que es `!!lead.website && !lead.socialWeb`.
  - `preFilter(places: object[], slug: string): { kept: Lead[], discarded: Array<{ lead: Lead, reason: string }> }`
  - `postFilterReason(lead: Lead): string | null`
  - Motivos exactos: `'Cerrado'`, `'Cadena'`, `'No es del sector'`, `'Sin actividad visible'`, `'Sin contacto posible'`, `'Sin contacto (web no se pudo revisar)'`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// test/filters.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSocialWeb, normalizeName, citySlug, isLocatorUrl, findChains, toLead, preFilter, postFilterReason,
  EMPTY_ANALYSIS, UNREVIEWED_ANALYSIS } from '../lib/leads.js';

const place = (id, name, extra = {}) => ({ id, displayName: { text: name }, formattedAddress: 'C/ X 1',
  userRatingCount: 40, rating: 4.6, businessStatus: 'OPERATIONAL', nationalPhoneNumber: '931 23 45 67', ...extra });

test('isSocialWeb reconoce redes, linktree y business.site', () => {
  for (const u of ['https://www.facebook.com/negocio', 'https://linktr.ee/x', 'https://negocio.business.site/',
    'https://maps.app.goo.gl/abc', 'https://www.instagram.com/negocio', 'https://wa.me/34600000000'])
    assert.equal(isSocialWeb(u), true, u);
  assert.equal(isSocialWeb('https://negocio.es/'), false);
});

test('normalizeName y citySlug', () => {
  assert.equal(normalizeName('Clínica Dental Pérez - Dentista en Barcelona'), 'clinica dental perez');
  assert.equal(normalizeName('Peluquería  Ana | Gràcia'), 'peluqueria ana');
  assert.equal(citySlug('Sant Cugat'), 'sant-cugat');
});

test('isLocatorUrl detecta fichas de cadena pero no raíces con tracking', () => {
  assert.equal(isLocatorUrl('https://www.vitaldent.com/clinicas-dentales/barcelona/sants', 'barcelona'), true);
  assert.equal(isLocatorUrl('https://www.basic-fit.com/es-es/gimnasios/barcelona-sants', 'barcelona'), true);
  assert.equal(isLocatorUrl('HTTP://WWW.Negocio.es/?utm_source=gmb&utm_medium=organic', 'barcelona'), false);
  assert.equal(isLocatorUrl('https://negocio.es/barcelona', 'barcelona'), false); // 1 segmento
});

test('findChains: dominio repetido, nombre repetido, cadena conocida y localizador', () => {
  const ps = [
    place('d1', 'Sonrisas Sants', { websiteUri: 'https://www.sonrisas.es/sants' }),
    place('d2', 'Sonrisas Gràcia', { websiteUri: 'https://sonrisas.es/gracia' }),
    place('n1', 'Dental Nova - Sants'), place('n2', 'Dental Nova | Gràcia'),
    place('k1', 'Tecnocasa Estudio Sants'),
    place('l1', 'Clínica X', { websiteUri: 'https://www.vitaldent.com/clinicas-dentales/barcelona/sants' }),
    place('i1', 'Clínica Dra. Pérez', { websiteUri: 'https://draperez.es/' }),
    place('f1', 'Bar Uno', { websiteUri: 'https://facebook.com/baruno' }),
    place('f2', 'Bar Dos', { websiteUri: 'https://facebook.com/bardos' }),
  ];
  assert.deepEqual([...findChains(ps, 'barcelona')].sort(), ['d1', 'd2', 'k1', 'l1', 'n1', 'n2']);
});

test('preFilter descarta con el motivo correcto y convierte el resto en Lead', () => {
  const { kept, discarded } = preFilter([
    place('c', 'Cerrado SL', { businessStatus: 'CLOSED_PERMANENTLY' }),
    place('k', 'Llongueras Diagonal'),
    place('h', 'Hotel Sol'),
    place('z', 'Nuevo Estudio', { userRatingCount: 0 }),
    place('s', 'Sin Nada', { nationalPhoneNumber: undefined, websiteUri: 'https://instagram.com/sinnada' }),
    place('ok', 'Peluquería Ana', { websiteUri: 'https://peluana.es/', primaryType: 'hair_salon', googleMapsUri: 'https://maps.google.com/?cid=1' }),
  ], 'barcelona');
  assert.deepEqual(discarded.map(d => [d.lead.id, d.reason]), [
    ['c', 'Cerrado'], ['k', 'Cadena'], ['h', 'No es del sector'], ['z', 'Sin actividad visible'], ['s', 'Sin contacto posible']]);
  assert.deepEqual(kept, [{ id: 'ok', name: 'Peluquería Ana', address: 'C/ X 1', rating: 4.6, reviews: 40,
    website: 'https://peluana.es/', socialWeb: false, phone: '931 23 45 67', mapsUrl: 'https://maps.google.com/?cid=1',
    type: 'hair_salon', status: 'OPERATIONAL', analysis: null, pagespeed: null }]);
});

test('postFilterReason se evalúa después del análisis', () => {
  const lead = toLead(place('x', 'X', { websiteUri: 'https://x.es/', nationalPhoneNumber: undefined }));
  assert.equal(postFilterReason({ ...lead, analysis: UNREVIEWED_ANALYSIS }), 'Sin contacto (web no se pudo revisar)');
  assert.equal(postFilterReason({ ...lead, analysis: { ...EMPTY_ANALYSIS, reachable: true } }), 'Sin contacto posible');
  assert.equal(postFilterReason({ ...lead, analysis: { ...EMPTY_ANALYSIS, reachable: true, emails: [{ email: 'a@x.es', kind: 'propio' }] } }), null);
  assert.equal(postFilterReason({ ...lead, phone: '600 00 00 00', analysis: UNREVIEWED_ANALYSIS }), null);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL en `filters.test.js` porque las funciones no están exportadas.

- [ ] **Step 3: Implementar en `lib/leads.js`**

- `SOCIAL_HOSTS`: `facebook.com`, `fb.com`, `instagram.com`, `linktr.ee`, `linkin.bio`, `beacons.ai`, `taplink.cc`, `wa.me`, `whatsapp.com`, `tiktok.com`, `business.site`, `sites.google.com`, `g.page`, `goo.gl`. Coincide si el host es igual o termina en `.` + el dominio; también todo host que matchee `/^maps\.google\./`.
- `normalizeName`: minúsculas, NFD sin diacríticos, cortar en ` - `, ` – ` o `|`, colapsar espacios y `trim`.
- `isLocatorUrl`: segmentos no vacíos del `pathname` (ignorando query) ≥ 2, y algún segmento que, partido por `-` o `_`, tenga una palabra de `tienda|tiendas|clinica|clinicas|centro|centros|locales|oficinas|gimnasios|salones|store|stores|sucursal|sucursales|delegacion|delegaciones`, o que contenga `slug`.
- `KNOWN_CHAINS`: la lista del spec 5.3, normalizada, cada nombre como palabra completa (`\b…\b`) dentro del `normalizeName`. Lista inicial: `vitaldent, sanitas, adeslas, caser, unidental, llongueras, marco aldany, jean louis david, provost, basic-fit, mcfit, anytime fitness, holmes place, dir, go fit, synergym, vivagym, altafit, tecnocasa, century 21, re/max, remax, engel & volkers, lucas fox, solvia, servihabitat, donpiso, midas, norauto, feu vert, euromaster, carglass, kiwoko, tiendanimal`.
- `findChains`: dominio registrable repetido entre places distintos (excluyendo `isSocialWeb`), `normalizeName` repetido, `KNOWN_CHAINS` o `isLocatorUrl`.
- `preFilter`: los motivos se chequean en el orden del test. `Sin contacto posible` en esta etapa solo aplica si `!hasOwnWeb(lead) && !lead.phone`.
- `postFilterReason`: solo para `hasOwnWeb`. Si no hay teléfono ni emails: `analysis.blocked` → `'Sin contacto (web no se pudo revisar)'`; si no, `'Sin contacto posible'`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Conectar `index.html`**

- Se borran `NOISE_KEYWORDS` e `isNoise` de la página.
- Después de `collectPlaces`, se aplica `preFilter(places, citySlug(cityLabel))`, donde `cityLabel` es el texto de la opción elegida o `#customCityName`.
- Solo se analizan con `mapLimit(…, 5, …)` los `kept` con `hasOwnWeb`. Mientras tanto, el estado muestra `Analizando webs i/N`.
- Después del análisis, los que tengan `postFilterReason` pasan a `discarded`.
- Debajo de la lista va `<details id="discardedSection"><summary>Descartados (N)</summary>…</details>`, con una línea por lead: `nombre — motivo`, en `font-family: 'Space Mono'` y `color: var(--muted)`.

- [ ] **Step 6: Verificar a mano**

Run: `npm run dev`. Joako busca "Inmobiliarias" en Barcelona con 4 zonas.
Expected: Tecnocasa, Century 21 y similares aparecen en "Descartados" con el motivo `Cadena`. Joako revisa la lista de descartados por si hay algún negocio bueno que se filtró de más.

- [ ] **Step 7: Commit**

```bash
git add lib/leads.js index.html test/filters.test.js
git commit -m "Filtros duros: cerrados, cadenas, ruido, sin actividad y sin contacto, con motivo visible"
```

---

### Task 5: Nota, ángulo y tarjeta nueva

**Files:**
- Modify: `lib/leads.js`, `index.html`
- Test: `test/score.test.js`

**Interfaces:**
- Consumes: `Lead`, `hasOwnWeb` y `EMPTY_ANALYSIS` (Tasks 3 y 4).
- Produces (en `lib/leads.js`):
  - `WEIGHTS`
  - `GOOD_THRESHOLD = 50`
  - `scoreLead(lead: Lead, currentYear = new Date().getFullYear()): { score: number, angle: string | null, problems: string[], good: boolean }`
  - `escapeHtml(s: unknown): string`
  - Etiquetas de ángulo y problema, exactas y en este orden de desempate: `'Sin web'`, `'Red social como web'`, `'Web caída'`, `'Sin HTTPS'`, `'No se adapta al celular'`, `'Lenta'`, `'Desactualizada'`, `'Sin publicidad'`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// test/score.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead, escapeHtml, EMPTY_ANALYSIS, UNREVIEWED_ANALYSIS } from '../lib/leads.js';

const base = { id: 'x', name: 'N', address: '', rating: 4.5, reviews: 100, website: null, socialWeb: false, phone: null,
  mapsUrl: null, type: null, status: 'OPERATIONAL', analysis: null, pagespeed: null };
const okWeb = { ...EMPTY_ANALYSIS, reachable: true, https: true, viewport: true, copyrightYear: 2026,
  emails: [{ email: 'info@n.es', kind: 'propio' }] };
const web = (analysis, extra = {}) => ({ ...base, website: 'https://n.es/', analysis, ...extra });

test('calibración del spec: sin web + teléfono + 100 reseñas = 65', () => {
  assert.deepEqual(scoreLead({ ...base, phone: '931' }, 2026), { score: 65, angle: 'Sin web', problems: ['Sin web'], good: true });
});

test('calibración del spec: web correcta sin publicidad, PageSpeed 50, email propio = 50', () => {
  const r = scoreLead(web(okWeb, { pagespeed: 50 }), 2026);
  assert.equal(r.score, 50); assert.equal(r.good, true); assert.equal(r.angle, 'Sin publicidad');
  assert.deepEqual(r.problems, ['Lenta', 'Sin publicidad']);
});

test('calibración del spec: web correcta con publicidad y email propio = 35', () => {
  const r = scoreLead(web({ ...okWeb, metaPixel: true }, { pagespeed: 80 }), 2026);
  assert.deepEqual(r, { score: 35, angle: null, problems: [], good: false });
});

test('GTM sin píxel visible: la publicidad no se sabe y no suma', () => {
  assert.equal(scoreLead(web({ ...okWeb, gtm: true }, { pagespeed: 80 }), 2026).score, 35);
});

test('red social, web caída y aparcada cuentan como sin web propia', () => {
  assert.equal(scoreLead({ ...base, website: 'https://instagram.com/n', socialWeb: true, phone: '9' }, 2026).angle, 'Red social como web');
  assert.equal(scoreLead(web({ ...EMPTY_ANALYSIS }, { phone: '9' }), 2026).angle, 'Web caída');
  const parked = scoreLead(web({ ...EMPTY_ANALYSIS, reachable: true, parked: true }, { phone: '9' }), 2026);
  assert.equal(parked.angle, 'Web caída'); assert.equal(parked.score, 65);
});

test('necesidad con tope 60 y desempate por orden', () => {
  const bad = { ...okWeb, https: false, viewport: false, copyrightYear: 2019 };
  const r = scoreLead(web(bad, { pagespeed: 20, reviews: 2000 }), 2026); // 20+20+10+10+10 = 70 → 60; +20 email; +0 tamaño
  assert.equal(r.score, 80); assert.equal(r.angle, 'Sin HTTPS');
  assert.deepEqual(r.problems, ['Sin HTTPS', 'No se adapta al celular', 'Lenta', 'Desactualizada', 'Sin publicidad']);
});

test('web que no se pudo revisar: sin puntos de necesidad', () => {
  assert.deepEqual(scoreLead(web(UNREVIEWED_ANALYSIS, { phone: '9' }), 2026), { score: 20, angle: null, problems: [], good: false });
});

test('contacto: el mejor email cuenta una vez; teléfono suma 5; tope 25', () => {
  const emails = [{ email: 'a@gmail.com', kind: 'gratuito' }, { email: 'b@ag.com', kind: 'otro' }];
  assert.equal(scoreLead(web({ ...okWeb, metaPixel: true, emails }, { pagespeed: 90, phone: '9' }), 2026).score, 15 + 5 + 15);
});

test('escapeHtml', () => {
  assert.equal(escapeHtml(`<b>"Bar" & 'Co'</b>`), '&lt;b&gt;&quot;Bar&quot; &amp; &#39;Co&#39;&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL en `score.test.js` porque `scoreLead` y `escapeHtml` no están exportadas.

- [ ] **Step 3: Implementar `WEIGHTS`, `scoreLead` y `escapeHtml` en `lib/leads.js`**

```js
export const WEIGHTS = {
  need: { cap: 60, noOwnWeb: 45, noHttps: 20, noViewport: 20, outdated: 10, slow: 10, medium: 5, noAds: 10 },
  contact: { cap: 25, propio: 20, gratuito: 15, otro: 5, phone: 5 },
  size: { sweet: 15, edge: 8, huge: 0 }, // 10–500 / 1–9 o 501–1500 / >1500
};
```

Reglas:
- "Sin web propia" es `!website`, `socialWeb`, `analysis.parked`, o `analysis` sin `reachable` ni `blocked`. Con eso no se evalúan las otras señales de web. El ángulo es `'Sin web'`, `'Red social como web'` o `'Web caída'`, según el caso.
- Las señales de web solo cuentan si `analysis.reachable` es `true` y la web no está aparcada:
  - `!https || sslBroken` → `'Sin HTTPS'`;
  - `!viewport` → `'No se adapta al celular'`;
  - `pagespeed` < 40 → 10, y 40–69 → 5, ambos `'Lenta'`;
  - `copyrightYear !== null && copyrightYear <= currentYear - 3` → `'Desactualizada'`;
  - `!metaPixel && !googleAds && !gtm` → `'Sin publicidad'`.
- `problems` va en el orden de las etiquetas.
- `angle` es el problema de mayor peso; si hay empate, gana el que va primero en ese orden. Si no hay problemas, `null`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Nueva tarjeta y filtros en `index.html`**

- Los leads que quedan se puntúan con `scoreLead` y se ordenan por `score` de mayor a menor.
- `renderCard` usa `escapeHtml` en todo dato que se interpole, también en los atributos `href`:
  - píldora `Nota ${score}` con clase `score-ok` (≥ 70), `score-mid` (50–69) o `score-bad` (< 50);
  - el ángulo como `tag-opp` (`💡 ${angle}`) y los problemas como `tag-issue`;
  - emails `tag-email` con su tipo (`· propio`, `· gratuito`, `· posible agencia`);
  - teléfono; link a Instagram si hay `analysis.instagram` o si la web es un Instagram; link `Google Maps`;
  - si `analysis.blocked`, un `tag-issue` con `No se pudo revisar la web`.
- Checkbox `#onlyGood` "Solo buenos" (marcado por defecto): al cambiarlo se vuelve a renderizar, y `#countBadge` muestra cuántos se ven.
- Textos: `<title>` y `h1` pasan a "Lead Finder — Flexora", el badge a `v4.0`, y `.warning` dice: `⚠ Requiere Google Places API Key (Places API New). Los leads se ordenan por nota de oportunidad para Flexora: necesidad, contacto y tamaño. Las cadenas, los cerrados y los que no tienen contacto quedan en Descartados.`

- [ ] **Step 6: Verificar a mano**

Run: `npm run dev`. Joako hace una búsqueda de su sector preferido.
Expected: los primeros 10 leads le parecen buenos. Si alguno no lo es, se anota por qué para ajustar `WEIGHTS` o las reglas antes de seguir.

- [ ] **Step 7: Commit**

```bash
git add lib/leads.js index.html test/score.test.js
git commit -m "Nota de oportunidad, angulo sugerido y tarjeta nueva con solo buenos"
```

---

### Task 6: PageSpeed con key, CSV nuevo y README

**Files:**
- Modify: `lib/leads.js`, `index.html`, `README.md`
- Test: `test/export.test.js`

**Interfaces:**
- Consumes: `Lead` + `scoreLead` (Task 5) y `mapLimit` (Task 2).
- Produces (en `lib/leads.js`):
  - `createPageSpeedClient(apiKey: string, fetchImpl = fetch): { measure(url: string): Promise<number | null>, readonly keyDisabled: boolean }`
  - `CSV_HEADERS: string[]`
  - `csvRow(lead: Lead & { score, angle, problems }): Array<string | number>`
  - `toCSV(leads): string`: todos los campos entre comillas, con `"` duplicadas y filas separadas por `\n`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// test/export.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageSpeedClient, CSV_HEADERS, csvRow, toCSV, EMPTY_ANALYSIS } from '../lib/leads.js';

const psi = (score) => new Response(JSON.stringify({ lighthouseResult: { categories: { performance: { score } } } }), { status: 200 });

test('PageSpeed usa la key y redondea el score', async () => {
  const urls = [];
  const c = createPageSpeedClient('K', async (u) => { urls.push(u); return psi(0.437); });
  assert.equal(await c.measure('https://n.es/'), 44);
  assert.match(urls[0], /strategy=mobile/); assert.match(urls[0], /key=K/);
});

test('PageSpeed: 403 con key → reintenta sin key y no la vuelve a usar', async () => {
  const urls = [];
  const c = createPageSpeedClient('K', async (u) => { urls.push(u); return u.includes('key=') ? new Response('{}', { status: 403 }) : psi(0.9); });
  assert.equal(await c.measure('https://a.es/'), 90);
  assert.equal(c.keyDisabled, true);
  await c.measure('https://b.es/');
  assert.equal(urls.filter(u => u.includes('key=')).length, 1);
});

test('PageSpeed: error o cuota → null', async () => {
  assert.equal(await createPageSpeedClient('', async () => new Response('{}', { status: 429 })).measure('https://n.es/'), null);
  assert.equal(await createPageSpeedClient('', async () => { throw new Error('x'); }).measure('https://n.es/'), null);
});

test('CSV: primeras 8 columnas intactas y nuevas al final', () => {
  assert.deepEqual(CSV_HEADERS, ['Nombre', 'Dirección', 'Rating', 'Reseñas', 'Web', 'PageSpeed Mobile', 'Teléfono', 'Emails',
    'Nota', 'Ángulo', 'Problemas', 'Instagram', 'Google Maps', 'Tipo']);
});

test('csvRow y toCSV con comillas, comas y valores vacíos', () => {
  const lead = { name: 'Bar "El Rincón", Gràcia', address: 'C/ A, 1', rating: 4.2, reviews: 30, website: null, socialWeb: false,
    phone: '931', mapsUrl: 'https://maps.google.com/?cid=1', type: 'bar', analysis: null, pagespeed: null,
    score: 65, angle: 'Sin web', problems: ['Sin web'] };
  assert.deepEqual(csvRow(lead), ['Bar "El Rincón", Gràcia', 'C/ A, 1', 4.2, 30, 'Sin web', 'N/A', '931', '',
    65, 'Sin web', 'Sin web', '', 'https://maps.google.com/?cid=1', 'bar']);
  const withWeb = { ...lead, website: 'https://n.es/', pagespeed: 38, problems: ['Sin HTTPS', 'Lenta'],
    analysis: { ...EMPTY_ANALYSIS, instagram: 'https://instagram.com/n',
      emails: [{ email: 'a@n.es', kind: 'propio' }, { email: 'b@gmail.com', kind: 'gratuito' }] } };
  const row = csvRow(withWeb);
  assert.equal(row[7], 'a@n.es | b@gmail.com'); assert.equal(row[10], 'Sin HTTPS; Lenta'); assert.equal(row[11], 'https://instagram.com/n');
  const csv = toCSV([lead]).split('\n');
  assert.equal(csv.length, 2);
  assert.ok(csv[1].startsWith('"Bar ""El Rincón"", Gràcia","C/ A, 1",'));
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL en `export.test.js` porque las funciones no están exportadas.

- [ ] **Step 3: Implementar en `lib/leads.js`**

- `measure` llama a `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=<enc>&strategy=mobile` + `&key=<enc>` mientras la key esté activa. Devuelve `Math.round(score * 100)`, o `null` si la respuesta no es ok, falta el score o hay una excepción.
- La columna Instagram es `analysis?.instagram`, o la propia `website` si `hostOf(website)` es `instagram.com`, o `''`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS en todos los archivos.

- [ ] **Step 5: Conectar `index.html` y reescribir el README**

- `index.html`:
  - Se agrega el checkbox `#measureSpeed` "Medir velocidad (más lento)", marcado por defecto.
  - Si está marcado: `createPageSpeedClient(apiKey)` y `mapLimit(candidatos, 2, …)`. Los candidatos son los que quedan con `hasOwnWeb`, `analysis.reachable`, sin `blocked` y sin `parked`. Esto va después del análisis y antes de `scoreLead`. Mientras tanto, el estado muestra `Midiendo velocidad i/N`.
  - Se borra `getPageSpeed`. Si al final `client.keyDisabled` es true, el estado agrega `⚠ Habilitá PageSpeed Insights API en tu proyecto de Google Cloud para que no falle`.
  - `exportCSV` exporta `toCSV(leadsVisibles)` con el BOM `'﻿'` de siempre.
- `README.md`: título Flexora; cómo funciona (zonas → filtros → análisis → nota); tabla de la nota (spec 5.7); costo de las zonas (1.000 consultas gratis al mes, después ~35 USD cada 1.000); habilitar PageSpeed Insights API; `npm run dev` y `npm test`.

- [ ] **Step 6: Verificar a mano**

Run: `npm run dev`. Joako hace una búsqueda completa y exporta el CSV.
Expected:
- La mayoría de los leads con web tienen PageSpeed, no "Sin datos".
- El CSV abre bien en Excel con acentos.
- Las 8 primeras columnas son las de siempre.

- [ ] **Step 7: Commit**

```bash
git add lib/leads.js index.html README.md test/export.test.js
git commit -m "PageSpeed con key y fallback, CSV con nota y angulo, README de Flexora"
```

- [ ] **Step 8: Checkpoint final de deploy (requiere el OK de Joako)**

Con el OK de Joako: `git push`. En la preview de Vercel, Joako hace una búsqueda real de punta a punta. El merge a `main` (que es lo que deploya a producción) se decide después, con `superpowers:finishing-a-development-branch`.
