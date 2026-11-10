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
  await expect(page.getByText('Uploads per month')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('61 videos from one channel (National Geographic)', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Key numbers')).toContainText('Typical views');
  await expect(page.getByLabel('Data health')).toContainText('No problems found');

  await page.getByRole('tab', { name: 'attention' }).click();
  await expect(page.getByText('Cumulative attention share', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Views per video', { exact: false }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'content' }).click();
  await expect(page.getByText('Title keywords', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Duration buckets', { exact: false }).first()).toBeVisible();
});

test('clicking a length bucket in the overview filters the explorer to those videos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();

  await page.getByTitle('Dataset Dashboard').click();
  await page.getByRole('button', { name: 'Generate dashboard', exact: true }).click();
  const bucket = page.getByRole('button', { name: /^20–60 min/ });
  await expect(bucket).toContainText('34');
  await bucket.click();

  await expect(page.getByText('Uploads per month')).toBeHidden();
  await expect(page.getByRole('contentinfo')).toContainText('showing 34 of 61 rows');
});
