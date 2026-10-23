import path from 'node:path';
import { expect, test } from './test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');

test('channels view generates channel metadata from the videos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();

  await page.getByTitle('Show generated channel metadata table').click();
  await expect(page.getByText('Channel metadata hasn’t been generated yet')).toBeVisible();
  await page.getByRole('button', { name: 'Generate channel metadata' }).first().click();
  await expect(page.getByRole('contentinfo')).toContainText('Channels: showing 1 of 1 rows', { timeout: 30_000 });
  await expect(page.locator('.ag-center-cols-container').getByText('National Geographic').first()).toBeVisible();
});
