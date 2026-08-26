import { test, expect } from '@playwright/test';

const LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'admin';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

test.describe('вход в админку', () => {
  test('неавторизованного редиректит на /login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('пустая форма показывает СВОИ ошибки, а не браузерные', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Войти' }).click();

    // Наши сообщения из zod отрисованы в DOM
    await expect(page.getByText('Введите логин')).toBeVisible();
    await expect(page.getByText('Введите пароль')).toBeVisible();

    // Браузер НЕ должен вмешиваться: у формы обязан стоять noValidate
    const noValidate = await page.locator('form').first().evaluate((f) => (f as HTMLFormElement).noValidate);
    expect(noValidate).toBe(true);
  });

  test('неверный пароль показывает ошибку без перезагрузки', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Логин').fill('admin');
    await page.getByLabel('Пароль').fill('заведомо-неверный');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('верный пароль пускает в настройки', async ({ page }) => {
    test.skip(!PASSWORD, 'E2E_ADMIN_PASSWORD не задан');
    await page.goto('/login');
    await page.getByLabel('Логин').fill(LOGIN);
    await page.getByLabel('Пароль').fill(PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible();
  });
});
