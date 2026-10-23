import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Opt-in: generate fixtures with `node scripts/generate-perf-fixture.mjs <rows>`, then
// PERF=1 PERF_ROWS=10000,100000 npx playwright test e2e/perf.spec.ts
const SIZES = String(process.env.PERF_ROWS || '10000,100000').split(',').map(Number);

test.skip(!process.env.PERF, 'Set PERF=1 to run performance measurements.');
test.describe.configure({ mode: 'serial' });

async function timed(label: string, results: Record<string, number>, action: () => Promise<void>) {
  const start = Date.now();
  await action();
  results[label] = Date.now() - start;
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
    await firstCell.click();
    await expect(footer(page)).toContainText('1 selected');
    await timed('exclude 1 row', results, async () => {
      await page.keyboard.press('Delete');
      await expect(footer(page)).toContainText(rowsText(size - 1), { timeout: 5 * 60_000 });
    });
    await timed('undo exclude', results, async () => {
      await page.keyboard.press('ControlOrMeta+z');
      await expect(footer(page)).toContainText(rowsText(size), { timeout: 5 * 60_000 });
    });

    await firstCell.click();
    await expect(footer(page)).toContainText('1 selected');
    await timed('select all', results, async () => {
      await page.keyboard.press('ControlOrMeta+a');
      await expect(footer(page)).toContainText(`${size.toLocaleString('en-US')} selected`, { timeout: 5 * 60_000 });
    });
    await timed('exclude all rows', results, async () => {
      await page.keyboard.press('Delete');
      await expect(page.getByRole('button', { name: new RegExp(`^Show excluded videos\\. ${size.toLocaleString('en-US')} videos`) }))
        .toBeVisible({ timeout: 5 * 60_000 });
    });

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
