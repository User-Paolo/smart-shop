import { api, ApiError, session, setUnauthorizedHandler } from './api.js';
import {
  $, clearFieldErrors, formatDateTime, h, money, openDialog, pager, render, showFieldErrors, toast, withBusy,
} from './dom.js';
import { Store } from './store.js';
import type {
  AuthResponse, Cart, Category, OrderStatus, Page, Product, ProductQuery, ProductSort, User,
} from './types.js';
import { parseMoney, validateLogin, validateQuantity, validateRegister } from './validation.js';

interface ShopState {
  user: User | null;
  categories: Category[];
  query: ProductQuery;
  page: Page<Product> | null;
  loading: boolean;
  cart: Cart | null;
}

const store = new Store<ShopState>({
  user: session.get()?.user ?? null,
  categories: [],
  query: { sort: 'name', page: 1, per_page: 12 },
  page: null,
  loading: true,
  cart: null,
});

let requestSeq = 0;

async function loadProducts(): Promise<void> {
  const seq = ++requestSeq; // ignore responses that arrive late
  store.set({ loading: true });
  try {
    const page = await api.products(store.get().query);
    if (seq === requestSeq) store.set({ page, loading: false });
  } catch (e) {
    if (seq === requestSeq) store.set({ loading: false });
    toast(e instanceof ApiError ? e.message : 'Could not load products.', 'error');
  }
}

async function loadCart(): Promise<void> {
  if (!store.get().user) {
    store.set({ cart: null });
    return;
  }
  try {
    store.set({ cart: await api.cart() });
  } catch (e) {
    if (e instanceof ApiError && e.status !== 401) toast(e.message, 'error');
  }
}

function updateQuery(patch: Partial<ProductQuery>, resetPage = true): void {
  store.set((s) => ({ query: { ...s.query, ...patch, ...(resetPage ? { page: 1 } : {}) } }));
  void loadProducts();
}

function renderHeader(): void {
  const { user, cart } = store.get();
  const nav = $('#user-nav');

  if (!user) {
    render(nav,
      h('button', { class: 'btn btn-ghost', on: { click: () => openAuth('login') } }, 'Log in'),
      h('button', { class: 'btn btn-primary', on: { click: () => openAuth('register') } }, 'Sign up'),
    );
  } else {
    render(nav,
      user.role === 'admin' ? h('a', { class: 'btn btn-ghost', attrs: { href: '/admin.html' } }, 'Dashboard') : null,
      h('button', { class: 'btn btn-ghost', on: { click: () => void openOrders() } }, 'My orders'),
      h('span', { class: 'user-chip', attrs: { title: user.email } }, user.name.split(' ')[0] ?? user.name),
      h('button', { class: 'btn btn-ghost', on: { click: logout } }, 'Log out'),
    );
  }

  const count = cart?.count ?? 0;
  const badge = $('#cart-count');
  badge.textContent = String(count);
  badge.hidden = count === 0;
}

function productCard(p: Product): HTMLElement {
  const qty = h('input', {
    class: 'qty-input',
    attrs: {
      type: 'number', min: 1, max: Math.max(1, Math.min(99, p.stock)), value: 1,
      'aria-label': `Quantity of ${p.name}`, disabled: p.stock === 0,
    },
  });
  const addBtn = h('button', { class: 'btn btn-primary btn-sm', attrs: { type: 'button', disabled: p.stock === 0 } },
    p.stock === 0 ? 'Sold out' : 'Add to cart');

  addBtn.addEventListener('click', () => {
    if (!store.get().user) {
      openAuth('login', 'Log in to start shopping.');
      return;
    }
    const v = validateQuantity(qty.value, p.stock);
    if (!v.ok) {
      toast(v.errors.quantity ?? 'Invalid quantity.', 'error');
      return;
    }
    void withBusy(addBtn, async () => {
      try {
        store.set({ cart: await api.addToCart(p.id, v.value) });
        toast(`Added ${v.value} × ${p.name}`, 'ok');
        qty.value = '1';
      } catch (e) {
        toast(e instanceof ApiError ? e.message : 'Could not add to cart.', 'error');
      }
    });
  });

  const stockLabel = p.stock === 0 ? 'Out of stock' : p.stock <= 5 ? `Only ${p.stock} left` : 'In stock';
  const stockClass = p.stock === 0 ? 'stock stock-out' : p.stock <= 5 ? 'stock stock-low' : 'stock';

  return h('article', { class: 'product-card' },
    h('div', { class: 'product-thumb', attrs: { 'aria-hidden': 'true' } }, p.name.match(/[A-Za-z]/)?.[0]?.toUpperCase() ?? '•'),
    h('div', { class: 'product-info' },
      h('p', { class: 'eyebrow' }, p.category),
      h('h3', { class: 'product-name' }, p.name),
      h('p', { class: 'product-desc' }, p.description ?? ''),
    ),
    h('div', { class: 'product-meta' },
      h('span', { class: 'price' }, money(p.price)),
      h('span', { class: stockClass }, stockLabel),
    ),
    h('div', { class: 'product-actions' }, qty, addBtn),
  );
}

