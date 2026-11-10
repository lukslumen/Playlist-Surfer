import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');

async function importFixture(page: Page) {
  // Keep the suite offline: thumbnail images fail fast and the tiles fall back to their titles.
  await page.route(/i\.ytimg\.com/, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();
}

const tiles = (page: Page) => page.getByRole('listbox', { name: 'Video thumbnails' }).getByRole('option');
const tile = (page: Page, index: number) => page.locator(`.thumbnail-tile[data-thumbnail-index="${index}"]`);

test.beforeEach(async ({ page }) => {
  await importFixture(page);
  await page.getByRole('button', { name: 'Show videos as thumbnails' }).click();
  await expect(tile(page, 0)).toBeVisible();
});

test('the thumbnail view replaces the table and renders only the tiles in view', async ({ page }) => {
  await expect(page.locator('.ag-root-wrapper')).toBeHidden();
  const rendered = await tiles(page).count();
  expect(rendered).toBeGreaterThan(4);
  expect(rendered).toBeLessThan(61);
  await expect(page.getByRole('contentinfo')).toContainText('showing 61 of 61 rows');
});

test('clicking, shift-clicking and Delete exclude the selected videos, and undo restores them', async ({ page }) => {
  await tile(page, 0).click();
  await expect(page.getByRole('contentinfo')).toContainText('1 selected');
  await tile(page, 2).click({ modifiers: ['Shift'] });
  await expect(page.getByText('3 videos selected')).toBeVisible();

  await page.keyboard.press('Delete');
  await expect(page.getByRole('button', { name: /^Show excluded videos\. 3 videos\./ })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('showing 58 of 58 rows');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('contentinfo')).toContainText('showing 61 of 61 rows');
});

test('arrow keys move the selection through the grid', async ({ page }) => {
  await tile(page, 0).click();
  await page.keyboard.press('ArrowRight');
  await expect(tile(page, 1)).toHaveAttribute('aria-selected', 'true');
  const columns = await page.evaluate(() => {
    const tops = [...document.querySelectorAll<HTMLElement>('.thumbnail-tile')].map((element) => element.getBoundingClientRect().top);
    return tops.filter((top) => top === tops[0]).length;
  });
  await page.keyboard.press('ArrowDown');
  await expect(tile(page, 1 + columns)).toHaveAttribute('aria-selected', 'true');
});

test('the zoom buttons change the number of columns', async ({ page }) => {
  const columnCount = () => page.evaluate(() => {
    const tops = [...document.querySelectorAll<HTMLElement>('.thumbnail-tile')].map((element) => element.getBoundingClientRect().top);
    return tops.filter((top) => top === Math.min(...tops)).length;
  });
  const before = await columnCount();
  await page.getByRole('button', { name: 'Larger thumbnails' }).click();
  await expect.poll(columnCount).toBeLessThan(before);
});

test('the thumbnails follow the table sort order', async ({ page }) => {
  await page.getByRole('button', { name: 'Show videos as a table' }).click();
  const viewsHeader = page.locator('.ag-header-cell[col-id="viewCount"] .ag-header-cell-label');
  await viewsHeader.click();
  await viewsHeader.click();
  await expect(page.locator('.ag-header-cell[col-id="viewCount"]')).toHaveAttribute('aria-sort', 'descending');
  const firstTitle = (await page.locator('.ag-row[row-index="0"] [col-id="videoTitle"]').first().innerText()).trim();

  await page.getByRole('button', { name: 'Show videos as thumbnails' }).click();
  // The view scrolls to the selected video; go back to the top to read the first tile.
  await page.locator('.thumbnail-grid-scroll').evaluate((element) => { element.scrollTop = 0; });
  await expect(tile(page, 0)).toHaveAttribute('aria-label', firstTitle);
});

test('the layout and tile size are kept across a reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Larger thumbnails' }).click();
  const width = await tile(page, 0).evaluate((element) => element.getBoundingClientRect().width);
  // App state is saved when the browser is idle; give it a moment before reloading.
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Show videos as thumbnails' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.thumbnail-tile').first().evaluate((element) => element.getBoundingClientRect().width)).toBe(width);
});

test('the dashboard no longer has a thumbnails tab', async ({ page }) => {
  await page.getByTitle('Dataset Dashboard').click();
  await expect(page.getByRole('tab', { name: 'overview' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'thumbnails' })).toHaveCount(0);
});
