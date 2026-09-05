import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { worldWithWorks } from '@/lib/queries';
import { WORLDS_HIDDEN } from '@/lib/features';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeftIcon } from 'lucide-react';
import { WorldWorksDetailTable } from './works-table';

export const dynamic = 'force-dynamic';

/**
 * Один мир и всё, что из него выросло.
 *
 * Страница отвечает на два вопроса сразу: «что это за мир» — картинкой, и
 * «во что его превращают» — списком работ. Второе и есть конкурс: «самый
 * неожиданный мир» выбирают глазами, автоматической оценки в проекте нет.
 */
export default async function WorldPage({ params }: PageProps<'/worlds/[id]'>) {
  const { id } = await params;
  if (WORLDS_HIDDEN) redirect('/tasks');
  const data = await worldWithWorks(id);
  if (!data) notFound();
  const { world, works } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">{world.title}</h1>
            {world.isActive
              ? <Badge variant="secondary">выдаётся</Badge>
              : <Badge variant="outline">выключен</Badge>}
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Выдан {world.timesIssued} раз · работ из него {works.length}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/worlds"><ArrowLeftIcon />К списку миров</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>Стартовая картинка</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-muted overflow-hidden rounded border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/media/${world.mediaId}`} alt="" className="w-full object-cover" />
            </div>
            <p className="text-muted-foreground text-xs">
              Название участник видит: бот присылает картинку подписью
              «Твой мир: {world.title}».
            </p>
            {world.sourcePrompt && (
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">Чем нарисован</p>
                <p className="text-sm">{world.sourcePrompt}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Что из него сделали</CardTitle></CardHeader>
          <CardContent>
            <WorldWorksDetailTable
              rows={works.map((w) => ({
                id: w.id,
                userPrompt: w.userPrompt,
                caption: w.caption,
                createdAt: w.createdAt.toISOString(),
                mediaId: w.mediaId,
                userId: w.userId,
                firstName: w.firstName,
                username: w.username,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
