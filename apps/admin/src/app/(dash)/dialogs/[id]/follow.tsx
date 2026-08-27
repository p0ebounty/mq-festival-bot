'use client';

import { useEffect, useRef } from 'react';

/**
 * Автопрокрутка переписки к концу.
 *
 * Прокручиваем только когда сообщений СТАЛО БОЛЬШЕ. Живое обновление
 * перерисовывает страницу и на посторонних событиях — например, когда
 * кто-то другой сделал генерацию, — и дёргать чужой экран вниз на каждое
 * такое событие было бы издевательством.
 *
 * И не прокручиваем, если человек ушёл вверх читать начало диалога: он
 * там не случайно. Порог в 200 пикселей — обычный «почти у конца».
 */
export function FollowNewMessages({ count }: { count: number }) {
  const seen = useRef<number | null>(null);

  useEffect(() => {
    const previous = seen.current;
    seen.current = count;

    // Первый заход: показываем конец переписки сразу, без анимации.
    if (previous === null) {
      window.scrollTo({ top: document.body.scrollHeight });
      return;
    }
    if (count <= previous) return;

    const nearBottom =
      document.body.scrollHeight - window.scrollY - window.innerHeight < 200;
    if (!nearBottom) return;

    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }, [count]);

  return null;
}
