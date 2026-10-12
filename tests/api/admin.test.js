import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, call, deactivate, newCustomer, newProduct } from './helpers.js';

test('customers cannot use admin routes', async () => {
  const c = await newCustomer();
  assert.equal((await call('GET', '/admin/users', { auth: c })).status, 403);
  assert.equal((await call('GET', '/admin/users')).status, 401);
});

test('inventory create, validate, update, adjust and deactivate', async () => {
  const a = await admin();
  const p = await newProduct(a, 5);
  const dup = await call('POST', '/admin/products', { auth: a, body: { name: 'Dup', sku: p.sku, price: 1, stock: 1, category_id: 1 } });
  assert.equal(dup.status, 409);
  const badCat = await call('POST', '/admin/products', { auth: a, body: { name: 'Bad', sku: 'BAD-CAT-1', price: 1, stock: 1, category_id: 99999 } });
  assert.equal(badCat.status, 422);
  assert.equal((await call('PATCH', `/admin/products/${p.id}`, { auth: a, body: { price: 12.5 } })).data.product.price, 12.5);
  assert.equal((await call('POST', `/admin/products/${p.id}/stock`, { auth: a, body: { adjustment: -10 } })).status, 409);
  assert.equal((await call('POST', `/admin/products/${p.id}/stock`, { auth: a, body: { adjustment: 7 } })).data.product.stock, 12);
  assert.equal((await deactivate(a, p.id)).status, 204);
  assert.equal((await call('GET', `/products/${p.id}`)).status, 404);
});

test('order status follows the allowed transitions, and cancelling returns stock', async () => {
  const a = await admin();
  const p = await newProduct(a, 4);
  const c = await newCustomer();
  const place = async () => {
    await call('POST', '/cart/items', { auth: c, body: { product_id: p.id, quantity: 1 } });
    return (await call('POST', '/orders', { auth: c })).data.order.id;
  };
  const first = await place();
  assert.equal((await call('PATCH', `/admin/orders/${first}/status`, { auth: a, body: { status: 'shipped' } })).status, 200);
  assert.equal((await call('PATCH', `/admin/orders/${first}/status`, { auth: a, body: { status: 'cancelled' } })).status, 409);
  const second = await place();
  assert.equal((await call('GET', `/products/${p.id}`)).data.product.stock, 2);
  assert.equal((await call('PATCH', `/admin/orders/${second}/status`, { auth: a, body: { status: 'cancelled' } })).status, 200);
  assert.equal((await call('GET', `/products/${p.id}`)).data.product.stock, 3);
  await deactivate(a, p.id);
});

test('the admin order list is paged instead of cut off', async () => {
  const a = await admin();
  const page1 = await call('GET', '/admin/orders', { auth: a });
  assert.equal(page1.data.orders.length, 50);
  assert.ok(page1.data.total > 50);
  const last = await call('GET', `/admin/orders?page=${page1.data.pages}`, { auth: a });
  assert.equal(last.data.orders.length, page1.data.total - 50 * (page1.data.pages - 1));
});

test('the forecast runs in the background and feeds the risk table', async () => {
  const a = await admin();
  let run = await call('POST', '/admin/forecasts/run', { auth: a });
  for (let i = 0; run.status === 409 && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    run = await call('POST', '/admin/forecasts/run', { auth: a });
  }
  assert.equal(run.status, 202);
  let job;
  for (let i = 0; i < 60; i++) {
    job = (await call('GET', '/admin/forecasts/status', { auth: a })).data.job;
    if (job.state === 'done' || job.state === 'failed') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(job.state, 'done', job.message);
  const summary = (await call('GET', '/admin/forecasts', { auth: a })).data;
  assert.ok(summary.products.length > 0);
  for (const p of summary.products) {
    assert.ok(['high', 'medium', 'low'].includes(p.risk));
    assert.equal(p.daily.length, 7);
  }
  const target = summary.products[0];
  const history = await call('GET', `/admin/forecasts/${target.product_id}/history`, { auth: a });
  assert.equal(history.status, 200);
  const restock = await call('POST', `/admin/forecasts/${target.product_id}/restock`, { auth: a, body: { quantity: 5 } });
  assert.equal(restock.data.product.stock, target.stock + 5);
});
