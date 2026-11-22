const SVG_NS = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K, attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

export function button(label: string, action: () => void, className = '') {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

const icons = {
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  plus: 'M12 5v14M5 12h14',
  map: 'M9 4L3.5 6.5v13.5L9 17.5l6 2.5 5.5-2.5V4L15 6.5 9 4zM9 4v13.5M15 6.5V20',
  scans: 'M12 3l8.5 4.5L12 12 3.5 7.5 12 3zM3.5 12L12 16.5 20.5 12M3.5 16.5L12 21l8.5-4.5',
  key: 'M11.5 15.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM10.4 12.6L19.5 3.5M16 7l2.5 2.5M13.4 9.6l2 2',
  camera: 'M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20v10H4v-10zM12 16.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
  image: 'M4 5h16v14H4V5zM4 15.5l4.5-4.5 4 4 2.5-2.5 5 5M15.5 9.5h.01',
  room: 'M4 20V8l8-4.5L20 8v12M4 20h16M9.5 20v-6h5v6',
  dish: 'M3.5 13.5a8.5 8.5 0 0 1 17 0M2.5 13.5h19M6 17h12M12 5V3.5',
  walk: 'M13 4.5a1.5 1.5 0 1 0 0-.01M10 21l1.5-6-2.5-2.5 1-5 3 1 2.5 3 2.5 1M9 12.5L7 14M13.5 15l2.5 6',
  retry: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.5H15',
  locate: 'M4 4h5M4 4v5M20 4h-5M20 4v5M4 20h5M4 20v-5M20 20h-5M20 20v-5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  alert: 'M12 4l9 16H3L12 4zM12 10v4.5M12 17.5h.01',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.8L12 3.5z',
} as const;
export type IconName = keyof typeof icons;

export function icon(name: IconName, className = '') {
  const node = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: `icon ${className}`.trim() });
  node.append(svg('path', { d: icons[name] }));
  return node;
}

export function iconButton(name: IconName, label: string, action: () => void, className = '') {
  const node = button('', action, `icon-button ${className}`.trim());
  node.setAttribute('aria-label', label);
  node.append(icon(name));
  return node;
}

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Animation length that collapses to zero when the device asks for reduced motion. */
export const motion = (ms: number) => reducedMotion.matches ? 0 : ms;

export function haptic(pattern: number | number[] = 8) {
  try { navigator.vibrate?.(pattern); } catch { /* Vibration is optional feedback. */ }
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Restarts a CSS animation class so repeated taps replay it. */
export function replay(node: Element, className: string) {
  node.classList.remove(className);
  void node.getBoundingClientRect();
  node.classList.add(className);
}

export function timeAgo(iso: string) {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}
