/** Коды kie.ai из документации (docs/vendor/kie/01-getting-started.md). */
export const KIE_CODES = {
  OK: 200,
  UNAUTHORIZED: 401,
  NO_CREDITS: 402,
  NOT_FOUND: 404,
  VALIDATION: 422,
  RATE_LIMITED: 429,
  SUBKEY_LIMIT: 433,
  MAINTENANCE: 455,
  SERVER: 500,
  GENERATION_FAILED: 501,
  FEATURE_DISABLED: 505,
} as const;

export class KieError extends Error {
  constructor(
    message: string,
    readonly code: number,
    /** Стоит ли повторять запрос. Определяется здесь, а не на месте вызова. */
    readonly retryable: boolean,
    /** Текст, который не стыдно показать участнику фестиваля. */
    readonly userMessage: string,
  ) {
    super(message);
    this.name = 'KieError';
  }
}

/**
 * Разбирает код kie.ai в осмысленную ошибку.
 * Важно: 401/402/422 повторять бессмысленно — они не «рассосутся»,
 * а 429/455/500 имеют шанс пройти со второй попытки.
 */
export function kieErrorFor(code: number, msg?: string): KieError {
  const raw = msg?.trim() || `код ${code}`;
  switch (code) {
    case KIE_CODES.UNAUTHORIZED:
      return new KieError(`kie.ai: не авторизован (${raw})`, code, false,
        'Сервис генерации не отвечает — администратор уже знает. Попробуй чуть позже.');
    case KIE_CODES.NO_CREDITS:
      return new KieError(`kie.ai: кончились кредиты (${raw})`, code, false,
        'На сервисе закончился лимит генераций. Мы уже разбираемся.');
    case KIE_CODES.VALIDATION:
      return new KieError(`kie.ai: параметры не прошли валидацию (${raw})`, code, false,
        'Не получилось собрать запрос к модели. Попробуй переформулировать.');
    case KIE_CODES.RATE_LIMITED:
    case KIE_CODES.SUBKEY_LIMIT:
      return new KieError(`kie.ai: превышен лимит запросов (${raw})`, code, true,
        'Сейчас много запросов — встал в очередь, скоро продолжу.');
    case KIE_CODES.MAINTENANCE:
      return new KieError(`kie.ai: обслуживание (${raw})`, code, true,
        'Сервис генерации на профилактике. Пробую ещё раз.');
    case KIE_CODES.GENERATION_FAILED:
      return new KieError(`kie.ai: генерация не удалась (${raw})`, code, true,
        'Не вышло с первого раза — пробую другой моделью.');
    case KIE_CODES.FEATURE_DISABLED:
      return new KieError(`kie.ai: функция отключена (${raw})`, code, false,
        'Эта модель сейчас недоступна.');
    case KIE_CODES.NOT_FOUND:
      return new KieError(`kie.ai: не найдено (${raw})`, code, false,
        'Задача не найдена.');
    default:
      return new KieError(`kie.ai: ${raw}`, code, code >= 500,
        'Сервис генерации подвис. Пробую ещё раз.');
  }
}
