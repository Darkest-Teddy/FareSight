import { animate } from 'motion/mini';
import { spring } from 'motion';
import { animateIcon, attachIconMotion, icon, type IconName } from './icons.ts';
import { attachTactileSpring, canAnimate, labelSpring, springSurface, springText } from './motion.ts';

export { icon, type IconName } from './icons.ts';

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text.replaceAll('—', '–');
  if (tag === 'button') attachTactileSpring(node);
  return node;
}

export function button(label: string, action: () => void, className = '') {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

/** A button that shows only an icon. The label is its accessible name and tooltip. */
export function iconButton(name: IconName, label: string, action: () => void, className = '') {
  const node = button('', action, `icon-button ${className}`.trim());
  node.append(icon(name));
  attachIconMotion(node);
  node.setAttribute('aria-label', label);
  node.title = label;
  return node;
}

/** An icon button for the bottom corners. Its label slides out of the button on hover or focus. */
export function dockButton(name: IconName, label: string, action: () => void, className = '') {
  const node = button('', action, `dock-button ${className}`.trim());
  node.append(icon(name), element('span', 'dock-label'));
  attachIconMotion(node);
  labelSpring(node);
  setDockButton(node, label);
  return node;
}

/** Renames a dock button, and swaps its icon when one is given. */
export function setDockButton(node: HTMLElement, label: string, name?: IconName) {
  node.setAttribute('aria-label', label);
  const text = node.querySelector<HTMLElement>('.dock-label');
  if (text) springText(text, label);
  if (!name) return;
  const glyph = node.querySelector<SVGSVGElement>('.icon');
  if (glyph && glyph.getAttribute('data-icon') !== name) {
    const replacement = icon(name);
    glyph.replaceWith(replacement);
    if (!node.hidden) animateIcon(replacement, 'state');
  }
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
  const closeButton = iconButton('close', 'Close', () => close(), 'quiet');
  header.append(heading, closeButton);
  const body = element('div', 'modal-body');
  dialog.append(header, body);

  let closing = false;
  let backdrop: ReturnType<typeof animate> | undefined;
  const motionPreference = typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const backdropOpacity = (fallback: number) => canAnimate(dialog) && typeof getComputedStyle === 'function'
    ? Number(getComputedStyle(dialog, '::backdrop').opacity) : fallback;
  const stopBackdrop = () => {
    backdrop?.cancel();
    backdrop = undefined;
    motionPreference?.removeEventListener?.('change', stopBackdrop);
  };

  function animateBackdrop(open: boolean, from: number) {
    stopBackdrop();
    if (!canAnimate(dialog)) return;
    try {
      const options = { pseudoElement: '::backdrop', type: spring, stiffness: 340, damping: 34 };
      const animation = animate(dialog, { opacity: [from, Number(open)] }, options);
      backdrop = animation;
      motionPreference?.addEventListener?.('change', stopBackdrop);
      void animation.finished.then(() => { if (backdrop === animation) stopBackdrop(); });
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof DOMException)) throw error;
    }
  }

  function close(after?: () => void) {
    if (!dialog.open) { after?.(); return; }
    if (closing) return;
    const opacity = backdropOpacity(1);
    closing = true;
    dialog.dataset.closing = 'true';
    // Keep the native dialog modal while its backdrop is visible.
    body.inert = header.inert = true;
    animateBackdrop(false, opacity);
    springSurface(dialog, false, { from: 'translateY(10px) scale(.965)' }, () => {
      closing = false;
      dialog.close();
      body.inert = header.inert = false;
      delete dialog.dataset.closing;
      stopBackdrop();
      after?.();
    });
  }

  function open() {
    const first = !dialog.open;
    if (!first && !closing) return;
    const opacity = first ? 0 : backdropOpacity(0);
    closing = false;
    delete dialog.dataset.closing;
    body.inert = header.inert = false;
    if (first) dialog.showModal();
    animateBackdrop(true, opacity);
    springSurface(dialog, true, { from: 'translateY(10px) scale(.965)' }, undefined, first);
  }

  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const { left, top, right, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) close();
  });
  document.body.append(dialog);
  return { dialog, body, open, close, isOpen: () => dialog.open && !closing };
}
