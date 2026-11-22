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
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  back: '<path d="M19.5 12h-15M10.5 6l-6 6 6 6"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.3" class="fill"/><circle cx="4.5" cy="12" r="1.3" class="fill"/><circle cx="4.5" cy="18" r="1.3" class="fill"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  alert: '<path d="M12 7v6.5M12 17v.2"/>',
  venue: '<path d="M4.5 10.5V20h15v-9.5M3 9l2-5h14l2 5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM10 20v-5h4v5"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  locate: '<circle cx="12" cy="12" r="5.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  budget: '<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.4c-.4-.8-1.4-1.3-2.6-1.3-1.5 0-2.6.8-2.6 1.9 0 2.7 5.3 1.3 5.3 4 0 1.2-1.1 2-2.7 2-1.3 0-2.3-.5-2.7-1.4M12 6.4v1.7M12 16v1.7"/>',
  vr: '<path d="M4 8h16a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 20 17h-3.4a1.5 1.5 0 0 1-1.2-.6l-1.2-1.6a2.7 2.7 0 0 0-4.4 0l-1.2 1.6a1.5 1.5 0 0 1-1.2.6H4a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 4 8z"/>',
  reset: '<path d="M5 12a7 7 0 1 0 2.2-5.1L5 9M5 4.5V9h4.5"/>',
  exit: '<path d="M14 4.5h4.5v15H14M10.5 8l-4 4 4 4M6.5 12H15"/>',
  upload: '<path d="M12 16V4.5M7.5 9 12 4.5 16.5 9M4.5 19.5h15"/>',
  pair: '<path d="M10 14a4 4 0 0 0 5.7 0l3.2-3.2a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3.2 3.2a4 4 0 0 0 5.7 5.7l1-1"/>',
  sound: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.7 7.7 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5zM16 9.7l4.5 4.6M20.5 9.7 16 14.3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/>',
  bug: '<rect x="8" y="7.5" width="8" height="11.5" rx="4"/><path d="M9.5 7.5a2.5 2.5 0 0 1 5 0M8 11.5H4.5M8 15.5H5M16 11.5h3.5M16 15.5h3M12 12v7"/>',
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

/** A menu row: icon first, then its label, which is also its accessible name. */
export function navItem(name: IconName, label: string, action: () => void, className = '') {
  const node = button('', action, `menu-item ${className}`.trim());
  node.append(icon(name), element('span', 'menu-label', label));
  return node;
}

/** A quiet utility entry in the menu: an icon over a one-word caption. */
export function navTool(name: IconName, label: string, action: () => void) {
  const node = button('', action, 'menu-tool');
  node.append(icon(name), element('span', 'menu-label', label));
  return node;
}

/** Renames a menu entry, and swaps its icon when one is given. */
export function setNavItem(node: HTMLElement, label: string, name?: IconName) {
  const text = node.querySelector('.menu-label');
  if (text) text.textContent = label;
  const glyph = name && node.querySelector('.icon');
  if (glyph) glyph.innerHTML = icons[name];
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
