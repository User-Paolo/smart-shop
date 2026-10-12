export type FieldErrors = Record<string, string>;
export type Validation<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload extends LoginPayload {
  name: string;
}

export interface ProductPayload {
  name: string;
  sku: string;
  description: string;
  price: number;
  stock: number;
  category_id: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SKU_RE = /^[A-Za-z0-9\-_]+$/;

function text(form: FormData, field: string): string {
  const v = form.get(field);
  return typeof v === 'string' ? v.trim() : '';
}

function lengthError(value: string, min: number, max: number): string | null {
  if (value.length === 0 && min > 0) return 'This field is required.';
  if (value.length < min || value.length > max) return `Must be between ${min} and ${max} characters.`;
  return null;
}

export function parseWholeNumber(raw: string): number | null {
  return /^\d+$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : null;
}

export function parseSignedInt(raw: string): number | null {
  return /^[+-]?\d+$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : null;
}

export function parseMoney(raw: string): number | null {
  return /^\d+(\.\d{1,2})?$/.test(raw.trim()) ? Number.parseFloat(raw.trim()) : null;
}

export function validateLogin(form: FormData): Validation<LoginPayload> {
  const errors: FieldErrors = {};
  const email = text(form, 'email').toLowerCase();
  const password = typeof form.get('password') === 'string' ? (form.get('password') as string) : '';

  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
  if (password.length === 0) errors.password = 'Enter your password.';

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { email, password } };
}

export function validateRegister(form: FormData): Validation<RegisterPayload> {
  const base = validateLogin(form);
  const errors: FieldErrors = base.ok ? {} : { ...base.errors };
  const name = text(form, 'name');
  const password = typeof form.get('password') === 'string' ? (form.get('password') as string) : '';
  const confirm = typeof form.get('confirm') === 'string' ? (form.get('confirm') as string) : '';

  const nameErr = lengthError(name, 2, 100);
  if (nameErr) errors.name = nameErr;

  if (password.length < 8 || password.length > 128) {
    errors.password = 'Use 8 to 128 characters.';
  } else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.password = 'Include at least one letter and one number.';
  }
  if (confirm !== password) errors.confirm = 'Passwords do not match.';

  if (Object.keys(errors).length || !base.ok) return { ok: false, errors };
  return { ok: true, value: { name, email: base.value.email, password } };
}

export function validateProduct(form: FormData): Validation<ProductPayload> {
  const errors: FieldErrors = {};
  const name = text(form, 'name');
  const sku = text(form, 'sku').toUpperCase();
  const description = text(form, 'description');
  const price = parseMoney(text(form, 'price'));
  const stock = parseWholeNumber(text(form, 'stock'));
  const categoryId = parseWholeNumber(text(form, 'category_id'));

  const nameErr = lengthError(name, 2, 150);
  if (nameErr) errors.name = nameErr;
  const skuErr = lengthError(sku, 2, 40);
  if (skuErr) errors.sku = skuErr;
  else if (!SKU_RE.test(sku)) errors.sku = 'Letters, numbers, dashes and underscores only.';
  if (description.length > 2000) errors.description = 'Keep it under 2000 characters.';
  if (price === null) errors.price = 'Enter a price like 19.90.';
  if (stock === null || stock > 1_000_000) errors.stock = 'Enter a whole number of units.';
  if (categoryId === null || categoryId < 1) errors.category_id = 'Choose a category.';

  if (Object.keys(errors).length || price === null || stock === null || categoryId === null) {
    return { ok: false, errors };
  }
  return { ok: true, value: { name, sku, description, price, stock, category_id: categoryId } };
}

export function validateQuantity(raw: string, max: number): Validation<number> {
  const qty = parseWholeNumber(raw);
  if (qty === null || qty < 1) return { ok: false, errors: { quantity: 'Enter at least 1.' } };
  if (qty > 99) return { ok: false, errors: { quantity: 'Maximum 99 per item.' } };
  if (qty > max) return { ok: false, errors: { quantity: `Only ${max} in stock.` } };
  return { ok: true, value: qty };
}
