import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');
const TOTAL_ROWS = 61;

async function importFixture(page: Page) {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText(`showing ${TOTAL_ROWS} of ${TOTAL_ROWS} rows`)).toBeVisible();
}

function row(page: Page, index: number) {
  return page.locator(`.ag-center-cols-container .ag-row[row-index="${index}"] .ag-cell`).first();
}

function excludedButton(page: Page, count: number) {
  return page.getByRole('button', { name: new RegExp(`^Show excluded videos\\. ${count} videos\\.`) });
}

async function expectExcludedCount(page: Page, count: number) {
  await expect(excludedButton(page, count)).toBeVisible();
  const remaining = TOTAL_ROWS - count;
  await expect(page.getByText(`showing ${remaining} of ${remaining} rows`)).toBeVisible();
}

/**
 * Selects the first row and presses `key`, then waits for the grid to replace that row. AG Grid applies
 * new row data slightly after React commits, so an immediate click could still hit the removed row.
 */
async function pressOnFirstRow(page: Page, key: string, expectedExcluded: number) {
  const firstTitle = await row(page, 0).innerText();
  await row(page, 0).click();
  // AG Grid delivers cell clicks asynchronously; wait until the app has registered the selection.
  await expect(page.getByRole('contentinfo')).toContainText('1 selected');
  await page.keyboard.press(key);
  await expectExcludedCount(page, expectedExcluded);
  await expect(row(page, 0)).not.toHaveText(firstTitle);
}

test.beforeEach(async ({ page }) => {
  await importFixture(page);
});

test('batch Exclude button moves the selected rows to Excluded', async ({ page }) => {
  await row(page, 0).click();
  await row(page, 1).click({ modifiers: ['Shift'] });
  await expect(page.getByText('2 videos selected')).toBeVisible();

  await page.getByRole('button', { name: 'Exclude', exact: true }).click();

  await expect(excludedButton(page, 2)).toBeVisible();
  await expect(page.getByText(`showing ${TOTAL_ROWS - 2} of ${TOTAL_ROWS - 2} rows`)).toBeVisible();
});

test('Delete and Backspace both move the selection', async ({ page }) => {
  await pressOnFirstRow(page, 'Delete', 1);
  await pressOnFirstRow(page, 'Backspace', 2);
});

test('Excluded view restores with the batch button, and undo reverts it', async ({ page }) => {
  await row(page, 0).click();
  await row(page, 2).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Exclude', exact: true }).click();
  await expectExcludedCount(page, 3);

  await excludedButton(page, 3).click();
  await expect(page.getByText('showing 3 of 3 rows')).toBeVisible();
  await row(page, 0).click();
  await row(page, 1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(excludedButton(page, 1)).toBeVisible();

  await page.keyboard.press('ControlOrMeta+z');
  await expect(excludedButton(page, 3)).toBeVisible();
});

test('undo only reverses videos the action actually changed', async ({ page }) => {
  await pressOnFirstRow(page, 'Delete', 1);

  // Exclude the new first row, then undo: the earlier exclusion must stay.
  await pressOnFirstRow(page, 'Delete', 2);
  await page.keyboard.press('ControlOrMeta+z');
  await expectExcludedCount(page, 1);
});
