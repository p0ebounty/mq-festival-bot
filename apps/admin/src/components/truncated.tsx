'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Текст, который обрезается многоточием и показывает себя целиком при
 * наведении.
 *
 * Всплывашка — компонент shadcn, а НЕ атрибут `title`: нативные подсказки
 * браузера в проекте запрещены (правило 30-admin-ui).
 *
 * Подсказка включается, только если текст действительно не поместился:
 * иначе она вылезала бы на каждом коротком слове и мешала читать таблицу.
 */
export function Truncated({
  text, children, className,
}: {
  text: string;
  children?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    check();
    // Ширина колонки меняется вместе с окном — пересчитываем.
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  const body = (
    <span ref={ref} className={cn('block truncate', className)}>
      {children ?? text}
    </span>
  );

  if (!clipped) return body;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{body}</TooltipTrigger>
        <TooltipContent className="max-w-md break-words whitespace-pre-wrap">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
