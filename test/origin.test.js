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
