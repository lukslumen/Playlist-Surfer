import path from 'node:path';
import { expect, test } from './test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');

test('the overview, attention and content dashboards render', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 5 } });

  await page.keyboard.press('Alt+Shift+KeyO');
  await page.getByRole('button', { name: 'Generate dashboard', exact: true }).click();
  await expect(page.getByText('Upload timeline', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Quality checks', { exact: false }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'attention' }).click();
  await expect(page.getByText('Cumulative attention share', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Views per video', { exact: false }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'content' }).click();
  await expect(page.getByText('Title keywords', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Duration buckets', { exact: false }).first()).toBeVisible();
});
