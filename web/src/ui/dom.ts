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

// Static line icons on a 24 px grid. Strokes take the text colour, so they follow every button state.
const icons = {
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1.6" class="fill"/><circle cx="12" cy="12" r="1.6" class="fill"/><circle cx="19" cy="12" r="1.6" class="fill"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.3" class="fill"/><circle cx="4.5" cy="12" r="1.3" class="fill"/><circle cx="4.5" cy="18" r="1.3" class="fill"/>',
  sliders: '<path d="M4 8h8M18 8h2M4 16h2M12 16h8"/><circle cx="15" cy="8" r="2.4"/><circle cx="9" cy="16" r="2.4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  alert: '<path d="M12 7v6.5M12 17v.2"/>',
  map: '<path d="m9 4-6 2.2v13.6L9 17.6l6 2.2 6-2.2V4l-6 2.2zM9 4v13.6M15 6.2v13.6"/>',
  venue: '<path d="M4.5 10.5V20h15v-9.5M3 9l2-5h14l2 5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM10 20v-5h4v5"/>',
  upload: '<path d="M12 16V4.5M7.5 9 12 4.5 16.5 9M4.5 19.5h15"/>',
  pair: '<path d="M10 14a4 4 0 0 0 5.7 0l3.2-3.2a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3.2 3.2a4 4 0 0 0 5.7 5.7l1-1"/>',
} as const;
export type IconName = keyof typeof icons;

export function icon(name: IconName) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  svg.innerHTML = icons[name];
  return svg;
}

/** A button that shows only an icon. The label is its accessible name and tooltip. */
export function iconButton(name: IconName, label: string, action: () => void, className = '') {
  const node = button('', action, `icon-button ${className}`.trim());
  node.append(icon(name));
  node.setAttribute('aria-label', label);
  node.title = label;
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

/** A titled group inside a fold or section. */
export function block(title: string) {
  const node = element('div', 'fold-block');
  node.append(element('h4', '', title));
  return node;
}

/**
 * A collapsible section. `hint` is a one-line readout shown beside the title, so the
 * collapsed row still answers the common question. The node keeps its open state when
 * its body is re-rendered.
 */
export function fold(title: string) {
  const node = element('details', 'fold');
  const summary = element('summary');
  const name = element('span', 'fold-title', title);
  const hint = element('span', 'fold-hint');
  summary.append(name, hint, icon('chevron'));
  const body = element('div', 'fold-body');
  node.append(summary, body);
  return { node, summary, title: name, hint, body };
}
export type Fold = ReturnType<typeof fold>;

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
