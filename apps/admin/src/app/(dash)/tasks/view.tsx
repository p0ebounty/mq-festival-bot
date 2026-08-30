'use client';

import Link from 'next/link';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { dateTime, userLabel } from '@/lib/format';
import { TasksTable, type TaskRow } from './table';

export interface WorkRow {
  id: string;
  taskId: string | null;
  taskText: string | null;
  taskTitle: string;
  userPrompt: string;
  createdAt: string;
  mediaId: string;
  userId: string;
  firstName: string | null;
  username: string | null;
}

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
        {works.length === 0 ? (
          <div className="rounded-lg border p-8 text-center">
            <p className="font-medium">Работ пока нет</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Как только участники начнут выполнять задания, работы появятся здесь.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {works.map((w) => (
              <Link
                key={w.id}
                href={`/generations/${w.id}`}
                className="focus-visible:ring-ring hover:bg-muted/50 rounded-lg border transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/media/${w.mediaId}`} alt="" className="aspect-video w-full rounded-t-lg object-cover" />
                <div className="space-y-1.5 p-3">
                  <p className="line-clamp-2 text-sm" title={w.userPrompt}>{w.userPrompt}</p>
                  <Badge variant="outline" className="max-w-full truncate text-xs font-normal">
                    {w.taskText ?? w.taskTitle}
                  </Badge>
                  <p className="text-muted-foreground text-xs">
                    {userLabel(w)} · {dateTime(w.createdAt)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="tasks">
        <TasksTable rows={tasks} />
      </TabsContent>
    </Tabs>
  );
}
