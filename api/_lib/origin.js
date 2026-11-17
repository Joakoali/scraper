// Acepta solo pedidos del mismo sitio. Un pedido sin headers de navegador (curl) pasa:
// es una limitación aceptada (spec 5.8), el chequeo frena a otras páginas web, no a scripts.
export function isSameOrigin(headers) {
  const site = headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return false;

  const origin = headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}
