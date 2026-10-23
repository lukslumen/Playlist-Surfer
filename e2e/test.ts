import { expect, test as base } from '@playwright/test';

/**
 * The Playwright `test` with one addition: any uncaught error in the page fails the test, so a crash
 * in a handler (like the exclude ReferenceError this suite was started for) can't pass silently.
 */
export const test = base.extend<{ failOnPageError: void }>({
  failOnPageError: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use();
    expect(errors, 'uncaught errors in the page').toEqual([]);
  }, { auto: true }],
});

export { expect };
