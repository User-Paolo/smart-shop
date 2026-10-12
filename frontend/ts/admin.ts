import { api, ApiError, session, setUnauthorizedHandler } from './api.js';
import { drawDemandChart, drawRiskOverview } from './chart.js';
import {
  $, clearFieldErrors, formatDateTime, h, money, openDialog, pager, render, showFieldErrors, toast, withBusy,
} from './dom.js';
import { Store } from './store.js';
import {
  ORDER_TRANSITIONS,
  type Category, type ForecastJob, type ForecastProduct, type ForecastSummary, type OrderDetail,
  type OrderStatus, type OrderSummary, type Product, type RiskLevel, type SalesPoint,
} from './types.js';
import { parseSignedInt, parseWholeNumber, validateProduct } from './validation.js';

type Tab = 'forecasts' | 'inventory' | 'orders';

interface AdminState {
  tab: Tab;
  forecast: ForecastSummary | null;
  selectedProduct: number | null;
  history: SalesPoint[];
  products: Product[];
  categories: Category[];
  orders: OrderSummary[];
  orderFilter: OrderStatus | '';
  orderPage: number;
  orderPages: number;
}

const store = new Store<AdminState>({
  tab: 'forecasts',
  forecast: null,
  selectedProduct: null,
  history: [],
  products: [],
  categories: [],
  orders: [],
  orderFilter: '',
  orderPage: 1,
  orderPages: 1,
});

const RISK_LABEL: Record<RiskLevel, string> = { high: 'High risk of stockout', medium: 'Watch', low: 'Healthy' };
const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};
const ACTION_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending', shipped: 'Mark shipped', delivered: 'Mark delivered', cancelled: 'Cancel',
};

function fail(e: unknown, fallback: string): void {
  toast(e instanceof ApiError ? (Object.values(e.fields)[0] ?? e.message) : fallback, 'error');
}

function confirmDialog(title: string, message: string, confirmLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const ok = h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary' }, confirmLabel);
    const cancel = h('button', { class: 'btn btn-ghost' }, 'Keep it');
    const dialog = openDialog(title, h('div', {},
      h('p', {}, message),
      h('div', { class: 'dialog-actions' }, cancel, ok),
    ));
    ok.addEventListener('click', () => { answer = true; dialog.close(); });
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => resolve(answer));
  });
}

let pollTimer: number | undefined;

async function loadForecasts(): Promise<void> {
  try {
    const forecast = await api.admin.forecasts();
    const keep = store.get().selectedProduct;
    const selected = forecast.products.some((p) => p.product_id === keep)
      ? keep
      : forecast.products[0]?.product_id ?? null;
    store.set({ forecast, selectedProduct: selected });
    if (selected !== null) void loadHistory(selected);
    if (forecast.job.state === 'queued' || forecast.job.state === 'running') startPolling();
  } catch (e) {
    fail(e, 'Could not load forecasts.');
  }
}

async function loadHistory(productId: number): Promise<void> {
  try {
    const { history } = await api.admin.salesHistory(productId);
    if (store.get().selectedProduct === productId) store.set({ history });
  } catch (e) {
    fail(e, 'Could not load sales history.');
  }
}

function startPolling(): void {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    try {
      const { job } = await api.admin.forecastStatus();
      renderJob(job);
      if (job.state === 'done' || job.state === 'failed') {
        window.clearInterval(pollTimer);
        if (job.state === 'done') {
          toast('Forecast updated.', 'ok');
          void loadForecasts();
        } else {
          toast(`Forecast failed: ${job.message ?? 'unknown error'}`, 'error');
        }
      }
    } catch {
      window.clearInterval(pollTimer);
    }
  }, 1500);
}

async function runForecast(btn: HTMLButtonElement): Promise<void> {
  await withBusy(btn, async () => {
    try {
      const res = await api.admin.runForecast();
      renderJob(res.job);
      toast('Forecast job started in the background.', 'info');
      startPolling();
    } catch (e) {
      fail(e, 'Could not start the forecast.');
    }
  });
}

