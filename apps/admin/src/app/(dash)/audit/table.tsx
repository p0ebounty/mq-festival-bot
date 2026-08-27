'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Truncated } from '@/components/truncated';
import { dateTimeFull } from '@/lib/format';

export interface AuditRow {
  id: string;
  action: string;
  target: string | null;
  details: string;
  ip: string | null;
  createdAt: string;
  adminLogin: string | null;
}

const ACTIONS: Record<string, string> = {
  'settings.update': 'изменена настройка',
  'user.grant_tokens': 'начислены токены',
  'user.deduct_tokens': 'списаны токены',
  'user.ban': 'закрыт доступ',
  'user.unban': 'возвращён доступ',
  'prompt.rollback': 'откат системного промпта',
};

const columns: ColumnDef<AuditRow, unknown>[] = [
  {
    accessorKey: 'createdAt', header: 'Когда', size: 190,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground whitespace-nowrap">{dateTimeFull(getValue() as string)}</span>
    ),
  },
  { accessorKey: 'adminLogin', header: 'Кто', size: 130,
    cell: ({ getValue }) => <Truncated text={String(getValue() ?? '—')} /> },
  {
    accessorKey: 'action', header: 'Действие', size: 220,
    cell: ({ getValue }) => (
      <Truncated text={ACTIONS[String(getValue())] ?? String(getValue())} />
    ),
  },
  { accessorKey: 'target', header: 'Объект',
    cell: ({ getValue }) => <Truncated text={String(getValue() ?? '—')} className="font-mono text-xs" /> },
  { accessorKey: 'details', header: 'Подробности',
    cell: ({ getValue }) => <Truncated text={String(getValue())} className="font-mono text-xs" /> },
  { accessorKey: 'ip', header: 'IP', size: 130,
    cell: ({ getValue }) => <Truncated text={String(getValue() ?? '—')} className="font-mono text-xs" /> },
];

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Действие, объект или админ"
      emptyTitle="Записей пока нет"
    />
  );
}
