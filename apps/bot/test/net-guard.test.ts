import { describe, it, expect } from 'vitest';
import { isPrivateAddress, isPublicHost, isPublicUrl } from '../src/social/net-guard.js';

/**
 * Открытый список площадок сделал эти проверки обязательными: ссылку,
 * которую прислал участник, открывает headless-браузер НА НАШЕМ сервере.
 */
describe('адрес ведёт наружу или внутрь', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1',
  ])('%s — внутренний', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1',
    '2606:4700:4700::1111',
  ])('%s — внешний', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it('не адрес — считаем небезопасным, а не «наверное можно»', () => {
    expect(isPrivateAddress('не адрес')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });

  it('localhost по имени тоже отсекается', async () => {
    expect(await isPublicHost('localhost')).toBe(false);
  });

  it('несуществующий домен не пускаем: идти туда незачем', async () => {
    expect(await isPublicHost('этого-домена-точно-нет-12345.invalid')).toBe(false);
  });

  it('обычный домен пускаем', async () => {
    expect(await isPublicHost('example.com')).toBe(true);
  });

  it('не-http отсекается до всякого резолва', async () => {
    expect(await isPublicUrl('file:///etc/passwd')).toBe(false);
    expect(await isPublicUrl('ftp://example.com/x')).toBe(false);
    expect(await isPublicUrl('не ссылка')).toBe(false);
  });

  it('ссылка на свой же порт не проходит', async () => {
    expect(await isPublicUrl('http://127.0.0.1:4002/')).toBe(false);
    expect(await isPublicUrl('http://[::1]:4001/healthz')).toBe(false);
  });
});
