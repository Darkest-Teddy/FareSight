export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text.replaceAll('—', '–');
  return node;
}

export function button(label: string, action: () => void, className = '') {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

export function previewBadge() {
  const badge = element('span', 'preview-badge', '3D');
  badge.setAttribute('aria-hidden', 'true');
  return badge;
}

export function option(value: string, label: string) {
  const node = element('option', '', label);
  node.value = value;
  return node;
}

export function field(label: string, control: HTMLElement) {
  const node = element('label', 'field');
  node.append(element('span', '', label), control);
  return node;
}

export function httpUrl(url?: string | null): URL | undefined {
  if (!url) return;
  try {
    const target = new URL(url);
    if (target.protocol === 'https:' || target.protocol === 'http:') return target;
  } catch { /* The caller can render the label without a link. */ }
}

export function link(label: string, url?: string | null) {
  const target = httpUrl(url);
  if (!target) return element('span', '', label);
  const node = element('a', 'text-link', label);
  node.href = target.href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

export function replacePreservingFocus(host: HTMLElement, fallback: HTMLElement, ...children: HTMLElement[]): void {
  const focused = document.activeElement;
  const restore = focused instanceof HTMLElement && host.contains(focused) && focused !== host;
  host.replaceChildren(...children);
  if (!restore || document.activeElement === focused) return;
  if (host.contains(focused)) { focused.focus({ preventScroll: true }); return; }
  const key = (node: HTMLElement) => node.dataset.focusKey ?? node.dataset.control ??
    node.getAttribute('aria-label') ?? node.getAttribute('href') ?? node.textContent;
  const replacement = [...host.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, textarea')]
    .find((node) => node.tagName === focused.tagName && key(node) === key(focused));
  if (replacement) replacement.focus({ preventScroll: true });
  else {
    fallback.tabIndex = -1;
    fallback.focus({ preventScroll: true });
  }
}

export function message(text: string, problem = false) {
  const node = element('p', problem ? 'message error' : 'message', text);
  node.setAttribute('role', problem ? 'alert' : 'status');
  return node;
}

export function section(title: string) {
  const node = element('section', 'detail-section');
  node.append(element('h3', '', title));
  return node;
}

export function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replaceAll('—', '–');
}

export function modal(title: string, className = '') {
  const dialog = element('dialog', `modal ${className}`.trim());
  const header = element('header', 'modal-header');
  const heading = element('h2', '', title);
  heading.id = 'dialog-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  dialog.setAttribute('aria-labelledby', heading.id);
  const close = button('Close', () => dialog.close(), 'quiet');
  header.append(heading, close);
  const body = element('div', 'modal-body');
  dialog.append(header, body);
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const { left, top, right, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dialog.close();
  });
  document.body.append(dialog);
  return { dialog, body, open: () => { if (!dialog.open) dialog.showModal(); } };
}

export const money = (value: number) => '$' + value.toFixed(2);
