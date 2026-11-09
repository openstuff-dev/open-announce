import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { admin, baseURL } from '../playwright.config';

const unique = (name: string): string => `${name} ${Date.now()}-${test.info().parallelIndex}-${randomUUID().slice(0, 4)}`;

/** Calls the API as the signed-in page, from the app's own origin, as the app does. */
async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post(path, {
    data,
    headers: { origin: baseURL, 'idempotency-key': randomUUID() },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

/** Signs in as the server admin and makes a new tenant, so every test starts empty. */
async function freshTenant(page: Page): Promise<{ slug: string; name: string }> {
  await post(page, '/api/session', admin);
  return post(page, '/api/tenants', { name: unique('Tenant') });
}

const tab = (tenant: string, id: string): string => `/t/${tenant}/settings/${id}`;

/** Records whether a skeleton ever appeared, from before the app starts. */
async function watchForSkeleton(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = (): void => {
      if (document.querySelector('os-skeleton')) (window as unknown as { sawSkeleton: boolean }).sawSkeleton = true;
    };
    new MutationObserver(seen).observe(document, { childList: true, subtree: true });
  });
}

const sawSkeleton = (page: Page): Promise<boolean> =>
  page.evaluate(() => Boolean((window as unknown as { sawSkeleton?: boolean }).sawSkeleton));

test.describe('Every Settings tab says what it is for', () => {
  test('UC-4/S1 each tab explains itself', async ({ page }) => {
    const tenant = await freshTenant(page);
    await page.goto(tab(tenant.slug, 'account'));
    const links = page.getByRole('navigation', { name: 'Settings' }).getByRole('link');
    await expect(links.first()).toBeVisible();
    const hrefs = await links.evaluateAll((all) => all.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length).toBeGreaterThanOrEqual(6);
    for (const href of hrefs) {
      await page.goto(href);
      const explainer = page.locator('header[os-section-header] p').first();
      await expect(explainer, href).toBeVisible();
      expect((await explainer.innerText()).split(' ').length, href).toBeGreaterThan(5);
    }
  });

  test('UC-4/S2 the only member is asked to add a developer', async ({ page }) => {
    const tenant = await freshTenant(page);
    await page.goto(tab(tenant.slug, 'members'));
    const empty = page.locator('os-empty-state');
    await expect(empty).toContainText('Add a developer to set up your systems');
    await empty.getByRole('button', { name: 'Add a developer' }).click();
    await expect(page.getByLabel('Email')).toBeFocused();
  });

  test('UC-4/S3 no system can post here yet links to Systems', async ({ page }) => {
    const tenant = await freshTenant(page);
    const system = await post<{ id: string }>(page, `/api/t/${tenant.slug}/systems`, { name: 'Portal' });
    await page.goto(tab(tenant.slug, 'integrations'));
    await expect(page.getByText('A system with a publish key can post News here')).toBeVisible();
    await expect(page.locator('os-empty-state', { hasText: 'No system can post here yet' })).toBeVisible();

    await post(page, `/api/t/${tenant.slug}/systems/${system.id}/publish-key`, {});
    await page.reload();
    await expect(page.getByText('This system has a publish key: Portal.')).toBeVisible();

    await page.getByRole('link', { name: 'Open Systems' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/systems$`));
  });

  test('UC-4/S4 a slow tab shows a placeholder, a fast one does not flash', async ({ page }) => {
    const tenant = await freshTenant(page);
    await watchForSkeleton(page);

    await page.goto(tab(tenant.slug, 'members'));
    await expect(page.locator('os-empty-state')).toBeVisible();
    expect(await sawSkeleton(page)).toBe(false);

    await page.route('**/api/t/*/members', async (route) => {
      await new Promise((done) => setTimeout(done, 1500));
      await route.continue();
    });
    await page.reload();
    await expect(page.locator('os-skeleton')).toBeVisible();
    await expect(page.locator('os-empty-state')).toBeVisible();
    await expect(page.locator('os-skeleton')).toBeHidden();
  });

  test('UC-4/S5 a tab that cannot load says what failed', async ({ page }) => {
    const tenant = await freshTenant(page);
    await page.route('**/api/t/*/{members,systems}', (route) =>
      route.fulfill({ status: 503, json: { error: 'The server is down for a moment.' } }),
    );
    await page.goto(tab(tenant.slug, 'members'));
    await expect(page.locator('os-callout[tone=danger]')).toContainText('The members didn’t load');
    await page.goto(tab(tenant.slug, 'integrations'));
    await expect(page.locator('os-callout[tone=danger]')).toContainText('The systems didn’t load');
  });

  test('UC-4/S6 removing a member or deleting a tenant says what stops and what stays', async ({ page }) => {
    const tenant = await freshTenant(page);
    await post(page, `/api/t/${tenant.slug}/members`, {
      email: `${randomUUID()}@e2e.test`,
      name: 'Dana Developer',
      role: 'developer',
    });
    const dialog = page.locator('os-confirm-dialog dialog');

    await page.goto(tab(tenant.slug, 'members'));
    await page.getByRole('row', { name: /Dana Developer/ }).getByRole('button', { name: 'Remove' }).click();
    await expect(dialog).toContainText('lose access');
    await expect(dialog).toContainText('Their account stays');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.goto(tab(tenant.slug, 'tenants'));
    await page.getByRole('button', { name: `Delete ${tenant.name}` }).click();
    await expect(dialog).toContainText('stop showing messages');
    await expect(dialog).toContainText('Member accounts stay');
    await dialog.getByRole('button', { name: 'Delete tenant' }).click();
    await expect(page).toHaveURL(/\/settings\/tenants$/);
    await expect(page.getByRole('link', { name: tenant.name })).toHaveCount(0);
  });
});
