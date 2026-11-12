import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Opt-in: generate fixtures with `node scripts/generate-perf-fixture.mjs <rows>`, then
// PERF=1 PERF_ROWS=10000,100000 npx playwright test --config playwright.perf.config.ts e2e/perf.spec.ts
const SIZES = String(process.env.PERF_ROWS || '10000,100000').split(',').map(Number);

test.skip(!process.env.PERF, 'Set PERF=1 to run performance measurements.');
test.describe.configure({ mode: 'serial' });

async function timed(label: string, results: Record<string, number>, action: () => Promise<void>) {
  const start = Date.now();
  await action();
  results[label] = Date.now() - start;
  // Logged per step so a crash part-way through still leaves the earlier numbers.
  console.log(`PERF step ${label}: ${results[label]} ms`);
}

/**
 * Presses `key` and measures, inside the page, from the keydown to the first frame painted after the
 * footer shows `expectedText`. Playwright's own polling is too coarse for sub-200 ms interactions.
 */
async function timedKey(page: Page, label: string, results: Record<string, number>, key: string, expectedText: string) {
  await page.evaluate((expected) => {
    const state = { start: 0, end: 0 };
    (window as any).__perf = state;
    window.addEventListener('keydown', () => { state.start = performance.now(); }, { capture: true, once: true });
    const target = document.querySelector('[role=contentinfo], footer') || document.body;
    const observer = new MutationObserver(() => {
      if (!state.start || state.end || !(target.textContent || '').includes(expected)) return;
      observer.disconnect();
      requestAnimationFrame(() => { state.end = performance.now(); });
    });
    observer.observe(target, { subtree: true, childList: true, characterData: true });
  }, expectedText);
  await page.keyboard.press(key);
  await page.waitForFunction(() => (window as any).__perf.end > 0, undefined, { timeout: 5 * 60_000, polling: 50 });
  results[label] = Math.round(await page.evaluate(() => (window as any).__perf.end - (window as any).__perf.start));
  console.log(`PERF step ${label}: ${results[label]} ms`);
}

function footer(page: Page) {
  return page.getByRole('contentinfo');
}

function rowsText(count: number) {
  return `showing ${count.toLocaleString('en-US')} of ${count.toLocaleString('en-US')} rows`;
}

