import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');
const row = (page: Page, index: number) => page.locator(`.ag-center-cols-container .ag-row[row-index="${index}"] .ag-cell`).first();

test('a project backup restores rows and exclusions in a fresh browser', async ({ page, browser }, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();

  await row(page, 0).click();
  await row(page, 1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Exclude', exact: true }).click();
  await expect(page.getByText('showing 59 of 59 rows')).toBeVisible();

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+Shift+KeyE');
  await page.getByRole('button', { name: /Full project backup/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Project Backup' }).click();
  const download = await downloadPromise;
  const zipPath = testInfo.outputPath('backup.zip');
  await download.saveAs(zipPath);

  // A fresh context has no autosave, so the data can only come from the backup.
  const fresh = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const restored = await fresh.newPage();
  const errors: string[] = [];
  restored.on('pageerror', (error) => errors.push(error.message));
  await restored.goto('/');
  await expect(restored.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await restored.locator('input[type=file]').setInputFiles(zipPath);
  await expect(restored.getByText('showing 59 of 59 rows')).toBeVisible({ timeout: 30_000 });
  await expect(restored.getByRole('button', { name: /^Show excluded videos\. 2 videos\./ })).toBeVisible();
  expect(errors).toEqual([]);
  await fresh.close();
});