function renderCatalogue(): void {
  const { page, loading, query } = store.get();
  const grid = $('#product-grid');
  grid.setAttribute('aria-busy', String(loading));

  $('#result-count').textContent = page
    ? `${page.total} product${page.total === 1 ? '' : 's'}${query.search ? ` for “${query.search}”` : ''}`
    : '';

  if (!page) {
    render(grid, ...Array.from({ length: 6 }, () => h('div', { class: 'product-card skeleton' })));
    return;
  }
  if (page.items.length === 0) {
    render(grid, h('div', { class: 'empty' },
      h('p', {}, 'No products match these filters.'),
      h('button', { class: 'btn btn-ghost', on: { click: resetFilters } }, 'Clear filters'),
    ));
  } else {
    render(grid, ...page.items.map(productCard));
  }

  render($('#pager'), page.pages > 1 ? pager(page.page, page.pages, (p) => updateQuery({ page: p }, false)) : null);
}

function renderCategories(): void {
  const select = $<HTMLSelectElement>('#filter-category');
  render(select,
    h('option', { attrs: { value: '' } }, 'All categories'),
    ...store.get().categories.map((c) => h('option', { attrs: { value: c.id } }, c.name)),
  );
}

function renderCart(): void {
  const { cart } = store.get();
  const body = $('#cart-body');
  const footer = $('#cart-footer');

  if (!cart || cart.items.length === 0) {
    render(body, h('div', { class: 'empty' }, h('p', {}, 'Your cart is empty.')));
    render(footer);
    return;
  }

  render(body, ...cart.items.map((item) => {
    const qty = h('input', {
      class: 'qty-input',
      attrs: { type: 'number', min: 1, max: Math.min(99, item.stock), value: item.quantity, 'aria-label': `Quantity of ${item.name}` },
    });
    qty.addEventListener('change', () => {
      const v = validateQuantity(qty.value, item.stock);
      if (!v.ok) {
        toast(v.errors.quantity ?? 'Invalid quantity.', 'error');
        qty.value = String(item.quantity);
        return;
      }
      void api.setCartQuantity(item.product_id, v.value)
        .then((c) => store.set({ cart: c }))
        .catch((e: unknown) => toast(e instanceof ApiError ? e.message : 'Update failed.', 'error'));
    });
    const remove = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': `Remove ${item.name}` } }, '✕');
    remove.addEventListener('click', () => {
      void api.removeFromCart(item.product_id)
        .then((c) => store.set({ cart: c }))
        .catch((e: unknown) => toast(e instanceof ApiError ? e.message : 'Remove failed.', 'error'));
    });

    return h('div', { class: item.available ? 'cart-line' : 'cart-line cart-line-warn' },
      h('div', { class: 'cart-line-info' },
        h('p', { class: 'cart-line-name' }, item.name),
        h('p', { class: 'muted small' }, `${money(item.unit_price)} each`),
        item.available ? null : h('p', { class: 'warn small' }, `Only ${item.stock} available`),
      ),
      qty,
      h('span', { class: 'cart-line-total' }, money(item.line_total)),
      remove,
    );
  }));

  const checkoutBtn = h('button', { class: 'btn btn-primary btn-block' }, `Checkout · ${money(cart.total)}`);
  checkoutBtn.addEventListener('click', () => void withBusy(checkoutBtn, checkout));
  render(footer,
    h('div', { class: 'cart-total' }, h('span', {}, 'Total'), h('strong', {}, money(cart.total))),
    checkoutBtn,
  );
}

