import path from 'node:path';
import { expect, test } from '@playwright/test';

for (const rows of String(process.env.PERF_ROWS || '10000,100000').split(',').map(Number)) {
  test(`localStorage persistence at ${rows}`, async ({ page }) => {
    test.setTimeout(10 * 60_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text().slice(0, 160));
      if (/autosave|\[state\]/.test(m.text())) console.log('LOG', m.text().slice(0, 200));
    });
    await page.goto('/');
    await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 60_000 });
    await page.locator('input[type=file]').setInputFiles(path.resolve(`e2e/fixtures/perf/videos-${rows}.csv`));
    await page.getByRole('button', { name: 'Import CSV' }).click();
    const n = rows.toLocaleString('en-US');
    await expect(page.getByRole('contentinfo')).toContainText(`showing ${n} of ${n} rows`, { timeout: 5 * 60_000 });
    const cell = page.locator('.ag-center-cols-container .ag-row[row-index="0"] .ag-cell').first();
    await cell.click();
    await expect(page.getByRole('contentinfo')).toContainText('1 selected');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(4000);
    await page.reload();
    await expect(page.getByRole('contentinfo')).toContainText(`showing ${(rows - 1).toLocaleString('en-US')} of`, { timeout: 5 * 60_000 });
    const stored = await page.evaluate(() => Object.keys(localStorage).map((key) => {
      const value = localStorage.getItem(key) || '';
      let excluded: number | null = null;
      try { excluded = (JSON.parse(value).excludedVideoIds || []).length; } catch { /* not json */ }
      return { key, kb: Math.round(value.length / 1024), excluded };
    }));
    console.log(`STORAGE ${rows}`, JSON.stringify(stored), 'ERRORS', JSON.stringify(errors.filter((e) => /quota|storage|setItem/i.test(e))));
  });
}
