import { listAudit } from '@/lib/queries';
import { AuditTable } from './table';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const { rows, total } = await listAudit();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Аудит</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Что делали администраторы. Значения секретов сюда не пишутся. Всего {total}.
        </p>
      </div>
      <AuditTable
        rows={rows.map((a) => ({
          id: a.id,
          action: a.action,
          target: a.target,
          details: a.details ? JSON.stringify(a.details) : '—',
          ip: a.ip,
          createdAt: a.createdAt.toISOString(),
          adminLogin: a.adminLogin,
        }))}
      />
    </div>
  );
}
