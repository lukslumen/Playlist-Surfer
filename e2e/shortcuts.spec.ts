import { expect, test } from './test';

test('keyboard help opens with Alt+Shift+K, lists the shortcuts and closes with Esc', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 45_000 });
  await page.locator('body').click();
  await page.keyboard.press('Alt+Shift+KeyK');
  const dialog = page.getByRole('heading', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(page.getByText('Delete / Backspace')).toBeVisible();
  await expect(page.getByText('Ctrl/Cmd + Shift + Z')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
