import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, call, login, newCustomer, uniqueEmail } from './helpers.js';

test('registration validates input and rejects duplicates', async () => {
  const email = uniqueEmail();
  const weak = await call('POST', '/auth/register', { body: { name: 'Ann Lee', email, password: 'lettersonly' } });
  assert.equal(weak.status, 422);
  assert.ok(weak.data.errors.password);

  const ok = await call('POST', '/auth/register', { body: { name: 'Ann Lee', email, password: 'Passw0rd1' } });
  assert.equal(ok.status, 201);
  assert.ok(ok.data.token && ok.data.csrf_token);

  const again = await call('POST', '/auth/register', { body: { name: 'Ann Lee', email, password: 'Passw0rd1' } });
  assert.equal(again.status, 409);
});

test('passwords keep their spaces', async () => {
  const c = await newCustomer(' spaced pass1 ');
  assert.equal((await call('POST', '/auth/login', { body: { email: c.email, password: ' spaced pass1 ' } })).status, 200);
  assert.equal((await call('POST', '/auth/login', { body: { email: c.email, password: 'spaced pass1' } })).status, 401);
});

test('login gives the same answer for unknown emails and wrong passwords', async () => {
  const unknown = await call('POST', '/auth/login', { body: { email: uniqueEmail(), password: 'Whatever1' } });
  const c = await newCustomer();
  const wrong = await call('POST', '/auth/login', { body: { email: c.email, password: 'Wrong1234' } });
  assert.equal(unknown.status, 401);
  assert.deepEqual(unknown.data, wrong.data);
});

test('five failed logins lock that email for a while, even with the right password', async () => {
  const c = await newCustomer();
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('POST', '/auth/login', { body: { email: c.email, password: 'Wrong1234' } })).status, 401);
  }
  const locked = await call('POST', '/auth/login', { body: { email: c.email, password: c.password } });
  assert.equal(locked.status, 429);
  const other = await newCustomer();
  assert.equal((await call('POST', '/auth/login', { body: { email: other.email, password: other.password } })).status, 200);
});

test('forged and tampered tokens are rejected', async () => {
  const c = await newCustomer();
  const none = 'eyJhbGciOiJub25lIn0.eyJzdWIiOjEsImV4cCI6OTk5OTk5OTk5OX0.';
  assert.equal((await call('GET', '/auth/me', { auth: { token: none } })).status, 401);
  const [h, , s] = c.token.split('.');
  const payload = Buffer.from(JSON.stringify({ sub: 1, exp: 9999999999 })).toString('base64url');
  assert.equal((await call('GET', '/auth/me', { auth: { token: `${h}.${payload}.${s}` } })).status, 401);
  assert.equal((await call('GET', '/auth/me')).status, 401);
});

test('writes need the CSRF token from the login response', async () => {
  const c = await newCustomer();
  const r = await call('POST', '/cart/items', { auth: { token: c.token }, body: { product_id: 1, quantity: 1 } });
  assert.equal(r.status, 403);
});

test('a demoted administrator loses access on the next request', async () => {
  const a = await admin();
  const c = await newCustomer();
  await call('PATCH', `/admin/users/${c.user.id}/role`, { auth: a, body: { role: 'admin' } });
  const promoted = await login(c.email, c.password);
  assert.equal((await call('GET', '/admin/users', { auth: promoted })).status, 200);
  await call('PATCH', `/admin/users/${c.user.id}/role`, { auth: a, body: { role: 'customer' } });
  assert.equal((await call('GET', '/admin/users', { auth: promoted })).status, 403);
});

test("a deleted user's token stops working cleanly", async () => {
  const a = await admin();
  const c = await newCustomer();
  assert.equal((await call('DELETE', `/admin/users/${c.user.id}`, { auth: a })).status, 204);
  const r = await call('POST', '/cart/items', { auth: c, body: { product_id: 1, quantity: 1 } });
  assert.equal(r.status, 401);
});

test('users can change their own name', async () => {
  const c = await newCustomer();
  const r = await call('PATCH', '/users/me', { auth: c, body: { name: 'New Name' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.name, 'New Name');
});
