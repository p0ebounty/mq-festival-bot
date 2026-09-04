'use client';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WorldsTable, type WorldRow } from './table';
import { WorldWorksTable, type WorldWorkRow } from './works-table';

/**
 * Раздел миров: две вкладки, как в заданиях.
 *
 *  - **Миры** — что раздаётся: картинка, название, счётчики.
 *  - **Работы** — что из них сделали, свежие сверху.
 *
 * Вкладка миров открывается первой, а не работ: сюда приходят с вопросом
 * «какие миры вообще есть», и ответ на него — пул, а не лента правок.
 */
export function WorldsView({ worlds, works }: { worlds: WorldRow[]; works: WorldWorkRow[] }) {
  return (
    <Tabs defaultValue="worlds">
      <TabsList>
        <TabsTrigger value="worlds">Миры · {worlds.length}</TabsTrigger>
        <TabsTrigger value="works">Работы {works.length ? `· ${works.length}` : ''}</TabsTrigger>
      </TabsList>

      <TabsContent value="worlds">
        <WorldsTable rows={worlds} />
      </TabsContent>

      <TabsContent value="works">
        <WorldWorksTable rows={works} />
      </TabsContent>
    </Tabs>
  );
}