function renderJob(job: ForecastJob): void {
  const el = $('#job-status');
  const busy = job.state === 'queued' || job.state === 'running';
  el.className = `job-status job-${job.state}`;
  const text: Record<string, string> = {
    never_run: 'Never run yet',
    queued: 'Queued…',
    running: job.message ?? 'Running…',
    done: job.finished_at ? `Last run ${formatDateTime(job.finished_at)}` : 'Done',
    failed: `Failed: ${job.message ?? ''}`,
    unknown: 'Status unknown',
  };
  render(el, busy ? h('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }) : null, text[job.state] ?? job.state);
  $<HTMLButtonElement>('#run-forecast').disabled = busy;
}

function modelMix(products: ForecastProduct[]): string {
  const regression = products.filter((p) => p.model.startsWith('LinearRegression')).length;
  return `${regression} regression, ${products.length - regression} average`;
}

function kpi(label: string, value: string, note?: string, tone = ''): HTMLElement {
  return h('div', { class: `kpi ${tone}` },
    h('p', { class: 'kpi-label' }, label),
    h('p', { class: 'kpi-value' }, value),
    note ? h('p', { class: 'kpi-note' }, note) : null,
  );
}

function renderForecasts(): void {
  const { forecast, selectedProduct } = store.get();
  if (!forecast) return;
  renderJob(forecast.job);

  const high = forecast.products.filter((p) => p.risk === 'high').length;
  const medium = forecast.products.filter((p) => p.risk === 'medium').length;
  const skill = forecast.job.skill_vs_baseline;
  render($('#kpis'),
    kpi('High risk of stockout', String(high), 'demand ≥ stock within 7 days', high ? 'kpi-alert' : ''),
    kpi('Watch list', String(medium), 'demand ≥ 70% of stock'),
    kpi('Products forecast', String(forecast.products.length), modelMix(forecast.products)),
    kpi('Model vs naive baseline',
      typeof skill === 'number' ? `${skill >= 0 ? '+' : ''}${(skill * 100).toFixed(1)}%` : '—',
      typeof forecast.job.mean_holdout_mae === 'number'
        ? `MAE ${forecast.job.mean_holdout_mae.toFixed(2)} vs ${forecast.job.mean_baseline_mae?.toFixed(2) ?? '—'} units/day`
        : 'accuracy on 14-day hold-out'),
  );

  if (forecast.products.length === 0) {
    render($('#forecast-table'), h('div', { class: 'empty' },
      h('p', {}, 'No forecast yet. Run the analytics job to generate predictions.')));
    return;
  }

  render($('#forecast-table'), h('table', { class: 'table' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Product'), h('th', { class: 'num' }, 'Stock'), h('th', { class: 'num' }, 'Predicted 7d'),
      h('th', { class: 'num' }, 'Days of cover'), h('th', {}, 'Risk'), h('th', { class: 'num' }, 'Suggested'), h('th', {}, ''),
    )),
    h('tbody', {}, ...forecast.products.map((p) => forecastRow(p, p.product_id === selectedProduct))),
  ));

  drawRiskOverview($<HTMLCanvasElement>('#risk-canvas'), forecast.products);
  renderDetailChart();
}

function forecastRow(p: ForecastProduct, selected: boolean): HTMLTableRowElement {
  const view = h('button', { class: 'btn btn-ghost btn-sm', attrs: { 'aria-pressed': selected } }, 'Chart');
  view.addEventListener('click', () => {
    store.set({ selectedProduct: p.product_id, history: [] });
    void loadHistory(p.product_id);
    $('#detail-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  const restock = p.risk === 'low'
    ? null
    : h('button', { class: p.risk === 'high' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm' }, 'Authorize restock');
  restock?.addEventListener('click', () => openRestock(p));

  return h('tr', { class: selected ? 'row-selected' : '' },
    h('td', {}, h('p', { class: 'cell-title' }, p.name), h('p', { class: 'muted small' }, `${p.sku} · ${p.category}`)),
    h('td', { class: 'num' }, String(p.stock)),
    h('td', { class: 'num' }, p.predicted_7d.toFixed(1)),
    h('td', { class: 'num' }, p.coverage_days === null ? '—' : p.coverage_days.toFixed(1)),
    h('td', {}, h('span', { class: `badge risk-${p.risk}` }, RISK_LABEL[p.risk])),
    h('td', { class: 'num' }, p.suggested_restock ? `+${p.suggested_restock}` : '—'),
    h('td', {}, h('div', { class: 'actions' }, view, restock)),
  );
}

function renderDetailChart(): void {
  const { forecast, selectedProduct, history } = store.get();
  const product = forecast?.products.find((p) => p.product_id === selectedProduct);
  if (!product) return;
  $('#detail-title').textContent = product.name;
  $('#detail-sub').textContent =
    `Last 30 days of sales and the next 7 days forecast · ${product.stock} in stock · ` +
    `${product.predicted_7d.toFixed(1)} units predicted`;
  // Same height as the overview chart so the two cards line up
  const overviewH = $<HTMLCanvasElement>('#risk-canvas').clientHeight;
  const sideBySide = window.matchMedia('(min-width: 1025px)').matches;
  drawDemandChart($<HTMLCanvasElement>('#detail-canvas'), history, product.daily,
    sideBySide ? Math.max(280, overviewH) : 280);
}

function openRestock(p: ForecastProduct): void {
  const input = h('input', {
    attrs: { id: 'restock-qty', name: 'quantity', type: 'number', min: 1, max: 100000,
      value: Math.max(1, p.suggested_restock), required: true },
  });
  const submit = h('button', { class: 'btn btn-primary', attrs: { type: 'submit' } }, 'Authorize restock');
  const form = h('form', { class: 'form', attrs: { novalidate: true } },
    h('p', {}, `${p.name} has ${p.stock} units in stock and is forecast to sell ${p.predicted_7d.toFixed(1)} in the next 7 days.`),
    h('p', { class: 'muted small' }, 'The suggestion covers two weeks of predicted demand.'),
    h('div', { class: 'field' }, h('label', { attrs: { for: 'restock-qty' } }, 'Units to add'), input),
    h('div', { class: 'dialog-actions' }, submit),
  );
  const dialog = openDialog('Pre-emptive restock', form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const qty = parseWholeNumber(input.value);
    if (qty === null || qty < 1 || qty > 100000) {
      showFieldErrors(form, { quantity: 'Enter a whole number between 1 and 100000.' });
      return;
    }
    void withBusy(submit, async () => {
      try {
        const res = await api.admin.restock(p.product_id, qty);
        dialog.close();
        toast(`${res.message} ${p.name} now has ${res.product.stock} units.`, 'ok');
        void loadForecasts();
      } catch (err) {
        fail(err, 'Restock failed.');
      }
    });
  });
  input.focus();
}

async function loadInventory(search = ''): Promise<void> {
  try {
    const [page, cats] = await Promise.all([
      api.admin.products(search),
      store.get().categories.length ? Promise.resolve({ categories: store.get().categories }) : api.categories(),
    ]);
    store.set({ products: page.items, categories: cats.categories });
  } catch (e) {
    fail(e, 'Could not load products.');
  }
}

function renderInventory(): void {
  const { products } = store.get();
  render($('#inventory-table'), products.length === 0
    ? h('div', { class: 'empty' }, h('p', {}, 'No products found.'))
    : h('table', { class: 'table' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Product'), h('th', {}, 'Category'), h('th', { class: 'num' }, 'Price'),
        h('th', { class: 'num' }, 'Stock'), h('th', {}, 'Status'), h('th', {}, ''),
      )),
      h('tbody', {}, ...products.map(inventoryRow)),
    ));
}

function inventoryRow(p: Product): HTMLTableRowElement {
  const edit = h('button', { class: 'btn btn-ghost btn-sm' }, 'Edit');
  edit.addEventListener('click', () => openProductForm(p));
  const stock = h('button', { class: 'btn btn-ghost btn-sm' }, 'Adjust stock');
  stock.addEventListener('click', () => openStockAdjust(p));
  const toggle = h('button', { class: 'btn btn-ghost btn-sm' }, p.is_active ? 'Deactivate' : 'Reactivate');
  toggle.addEventListener('click', async () => {
    if (p.is_active && !(await confirmDialog('Deactivate product',
      `${p.name} will be hidden from the shop. Its order history is kept.`, 'Deactivate', true))) return;
    try {
      if (p.is_active) await api.admin.deactivateProduct(p.id);
      else await api.admin.updateProduct(p.id, { is_active: true });
      toast(`${p.name} ${p.is_active ? 'deactivated' : 'reactivated'}.`, 'ok');
      void loadInventory($<HTMLInputElement>('#inventory-search').value);
    } catch (e) {
      fail(e, 'Update failed.');
    }
  });

  return h('tr', { class: p.is_active ? '' : 'row-muted' },
    h('td', {}, h('p', { class: 'cell-title' }, p.name), h('p', { class: 'muted small' }, p.sku)),
    h('td', {}, p.category),
    h('td', { class: 'num' }, money(p.price)),
    h('td', { class: 'num' }, h('span', { class: p.stock === 0 ? 'warn' : '' }, String(p.stock))),
    h('td', {}, h('span', { class: p.is_active ? 'badge badge-delivered' : 'badge badge-cancelled' }, p.is_active ? 'Active' : 'Inactive')),
    h('td', {}, h('div', { class: 'actions' }, edit, stock, toggle)),
  );
}

function openProductForm(existing?: Product): void {
  const { categories } = store.get();
  const input = (name: string, label: string, value: string, type = 'text', extra: Record<string, string | number> = {}): HTMLElement =>
    h('div', { class: 'field' },
      h('label', { attrs: { for: `pf-${name}` } }, label),
      h('input', { attrs: { id: `pf-${name}`, name, type, value, ...extra } }),
    );

  const category = h('select', { attrs: { id: 'pf-category_id', name: 'category_id' } },
    h('option', { attrs: { value: '' } }, 'Choose…'),
    ...categories.map((c) => h('option', { attrs: { value: c.id, selected: c.id === existing?.category_id } }, c.name)),
  );
  const description = h('textarea', { attrs: { id: 'pf-description', name: 'description', rows: 3 } }, existing?.description ?? '');
  const submit = h('button', { class: 'btn btn-primary', attrs: { type: 'submit' } }, existing ? 'Save changes' : 'Add product');

  const form = h('form', { class: 'form form-grid', attrs: { novalidate: true } },
    input('name', 'Name', existing?.name ?? ''),
    input('sku', 'SKU', existing?.sku ?? ''),
    input('price', 'Price (€)', existing ? existing.price.toFixed(2) : '', 'text', { inputmode: 'decimal' }),
    input('stock', 'Stock', existing ? String(existing.stock) : '0', 'text', { inputmode: 'numeric' }),
    h('div', { class: 'field' }, h('label', { attrs: { for: 'pf-category_id' } }, 'Category'), category),
    h('div', { class: 'field field-wide' }, h('label', { attrs: { for: 'pf-description' } }, 'Description'), description),
    h('div', { class: 'dialog-actions field-wide' }, submit),
  );

  const dialog = openDialog(existing ? `Edit ${existing.name}` : 'New product', form, true);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const v = validateProduct(new FormData(form));
    if (!v.ok) {
      showFieldErrors(form, v.errors);
      return;
    }
    void withBusy(submit, async () => {
      try {
        if (existing) await api.admin.updateProduct(existing.id, v.value);
        else await api.admin.createProduct(v.value);
        dialog.close();
        toast(existing ? 'Product updated.' : 'Product added.', 'ok');
        void loadInventory($<HTMLInputElement>('#inventory-search').value);
      } catch (err) {
        if (err instanceof ApiError && Object.keys(err.fields).length) showFieldErrors(form, err.fields);
        else fail(err, 'Save failed.');
      }
    });
  });
}

function openStockAdjust(p: Product): void {
  const input = h('input', { attrs: { id: 'adj', name: 'adjustment', type: 'text', inputmode: 'numeric', placeholder: 'e.g. +20 or -3' } });
  const submit = h('button', { class: 'btn btn-primary', attrs: { type: 'submit' } }, 'Apply');
  const form = h('form', { class: 'form', attrs: { novalidate: true } },
    h('p', {}, `${p.name} currently has ${p.stock} units.`),
    h('div', { class: 'field' }, h('label', { attrs: { for: 'adj' } }, 'Adjustment (+ to add, − to remove)'), input),
    h('div', { class: 'dialog-actions' }, submit),
  );
  const dialog = openDialog('Adjust stock', form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const delta = parseSignedInt(input.value);
    if (delta === null || delta === 0) {
      showFieldErrors(form, { adjustment: 'Enter a non-zero whole number.' });
      return;
    }
    if (p.stock + delta < 0) {
      showFieldErrors(form, { adjustment: `Cannot remove more than ${p.stock} units.` });
      return;
    }
    void withBusy(submit, async () => {
      try {
        const res = await api.admin.adjustStock(p.id, delta);
        dialog.close();
        toast(`${p.name}: stock is now ${res.product.stock}.`, 'ok');
        void loadInventory($<HTMLInputElement>('#inventory-search').value);
      } catch (err) {
        fail(err, 'Adjustment failed.');
      }
    });
  });
  input.focus();
}

async function loadOrders(page = store.get().orderPage): Promise<void> {
  try {
    const { orders, pages } = await api.admin.orders(store.get().orderFilter, page);
    store.set({ orders, orderPage: page, orderPages: pages });
  } catch (e) {
    fail(e, 'Could not load orders.');
  }
}

function renderOrders(): void {
  const { orders, orderPage, orderPages } = store.get();
  render($('#orders-table'), orderPages > 1 ? pager(orderPage, orderPages, (p) => void loadOrders(p)) : null, orders.length === 0
    ? h('div', { class: 'empty' }, h('p', {}, 'No orders with this status.'))
    : h('table', { class: 'table' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Order'), h('th', {}, 'Placed'), h('th', {}, 'Customer'), h('th', { class: 'num' }, 'Items'),
        h('th', { class: 'num' }, 'Total'), h('th', {}, 'Status'), h('th', {}, ''),
      )),
      h('tbody', {}, ...orders.map(orderRow)),
    ));
}

