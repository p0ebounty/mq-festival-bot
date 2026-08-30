import Link from 'next/link';
import { listTasks, recentWorksByTask } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRightIcon } from 'lucide-react';
import { dateTime, userLabel } from '@/lib/format';
import { TasksTable } from './table';

export const dynamic = 'force-dynamic';

/**
 * Задания и присланные работы на одном экране.
 *
 * Сначала было только оглавление, и жюри пришлось бы заходить в каждое
 * задание по очереди — десять заданий, десять кликов. В зале так не
 * выбирают: работы сравнивают взглядом, прокручивая. Поэтому свежие работы
 * лежат прямо здесь, а страница задания остаётся для полного разбора.
 */
export default async function TasksPage() {
  const [rows, worksByTask] = await Promise.all([listTasks(), recentWorksByTask()]);
  const works = rows.reduce((n, t) => n + t.works, 0);
  const withWorks = rows.filter((t) => t.works > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Задания</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Картинка и цель, что из неё получить. Работ прислано: {works}.
          Победителя выбирают глазами — работы ниже, по заданиям.
        </p>
      </div>

      <TasksTable
        rows={rows.map((t) => ({
          id: t.id,
          title: t.title,
          taskText: t.taskText,
          mediaId: t.mediaId,
          isActive: t.isActive,
          timesIssued: t.timesIssued,
          works: t.works,
        }))}
      />

      {withWorks.length === 0 ? null : (
        <div className="space-y-4">
          <h2 className="font-heading text-lg font-semibold">Работы участников</h2>
          {withWorks.map((t) => {
            const items = worksByTask.get(t.id) ?? [];
            return (
              <Card key={t.id}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{t.taskText ?? t.title}</CardTitle>
                    <p className="text-muted-foreground mt-1 text-xs">
                      работ {t.works}{t.works > items.length ? `, показаны свежие ${items.length}` : ''}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/tasks/${t.id}`}>Все работы<ArrowRightIcon /></Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                    <div className="bg-muted overflow-hidden rounded border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/media/${t.mediaId}`} alt=""
                           className="aspect-video w-full object-cover opacity-70" />
                      <p className="text-muted-foreground p-1.5 text-[11px]">исходная</p>
                    </div>
                    {items.map((w) => (
                      <Link
                        key={w.id}
                        href={`/generations/${w.id}`}
                        className="focus-visible:ring-ring hover:bg-muted/50 rounded border transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/media/${w.mediaId}`} alt="" className="aspect-video w-full rounded-t object-cover" />
                        <div className="p-1.5">
                          <p className="line-clamp-2 text-xs" title={w.userPrompt}>{w.userPrompt}</p>
                          <p className="text-muted-foreground mt-1 text-[11px]">
                            {userLabel(w)} · {dateTime(w.createdAt)}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