async function checkout(): Promise<void> {
  try {
    const { order } = await api.checkout();
    store.set({ cart: { items: [], total: 0, count: 0 } });
    closeCart();
    toast(`Order #${order.id} placed. Total ${money(order.total)}.`, 'ok');
    void loadProducts();
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      toast(Object.values(e.fields)[0] ?? e.message, 'error');
      void loadCart();
    } else {
      toast(e instanceof ApiError ? e.message : 'Checkout failed.', 'error');
    }
  }
}

function openCart(): void {
  if (!store.get().user) {
    openAuth('login', 'Log in to see your cart.');
    return;
  }
  const drawer = $('#cart-drawer');
  drawer.hidden = false;
  requestAnimationFrame(() => drawer.classList.add('open'));
  $('#cart-close').focus();
  void loadCart();
}

function closeCart(): void {
  const drawer = $('#cart-drawer');
  drawer.classList.remove('open');
  window.setTimeout(() => { drawer.hidden = true; }, 200);
}

function logout(): void {
  session.clear();
  store.set({ user: null, cart: null });
  closeCart();
  toast('You are logged out.');
}

function resetFilters(): void {
  $<HTMLFormElement>('#filters').reset();
  $<HTMLInputElement>('#search').value = '';
  store.set({ query: { sort: 'name', page: 1, per_page: 12 } });
  void loadProducts();
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};

async function openOrders(page = 1, list?: HTMLElement): Promise<void> {
  if (!list) {
    list = h('div', { class: 'order-list' }, h('p', { class: 'muted' }, 'Loading…'));
    openDialog('My orders', list, true);
  }
  const host = list;
  try {
    const { orders, pages } = await api.myOrders(page);
    if (orders.length === 0) {
      render(host, h('p', { class: 'muted' }, 'You have not placed any orders yet.'));
      return;
    }
    render(host, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Order'), h('th', {}, 'Date'), h('th', {}, 'Items'),
        h('th', { class: 'num' }, 'Total'), h('th', {}, 'Status'))),
      h('tbody', {}, ...orders.map((o) => h('tr', {},
        h('td', {}, `#${o.id}`),
        h('td', {}, formatDateTime(o.created_at)),
        h('td', {}, String(o.item_count)),
        h('td', { class: 'num' }, money(o.total)),
        h('td', {}, h('span', { class: `badge badge-${o.status}` }, STATUS_LABEL[o.status])),
      ))),
    ), pages > 1 ? pager(page, pages, (p) => void openOrders(p, host)) : null);
  } catch (e) {
    render(host, h('p', { class: 'warn' }, e instanceof ApiError ? e.message : 'Could not load orders.'));
  }
}

function field(label: string, input: HTMLInputElement): HTMLElement {
  return h('div', { class: 'field' }, h('label', { attrs: { for: input.id } }, label), input);
}

