import { test, expect, type Page } from '@playwright/test';

/**
 * Публичная страница результата — то, что открывается по QR-коду (фаза 7).
 *
 * Проверяем на ЖИВОМ стенде, а не в отрыве: страницу отдаёт Fastify, а
 * маршрут `/g/*` до него доводит Traefik. Отрендерить HTML в тесте мало —
 * ошибка приоритета роутера отправила бы участника в админку.
 *
 * Короткая ссылка задаётся через E2E_SHORT_ID; без неё тест пропускается,
 * чтобы прогон не падал на чистой базе.
 */
const SHORT_ID = process.env.E2E_SHORT_ID;

test.describe('страница результата по QR', () => {
  test.skip(!SHORT_ID, 'E2E_SHORT_ID не задан');

  const url = () => `/g/${SHORT_ID}`;

  /** Собираем ошибки консоли: пустая страница без ошибок — тоже провал. */
  function watchConsole(page: Page): string[] {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    return errors;
  }

  test('открывается, показывает картинку и хештеги', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(url());

    const shot = page.locator('img.shot');
    await expect(shot).toBeVisible();
    // Картинка должна реально загрузиться, а не остаться битой иконкой.
    await expect.poll(() => shot.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);

    await expect(page.getByRole('link', { name: 'Скачать картинку' })).toBeVisible();
    await expect(page.locator('#tags')).not.toBeEmpty();
    await expect(page.locator('.qr svg')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('помещается в телефон и не едет вбок', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(url());
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`читается в теме ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url());
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const ink = await page.evaluate(() => getComputedStyle(document.body).color);
      expect(bg).not.toBe(ink);
      // В тёмной теме фон обязан быть тёмным — иначе тема просто не применилась.
      const lum = (c: string) => (c.match(/\d+/g) ?? ['255']).slice(0, 3)
        .reduce((a, v) => a + Number(v), 0) / 3;
      expect(scheme === 'dark' ? lum(bg) < 90 : lum(bg) > 200).toBe(true);
    });
  }

  test('копирование хештегов работает своим тостом, без alert', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const nativeCalled: string[] = [];
    await page.addInitScript(() => {
      for (const name of ['alert', 'confirm', 'prompt'] as const) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any)[name] = () => { (window as any).__native = name; };
      }
    });
    await page.goto(url());
    await page.getByRole('button', { name: 'Скопировать хештеги' }).click();
    await expect(page.locator('#toast')).toHaveClass(/on/);
    expect(await page.evaluate(() => (window as unknown as { __native?: string }).__native))
      .toBeUndefined();
    expect(nativeCalled).toEqual([]);
  });

  test('скачивание отдаёт файл, а не открывает картинку', async ({ page }) => {
    await page.goto(url());
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Скачать картинку' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^mqbot-.+\.(jpg|png)$/);
  });

  test('несуществующая ссылка — человеческая страница, а не голый 404', async ({ page }) => {
    const res = await page.goto('/g/zzzzzzzz');
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Такой ссылки нет')).toBeVisible();
  });
});
