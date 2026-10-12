export const BASE = process.env.BASE_URL ?? 'http://localhost:8000';

export async function call(method, path, { auth, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (auth) {
    h.Authorization = `Bearer ${auth.token}`;
    if (auth.csrf) h['X-CSRF-Token'] = auth.csrf;
  }
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}/api${path}`, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

export const uniqueEmail = (prefix = 'user') =>
  `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@test.local`;

const toAuth = (data) => ({ token: data.token, csrf: data.csrf_token, user: data.user });

export async function login(email, password) {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email} failed with ${r.status}`);
  return toAuth(r.data);
}

export async function newCustomer(password = 'Passw0rd1') {
  const email = uniqueEmail();
  const r = await call('POST', '/auth/register', { body: { name: 'Test Customer', email, password } });
  if (r.status !== 201) throw new Error(`register failed with ${r.status}`);
  return { ...toAuth(r.data), email, password };
}

export const admin = () => login('admin@smartshop.test', 'Admin1234');

export async function newProduct(adminAuth, stock, name = 'Test Product') {
  const sku = `T${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const r = await call('POST', '/admin/products', {
    auth: adminAuth, body: { name, sku, description: 'Created by the test suite', price: 10, stock, category_id: 1 },
  });
  if (r.status !== 201) throw new Error(`product create failed with ${r.status}`);
  return r.data.product;
}

export const deactivate = (adminAuth, id) => call('DELETE', `/admin/products/${id}`, { auth: adminAuth });
