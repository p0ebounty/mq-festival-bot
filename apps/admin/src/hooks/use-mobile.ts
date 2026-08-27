import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Узкий ли экран. Нужен боковому меню: на телефоне оно превращается в шторку.
 *
 * Переписан с `useState` + `useEffect` на `useSyncExternalStore` — так и
 * задумано для подписки на внешний источник. Исходный вариант из shadcn
 * вызывал `setState` прямо в теле эффекта, а это лишний каскад отрисовок
 * и ошибка компилятора React.
 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;
// На сервере ширины нет; считаем экран широким, чтобы разметка совпала
// с первым рендером в браузере на десктопе.
const getServerSnapshot = () => false;

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
