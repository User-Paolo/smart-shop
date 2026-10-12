import { test as base, expect } from '@playwright/test';

// Fails the test on any script error or console error, except HTTP errors the app handles itself
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
    });
    await use(page);
    expect(errors, 'browser errors').toEqual([]);
  },
});

export { expect };

export async function logIn(page, email, password) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.locator('dialog').getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}
