import type {
  AuthResponse, Cart, Category, ForecastJob, ForecastSummary, OrderDetail, OrderStatus,
  OrderPage, Page, Product, ProductQuery, SalesPoint, User,
} from './types.js';
import type { LoginPayload, ProductPayload, RegisterPayload } from './validation.js';

const API_BASE = '/api';
const SESSION_KEY = 'smartshop.session';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Session {
  token: string;
  csrfToken: string;
  user: User;
  expiresAt: number;
}

// The token travels in a header, never a cookie, so other sites cannot send it for us
export const session = {
  get(): Session | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Session;
      if (parsed.expiresAt < Date.now()) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },
  refresh(user: User): void {
    const s = this.get();
    if (s) this.set({ token: s.token, csrf_token: s.csrfToken, user, expires_in: Math.round((s.expiresAt - Date.now()) / 1000) });
  },
  set(auth: AuthResponse): Session {
    const s: Session = {
      token: auth.token,
      csrfToken: auth.csrf_token,
      user: auth.user,
      expiresAt: Date.now() + auth.expires_in * 1000,
    };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { }
    return s;
  },
  clear(): void {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { }
  },
};

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const s = session.get();
  if (s) {
    headers.Authorization = `Bearer ${s.token}`;
    if (method !== 'GET') headers['X-CSRF-Token'] = s.csrfToken;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is it running?');
  }

  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; errors?: Record<string, string> };
    if (res.status === 401 && s) onUnauthorized();
    throw new ApiError(res.status, err.error ?? `Request failed (${res.status})`, err.errors ?? {});
  }
  return data as T;
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === false) continue;
    q.set(key, value === true ? '1' : String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  register: (p: RegisterPayload) => request<AuthResponse>('POST', '/auth/register', p),
  login: (p: LoginPayload) => request<AuthResponse>('POST', '/auth/login', p),
  me: () => request<{ user: User }>('GET', '/auth/me'),

  categories: () => request<{ categories: Category[] }>('GET', '/categories'),
  products: (q: ProductQuery) => request<Page<Product>>('GET', '/products' + queryString({ ...q })),

  cart: () => request<Cart>('GET', '/cart'),
  addToCart: (productId: number, quantity: number) =>
    request<Cart>('POST', '/cart/items', { product_id: productId, quantity }),
  setCartQuantity: (productId: number, quantity: number) =>
    request<Cart>('PATCH', `/cart/items/${productId}`, { quantity }),
  removeFromCart: (productId: number) => request<Cart>('DELETE', `/cart/items/${productId}`),
  checkout: () => request<{ order: OrderDetail }>('POST', '/orders'),
  myOrders: (page = 1) => request<OrderPage>('GET', '/orders' + queryString({ page })),
  order: (id: number) => request<{ order: OrderDetail }>('GET', `/orders/${id}`),

  admin: {
    products: (search = '') => request<Page<Product>>('GET', '/admin/products' + queryString({ search })),
    createProduct: (p: ProductPayload) => request<{ product: Product }>('POST', '/admin/products', p),
    updateProduct: (id: number, p: Partial<ProductPayload> & { is_active?: boolean }) =>
      request<{ product: Product }>('PATCH', `/admin/products/${id}`, p),
    adjustStock: (id: number, adjustment: number) =>
      request<{ product: Product }>('POST', `/admin/products/${id}/stock`, { adjustment }),
    deactivateProduct: (id: number) => request<void>('DELETE', `/admin/products/${id}`),

    orders: (status: OrderStatus | '' = '', page = 1) =>
      request<OrderPage>('GET', '/admin/orders' + queryString({ status, page })),
    setOrderStatus: (id: number, status: OrderStatus) =>
      request<{ order: OrderDetail }>('PATCH', `/admin/orders/${id}/status`, { status }),

    forecasts: () => request<ForecastSummary>('GET', '/admin/forecasts'),
    forecastStatus: () => request<{ job: ForecastJob }>('GET', '/admin/forecasts/status'),
    runForecast: () => request<{ message: string; job: ForecastJob }>('POST', '/admin/forecasts/run'),
    salesHistory: (productId: number) =>
      request<{ product_id: number; history: SalesPoint[] }>('GET', `/admin/forecasts/${productId}/history`),
    restock: (productId: number, quantity: number) =>
      request<{ message: string; product: Product }>('POST', `/admin/forecasts/${productId}/restock`, { quantity }),
  },
};
