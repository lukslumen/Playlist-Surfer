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
  await page.getByRole('tab', { name: 'Links' }).click();
  // Descriptions are suggested first: the videos' own URLs and thumbnails are not outgoing links.
  await expect(page.locator('.dash-choice').first()).toContainText('videoDescription');
  await page.locator('.dash-choice').first().click();
  await page.getByRole('button', { name: /Generate linking summary/i }).click();

  await expect(page.getByRole('region', { name: 'Links in videoDescription' })).toContainText('of videos link out', { timeout: 30_000 });
  await expect(page.getByRole('region', { name: 'Where links point' })).toContainText('Other platforms');
  await expect(page.getByText('on.natgeo.com').first()).toBeVisible();
  await expect(page.getByText('Generating linking summary')).toBeHidden({ timeout: 30_000 });
});
