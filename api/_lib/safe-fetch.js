import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'es-ES,es;q=0.9',
};

function blocked(message) {
  return Object.assign(new Error(message), { code: 'BLOCKED_TARGET' });
}

function isPrivateIpv4([a, b, c, d]) {
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || (a === 0 && b === 0 && c === 0 && d === 0);
}

// Devuelve los 8 grupos de 16 bits de una IPv6, o null si no se puede interpretar.
function parseIpv6(ip) {
  let text = ip.split('%')[0];
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[2].split('.').map(Number);
    if (o.length !== 4 || o.some((n) => n > 255)) return null;
    text = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

export function isPrivateIp(ip) {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip.split('.').map(Number));
  if (family === 6) {
    const g = parseIpv6(ip);
    if (!g) return true;
    // IPv4 mapeada (::ffff:a.b.c.d): se evalúa como IPv4
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return isPrivateIpv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
    }
    if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return true; // :: y ::1
    return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80; // fc00::/7 y fe80::/10
  }
  return true; // lo que no se puede interpretar como IP se trata como no confiable
}

const defaultLookup = (hostname) => dns.lookup(hostname, { all: true });

export async function assertPublicUrl(url, lookupImpl = defaultLookup) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw blocked(`URL inválida: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw blocked(`Protocolo no permitido: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookupImpl(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw blocked(`Destino no permitido: ${hostname}`);
  }
  return parsed;
}

async function readBody(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

export async function safeFetch(url, {
  timeoutMs = 8000,
  maxBytes = 1_500_000,
  maxRedirects = 5,
  fetchImpl = fetch,
  lookupImpl,
} = {}) {
  let current = url;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const target = await assertPublicUrl(current, lookupImpl);
    const response = await fetchImpl(target.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: HEADERS,
    });

    const location = response.headers.get('location');
    if (REDIRECT_STATUSES.has(response.status) && location) {
      await response.body?.cancel().catch(() => {});
      current = new URL(location, target).href;
      continue;
    }
    return { status: response.status, url: target.href, html: await readBody(response, maxBytes) };
  }
  throw new Error(`Demasiadas redirecciones (más de ${maxRedirects})`);
}
