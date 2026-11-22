import type { Dish } from './types.js';

export function formatDishPrice(price: Dish['price'], unlisted = 'Price not listed'): string {
  return price == null ? unlisted : `$${price.toFixed(2)}`;
}
