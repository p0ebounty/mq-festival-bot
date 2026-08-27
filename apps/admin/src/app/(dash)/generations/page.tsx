import { listGenerations } from '@/lib/queries';
import { GenerationsTable } from './table';

export const dynamic = 'force-dynamic';

export default async function GenerationsPage() {
  const { rows, total } = await listGenerations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Генерации</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Что просил участник, что ушло в модель, что получилось. Всего {total}.
        </p>
      </div>
      <GenerationsTable
        rows={rows.map((g) => ({
          id: g.id,
          kind: g.kind,
          status: g.status,
          model: g.model,
          userPrompt: g.userPrompt,
          finalPrompt: g.finalPrompt,
          durationMs: g.durationMs,
          createdAt: g.createdAt.toISOString(),
          mediaId: g.mediaId,
          userId: g.userId,
          firstName: g.firstName,
          username: g.username,
        }))}
      />
    </div>
  );
}
