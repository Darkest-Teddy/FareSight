import { ROUTE_COLORS, type Stop } from '@faresight/shared';
import { element } from './dom';

/** One coloured dot per line serving the stop, each with its line name. */
export function lineDots(stop: Stop) {
  const node = element('span', 'route-list');
  for (const route of stop.lines) {
    const lamp = element('span', 'route-dot');
    lamp.style.backgroundColor = ROUTE_COLORS[route] ?? stop.primary_color;
    const line = element('span', 'route-line', route.replace('-', ' '));
    line.prepend(lamp);
    node.append(line);
  }
  return node;
}
