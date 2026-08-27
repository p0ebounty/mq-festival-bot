import { listConversations } from '@/lib/queries';
import { DialogsTable } from './table';

export const dynamic = 'force-dynamic';

export default async function DialogsPage() {
  const { rows, total } = await listConversations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Диалоги</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Переписка с агентом и вызовы инструментов. Всего {total}.
        </p>
      </div>
      <DialogsTable
        rows={rows.map((c) => ({
          id: c.id,
          userId: c.userId,
          firstName: c.firstName,
          username: c.username,
          tgId: String(c.tgId),
          startedAt: c.startedAt.toISOString(),
          lastMessageAt: c.lastMessageAt.toISOString(),
          messages: c.messages,
          tools: c.tools,
        }))}
      />
    </div>
  );
}
