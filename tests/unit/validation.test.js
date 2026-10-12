import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMoney, parseSignedInt, parseWholeNumber, validateLogin, validateProduct, validateQuantity, validateRegister,
} from '../../frontend/js/validation.js';

const form = (fields) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

test('number parsers accept only clean input', () => {
  assert.equal(parseWholeNumber(' 12 '), 12);
  for (const bad of ['12.5', '1e3', '', '-3', 'abc']) assert.equal(parseWholeNumber(bad), null);
  assert.equal(parseSignedInt('-5'), -5);
  assert.equal(parseSignedInt('+20'), 20);
  assert.equal(parseMoney('19.90'), 19.9);
  for (const bad of ['19.999', '1,50', '-2']) assert.equal(parseMoney(bad), null);
});

test('login lowercases the email and keeps the password as typed', () => {
  const r = validateLogin(form({ email: ' Ann@Example.COM ', password: ' secret ' }));
  assert.deepEqual(r, { ok: true, value: { email: 'ann@example.com', password: ' secret ' } });
  assert.equal(validateLogin(form({ email: 'not-an-email', password: '' })).ok, false);
});

test('registration needs a name, a letter and a number, and matching passwords', () => {
  const base = { name: 'Ann Lee', email: 'ann@example.com', password: 'Passw0rd1', confirm: 'Passw0rd1' };
  assert.equal(validateRegister(form(base)).ok, true);
  const noDigit = validateRegister(form({ ...base, password: 'Password', confirm: 'Password' }));
  assert.ok(!noDigit.ok && noDigit.errors.password);
  const mismatch = validateRegister(form({ ...base, confirm: 'Other1234' }));
  assert.ok(!mismatch.ok && mismatch.errors.confirm);
  const short = validateRegister(form({ ...base, name: 'A' }));
  assert.ok(!short.ok && short.errors.name);
});

test('product form becomes a typed payload', () => {
  const r = validateProduct(form({ name: 'Desk Lamp', sku: 'ld-1', description: '', price: '24.50', stock: '7', category_id: '2' }));
  assert.deepEqual(r, { ok: true, value: { name: 'Desk Lamp', sku: 'LD-1', description: '', price: 24.5, stock: 7, category_id: 2 } });
  const bad = validateProduct(form({ name: 'X', sku: 'bad sku!', price: 'free', stock: '-1', category_id: '' }));
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['category_id', 'name', 'price', 'sku', 'stock']);
});

test('quantities stay between 1 and the stock, at most 99', () => {
  assert.deepEqual(validateQuantity('3', 10), { ok: true, value: 3 });
  for (const [raw, max] of [['0', 10], ['11', 10], ['100', 500], ['2.5', 10]]) assert.equal(validateQuantity(raw, max).ok, false);
});
