import path from 'node:path';
import { expect, test } from './test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');

test('linking summary classifies links from the video descriptions', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  await page.keyboard.press('Alt+Shift+KeyO');
  await page.getByRole('tab', { name: 'linking' }).click();
  await page.getByText('videoDescription', { exact: true }).click();
  await page.getByRole('button', { name: /Generate linking summary/i }).click();

  await expect(page.getByText(/Source column\s*videoDescription/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('on.natgeo.com').first()).toBeVisible();
  await expect(page.getByText('Generating linking summary')).toBeHidden({ timeout: 30_000 });
});
