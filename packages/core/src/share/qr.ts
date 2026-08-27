import QRCode from 'qrcode';

export interface QrOptions {
  /** Сторона картинки в пикселях. */
  size?: number;
  /** Поля вокруг кода, в модулях. Меньше 2 — сканеры начинают промахиваться. */
  margin?: number;
}

/**
 * QR-код ссылки в PNG.
 *
 * Намеренно без логотипов, подписей и цветных градиентов: код сканируют с
 * экрана телефона, часто под углом и в зале с плохим светом. Всё, что
 * снижает контраст, снижает и вероятность, что участник вообще откроет
 * страницу. Уровень коррекции M — запас на блики без раздувания сетки.
 *
 * Файл не сохраняем: код однозначно выводится из ссылки, генерация занимает
 * миллисекунды, и хранить его — значит держать лишнюю строку в `media` на
 * каждую генерацию фестиваля.
 */
export async function renderQrPng(url: string, opts: QrOptions = {}): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: opts.margin ?? 2,
    width: opts.size ?? 512,
    color: { dark: '#0f172aff', light: '#ffffffff' },
  });
}

/** Тот же код в SVG — для страницы результата, где он масштабируется без потерь. */
export async function renderQrSvg(url: string, opts: QrOptions = {}): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: opts.margin ?? 2,
    width: opts.size ?? 256,
    color: { dark: '#0f172aff', light: '#ffffffff' },
  });
}
