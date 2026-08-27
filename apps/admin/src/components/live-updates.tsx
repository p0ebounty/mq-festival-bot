'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RadioIcon, RadioTowerIcon } from 'lucide-react';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Живое обновление всей админки одним компонентом.
 *
 * Стоит в layout и работает на любой странице: страницы — серверные
 * компоненты, поэтому достаточно позвать `router.refresh()`, и Next
 * перерисует их со свежими данными. Состояние клиентских компонентов
 * (поиск в таблице, раскрытый вызов инструмента) при этом сохраняется.
 *
 * События приходят из БД: триггеры → `pg_notify` → SSE (`/api/events`).
 */
export function LiveUpdates() {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('ready', () => setLive(true));

    es.addEventListener('changed', () => {
      // Пачка записей за один оборот бота (сообщение + вызов + генерация)
      // даёт три события подряд. Перерисовываем один раз.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 600);
    });

    // EventSource переподключается сам; нам остаётся честно показать,
    // что связь пропала, а не делать вид, что данные свежие.
    es.onerror = () => setLive(false);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      es.close();
    };
  }, [router]);

  const Icon = live ? RadioTowerIcon : RadioIcon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={live ? 'text-emerald-500' : 'text-muted-foreground/50'}
          aria-live="polite"
          aria-label={live ? 'Данные обновляются сами' : 'Связь с сервером потеряна'}
        >
          <Icon className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {live ? 'Данные обновляются сами' : 'Связь потеряна, данные могут устареть'}
      </TooltipContent>
    </Tooltip>
  );
}
