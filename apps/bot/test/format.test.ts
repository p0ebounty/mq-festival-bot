import { describe, it, expect } from 'vitest';
import { toTelegramHtml, looksBalanced, clampForTelegram, prepareMessage } from '../src/bot/format';

const ok = (md: string) => {
  const html = toTelegramHtml(md);
  expect(looksBalanced(html), `несбалансировано: ${html}`).toBe(true);
  return html;
};

describe('markdown → Telegram HTML', () => {
  it('жирный и курсив', () => {
    expect(ok('**важно** и *слегка*')).toBe('<b>важно</b> и <i>слегка</i>');
  });

  it('код не трогается разметкой', () => {
    expect(ok('вот `a * b` код')).toBe('вот <code>a * b</code> код');
  });

  it('блок кода сохраняет переводы строк', () => {
    const html = ok('```\nline1\nline2\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('line1');
    expect(html).toContain('line2');
  });

  it('ссылки', () => {
    expect(ok('[тут](https://a.b/c)')).toBe('<a href="https://a.b/c">тут</a>');
  });

  it('экранирует HTML из текста участника', () => {
    expect(ok('<script>alert(1)</script>')).toContain('&lt;script&gt;');
  });

  it('амперсанд не ломает разметку', () => {
    expect(ok('кот & пёс')).toBe('кот &amp; пёс');
  });

  it('точка в конце не ломает — главная беда MarkdownV2', () => {
    expect(ok('Готово. Держи картинку!')).toBe('Готово. Держи картинку!');
  });

  it('дефисы и скобки тоже не ломают', () => {
    expect(ok('Кот-космонавт (рыжий) — готов!')).toBe('Кот-космонавт (рыжий) — готов!');
  });

  it('маркеры списка становятся точками', () => {
    expect(ok('- раз\n- два')).toBe('• раз\n• два');
  });

  it('заголовок становится жирной строкой', () => {
    expect(ok('## Профессии')).toBe('<b>Профессии</b>');
  });

  it('звёздочка внутри слова не превращается в курсив', () => {
    expect(ok('2*3*4 = 24')).not.toContain('<i>');
  });

  it('цитата', () => {
    expect(ok('> мысль')).toBe('<blockquote>мысль</blockquote>');
  });

  it('эмодзи и кириллица целы', () => {
    expect(ok('Готово! 🚀 Держи 🎨')).toBe('Готово! 🚀 Держи 🎨');
  });

  it('незакрытая разметка не ломает результат', () => {
    const html = toTelegramHtml('**не закрыл');
    expect(looksBalanced(html)).toBe(true);
    expect(html).toContain('не закрыл');
  });

  it('обычный текст проходит без изменений', () => {
    expect(ok('Уже колдую над твоим котом, скоро прилетит!')).toBe(
      'Уже колдую над твоим котом, скоро прилетит!',
    );
  });
});

describe('проверка баланса тегов', () => {
  it('ловит перехлёст', () => {
    expect(looksBalanced('<b><i>x</b></i>')).toBe(false);
  });
  it('ловит незакрытый', () => {
    expect(looksBalanced('<b>x')).toBe(false);
  });
  it('ловит запрещённый тег', () => {
    expect(looksBalanced('<script>x</script>')).toBe(false);
  });
  it('пропускает корректный', () => {
    expect(looksBalanced('<b>x</b> <a href="https://a">y</a>')).toBe(true);
  });
});

describe('подготовка сообщения', () => {
  it('обрезает по лимиту Telegram', () => {
    expect(clampForTelegram('x'.repeat(5000)).length).toBe(4096);
  });
  it('короткое не трогает', () => {
    expect(clampForTelegram('привет')).toBe('привет');
  });
  it('отдаёт и HTML, и запасной простой текст', () => {
    const m = prepareMessage('**жирно**');
    expect(m.html).toBe('<b>жирно</b>');
    expect(m.plain).toBe('**жирно**');
    expect(m.useHtml).toBe(true);
  });
});
