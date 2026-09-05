import { describe, it, expect } from 'vitest';
import { kieFileName } from '../src/bot/media-name.js';

/**
 * Живой случай 05.09: имена загрузок в kie.ai строились из начала Telegram
 * file_id, одинакового у всех фото бота, — и фото разных детей затирали
 * друг друга в хранилище (одинаковые имена там перезаписывают файл).
 */
describe('имя файла в хранилище kie.ai', () => {
  it('разные медиа — разные имена, без усечения id', () => {
    const a = kieFileName('tg', '47edd96c-3995-4bfe-80b8-f60d6a85010a');
    const b = kieFileName('tg', '57529246-be04-4ddd-b521-49bdccb91b9b');
    expect(a).not.toBe(b);
    expect(a).toBe('tg-47edd96c-3995-4bfe-80b8-f60d6a85010a.jpg');
  });

  it('имя не зависит от Telegram file_id', () => {
    // Раньше: `tg-${file_id.slice(0, 16)}` — у всех фото «tg-AgACAgIAAxkBAAIB».
    expect(kieFileName('tg', 'id-1')).not.toContain('AgACAgIAAxkBAAIB');
  });
});
