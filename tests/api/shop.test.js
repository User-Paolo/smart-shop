import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, call, deactivate, newCustomer, newProduct } from './helpers.js';

test('REST errors use the right status codes', async () => {
  assert.equal((await call('GET', '/nope')).status, 404);
  assert.equal((await call('DELETE', '/products')).status, 405);
  assert.equal((await call('POST', '/auth/login', { raw: 'email=a', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('POST', '/auth/login', { raw: '{bad json', headers: { 'Content-Type': 'application/json' } })).status, 400);
});

test('catalogue search, filters and paging', async () => {
  const all = await call('GET', '/products?per_page=5');
  assert.equal(all.status, 200);
  assert.equal(all.data.items.length, 5);
  assert.ok(all.data.pages >= 2);
  const cheap = await call('GET', '/products?max_price=20&sort=price_asc');
  assert.ok(cheap.data.items.every((p) => p.price <= 20));
  const prices = cheap.data.items.map((p) => p.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
});

test('SQL injection in the search is treated as plain text', async () => {
  const r = await call('GET', `/products?search=${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 0);
});

test('markup in product names is stored and returned as text', async () => {
  const a = await admin();
  const p = await newProduct(a, 1, '<img src=x onerror=alert(1)>');
  assert.equal(p.name, '<img src=x onerror=alert(1)>');
  await deactivate(a, p.id);
});

test('cart add, update, remove and stock limits', async () => {
  const a = await admin();
  const p = await newProduct(a, 3);
  const c = await newCustomer();
  assert.equal((await call('POST', '/cart/items', { auth: c, body: { product_id: p.id, quantity: 4 } })).status, 409);
  const added = await call('POST', '/cart/items', { auth: c, body: { product_id: p.id, quantity: 2 } });
  assert.equal(added.status, 200);
  assert.equal(added.data.count, 2);
  assert.equal((await call('PATCH', `/cart/items/${p.id}`, { auth: c, body: { quantity: 3 } })).data.count, 3);
  assert.equal((await call('DELETE', `/cart/items/${p.id}`, { auth: c })).data.count, 0);
  await deactivate(a, p.id);
});

test('checkout creates the order and takes the stock', async () => {
  const a = await admin();
  const p = await newProduct(a, 5);
  const c = await newCustomer();
  assert.equal((await call('POST', '/orders', { auth: c })).status, 422);
  await call('POST', '/cart/items', { auth: c, body: { product_id: p.id, quantity: 2 } });
  const order = await call('POST', '/orders', { auth: c });
  assert.equal(order.status, 201);
  assert.equal(order.data.order.total, 20);
  assert.equal((await call('GET', `/products/${p.id}`)).data.product.stock, 3);
  assert.equal((await call('GET', '/cart', { auth: c })).data.count, 0);
  const mine = await call('GET', '/orders', { auth: c });
  assert.equal(mine.data.total, 1);
  const stranger = await newCustomer();
  assert.equal((await call('GET', `/orders/${order.data.order.id}`, { auth: stranger })).status, 404);
  await deactivate(a, p.id);
});

test('six customers racing for the last two units: two orders, four refusals, stock zero', async () => {
  const a = await admin();
  const p = await newProduct(a, 2, 'Race Product');
  const customers = await Promise.all(Array.from({ length: 6 }, () => newCustomer()));
  for (const c of customers) await call('POST', '/cart/items', { auth: c, body: { product_id: p.id, quantity: 1 } });
  const results = await Promise.all(customers.map((c) => call('POST', '/orders', { auth: c })));
  const codes = results.map((r) => r.status).sort();
  assert.deepEqual(codes, [201, 201, 409, 409, 409, 409]);
  assert.equal((await call('GET', `/products/${p.id}`)).data.product.stock, 0);
  await deactivate(a, p.id);
});
