import { listWorlds, listWorldWorks } from '@/lib/queries';
import { WorldsView } from './view';

export const dynamic = 'force-dynamic';

export default async function WorldsPage() {
  const [worlds, works] = await Promise.all([listWorlds(), listWorldWorks()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Миры</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Стартовые картинки, которые бот раздаёт бесплатно: участник меняет
          выданный мир одной фразой. Отличие от задания одно — здесь у него
          полная свобода, заданного результата нет. Во вкладке работ —
          по одной, последней правке каждого участника; вся цепочка видна
          внутри мира.
        </p>
      </div>
      <WorldsView
        worlds={worlds.map((w) => ({
          id: w.id,
          title: w.title,
          sourcePrompt: w.sourcePrompt,
          mediaId: w.mediaId,
          isActive: w.isActive,
          timesIssued: w.timesIssued,
          works: w.works,
        }))}
        works={works.map((w) => ({
          id: w.id,
          worldId: w.worldId!,
          worldTitle: w.worldTitle,
          userPrompt: w.userPrompt,
          createdAt: w.createdAt.toISOString(),
          mediaId: w.mediaId,
          userId: w.userId,
          firstName: w.firstName,
          username: w.username,
          attempts: w.attempts,
        }))}
      />
    </div>
  );
}
