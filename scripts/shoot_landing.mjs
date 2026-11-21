/**
 * Screenshots the landing page at a series of scroll positions.
 *
 *   node scripts/shoot_landing.mjs [baseUrl] [outDir]
 *
 * The page is a scroll animation, so "does it build" says nothing useful
 * about whether it works. This drives a real Chrome at a real GPU, steps the
 * scroll through both sections, and writes a frame at each step so the motion
 * can actually be looked at. Console errors and failed requests are reported,
 * because a missing texture shows up as a silently grey wall otherwise.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const chrome = process.env.CHROME_PATH
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.argv[2] ?? 'http://localhost:5173/landing.html';
const outDir = process.argv[3] ?? 'scripts/.shots';

/** Fractions of total scrollable height to capture. */
const marks = [0, 0.08, 0.16, 0.24, 0.32, 0.42, 0.52, 0.62, 0.74, 0.86, 0.95];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await mkdir(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'shell',
    args: [
      // Headless Chrome will not give you a real GPU, and without these it
      // falls back to a software path that refuses WebGL outright.
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--hide-scrollbars',
      '--no-sandbox',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    problems.push(`failed: ${request.url().replace(baseUrl, '')} (${request.failure()?.errorText})`);
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 90_000 });
  // The scene loads its probes and scans after the document settles, and
  // builds the prefiltered atlas on top of that. Give it room.
  await sleep(6000);

  const height = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
  console.log(`scrollable height: ${height}px`);

  for (const [index, mark] of marks.entries()) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(height * mark));
    // The director smooths towards the scrollbar, so a frame taken straight
    // after a jump shows the previous state. Let it catch up.
    await sleep(1100);
    const name = `${String(index).padStart(2, '0')}-${Math.round(mark * 100)}.png`;
    await page.screenshot({ path: join(outDir, name) });
    console.log(`  ${name}`);
  }

  await browser.close();

  if (problems.length) {
    const unique = [...new Set(problems)];
    console.log(`\n${unique.length} problem(s):`);
    for (const problem of unique.slice(0, 25)) console.log('  -', problem);
    await writeFile(join(outDir, 'problems.txt'), unique.join('\n') + '\n');
  } else {
    console.log('\nNo console errors or failed requests.');
  }
}

main().catch((error) => { console.error('Failed:', error); process.exit(1); });
