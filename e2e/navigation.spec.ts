import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');
const row = (page: Page, index: number) => page.locator(`.ag-center-cols-container .ag-row[row-index="${index}"] .ag-cell`).first();
const detailTitle = (page: Page) => page.locator('h2').first();

test('Back and Forward return to previously selected videos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();

  const titles: string[] = [];
  for (const index of [1, 2]) {
    titles.push((await page.locator(`.ag-row[row-index="${index}"] [col-id="videoTitle"]`).first().innerText()).trim());
    await row(page, index).click();
    await expect(detailTitle(page)).toContainText(titles[titles.length - 1].slice(0, 30));
  }

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(detailTitle(page)).toContainText(titles[0].slice(0, 30));
  await page.getByRole('button', { name: 'Forward', exact: true }).click();
  await expect(detailTitle(page)).toContainText(titles[1].slice(0, 30));
});