function orderRow(o: OrderSummary): HTMLTableRowElement {
  const view = h('button', { class: 'btn btn-ghost btn-sm' }, 'View');
  view.addEventListener('click', () => void openOrder(o.id));

  const transitions = ORDER_TRANSITIONS[o.status].map((next) => {
    const b = h('button', { class: next === 'cancelled' ? 'btn btn-ghost btn-sm btn-danger-text' : 'btn btn-primary btn-sm' }, ACTION_LABEL[next]);
    b.addEventListener('click', async () => {
      if (next === 'cancelled' && !(await confirmDialog('Cancel order',
        `Cancel order #${o.id}? Its items will be returned to stock.`, 'Cancel order', true))) return;
      await withBusy(b, async () => {
        try {
          await api.admin.setOrderStatus(o.id, next);
          toast(`Order #${o.id} → ${STATUS_LABEL[next]}`, 'ok');
          void loadOrders();
        } catch (e) {
          fail(e, 'Status change failed.');
        }
      });
    });
    return b;
  });

  return h('tr', {},
    h('td', {}, `#${o.id}`),
    h('td', {}, formatDateTime(o.created_at)),
    h('td', {}, h('p', { class: 'cell-title' }, o.customer), h('p', { class: 'muted small' }, o.email)),
    h('td', { class: 'num' }, String(o.item_count)),
    h('td', { class: 'num' }, money(o.total)),
    h('td', {}, h('span', { class: `badge badge-${o.status}` }, STATUS_LABEL[o.status])),
    h('td', {}, h('div', { class: 'actions' }, view, ...transitions)),
  );
}

