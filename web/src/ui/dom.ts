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
