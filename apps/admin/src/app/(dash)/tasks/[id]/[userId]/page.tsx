import Link from 'next/link';
import { notFound } from 'next/navigation';
import { taskAttempts } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { dateTime, userLabel, GENERATION_STATUS } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Путь участника по заданию: исходная картинка и все его попытки подряд.
 *
 * Смысл именно в последовательности. Одна финальная картинка не говорит
 * ничего о том, как человек к ней шёл, а на фестивале про формулировки —
 * это и есть содержание. Видно, с чего начал, что поправил и на чём
 * остановился.
 *
 * Технических полей здесь нет намеренно: модель, длительность и кредиты
 * нужны на разборе генерации, а не тому, кто смотрит работы.
 */
export default async function TaskAttemptsPage({ params }: PageProps<'/tasks/[id]/[userId]'>) {
  const { id, userId } = await params;
  const data = await taskAttempts(id, userId);
  if (!data) notFound();
  const { task, user, attempts } = data;
  const done = attempts.filter((a) => a.status === 'success');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold">{userLabel(user)}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {task.taskText ?? task.title} · попыток {done.length}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/tasks"><ArrowLeftIcon />Ко всем работам</Link>
        </Button>
      </div>

      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-normal">
              <Badge variant="outline" className="mr-2">исходная</Badge>
              {task.taskText ?? task.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/media/${task.mediaId}`} alt=""
                 className="max-h-72 w-full rounded border object-contain" />
          </CardContent>
        </Card>

        {attempts.map((a, i) => {
          const st = GENERATION_STATUS[a.status];
          const ready = a.status === 'success' && a.mediaId;
          return (
            <div key={a.id} className="space-y-3">
              <div className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
                <ArrowRightIcon className="size-4 rotate-90" />
                <span className="max-w-2xl break-words">«{a.userPrompt}»</span>
              </div>

              <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
                  <CardTitle className="text-sm font-normal">
                    <Badge variant="secondary" className="mr-2">попытка {i + 1}</Badge>
                    {dateTime(a.createdAt)}
                    {!ready && st ? (
                      <Badge variant={st.tone === 'bad' ? 'destructive' : 'outline'} className="ml-2">
                        {st.label}
                      </Badge>
                    ) : null}
                  </CardTitle>
                  {ready ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/generations/${a.id}`}>Разбор</Link>
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {ready ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/media/${a.mediaId}`} alt=""
                           className="max-h-72 w-full rounded border object-contain" />
                      {a.caption ? <p className="mt-2 text-sm">{a.caption}</p> : null}
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">Картинки нет — попытка не дошла до результата.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
