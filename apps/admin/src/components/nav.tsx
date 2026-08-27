'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/', label: 'Дашборд' },
  { href: '/users', label: 'Участники' },
  { href: '/dialogs', label: 'Диалоги' },
  { href: '/generations', label: 'Генерации' },
  { href: '/claims', label: 'Репосты' },
  { href: '/audit', label: 'Аудит' },
  { href: '/settings', label: 'Настройки' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto text-sm">
      {ITEMS.map((it) => {
        // Дашборд подсвечиваем только на точном совпадении: иначе он
        // остаётся активным на всех страницах сразу.
        const active = it.href === '/' ? path === '/' : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 whitespace-nowrap transition-colors',
              active
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
