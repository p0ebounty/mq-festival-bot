'use client';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TasksTable, type TaskRow } from './table';
import { WorksTable, type WorkRow } from './works-table';


/**
 * Раздел заданий: две вкладки.
 *
 *  - **Задания** — что раздаётся: картинка, формулировка, счётчики.
 *  - **Работы** — что прислали, общим списком, свежие сверху.
 *
 * Изначально всё лежало на одной странице секциями по заданиям, и она
 * росла с каждым новым заданием. Жюри листает работы, а не оглавление,
 * поэтому список работ отделён и открывается сразу.
 */
export function TasksView({ tasks, works }: { tasks: TaskRow[]; works: WorkRow[] }) {
  return (
    <Tabs defaultValue={works.length ? 'works' : 'tasks'}>
      <TabsList>
        <TabsTrigger value="works">Работы {works.length ? `· ${works.length}` : ''}</TabsTrigger>
        <TabsTrigger value="tasks">Задания · {tasks.length}</TabsTrigger>
      </TabsList>

      <TabsContent value="works">
        <WorksTable rows={works} />
      </TabsContent>

      <TabsContent value="tasks">
        <TasksTable rows={tasks} />
      </TabsContent>
    </Tabs>
  );
}
