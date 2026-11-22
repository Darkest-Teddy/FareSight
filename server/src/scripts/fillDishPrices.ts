/**
 * Backfills the menu prices missing from `shared/src/restaurantDishes.ts` with the price agent,
 * then rewrites that file in place with the prices and the page each one was read from.
 *
 *   node src/scripts/fillDishPrices.ts [--dry-run] [--venue <id>] [--batch 8] [--rounds 3] [--allow-third-party]
 *
 * By default only the venue's own menu, its ordering page or a first-party delivery listing counts.
 * `--allow-third-party` also accepts a cited menu-aggregator listing, which is how chains that publish
 * no prices of their own get filled; the publisher is recorded either way.
 *
 * Dishes the agent cannot price on a cited page are left null and listed in the closing report;
 * nothing is estimated. Run it from the server workspace with OPENAI_API_KEY set.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoPlaces, type Dish, type Place } from '@faresight/shared';
import { getConfig, projectRoot } from '../config.ts';
import { lookupMenuPrices } from '../services/menuPrices.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const dryRun = flag('dry-run');
const onlyVenue = value('venue');
const batchSize = Math.max(1, Number(value('batch') ?? 8));
const rounds = Math.max(1, Number(value('rounds') ?? 3));
const allowThirdParty = flag('allow-third-party');

const dataFile = resolve(projectRoot, 'shared/src/restaurantDishes.ts');
const config = getConfig();
if (!config.openaiKey) {
  console.error('OPENAI_API_KEY is not set, so there is no price agent to ask.');
  process.exit(1);
}

interface Found { price: number; source: string; url: string }
const found = new Map<string, Found>();
const reasons = new Map<string, string>();

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

async function priceVenue(place: Place, wanted: Dish[]) {
  let outstanding = wanted;
  for (let round = 1; round <= rounds && outstanding.length; round++) {
    const before = found.size;
    for (const batch of batches(outstanding, batchSize)) {
      const names = batch.map(({ name }) => name).join(', ');
      process.stdout.write(`  round ${round} · ${batch.length} dishes · ${names.slice(0, 70)}…\n`);
      const result = await lookupMenuPrices(place, batch, config, { allowThirdParty }).catch((error: unknown) => {
        console.warn(`    lookup failed: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      });
      if (!result) continue;
      for (const { dish_id, price, source, url } of result.prices) {
        if (!found.has(dish_id)) found.set(dish_id, { price, source, url });
        reasons.delete(dish_id);
      }
      for (const { dish_id, reason } of result.unpriced) {
        if (!found.has(dish_id)) reasons.set(dish_id, reason);
      }
    }
    outstanding = outstanding.filter(({ id }) => !found.has(id));
    // A round that adds nothing new will not do better on the next pass.
    if (found.size === before) break;
  }
}

/** Replaces the `price: null` belonging to one dish, and records where the number came from. */
function applyPrice(source: string, dishId: string, price: number, label: string, url: string): string {
  const anchor = source.indexOf(`id: '${dishId}',`);
  if (anchor < 0) throw new Error(`${dishId} is not in restaurantDishes.ts`);
  const target = source.indexOf('price: null,', anchor);
  const nextDish = source.indexOf('id: \'', anchor + 1);
  if (target < 0 || (nextDish >= 0 && target > nextDish)) throw new Error(`${dishId} has no price: null to fill`);
  const quoted = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const replacement = `price: ${price.toFixed(2)}, priceSource: ${quoted(label)}, priceUrl: ${quoted(url)},`;
  return source.slice(0, target) + replacement + source.slice(target + 'price: null,'.length);
}

const venues = demoPlaces.filter((place) => place.dishes.some((dish) => dish.price == null)
  && (!onlyVenue || place.id === onlyVenue));
if (!venues.length) {
  console.log('Every dish in the catalog already has a price.');
  process.exit(0);
}

for (const place of venues) {
  const wanted = place.dishes.filter((dish) => dish.price == null);
  console.log(`\n${place.name} (${place.id}) · ${wanted.length} unpriced of ${place.dishes.length}`);
  await priceVenue(place, wanted);
}

let file = readFileSync(dataFile, 'utf8');
let written = 0;
for (const place of venues) {
  for (const dish of place.dishes) {
    const hit = found.get(dish.id);
    if (!hit || dish.price != null) continue;
    file = applyPrice(file, dish.id, hit.price, hit.source, hit.url);
    written++;
  }
}
if (!dryRun && written) writeFileSync(dataFile, file);

console.log(`\n${written} price${written === 1 ? '' : 's'} ${dryRun ? 'would be written' : 'written'} to shared/src/restaurantDishes.ts`);
for (const place of venues) {
  const still = place.dishes.filter((dish) => dish.price == null && !found.has(dish.id));
  if (!still.length) continue;
  console.log(`\nStill unpriced at ${place.name}:`);
  for (const dish of still) console.log(`  ${dish.name} — ${reasons.get(dish.id) ?? 'No published price found.'}`);
}
