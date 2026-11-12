import path from 'node:path';
import { expect, test } from './test';

// YouTube Data Tools' video list export as of November 2026 (Shorts flag and channel metadata per video).
const FIXTURE = process.env.YTDT_EXPORT || path.join(import.meta.dirname, 'fixtures', 'videolist-ytdt-2026.csv');
const TOTAL = Number(process.env.YTDT_EXPORT_ROWS || 30);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await expect(page.getByText('Detected: YouTube Data Tools — Video List export')).toBeVisible();
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText(`showing ${TOTAL} of ${TOTAL} rows`)).toBeVisible();
});

test('the overview shows the Shorts split, and clicking Shorts filters the explorer', async ({ page }) => {
  await page.getByTitle('Dataset Dashboard').click();
  await page.getByRole('button', { name: 'Generate dashboard', exact: true }).click();
  await expect(page.getByText('Uploads per')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\d+% are Shorts\./)).toBeVisible();
  await expect(page.getByLabel('Key numbers')).toContainText('subscribers');
  const shorts = page.getByRole('button', { name: /^Shorts/ });
  const count = Number((await shorts.locator('.dash-bar-value span').innerText()).replace(/,/g, ''));
  await shorts.click();
  await expect(page.getByRole('contentinfo')).toContainText(`showing ${count} of ${TOTAL} rows`);
});

test('generated channel metadata includes the per-video channel fields', async ({ page }) => {
  await page.getByTitle('Show generated channel metadata table').click();
  await page.getByRole('button', { name: 'Generate channel metadata' }).first().click();
  await expect(page.getByRole('contentinfo')).toContainText('Channels: showing', { timeout: 30_000 });
  // Select a channel (a plain cell: the first one links to the channel's videos); its panel lists the fields.
  const firstRow = page.locator('.ag-center-cols-container .ag-row[row-index="0"]');
  await firstRow.locator('.ag-cell').nth(2).click();
  await expect(firstRow).toHaveClass(/ag-row-selected/);
  await expect(page.getByRole('heading', { name: 'Performance' })).toBeVisible();
  await expect(page.getByText('Subscribers', { exact: true })).toBeVisible();
  await expect(page.getByText('Channel created', { exact: true })).toBeVisible();
  // Shown as a date, not as epoch milliseconds.
  await expect(page.getByText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/).first()).toBeVisible();
  await expect(page.getByText(/^1,\d{3},\d{3},\d{3},\d{3}$/)).toHaveCount(0);
});

test('the attention table offers views per subscriber', async ({ page }) => {
  await page.getByTitle('Dataset Dashboard').click();
  await page.getByRole('button', { name: 'Generate dashboard', exact: true }).click();
  await expect(page.getByText('Uploads per')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Attention' }).click();
  const ranked = page.getByRole('region', { name: 'Ranked videos' });
  await ranked.getByRole('button', { name: 'Per subscriber' }).click();
  await expect(ranked).toContainText("reached far beyond their channel's subscriber base");
  await expect(ranked.getByRole('columnheader', { name: 'Per subscriber' })).toBeVisible();
});
