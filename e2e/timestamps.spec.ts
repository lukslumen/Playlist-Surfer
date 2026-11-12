import path from 'node:path';
import { expect, test } from './test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');

// Seeking itself needs YouTube's player (network), so this checks the links; seeking was verified by hand.
test('chapter timestamps in the description are links', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();

  await page.locator('.ag-center-cols-container .ag-row[row-index="0"] .ag-cell').first().click();
  const links = page.locator('.timestamp-link');
  await expect(links.first()).toBeVisible();
  await expect(links).toHaveText(['00:00', '01:32', '06:00', '09:56', '16:51', '18:41', '21:40', '27:05', '30:45', '32:55', '36:45']);
  await expect(page.getByTitle('Play from 06:00')).toBeVisible();
});
