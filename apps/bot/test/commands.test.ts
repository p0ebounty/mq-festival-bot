import { describe, it, expect } from 'vitest';
import { greetingText, helpText, balanceText, plural, START_CHIPS } from '../src/bot/commands.js';

describe('приветствие на /start', () => {
  it('здоровается — именно с этого начиналась жалоба с прода', () => {
    const t = greetingText('Артём', { balance: 10, costPerImage: 1 });
    expect(t.startsWith('Привет, Артём!')).toBe(true);
  });

  it('без имени всё равно здоровается', () => {
    expect(greetingText(null, { balance: 10, costPerImage: 1 })).toMatch(/^Привет! /);
  });

  it('показывает возможности примерами, а не закрытым списком', () => {
    // Раньше было «Умею три вещи:» с тремя буллитами. Список читался как
    // меню и занижал возможности: генератор с фотографией умеет заметно
    // больше, а участник не просил того, чего у бота «нет».
    const t = greetingText('Аня', { balance: 10, costPerImage: 1 });
    expect(t).not.toContain('три вещи');
    expect(t).not.toMatch(/^- /m);
    expect(t).toContain('готовый мир');
    expect(t).toContain('с нуля');
    expect(t).toContain('это только примеры'.replace('э', 'Э'));
  });

  it('считает баланс в картинках, а не в токенах', () => {
    expect(greetingText('Аня', { balance: 10, costPerImage: 1 })).toContain('хватит на 10 картинок');
    expect(greetingText('Аня', { balance: 6, costPerImage: 3 })).toContain('хватит на 2 картинки');
    expect(greetingText('Аня', { balance: 3, costPerImage: 3 })).toContain('хватит на 1 картинку');
  });

  it('при пустом балансе зовёт за бонусом, а не бросает в тупике', () => {
    const t = greetingText('Аня', { balance: 0, costPerImage: 1 });
    expect(t).toContain('репост');
    expect(t).not.toContain('хватит на');
  });

  it('без данных о балансе строку о токенах опускает целиком', () => {
    const t = greetingText('Аня', null);
    expect(t).not.toMatch(/токен/i);
    expect(t).toContain('Пиши обычным текстом');
  });

  it('кнопок ровно две и обе ведут к действию', () => {
    expect(START_CHIPS).toHaveLength(2);
    for (const c of START_CHIPS) expect(c.length).toBeLessThanOrEqual(30);
  });
});

describe('склонение после числа', () => {
  it.each([
    [1, 'картинку'], [2, 'картинки'], [4, 'картинки'], [5, 'картинок'],
    [11, 'картинок'], [12, 'картинок'], [14, 'картинок'], [21, 'картинку'],
    [22, 'картинки'], [25, 'картинок'], [111, 'картинок'], [101, 'картинку'],
    [0, 'картинок'],
  ])('%i → %s', (n, want) => {
    expect(plural(n, 'картинку', 'картинки', 'картинок')).toBe(want);
  });
});

/**
 * /help и /balance тоже отвечают заготовкой: ответ на них известен заранее,
 * и гонять ради него модель — это девять секунд ожидания и деньги за токены.
 */
describe('/help', () => {
  it('описывает возможности примерами и честно говорит, что список открыт', () => {
    const t = helpText(1, 3);
    expect(t).toContain('готовый мир');
    expect(t).toContain('с нуля');
    expect(t).toContain('Список открытый');
    expect(t).not.toMatch(/^- /m);   // буллиты читались как меню
  });

  it('говорит, что мир бесплатный — иначе за него боятся платить', () => {
    expect(helpText(1, 3)).toContain('бесплатно');
  });

  it('склоняет цену и бонус', () => {
    expect(helpText(1, 3)).toContain('стоит 1 токен.');
    expect(helpText(2, 5)).toContain('стоит 2 токена.');
    expect(helpText(5, 21)).toContain('ещё 21 токен.');
  });

  it('зовёт словами, а не кнопками — бот не меню', () => {
    expect(helpText(1, 3)).toContain('Говори обычным языком');
  });
});

describe('/balance', () => {
  it('переводит токены в картинки', () => {
    expect(balanceText(10, 1, 3)).toContain('это ещё 10 картинок');
    expect(balanceText(6, 3, 3)).toContain('это ещё 2 картинки');
    expect(balanceText(3, 3, 3)).toContain('это ещё 1 картинка');
  });

  it('на нуле не молчит про выход, а зовёт за бонусом', () => {
    const t = balanceText(0, 1, 3);
    expect(t).toContain('Токены кончились');
    expect(t).toContain('ссылку на пост');
    expect(t).not.toContain('это ещё');
  });

  it('объясняет, за что НЕ списывают — про это и спрашивают', () => {
    const t = balanceText(10, 1, 3);
    expect(t).toContain('Готовый мир бесплатный');
    expect(t).toContain('возвращается');
  });

  it('перечисляет сети, куда можно публиковать', () => {
    for (const net of ['Telegram', 'VK', 'Одноклассники', 'X', 'Instagram']) {
      expect(balanceText(10, 1, 3), net).toContain(net);
    }
  });
});

describe('задания названы там, где участник о них узнаёт', () => {
  /**
   * Живой случай 31.08: участник спросил «а что ты умеешь» и услышал про
   * профессии, миры и рисунок с нуля — про задания ни слова. Возможность,
   * о которой не рассказали, для участника не существует: он не попросит
   * того, чего, как ему кажется, у бота нет.
   */
  it('приветствие называет задания', () => {
    expect(greetingText('Артём', { balance: 10, costPerImage: 1 })).toContain('задание');
  });

  it('/help называет задания', () => {
    expect(helpText(1, 3)).toContain('задание');
  });
});
