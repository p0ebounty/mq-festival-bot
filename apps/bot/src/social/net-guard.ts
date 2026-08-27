import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Проверка, что адрес ведёт наружу, а не внутрь нашего сервера.
 *
 * Пока список площадок был закрытым, этого не требовалось: пять доменов
 * никуда, кроме себя, не резолвятся. Открыв проверку для любых сайтов, мы
 * получили классический SSRF: участник присылает ссылку — headless-браузер
 * открывает её **у нас на машине**, и `http://127.0.0.1:4002` читает
 * админку, а `http://169.254.169.254` — метаданные облака.
 *
 * Одной проверки строки мало: `localtest.me` выглядит обычным доменом и
 * резолвится в 127.0.0.1. Поэтому смотрим на РЕЗУЛЬТАТ резолва, а не на имя,
 * и перепроверяем после каждого редиректа: публичный хост вправе увести
 * на внутренний.
 */

/** Диапазоны, которых в интернете быть не может. */
function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;             // this-network, private, loopback
  if (a === 169 && b === 254) return true;                       // link-local, метаданные облаков
  if (a === 172 && b >= 16 && b <= 31) return true;              // private
  if (a === 192 && b === 168) return true;                       // private
  if (a === 192 && b === 0) return true;                         // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true;             // CGNAT
  if (a >= 224) return true;                                     // multicast и выше
  return false;
}

function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (s === '::' || s === '::1') return true;                    // unspecified, loopback
  if (s.startsWith('fe80')) return true;                         // link-local
  if (/^f[cd]/.test(s)) return true;                             // unique local
  // ::ffff:127.0.0.1 — v4 внутри v6, разбираем как v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return isPrivateV4(mapped[1]!);
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true;   // не адрес — считаем небезопасным
}

/**
 * Резолвит хост и говорит, ведёт ли он наружу.
 *
 * `all: true` обязательно: хост может отдавать несколько адресов, и хватит
 * одного внутреннего, чтобы браузер ушёл туда.
 */
export async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0) return false;
    return addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;   // не резолвится — идти туда незачем
  }
}

/** То же для целой ссылки. Ошибку разбора считаем небезопасной. */
export async function isPublicUrl(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return await isPublicHost(u.hostname);
  } catch {
    return false;
  }
}
