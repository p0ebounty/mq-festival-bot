import { test, expect, type Page } from '@playwright/test';

/**
 * Страховка от нарушения требования заказчика:
 * никаких браузерных выпадающих списков, подтверждений и валидаций.
 * См. .claude/rules/30-admin-ui.md
 */
const LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

async function assertNoNativeUi(page: Page, label: string) {
  // 1. нативных <select> быть не должно — только кастомный Select
  const selects = await page.locator('select').count();
  expect(selects, `${label}: найден нативный <select>`).toBe(0);

  // 2. каждая форма отключает браузерную валидацию
  const forms = page.locator('form');
  for (let i = 0; i < (await forms.count()); i++) {
    const nv = await forms.nth(i).evaluate((f) => (f as HTMLFormElement).noValidate);
    expect(nv, `${label}: форма #${i} без noValidate`).toBe(true);
  }

  // 3. type=number даёт нативные стрелки и валидацию — запрещён
  expect(await page.locator('input[type="number"]').count(),
    `${label}: найден input[type=number]`).toBe(0);

  // 4. title="" рисует нативный тултип — используем компонент Tooltip
  expect(await page.locator('[title]:not([title=""])').count(),
    `${label}: найден нативный tooltip через title`).toBe(0);
}

test('на /login нет нативных элементов', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => { dialogs.push(d.type()); void d.dismiss(); });

  await page.goto('/login');
  await page.getByRole('button', { name: 'Войти' }).click();
  await assertNoNativeUi(page, '/login');
  expect(dialogs, 'вызван нативный alert/confirm/prompt').toEqual([]);
});

test('на /settings нет нативных элементов', async ({ page }) => {
  test.skip(!PASSWORD, 'E2E_ADMIN_PASSWORD не задан');
  const dialogs: string[] = [];
  page.on('dialog', (d) => { dialogs.push(d.type()); void d.dismiss(); });

  await page.goto('/login');
  await page.getByLabel('Логин').fill(LOGIN);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await assertNoNativeUi(page, '/settings');

  // Выход — кастомный AlertDialog, а не window.confirm
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  expect(dialogs, 'вызван нативный confirm').toEqual([]);
});
