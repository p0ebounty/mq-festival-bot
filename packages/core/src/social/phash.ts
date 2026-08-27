import sharp from 'sharp';

/** Сторона рабочей матрицы до DCT. 32 — классика pHash. */
const SIZE = 32;
/** Сколько низких частот берём в хеш: 8×8 = 64 бита = 16 hex-знаков. */
const LOW = 8;

/**
 * Перцептивный хеш картинки (DCT-хеш, 64 бита в hex).
 *
 * Зачем не sha256: соцсети **пережимают** загруженные картинки — меняют
 * качество, размер, иногда добавляют поля. Побайтовое сравнение после этого
 * не совпадёт никогда, а перцептивный хеш смотрит на низкие частоты, то есть
 * на общую структуру кадра, и переживает пережатие.
 *
 * Это то самое «сильное доказательство» из ADR 0007: если на публичной
 * странице лежит картинка с таким же pHash, значит участник опубликовал
 * именно нашу генерацию, а не что-то похожее.
 */
export async function perceptualHash(image: Buffer): Promise<string> {
  const raw = await sharp(image)
    .greyscale()
    // fit: 'fill' — специально без сохранения пропорций: хеш должен
    // совпадать и у обрезанного соцсетью превью, и у оригинала.
    .resize(SIZE, SIZE, { fit: 'fill' })
    .raw()
    .toBuffer();

  const pixels = new Float64Array(SIZE * SIZE);
  for (let i = 0; i < pixels.length; i++) pixels[i] = raw[i] ?? 0;

  const dct = dct2d(pixels, SIZE);

  // Берём левый верхний угол — низкие частоты, — но БЕЗ самого первого
  // коэффициента: он отражает среднюю яркость, и от него хеш поехал бы
  // на любом изменении экспозиции.
  const low: number[] = [];
  for (let y = 0; y < LOW; y++) {
    for (let x = 0; x < LOW; x++) {
      if (x === 0 && y === 0) continue;
      low.push(dct[y * SIZE + x]!);
    }
  }

  const median = medianOf(low);
  // Сравниваем с медианой, а не со средним: одна выбивающаяся частота
  // не должна перевернуть половину битов.
  let bits = '';
  let idx = 0;
  for (let y = 0; y < LOW; y++) {
    for (let x = 0; x < LOW; x++) {
      if (x === 0 && y === 0) { bits += '0'; continue; }
      bits += (low[idx++]! > median ? '1' : '0');
    }
  }

  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * Расстояние Хэмминга между двумя хешами: сколько битов различается.
 * Вернёт `null`, если хеши несравнимы (разной длины или мусор).
 */
export function hammingDistance(a: string, b: string): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i]!, 16);
    const y = parseInt(b[i]!, 16);
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
    let v = x ^ y;
    while (v) { d += v & 1; v >>= 1; }
  }
  return d;
}

/**
 * Порог «та же самая картинка».
 *
 * 10 из 64 битов — общепринятый компромисс: пережатие соцсетью даёт
 * обычно 0–6, а разные картинки расходятся на 20+. Ниже 10 начинаем
 * отвергать честные посты, выше — принимать чужие кадры.
 */
export const PHASH_MATCH_THRESHOLD = 10;

/** Похожи ли настолько, чтобы считать это одной картинкой. */
export function looksSame(a: string, b: string, threshold = PHASH_MATCH_THRESHOLD): boolean {
  const d = hammingDistance(a, b);
  return d !== null && d <= threshold;
}

/** Двумерное DCT-II. Размер маленький (32×32), наивной реализации хватает. */
function dct2d(input: Float64Array, n: number): Float64Array {
  // Таблица косинусов: без неё это 32⁴ вызовов Math.cos на каждую картинку.
  const cos = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cos[i * n + j] = Math.cos(((2 * i + 1) * j * Math.PI) / (2 * n));
    }
  }
  const c = (k: number) => (k === 0 ? Math.SQRT1_2 : 1);

  // Строки, затем столбцы — DCT разделима, это на порядок дешевле прямого хода.
  const rows = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let u = 0; u < n; u++) {
      let sum = 0;
      for (let x = 0; x < n; x++) sum += input[y * n + x]! * cos[x * n + u]!;
      rows[y * n + u] = c(u) * sum;
    }
  }
  const out = new Float64Array(n * n);
  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      let sum = 0;
      for (let y = 0; y < n; y++) sum += rows[y * n + u]! * cos[y * n + v]!;
      out[v * n + u] = c(v) * sum;
    }
  }
  return out;
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
