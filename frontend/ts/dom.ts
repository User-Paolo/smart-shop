import type { FieldErrors } from './validation.js';

export type Child = Node | string | number | null | undefined | false;

interface Props {
  class?: string;
  attrs?: Record<string, string | number | boolean>;
  dataset?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
}

// Strings always become text nodes, never HTML, so server data cannot inject markup
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === false) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [key, value] of Object.entries(props.dataset ?? {})) el.dataset[key] = value;
  for (const [event, handler] of Object.entries(props.on ?? {})) {
    el.addEventListener(event, handler as EventListener);
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function render(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, ...children);
}

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

const moneyFmt = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' });
export const money = (value: number): string => moneyFmt.format(value);

export function formatDateTime(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function showFieldErrors(form: HTMLFormElement, errors: FieldErrors): void {
  clearFieldErrors(form);
  for (const [field, message] of Object.entries(errors)) {
    const input = form.elements.namedItem(field);
    if (input instanceof HTMLElement) {
      input.setAttribute('aria-invalid', 'true');
      const note = h('p', { class: 'field-error', attrs: { role: 'alert' } }, message);
      input.closest('.field')?.appendChild(note);
    }
  }
}

export function clearFieldErrors(form: HTMLFormElement): void {
  form.querySelectorAll('.field-error').forEach((n) => n.remove());
  form.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
}

export function toast(message: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { attrs: { id: 'toasts', 'aria-live': 'polite' } });
    document.body.appendChild(host);
  }
  const t = h('div', { class: `toast toast-${kind}` }, message);
  host.appendChild(t);
  window.setTimeout(() => t.classList.add('toast-out'), 3200);
  window.setTimeout(() => t.remove(), 3600);
}

export async function withBusy<T>(button: HTMLButtonElement, work: () => Promise<T>): Promise<T> {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

export function openDialog(title: string, body: Node, wide = false): HTMLDialogElement {
  const closeBtn = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Close' } }, '✕');
  const dialog = h('dialog', { class: wide ? 'dialog dialog-wide' : 'dialog' },
    h('header', { class: 'dialog-head' }, h('h2', {}, title), closeBtn),
    h('div', { class: 'dialog-body' }, body),
  );
  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.appendChild(dialog);
  dialog.showModal();
  return dialog;
}

export function pager(page: number, pages: number, go: (page: number) => void): HTMLElement {
  return h('nav', { class: 'pager', attrs: { 'aria-label': 'Pagination' } },
    h('button', { class: 'btn btn-ghost btn-sm', attrs: { disabled: page <= 1 }, on: { click: () => go(page - 1) } }, '← Prev'),
    h('span', { class: 'muted' }, `Page ${page} of ${pages}`),
    h('button', { class: 'btn btn-ghost btn-sm', attrs: { disabled: page >= pages }, on: { click: () => go(page + 1) } }, 'Next →'),
  );
}
