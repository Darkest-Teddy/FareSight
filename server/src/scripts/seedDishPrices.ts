/**
 * Copies every menu price already compiled into `shared/src/restaurantDishes.ts` into the
 * `dish_prices` table in Tiger Data.
 *
 *   node src/scripts/seedDishPrices.ts [--dry-run]
 *
 * The compiled file and the table hold the same prices by design: the file is what ships with the
 * client and works with no database, and the table is what the running server reads to fill a dish
 * the file has no price for. This brings the table up to the file in one pass, so Tiger Data holds
 * the whole record rather than only the prices found since the table was added.
 *
 * It asks nothing of the price agent and costs nothing. Re-running it is safe: each dish is
 * upserted on its id.
 */
import { restaurantDishMenus } from '@faresight/shared';
import { getConfig } from '../config.ts';
import { createPool, migrate } from '../db/pg.ts';
import { saveDishPrices } from '../services/dishPrices.ts';

const dryRun = process.argv.includes('--dry-run');
const config = getConfig();
const databaseUrl = config.accounts?.databaseUrlDirect;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set, so there is no Tiger Data to seed.');
  process.exit(1);
}

/**
 * Publishers that list a venue's menu without being the venue. A price from one of these is still
 * a real cited price -- it is how a chain that publishes no prices of its own gets filled at all --
 * but the reader is told it is third-hand, so the distinction is carried into the table.
 */
const aggregators = ['menu with price', 'menuwithprice', 'menupix', 'allmenus', 'menuism', 'zmenu', 'sirved'];
const isAggregator = (source: string) => aggregators.includes(source.toLowerCase().trim());

/** A price with no recorded publisher came from the venue's own ordering page, named by its host. */
function publisher(pricingUrl: string | undefined): string {
  if (!pricingUrl) return 'Venue menu';
  try {
    return `${new URL(pricingUrl).hostname.replace(/^www\./, '')} (venue ordering page)`;
  } catch {
    return 'Venue menu';
  }
}

const pool = createPool(databaseUrl);
let total = 0;
try {
  await migrate(pool);
  for (const { venueId, pricingUrl, dishes } of restaurantDishMenus) {
    const priced = dishes.filter(({ price }) => price != null);
    const firstParty = priced.filter((dish) => !dish.priceSource || !isAggregator(dish.priceSource));
    const thirdParty = priced.filter((dish) => dish.priceSource && isAggregator(dish.priceSource));
    const toRow = ({ id, price, priceSource, priceUrl }: typeof priced[number]) => ({
      dish_id: id,
      price: price as number,
      source: priceSource ?? publisher(pricingUrl),
      url: priceUrl ?? pricingUrl ?? '',
    });
    const counts = { first: firstParty.length, third: thirdParty.length };
    if (!dryRun) {
      // The two groups differ only by the third_party flag, so they are written as two statements.
      if (firstParty.length) await saveDishPrices(pool, venueId, firstParty.map(toRow), false);
      if (thirdParty.length) await saveDishPrices(pool, venueId, thirdParty.map(toRow), true);
    }
    total += priced.length;
    console.log(`${venueId}: ${priced.length} of ${dishes.length} priced `
      + `(${counts.first} first-party, ${counts.third} aggregator)`);
  }
  console.log(`\n${total} price${total === 1 ? '' : 's'} ${dryRun ? 'would be written' : 'written'} to dish_prices in Tiger Data`);
} finally {
  await pool.end();
}