function openAuth(mode: 'login' | 'register', notice?: string): void {
  const isRegister = mode === 'register';
  const input = (name: string, type: string, autocomplete: string): HTMLInputElement =>
    h('input', { attrs: { id: `auth-${name}`, name, type, autocomplete, required: true } });

  const form = h('form', { class: 'form', attrs: { novalidate: true } },
    notice ? h('p', { class: 'notice' }, notice) : null,
    isRegister ? field('Full name', input('name', 'text', 'name')) : null,
    field('Email', input('email', 'email', 'email')),
    field('Password', input('password', 'password', isRegister ? 'new-password' : 'current-password')),
    isRegister ? field('Confirm password', input('confirm', 'password', 'new-password')) : null,
    isRegister ? h('p', { class: 'muted small' }, 'At least 8 characters, with a letter and a number.') : null,
  );
  const submit = h('button', { class: 'btn btn-primary btn-block', attrs: { type: 'submit' } }, isRegister ? 'Create account' : 'Log in');
  const swap = h('button', { class: 'link-btn', attrs: { type: 'button' } },
    isRegister ? 'Already have an account? Log in' : 'New here? Create an account');
  form.append(submit, swap);

  const dialog = openDialog(isRegister ? 'Create your account' : 'Welcome back', form);
  swap.addEventListener('click', () => { dialog.close(); openAuth(isRegister ? 'login' : 'register'); });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    clearFieldErrors(form);
    const data = new FormData(form);

    // Only a validated, typed payload can reach the API
    let send: () => Promise<AuthResponse>;
    if (isRegister) {
      const r = validateRegister(data);
      if (!r.ok) { showFieldErrors(form, r.errors); return; }
      send = () => api.register(r.value);
    } else {
      const r = validateLogin(data);
      if (!r.ok) { showFieldErrors(form, r.errors); return; }
      send = () => api.login(r.value);
    }

    void withBusy(submit, async () => {
      try {
        const s = session.set(await send());
        store.set({ user: s.user });
        dialog.close();
        toast(`Hi ${s.user.name.split(' ')[0] ?? ''}!`, 'ok');
        void loadCart();
      } catch (e) {
        if (e instanceof ApiError && Object.keys(e.fields).length) showFieldErrors(form, e.fields);
        else toast(e instanceof ApiError ? e.message : 'Something went wrong.', 'error');
      }
    });
  });
  form.querySelector('input')?.focus();
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: number | undefined;
  return (...args: A) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

function bindFilters(): void {
  const search = $<HTMLInputElement>('#search');
  const onSearch = debounce(() => updateQuery({ search: search.value.trim().slice(0, 100) || undefined }), 300);
  search.addEventListener('input', onSearch);
  $<HTMLFormElement>('#search-form').addEventListener('submit', (e) => e.preventDefault());

  const form = $<HTMLFormElement>('#filters');
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('change', () => {
    const data = new FormData(form);
    const cat = String(data.get('category') ?? '');
    const min = parseMoney(String(data.get('min_price') ?? ''));
    const max = parseMoney(String(data.get('max_price') ?? ''));
    const sort = String(data.get('sort') ?? 'name') as ProductSort;

    if (min !== null && max !== null && min > max) {
      toast('Minimum price is higher than maximum price.', 'error');
      return;
    }
    updateQuery({
      category_id: cat ? Number(cat) : undefined,
      min_price: min ?? undefined,
      max_price: max ?? undefined,
      in_stock: data.get('in_stock') === 'on',
      sort,
    });
  });
  $('#filters-reset').addEventListener('click', resetFilters);
}

async function init(): Promise<void> {
  setUnauthorizedHandler(() => {
    session.clear();
    store.set({ user: null, cart: null });
    toast('Your session expired. Please log in again.', 'info');
  });

  // Re-render only what changed
  store.subscribe((s, prev) => {
    if (s.user !== prev.user || s.cart !== prev.cart) renderHeader();
    if (s.page !== prev.page || s.loading !== prev.loading) renderCatalogue();
    if (s.categories !== prev.categories) renderCategories();
    if (s.cart !== prev.cart) renderCart();
  });

  $('#cart-open').addEventListener('click', openCart);
  $('#cart-close').addEventListener('click', closeCart);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#cart-drawer').hidden) closeCart(); });
  bindFilters();

  renderHeader();
  renderCatalogue();

  if (new URLSearchParams(window.location.search).has('login') && !store.get().user) {
    openAuth('login', 'Log in with an administrator account to open the dashboard.');
  }

  if (store.get().user) {
    try {
      const { user } = await api.me();
      session.refresh(user);
      store.set({ user });
    } catch { }
  }

  const [cats] = await Promise.allSettled([api.categories(), loadProducts(), loadCart()]);
  if (cats.status === 'fulfilled') store.set({ categories: cats.value.categories });
}

void init();
