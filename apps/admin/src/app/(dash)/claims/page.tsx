import { listClaims } from '@/lib/queries';
import { ClaimsTable } from './table';

export const dynamic = 'force-dynamic';

export default async function ClaimsPage() {
  const { rows, total } = await listClaims();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Начисления за репосты</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
          Журнал проверок постфактум. Руками здесь ничего не согласовывается — бот автономен,
          каждая проверка решает сама. Если каскад начнёт ошибаться, меняется настройка
          «Лимит слабых подтверждений», а не отдельные заявки. Всего {total}.
        </p>
      </div>
      <ClaimsTable
        rows={rows.map((c) => ({
          id: c.id,
          status: c.status,
          evidence: c.evidence,
          checks: (c.checks ?? null) as Record<string, unknown> | null,
          postUrl: c.postUrl,
          tokensAwarded: c.tokensAwarded,
          verdictReason: c.verdictReason,
          createdAt: c.createdAt.toISOString(),
          userId: c.userId,
          firstName: c.firstName,
          username: c.username,
        }))}
      />
    </div>
  );
}