for (const size of SIZES) {
  test(`perf ${size.toLocaleString('en-US')} rows`, async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const fixture = path.resolve('e2e/fixtures/perf', `videos-${size}.csv`);
    test.skip(!fs.existsSync(fixture), `Missing ${fixture}`);
    const results: Record<string, number> = {};

    await page.goto('/');
    await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 60_000 });

    await timed('parse + open import dialog', results, async () => {
      await page.locator('input[type=file]').setInputFiles(fixture);
      await expect(page.getByRole('button', { name: 'Import CSV' })).toBeVisible({ timeout: 10 * 60_000 });
    });
    await timed('import to grid', results, async () => {
      await page.getByRole('button', { name: 'Import CSV' }).click();
      await expect(footer(page)).toContainText(rowsText(size), { timeout: 10 * 60_000 });
    });

    const firstCell = page.locator('.ag-center-cols-container .ag-row[row-index="0"] .ag-cell').first();
    // Single interactions are noisy (GC, scheduling), so repeat and keep the median.
    const samples: Record<string, number[]> = { 'exclude 1 row': [], 'undo exclude': [] };
    for (let i = 0; i < 5; i += 1) {
      await firstCell.click();
      await expect(footer(page)).toContainText('1 selected');
      const sample: Record<string, number> = {};
      await timedKey(page, 'exclude 1 row', sample, 'Delete', rowsText(size - 1));
      await timedKey(page, 'undo exclude', sample, 'ControlOrMeta+z', rowsText(size));
      samples['exclude 1 row'].push(sample['exclude 1 row']);
      samples['undo exclude'].push(sample['undo exclude']);
    }
    Object.entries(samples).forEach(([label, values]) => {
      results[`${label} (median of 5)`] = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      console.log(`PERF median ${label}: ${results[`${label} (median of 5)`]} ms (${values.join(', ')})`);
    });

    await firstCell.click();
    await expect(footer(page)).toContainText('1 selected');
    await timedKey(page, 'select all', results, 'ControlOrMeta+a', `${size.toLocaleString('en-US')} selected`);
    await timedKey(page, 'exclude all rows', results, 'Delete', rowsText(0));

    // Reopening: from navigation until the restored project's rows are on screen.
    await timedKey(page, 'restore all rows (undo)', results, 'ControlOrMeta+z', rowsText(size));
    await page.waitForTimeout(1500);
    await timed('reload to restored project', results, async () => {
      await page.reload();
      await expect(footer(page)).toContainText(rowsText(size), { timeout: 5 * 60_000 });
    });

    // Thumbnail view, sorted by views: every exclude re-sorts the rows, so this is the worst case.
    const viewsHeader = page.locator('.ag-header-cell[col-id="viewCount"] .ag-header-cell-label');
    await viewsHeader.click();
    await viewsHeader.click();
    await expect(page.locator('.ag-header-cell[col-id="viewCount"]')).toHaveAttribute('aria-sort', 'descending');
    await timed('switch to thumbnails (sorted)', results, async () => {
      await page.getByRole('button', { name: 'Show videos as thumbnails' }).click();
      await expect(page.locator('.thumbnail-tile').first()).toBeVisible({ timeout: 60_000 });
    });
    await page.locator('.thumbnail-grid-scroll').evaluate((element) => { element.scrollTop = 0; });
    const thumbnailSamples: Record<string, number[]> = { 'thumbnails: exclude 1': [], 'thumbnails: undo': [] };
    for (let i = 0; i < 5; i += 1) {
      await page.locator('.thumbnail-tile[data-thumbnail-index="0"]').click();
      await expect(footer(page)).toContainText('1 selected');
      const sample: Record<string, number> = {};
      await timedKey(page, 'thumbnails: exclude 1', sample, 'Delete', rowsText(size - 1));
      await timedKey(page, 'thumbnails: undo', sample, 'ControlOrMeta+z', rowsText(size));
      thumbnailSamples['thumbnails: exclude 1'].push(sample['thumbnails: exclude 1']);
      thumbnailSamples['thumbnails: undo'].push(sample['thumbnails: undo']);
    }
    Object.entries(thumbnailSamples).forEach(([label, values]) => {
      results[`${label} (median of 5)`] = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      console.log(`PERF median ${label}: ${results[`${label} (median of 5)`]} ms (${values.join(', ')})`);
    });
    await timed('thumbnails: scroll to end', results, async () => {
      await page.locator('.thumbnail-grid-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expect(page.locator(`.thumbnail-tile[data-thumbnail-index="${size - 1}"]`)).toBeVisible();
    });

    // Dashboards: generating the snapshot builds every tab's profile; then open the heaviest tabs.
    await page.getByRole('button', { name: 'Show videos as a table' }).click();
    await page.getByTitle('Dataset Dashboard').click();
    await timed('dashboard: generate snapshot', results, async () => {
      await page.getByRole('button', { name: 'Generate dashboard', exact: true }).click();
      await expect(page.getByText(/Uploads per/)).toBeVisible({ timeout: 5 * 60_000 });
    });
    for (const tab of ['Attention', 'Vernacular', 'Time'] as const) {
      await timed(`dashboard: open ${tab}`, results, async () => {
        await page.getByRole('tab', { name: tab }).click();
        await expect(page.locator('.dash-panel').first()).toBeVisible({ timeout: 60_000 });
      });
    }

    const heapMb = await page.evaluate(() => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return memory ? Math.round(memory.usedJSHeapSize / 1e6) : null;
    });

    const report = { rows: size, heapMb, timingsMs: results };
    console.log(`PERF ${JSON.stringify(report)}`);
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync(`test-results/perf-${size}.json`, JSON.stringify(report, null, 2));
  });
}
