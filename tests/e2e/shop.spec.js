import { expect, test } from './fixtures.js';

test('a new customer signs up, searches, buys and sees the order', async ({ page }) => {
  const email = `shopper.${Date.now()}.${Math.floor(Math.random() * 1e6)}@test.local`;
  await page.goto('/');
  await expect(page.locator('.product-card:not(.skeleton)').first()).toBeVisible();

  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.getByLabel('Full name').fill('Maria Test');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('lettersonly');
  await page.getByLabel('Confirm password').fill('lettersonly');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('.field-error')).toContainText('letter and one number');

  await page.getByLabel('Password', { exact: true }).fill('Passw0rd1');
  await page.getByLabel('Confirm password').fill('Passw0rd1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

  await page.getByLabel('Search products').fill('mug');
  await expect(page.locator('.product-card')).toHaveCount(1);
  const card = page.locator('.product-card').first();
  await expect(card).toContainText('Ceramic Coffee Mug Set');
  await card.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.locator('#cart-count')).toHaveText('1');

  await page.getByRole('button', { name: 'Open cart' }).click();
  await page.getByRole('button', { name: /Checkout/ }).click();
  await expect(page.locator('.toast-ok').last()).toContainText('placed');

  await page.getByRole('button', { name: 'My orders' }).click();
  await expect(page.locator('dialog .table tbody tr')).toHaveCount(1);
  await expect(page.locator('dialog .badge')).toHaveText('Pending');
});

test('filters and paging update the catalogue without reloading', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.product-card:not(.skeleton)')).toHaveCount(12);
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(page.locator('#pager')).toContainText('Page 2 of');
  await page.getByLabel('Maximum price').fill('20');
  await page.getByLabel('Maximum price').blur();
  await expect(page.locator('#result-count')).not.toContainText(/^1[5-9] /);
  for (const price of await page.locator('.price').allTextContents()) {
    expect(Number.parseFloat(price.replace(/[^\d,]/g, '').replace(',', '.'))).toBeLessThanOrEqual(20);
  }
});
