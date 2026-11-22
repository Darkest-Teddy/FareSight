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

const iconPaths = {
  back: 'm14 6-6 6 6 6',
  more: 'M4.6 12a.4.4 0 1 0 .8 0 .4.4 0 1 0-.8 0M11.6 12a.4.4 0 1 0 .8 0 .4.4 0 1 0-.8 0M18.6 12a.4.4 0 1 0 .8 0 .4.4 0 1 0-.8 0',
  mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5 10v1a7 7 0 0 0 14 0v-1M12 18v4m-3 0h6',
  reset: 'M3.5 10a8.5 8.5 0 1 1 2.1 7.6M3.5 4.5V10H9',
  upload: 'M12 15V3M7.5 7.5 12 3l4.5 4.5M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  headset: 'M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4l-2-2h-4l-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM7 12h.01M17 12h.01',
  sound: 'M11 5 6 9H3v6h3l5 4zM15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12',
  'sound-off': 'M11 5 6 9H3v6h3l5 4zM16 9l5 6m0-6-5 6',
  bug: 'M7 10a5 5 0 0 1 10 0v5a5 5 0 0 1-10 0zM9 6 7 3m8 3 2-3M3 9l4 2m10 0 4-2M3 14h4m10 0h4M4 20l4-3m8 0 4 3M12 11v9',
  info: 'M12 11v5m0-8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  'chevron-right': 'm9 6 6 6-6 6',
  close: 'm6 6 12 12M18 6 6 18',
};

export function icon(name: keyof typeof iconPaths): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', iconPaths[name]);
  svg.append(path);
  return svg;
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

export function link(label: string, url: string) {
  const node = element('a', 'text-link', label);
  const target = new URL(url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new TypeError('Invalid link URL');
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

export const money = (value: number) => '$' + value.toFixed(2);
