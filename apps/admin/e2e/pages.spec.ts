import { test, expect, type Page } from '@playwright/test';

/**
 * Нативных `<select>` быть не должно.
 *
 * Считаем только те, что видит и трогает человек: Radix рядом со своим
 * Select рендерит служебный `<select aria-hidden tabindex="-1">`, обрезанный
 * в точку, — он нужен автозаполнению браузера и выпадашку показать не может.
 * Требование заказчика про интерфейс, а не про разметку.
 */
async function visibleNativeSelects(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('select').evaluateAll((els) =>
    els.filter((el) => {
      if (el.getAttribute('aria-hidden') === 'true') return false;
      if (el.getAttribute('tabindex') === '-1') return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    }).length);
}


/**
 * Страницы админки на ЖИВОМ стенде.
 *
 * Проверяем не разметку, а требования заказчика: страница открывается,
 * не сыпет ошибками в консоль, работает в обеих темах и нигде не
 * использует нативных элементов браузера.
 */
const LOGIN = process.env.E2E_ADMIN_LOGIN ?? 'e2e';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

const PAGES = [
  { path: '/', title: 'Дашборд', nav: 'Дашборд' },
  { path: '/users', title: 'Участники', nav: 'Участники' },
  { path: '/dialogs', title: 'Диалоги', nav: 'Диалоги' },
  { path: '/generations', title: 'Генерации', nav: 'Генерации' },
  { path: '/claims', title: 'Начисления за репосты', nav: 'Репосты' },
  { path: '/audit', title: 'Аудит', nav: 'Аудит' },
  { path: '/settings', title: 'Настройки', nav: 'Настройки' },
];

test.describe('страницы админки', () => {
  test.skip(!PASSWORD, 'E2E_ADMIN_PASSWORD не задан');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Логин').fill(LOGIN);
    await page.getByLabel('Пароль').fill(PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  function watchConsole(page: Page): string[] {
    const errors: string[] = [];
    page.on('console', (m) => {
      // Битые картинки на dev-стенде — не ошибка страницы: часть медиа
      // могла быть удалена ретеншном.
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    return errors;
  }

  for (const p of PAGES) {
    test(`${p.title}: открывается и не сыпет ошибками`, async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(p.path);
      await expect(page.getByRole('heading', { name: p.title, level: 1 })).toBeVisible();
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('навигация ведёт по всем разделам', async ({ page }) => {
    await page.goto('/');
    for (const p of PAGES.slice(1)) {
      await page.getByRole('navigation').getByRole('link', { name: p.nav, exact: true }).click();
      await expect(page.getByRole('heading', { name: p.title, level: 1 })).toBeVisible();
    }
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`дашборд читается в теме ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const fg = await page.evaluate(() => getComputedStyle(document.body).color);
      expect(bg).not.toBe(fg);
    });
  }

  /**
   * Требование заказчика: никаких нативных элементов браузера.
   * Проверяем на каждой странице, а не только на настройках, — новую
   * страницу легко написать «как привычно» и нарушить правило.
   */
  test('нигде нет нативных select и диалогов', async ({ page }) => {
    await page.addInitScript(() => {
      for (const name of ['alert', 'confirm', 'prompt'] as const) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any)[name] = () => { (window as any).__native = name; };
      }
    });

    for (const p of PAGES) {
      await page.goto(p.path);
      expect(await visibleNativeSelects(page), `<select> на ${p.path}`).toBe(0);
      // У форм обязателен noValidate — иначе всплывашка браузера.
      const forms = await page.locator('form').all();
      for (const f of forms) {
        expect(await f.evaluate((el) => (el as HTMLFormElement).noValidate),
          `noValidate на ${p.path}`).toBe(true);
      }
      expect(await page.evaluate(() => (window as unknown as { __native?: string }).__native),
        `нативный диалог на ${p.path}`).toBeUndefined();
    }
  });

  test('поиск в таблице фильтрует и объясняет пустой результат', async ({ page }) => {
    await page.goto('/users');
    const search = page.getByRole('textbox', { name: /telegram id/i });
    await search.fill('zzzzzzzzнеттакого');
    // Пустой экран без объяснения читается как поломка (30-admin-ui).
    await expect(page.getByText('Ничего не нашлось')).toBeVisible();
    await search.fill('');
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('клик по строке таблицы открывает карточку', async ({ page }) => {
    await page.goto('/dialogs');
    const firstRow = page.getByRole('row').nth(1);
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await expect(page).toHaveURL(/\/dialogs\/[0-9a-f-]{36}$/);
  });

  test('длинный текст обрезается, а не растягивает таблицу', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto('/generations');
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('редактор промпта грузится и знает про историю', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Промпт' }).click();
    await expect(page.getByLabel('Системный промпт агента')).toBeVisible();
    await expect(page.getByText('История версий')).toBeVisible();
    // Пока правок нет — кнопка сохранения неактивна.
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });
});
