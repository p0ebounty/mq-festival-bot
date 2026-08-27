import { listUsers } from '@/lib/queries';
import { UsersTable } from './table';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const { rows, total } = await listUsers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Участники</h1>
        <p className="text-muted-foreground mt-1 text-sm">Всего {total}.</p>
      </div>
      <UsersTable
        rows={rows.map((u) => ({
          id: u.id,
          tgId: String(u.tgId),
          username: u.username,
          firstName: u.firstName,
          tokenBalance: u.tokenBalance,
          isBanned: u.isBanned,
          lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
          generations: u.generations,
        }))}
      />
    </div>
  );
}