async function openOrder(id: number): Promise<void> {
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  openDialog(`Order #${id}`, body, true);
  try {
    const { order } = await api.order(id);
    render(body, orderDetail(order));
  } catch (e) {
    render(body, h('p', { class: 'warn' }, e instanceof ApiError ? e.message : 'Could not load the order.'));
  }
}

function orderDetail(o: OrderDetail): HTMLElement {
  return h('div', {},
    h('p', { class: 'muted' }, `${o.customer} · ${o.email} · ${formatDateTime(o.created_at)} · `,
      h('span', { class: `badge badge-${o.status}` }, STATUS_LABEL[o.status])),
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', { class: 'num' }, 'Qty'),
        h('th', { class: 'num' }, 'Unit'), h('th', { class: 'num' }, 'Total'))),
      h('tbody', {}, ...o.items.map((i) => h('tr', {},
        h('td', {}, h('p', { class: 'cell-title' }, i.name), h('p', { class: 'muted small' }, i.sku)),
        h('td', { class: 'num' }, String(i.quantity)),
        h('td', { class: 'num' }, money(i.unit_price)),
        h('td', { class: 'num' }, money(i.line_total)),
      ))),
      h('tfoot', {}, h('tr', {}, h('td', { attrs: { colspan: 3 } }, 'Total'), h('td', { class: 'num' }, money(o.total)))),
    ),
  );
}

