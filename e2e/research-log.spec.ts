import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');

function row(page: Page, index: number) {
  return page.locator(`.ag-center-cols-container .ag-row[row-index="${index}"] .ag-cell`).first();
}

test('the research log nets out undone exclusions and exports notes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();

  // Exclude two videos, then restore one of them: the log should show one net exclusion.
  await row(page, 0).click();
  await row(page, 1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Exclude', exact: true }).click();
  await expect(page.getByText('showing 59 of 59 rows')).toBeVisible();
  await page.getByRole('button', { name: /^Show excluded videos\. 2 videos\./ }).click();
  await expect(page.getByText('showing 2 of 2 rows')).toBeVisible();
  await row(page, 0).click();
  await expect(page.getByRole('contentinfo')).toContainText('1 selected');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('button', { name: /^Show excluded videos\. 1 videos?\./ })).toBeVisible();

  await page.getByTitle('Research Log').click();
  const log = page.getByRole('dialog', { name: 'Research log' });
  await expect(log).toBeVisible();
  await expect(log.getByText('Excluded 1 video by hand')).toBeVisible();
  await expect(log.getByText(/^Restored/)).toHaveCount(0);
  await expect(log.getByText('2 steps')).toBeVisible();

  // The raw steps are still there on request.
  await log.getByLabel(/Show all steps/).check();
  await expect(log.getByText(/^Restored 1 video/)).toBeVisible();
  await log.getByLabel(/Show all steps/).uncheck();

  // A quick note, then a note attached to the exclusion.
  const noteBox = log.getByRole('textbox', { name: /Write a note/ });
  await noteBox.fill('First pass over the playlist.');
  await noteBox.press('Enter');
  await expect(log.locator('.rlog-item.is-note')).toContainText('First pass over the playlist.');
  await log.getByRole('button', { name: 'Add a note to this step' }).first().click();
  const attach = log.getByRole('textbox', { name: /Why\? Add a note/ });
  await attach.fill('Off-topic upload.');
  await attach.press('Enter');
  await expect(log.locator('.rlog-attached')).toContainText('Off-topic upload.');

  await log.getByRole('button', { name: 'My notes' }).click();
  await expect(log.getByText('Excluded 1 video by hand')).toHaveCount(0);

  await log.getByRole('tab', { name: 'Export' }).click();
  const preview = log.getByLabel('Export preview');
  await expect(preview).toContainText('Excluded 1 video by hand');
  await expect(preview).toContainText('*Note:* Off-topic upload.');
  await expect(preview).toContainText('✎ First pass over the playlist.');
  await expect(preview).toContainText('60 videos** in the corpus, 1 excluded.');
  await expect(preview).not.toContainText('Restored');
});
