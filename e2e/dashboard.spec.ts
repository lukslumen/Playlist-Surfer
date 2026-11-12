import path from 'node:path';
import { expect, test } from './test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');

async function openDashboard(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();
  await page.getByTitle('Dataset Dashboard').click();
  await page.getByRole('button', { name: 'Generate dashboard', exact: true }).click();
  await expect(page.getByText('Uploads per month')).toBeVisible({ timeout: 30_000 });
}

test('every dashboard tab renders its panels', async ({ page }) => {
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

  await page.getByRole('tab', { name: 'Attention' }).click();
  await expect(page.getByRole('region', { name: 'Concentration of attention' })).toContainText('The top 10% of videos get');
  await expect(page.getByRole('region', { name: 'Views vs engagement' })).toContainText('likes and comments per 1,000 views');
  await expect(page.getByRole('region', { name: 'Ranked videos' }).getByRole('row')).toHaveCount(26);

  await page.getByRole('tab', { name: 'Vernacular' }).click();
  await expect(page.getByRole('region', { name: 'Most used hashtags' })).toContainText('#NationalGeographic');
  await expect(page.getByRole('region', { name: 'Tags and hashtags that appear together' })).toContainText('The strongest pair');

  await page.getByRole('tab', { name: 'Time' }).click();
  await expect(page.getByRole('region', { name: 'Publishing rhythm' })).toContainText('Most uploads go out on');
  await expect(page.getByRole('region', { name: 'Channel activity over time' })).toContainText('one channel');

  await page.getByRole('tab', { name: 'Links' }).click();
  await expect(page.getByText('Where should links be read from?')).toBeVisible();
  await expect(page.locator('.dash-choice').first()).toContainText('videoDescription');
});

test('the method popover explains a panel and the menu exports its CSV', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('tab', { name: 'Vernacular' }).click();
  const panel = page.getByRole('region', { name: 'Most used hashtags' });
  await panel.getByRole('button', { name: 'How "Most used hashtags" is calculated' }).click();
  await expect(page.getByRole('dialog', { name: 'Method: Most used hashtags' })).toContainText('Watch out for');
  await page.keyboard.press('Escape');

  await panel.getByRole('button', { name: 'Export "Most used hashtags"' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('most-used-hashtags-whole-dataset.csv');
  const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
  expect(text.split('\n')[0]).toBe('"term","videos","share_of_videos","share_of_views"');
  expect(text).toContain('"#NationalGeographic","54"');

  await page.getByRole('region', { name: 'Tags and hashtags that appear together' }).getByRole('button', { name: /^Export/ }).click();
  const gexf = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download GEXF (Gephi)' }).click();
  expect((await gexf).suggestedFilename()).toBe('cooccurrence-whole-dataset.gexf');
});

test('hiding a term removes it from the vernacular lists', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('tab', { name: 'Vernacular' }).click();
  const panel = page.getByRole('region', { name: 'Most used hashtags' });
  await expect(panel).toContainText('The most common is #NationalGeographic');
  await panel.getByLabel('Term to hide from vernacular lists').fill('#NationalGeographic');
  await panel.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(panel).not.toContainText('The most common is #NationalGeographic', { timeout: 15_000 });
  await expect(panel.getByRole('button', { name: 'Show "#NationalGeographic" again' })).toBeVisible();
});

test('comparing the filtered view with the whole dataset shows over- and under-represented terms', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('button', { name: /^20–60 min/ }).click();
  await expect(page.getByRole('contentinfo')).toContainText('showing 34 of 61 rows');
  await page.getByTitle('Dataset Dashboard').click();
  await page.getByRole('button', { name: 'Generate dashboard', exact: true }).click();
  await expect(page.getByText('Uploads per month')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('combobox', { name: 'Compare with' }).selectOption('full');
  await expect(page.getByText('Comparing filtered view with whole dataset')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('tab', { name: 'Vernacular' }).click();
  const panel = page.getByRole('region', { name: 'Most used hashtags' });
  await expect(panel.getByRole('row', { name: /#MegaEpisode/ })).toContainText('▼');
  await expect(panel.getByRole('row', { name: /#FullEpisode/ })).toContainText('▲');
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

test('a panel saves as PNG and SVG', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('tab', { name: 'Attention' }).click();
  const panel = page.getByRole('region', { name: 'Concentration of attention' });
  for (const [item, extension] of [['Save as PNG', 'png'], ['Save as SVG', 'svg']] as const) {
    await panel.getByRole('button', { name: 'Export "Concentration of attention"' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: item }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`concentration-of-attention-whole-dataset.${extension}`);
    const bytes = Buffer.concat(await (await file.createReadStream()).toArray());
    expect(bytes.length).toBeGreaterThan(1000);
    if (extension === 'png') expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    else expect(bytes.toString('utf8')).toContain('<foreignObject');
  }
});
