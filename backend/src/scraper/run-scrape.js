/**
 * run-scrape.js
 * --------------------------------------------------------------------------
 * Standalone CLI entry point for the scraper. Lets us run the scraper in
 * ISOLATION (no Express, no DB) to prove the retry / backoff / validation
 * / extraction logic works against the real mock store before wiring it
 * into the API.
 *
 * Usage:
 *   node src/scraper/run-scrape.js <productId>            # headless, 3 attempts
 *   node src/scraper/run-scrape.js <productId> --headed   # visible browser (for demo recording)
 *   node src/scraper/run-scrape.js <productId> --attempts 5
 *   HEADLESS=false node src/scraper/run-scrape.js <productId>
 *
 * Examples:
 *   node src/scraper/run-scrape.js 921 --headed
 *   node src/scraper/run-scrape.js 921 36 459   # scrape several sequentially
 *
 * The script does NOT write to the database. It only prints what the
 * scraper saw, so you can verify reliability by eye.
 * --------------------------------------------------------------------------
 */

const { scrapeProduct, STORE_BASE_URL } = require('./scraper');

async function main() {
  const argv = process.argv.slice(2);
  const headedFlagIdx = argv.indexOf('--headed');
  if (headedFlagIdx >= 0) argv.splice(headedFlagIdx, 1);

  const attemptsFlagIdx = argv.indexOf('--attempts');
  let maxAttempts;
  if (attemptsFlagIdx >= 0) {
    maxAttempts = parseInt(argv[attemptsFlagIdx + 1], 10);
    argv.splice(attemptsFlagIdx, 2);
    if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
      console.error('--attempts must be a positive integer');
      process.exit(2);
    }
  }

  const productIds = argv.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
  if (productIds.length === 0) {
    console.error('Usage: node run-scrape.js <productId> [<productId>...] [--headed] [--attempts N]');
    console.error('Example: node run-scrape.js 921 --headed');
    process.exit(2);
  }

  // Headless unless the user explicitly asked for headed via --headed OR
  // set HEADLESS=false in the environment. Headed mode is for the demo
  // recording and must be run on a machine with a real display (X server
  // on Linux, or any macOS / Windows desktop). This CLI sandbox has no
  // display, so we default to headless here.
  const wantsHeaded = headedFlagIdx >= 0 || process.env.HEADLESS === 'false';
  const headless = !wantsHeaded;

  console.log('========================================================');
  console.log(' INE Price Tracker — standalone scraper run');
  console.log('--------------------------------------------------------');
  console.log(` Target site:  ${STORE_BASE_URL}`);
  console.log(` Headless:     ${headless}`);
  console.log(` Max attempts: ${maxAttempts ?? 3}`);
  console.log(` Products:     ${productIds.join(', ')}`);
  console.log('========================================================');

  // Share one browser across all products (faster than relaunching each time).
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless });

  try {
    for (const id of productIds) {
      console.log(`\n>>> Scraping product ${id}`);
      const t0 = Date.now();
      const result = await scrapeProduct(id, {
        headless,
        maxAttempts,
        browser,
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`<<< product ${id}  (${dt}s)`);
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Standalone scraper crashed:', err);
  process.exit(1);
});
