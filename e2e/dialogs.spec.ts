import path from 'node:path';
import { expect, test } from './test';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'playlist61.csv');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('input[type=file]').setInputFiles(FIXTURE);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByText('showing 61 of 61 rows')).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
});

// Each dialog opens from its shortcut and closes with Esc (guards the per-dialog file split).
const cases: Array<{ name: string; keys: string; visible: (page: import('@playwright/test').Page) => import('@playwright/test').Locator }> = [
  { name: 'command palette', keys: 'ControlOrMeta+k', visible: (page) => page.getByPlaceholder('Type a command…') },
  { name: 'export', keys: 'Alt+Shift+KeyE', visible: (page) => page.getByRole('heading', { name: 'Export Project' }) },
  { name: 'edit view', keys: 'Alt+Shift+KeyV', visible: (page) => page.getByText('Edit view', { exact: true }) },
  { name: 'keyboard help', keys: 'Alt+Shift+KeyK', visible: (page) => page.getByRole('heading', { name: 'Keyboard shortcuts' }) },
];

for (const dialog of cases) {
  test(`${dialog.name} opens and closes`, async ({ page }) => {
    await page.keyboard.press(dialog.keys);
    await expect(dialog.visible(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog.visible(page)).toBeHidden();
  });
}

test('overview dashboard opens', async ({ page }) => {
  await page.keyboard.press('Alt+Shift+KeyO');
  const prompt = page.getByText('Generate a dashboard for the whole dataset');
  await expect(prompt).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(prompt).toBeHidden();
});
