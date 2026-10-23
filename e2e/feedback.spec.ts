import fs from 'node:fs';
import { expect, test } from './test';

test('restoring a broken backup shows an error toast', async ({ page }, testInfo) => {
  const broken = testInfo.outputPath('broken.zip');
  fs.writeFileSync(broken, 'this is not a zip archive');
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(broken);
  const toast = page.getByRole('alert');
  await expect(toast).toContainText("Couldn't restore broken.zip");
  await toast.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(toast).toBeHidden();
});

test('clicking a row without a video ID explains why it cannot be excluded', async ({ page }, testInfo) => {
  const csv = testInfo.outputPath('mixed.csv');
  fs.writeFileSync(csv, 'videoId,videoTitle,viewCount\nabc123,Has an id,10\n,Missing id,5\n,Also missing,7\n');
  const gridWarnings: string[] = [];
  page.on('console', (message) => { if (/Duplicate node id/.test(message.text())) gridWarnings.push(message.text()); });
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(csv);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 3 of 3 rows')).toBeVisible();
  // Rows without a video ID used to share the grid id '', which AG Grid mishandles.
  await expect(page.locator('.ag-center-cols-container .ag-row')).toHaveCount(3);
  expect(gridWarnings).toEqual([]);

  await page.locator('.ag-row').filter({ hasText: 'Missing id' }).first().locator('.ag-cell').first().click();
  await expect(page.getByRole('status').filter({ hasText: 'no video ID' })).toBeVisible();
});