function switchTab(tab: Tab): void {
  store.set({ tab });
  if (tab === 'forecasts') void loadForecasts();
  if (tab === 'inventory') void loadInventory($<HTMLInputElement>('#inventory-search').value);
  if (tab === 'orders') void loadOrders();
}

function renderTabs(): void {
  const { tab } = store.get();
  document.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(active));
    b.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll<HTMLElement>('[role="tabpanel"]').forEach((p) => {
    p.hidden = p.id !== `panel-${tab}`;
  });
  if (tab === 'forecasts') requestAnimationFrame(renderForecasts); // canvases need a layout first
}

function init(): void {
  const s = session.get();
  if (!s || s.user.role !== 'admin') {
    window.location.replace('/?login=admin');
    return;
  }
  setUnauthorizedHandler(() => {
    session.clear();
    window.location.replace('/');
  });

  void api.me().then(({ user }) => {
    session.refresh(user);
    if (user.role !== 'admin') window.location.replace('/');
  }).catch(() => { });

  $('#admin-name').textContent = s.user.name;
  $('#logout').addEventListener('click', () => { session.clear(); window.location.replace('/'); });

  store.subscribe((st, prev) => {
    if (st.tab !== prev.tab) renderTabs();
    if (st.forecast !== prev.forecast || st.selectedProduct !== prev.selectedProduct) renderForecasts();
    else if (st.history !== prev.history) renderDetailChart();
    if (st.products !== prev.products) renderInventory();
    if (st.orders !== prev.orders) renderOrders();
  });

  document.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab as Tab));
  });
  const runBtn = $<HTMLButtonElement>('#run-forecast');
  runBtn.addEventListener('click', () => void runForecast(runBtn));
  $('#add-product').addEventListener('click', () => openProductForm());

  let searchTimer: number | undefined;
  $<HTMLInputElement>('#inventory-search').addEventListener('input', (e) => {
    window.clearTimeout(searchTimer);
    const value = (e.target as HTMLInputElement).value.trim().slice(0, 100);
    searchTimer = window.setTimeout(() => void loadInventory(value), 300);
  });
  $<HTMLSelectElement>('#order-filter').addEventListener('change', (e) => {
    store.set({ orderFilter: (e.target as HTMLSelectElement).value as OrderStatus | '' });
    void loadOrders(1);
  });

  // Canvases are pixel based, so redraw on resize and theme change
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { if (store.get().tab === 'forecasts') renderForecasts(); }, 150);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderForecasts());

  renderTabs();
  void loadForecasts();
}

init();
