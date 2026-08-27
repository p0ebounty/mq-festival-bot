import { describe, it, expect, beforeAll, vi } from 'vitest';

beforeAll(() => {
  const need: Record<string, string> = {
    PUBLIC_URL: 'https://bot-dev.example.com',
    PORT: '3001',
    TELEGRAM_BOT_TOKEN: '1234567890:AAtest-token-for-unit-tests-only',
    TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(32),
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/none',
    SECRETS_ENC_KEY: 'a'.repeat(64),
    MEDIA_ROOT: '/tmp/mqbot-test-media',
  };
  for (const [k, v] of Object.entries(need)) process.env[k] ??= v;
});

/**
 * `allowed_updates` — тихая ловушка: список не только разрешает типы
 * апдейтов, но и ОТСЕКАЕТ все остальные. Пока там был один `message`,
 * Telegram не присылал нажатия кнопок вообще, и кнопка «Скачать и
 * поделиться» была мёртвой без единой ошибки в логах.
 */
describe('установка вебхука', () => {
  it('разрешает и сообщения, и нажатия кнопок', async () => {
    const setWebhook = vi.fn().mockResolvedValue(true);
    const bot = { api: { setWebhook, getMe: async () => ({ username: 'test_bot' }) } };
    const log = { info: vi.fn(), error: vi.fn() };

    const { installWebhook } = await import('../src/routes/telegram.js');
    await installWebhook(bot as never, log as never);

    expect(setWebhook).toHaveBeenCalledTimes(1);
    const opts = setWebhook.mock.calls[0]![1] as { allowed_updates: string[]; secret_token: string };
    expect(opts.allowed_updates).toContain('message');
    expect(opts.allowed_updates).toContain('callback_query');
  });

  it('ставит секретный заголовок и адрес нашего стенда', async () => {
    const setWebhook = vi.fn().mockResolvedValue(true);
    const bot = { api: { setWebhook, getMe: async () => ({ username: 'test_bot' }) } };
    const { installWebhook } = await import('../src/routes/telegram.js');
    await installWebhook(bot as never, { info: vi.fn(), error: vi.fn() } as never);

    const [url, opts] = setWebhook.mock.calls[0] as [string, { secret_token: string }];
    expect(url).toContain('https://bot-dev.example.com/tg/');
    expect(opts.secret_token).toBe('x'.repeat(32));
  });

  it('сбой установки не роняет процесс — стенд поднимется и без вебхука', async () => {
    const bot = { api: { setWebhook: vi.fn().mockRejectedValue(new Error('нет сети')) } };
    const log = { info: vi.fn(), error: vi.fn() };
    const { installWebhook } = await import('../src/routes/telegram.js');
    await expect(installWebhook(bot as never, log as never)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });
});
