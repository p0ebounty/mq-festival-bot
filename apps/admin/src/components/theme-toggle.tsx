'use client';

import { useTheme } from 'next-themes';
import { MoonIcon, SunIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Обе иконки в разметке всегда; какая видна — решает CSS по классу .dark.
 * Так не нужен mounted-флаг с setState в useEffect (каскадные рендеры),
 * и нет мигания иконки при гидрации.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Переключить тему"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          <SunIcon className="hidden dark:block" />
          <MoonIcon className="block dark:hidden" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Переключить тему</TooltipContent>
    </Tooltip>
  );
}
