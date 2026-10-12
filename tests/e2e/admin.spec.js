import { expect, logIn, test } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await logIn(page, 'admin@smartshop.test', 'Admin1234');
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('tab', { name: 'Forecasts' })).toHaveAttribute('aria-selected', 'true');
});

test('the forecast dashboard shows risk levels and both charts', async ({ page }) => {
  await expect(page.locator('#kpis .kpi')).toHaveCount(4);
  await expect(page.locator('#forecast-table tbody tr').first()).toBeVisible();
  await expect(page.locator('#forecast-table')).toContainText('High risk of stockout');
  for (const id of ['#risk-canvas', '#detail-canvas']) {
    const box = await page.locator(id).boundingBox();
    expect(box?.width).toBeGreaterThan(100);
  }
  await page.getByRole('button', { name: 'Chart' }).nth(1).click();
  await expect(page.locator('#detail-title')).not.toBeEmpty();
});

test('running the forecast reports progress and finishes', async ({ page }) => {
  await page.getByRole('button', { name: 'Run forecast' }).click();
  await expect(page.locator('#job-status')).toHaveClass(/job-(queued|running)/);
  await expect(page.locator('#job-status')).toHaveClass(/job-done/, { timeout: 45_000 });
  await expect(page.locator('#job-status')).toContainText('Last run');
});

test('an admin adds a product from the inventory tab', async ({ page }) => {
  const name = `Browser Test Lamp ${Date.now()}`;
  await page.getByRole('tab', { name: 'Inventory' }).click();
  await page.getByRole('button', { name: 'Add product' }).click();
  const form = page.locator('dialog');
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('SKU', { exact: true }).fill(`BT-${Date.now()}`);
  await form.getByLabel('Price (€)').fill('24.90');
  await form.getByLabel('Stock', { exact: true }).fill('8');
  await form.getByLabel('Category', { exact: true }).selectOption({ index: 1 });
  await form.getByRole('button', { name: 'Add product' }).click();
  await page.getByLabel('Search inventory').fill(name);
  await expect(page.locator('#inventory-table')).toContainText(name);
  await page.locator('#inventory-table tr', { hasText: name }).getByRole('button', { name: 'Deactivate' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.locator('#inventory-table tr', { hasText: name })).toContainText('Inactive');
});

test('orders are paged and can be shipped', async ({ page }) => {
  await page.getByRole('tab', { name: 'Orders' }).click();
  await expect(page.locator('#orders-table .pager')).toContainText('Page 1 of');
  await page.locator('#order-filter').selectOption('pending');
  const row = page.locator('#orders-table tbody tr').first();
  const id = (await row.locator('td').first().textContent())?.trim();
  await row.getByRole('button', { name: 'Mark shipped' }).click();
  await expect(page.locator('.toast-ok').last()).toContainText(`Order ${id}`);
});
