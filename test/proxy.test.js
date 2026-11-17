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
