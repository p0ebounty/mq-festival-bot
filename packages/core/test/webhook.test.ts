import { describe, it, expect } from 'vitest';
import { signWebhook, verifyWebhook, callbackTaskId } from '../src/kie/webhook';

const SECRET = 'whsec_test_key';
const TASK = 'task_abc123';
const NOW = 1_800_000_000;

describe('подпись callback kie.ai', () => {
  it('корректная подпись принимается', () => {
    const sig = signWebhook(TASK, NOW, SECRET);
    expect(verifyWebhook({ taskId: TASK, signature: sig, timestamp: String(NOW), secret: SECRET, nowSec: NOW }))
      .toEqual({ ok: true });
  });

  it('чужой секрет отвергается', () => {
    const sig = signWebhook(TASK, NOW, 'другой');
    expect(verifyWebhook({ taskId: TASK, signature: sig, timestamp: String(NOW), secret: SECRET, nowSec: NOW }))
      .toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('подпись от другого taskId не подходит', () => {
    const sig = signWebhook('task_other', NOW, SECRET);
    expect(verifyWebhook({ taskId: TASK, signature: sig, timestamp: String(NOW), secret: SECRET, nowSec: NOW }).ok)
      .toBe(false);
  });

  it('старая подпись отбивается как replay', () => {
    const sig = signWebhook(TASK, NOW - 3600, SECRET);
    expect(verifyWebhook({ taskId: TASK, signature: sig, timestamp: String(NOW - 3600), secret: SECRET, nowSec: NOW }))
      .toEqual({ ok: false, reason: 'stale' });
  });

  it('подпись из будущего тоже отбивается', () => {
    const ts = NOW + 3600;
    const sig = signWebhook(TASK, ts, SECRET);
    expect(verifyWebhook({ taskId: TASK, signature: sig, timestamp: String(ts), secret: SECRET, nowSec: NOW }).reason)
      .toBe('stale');
  });

  it('отсутствующие заголовки дают понятную причину', () => {
    const base = { taskId: TASK, secret: SECRET, nowSec: NOW };
    expect(verifyWebhook({ ...base, signature: null, timestamp: String(NOW) }).reason).toBe('no-signature');
    expect(verifyWebhook({ ...base, signature: 'x', timestamp: null }).reason).toBe('no-timestamp');
    expect(verifyWebhook({ ...base, taskId: undefined, signature: 'x', timestamp: String(NOW) }).reason).toBe('no-task-id');
  });

  it('подпись другой длины не роняет timingSafeEqual', () => {
    expect(() => verifyWebhook({
      taskId: TASK, signature: 'коротко', timestamp: String(NOW), secret: SECRET, nowSec: NOW,
    })).not.toThrow();
  });

  it('taskId читается и в snake_case, и в camelCase', () => {
    expect(callbackTaskId({ data: { task_id: 'a' } })).toBe('a');
    expect(callbackTaskId({ data: { taskId: 'b' } })).toBe('b');
    expect(callbackTaskId(null)).toBeUndefined();
  });
});
