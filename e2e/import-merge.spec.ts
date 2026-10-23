import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');

test('merging a second CSV keeps the rows, and adds its column', async ({ page }, testInfo) => {
  // An enrichment file: two of the sample's video ids plus a new column.
  const ids = fs.readFileSync(FIXTURE, 'utf8').split('\n').slice(1, 3).map((line) => {
    const header = fs.readFileSync(FIXTURE, 'utf8').split('\n')[0].split(',');
    return line.split(',')[header.indexOf('videoId')];
  });
  const enrichment = testInfo.outputPath('labels.csv');
  fs.writeFileSync(enrichment, `videoId,coder_label\n${ids[0]},smuggling\n${ids[1]},supply chains\n`);

  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();

  await page.locator('input[type=file]').setInputFiles(enrichment);
  await page.getByRole('button', { name: /Merge into current project/ }).click();
  await page.getByRole('button', { name: 'Merge CSV' }).click();
  await expect(page.getByText('Import or Merge CSV')).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();

  // The new column is in the project.
  await page.keyboard.press('Alt+Shift+KeyV');
  await page.getByPlaceholder('Search columns, deleted fields, or active filters...').fill('coder');
  await expect(page.getByTitle('coder_label', { exact: true })).toBeVisible();
  await expect(page.getByText('src: labels.csv').first()).toBeVisible();
});
