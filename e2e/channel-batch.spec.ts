import fs from 'node:fs';
import { expect, test } from './test';

test('selecting several channels tags them and excludes all their videos', async ({ page }, testInfo) => {
  const csv = testInfo.outputPath('two-channels.csv');
  fs.writeFileSync(csv, [
    'videoId,videoTitle,channelId,channelTitle,viewCount',
    'v1,First A,UCa,Channel A,10',
    'v2,Second A,UCa,Channel A,20',
    'v3,First B,UCb,Channel B,30',
  ].join('\n'));
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(csv);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 3 of 3 rows')).toBeVisible();

  await page.getByTitle('Show generated channel metadata table').click();
  await page.getByRole('button', { name: 'Generate channel metadata' }).first().click();
  await expect(page.getByRole('contentinfo')).toContainText('Channels: showing 2 of 2 rows', { timeout: 30_000 });

  // The first cell holds a channel-name button that navigates; select via the channel ID cell.
  const cell = (index: number) => page.locator(`.ag-center-cols-container .ag-row[row-index="${index}"] .ag-cell`).nth(1);
  await cell(0).click();
  await cell(1).click({ modifiers: ['Shift'] });
  await expect(page.getByText('2 channels selected')).toBeVisible();

  await page.getByPlaceholder('Add tag to selected channels').fill('reviewed');
  await page.getByPlaceholder('Add tag to selected channels').press('Enter');
  await expect(page.getByText('Shared tags across selection').locator('..').getByText('reviewed')).toBeVisible();

  await page.getByRole('button', { name: 'Exclude', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Show excluded videos\. 3 videos\./ })).toBeVisible();
});
