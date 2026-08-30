import Link from 'next/link';
import { notFound } from 'next/navigation';
import { taskWithWorks } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeftIcon } from 'lucide-react';
import { dateTime, userLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Одно задание и все работы по нему.
 *
 * Это и есть рабочее место жюри: победителя выбирают глазами, никакой
 * автоматической оценки в проекте нет (ADR 0013). Отметок «в избранное»
 * тоже нет — их вычеркнул заказчик, поэтому страница только показывает.
 *
 * Рядом с каждой работой стоит фраза участника: конкурс по сути про то,
 * кто точнее сформулировал, и без неё сравнивать нечего.
 */
export default async function TaskPage({ params }: PageProps<'/tasks/[id]'>) {
  const { id } = await params;
  const data = await taskWithWorks(id);
  if (!data) notFound();
  const { task, works } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">Задание</h1>
            {task.isActive
              ? <Badge variant="secondary">выдаётся</Badge>
              : <Badge variant="outline">выключено</Badge>}
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Выдано {task.timesIssued} раз · работ прислано {works.length}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/tasks"><ArrowLeftIcon />К списку заданий</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>Исходная картинка</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-muted overflow-hidden rounded border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/media/${task.mediaId}`} alt="" className="w-full object-cover" />
            </div>
            <p className="text-sm">{task.taskText ?? '—'}</p>
            <p className="text-muted-foreground text-xs">
              Внутреннее имя: {task.title}. Участнику не показывается — в нём ответ.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Работы участников</CardTitle></CardHeader>
          <CardContent>
            {works.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                По этому заданию пока никто ничего не прислал.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {works.map((w) => (
                  <Link
                    key={w.id}
                    href={`/generations/${w.id}`}
                    className="focus-visible:ring-ring group rounded-lg border p-2 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <div className="bg-muted mb-2 overflow-hidden rounded">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/media/${w.mediaId}`} alt="" className="aspect-video w-full object-cover" />
                    </div>
                    <p className="line-clamp-2 text-sm" title={w.userPrompt}>{w.userPrompt}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {userLabel(w)} · {dateTime(w.createdAt)}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
