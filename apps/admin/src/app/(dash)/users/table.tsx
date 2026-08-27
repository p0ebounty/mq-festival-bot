'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Truncated } from '@/components/truncated';
import { ago, userLabel } from '@/lib/format';

export interface UserRow {
  id: string;
  tgId: string;
  username: string | null;
  firstName: string | null;
  tokenBalance: number;
  isBanned: boolean;
  lastSeenAt: string | null;
  generations: number;
}

const columns: ColumnDef<UserRow, unknown>[] = [
  {
    accessorFn: (r) => `${r.firstName ?? ''} ${r.username ?? ''} ${r.tgId}`,
    id: 'name',
    header: 'Участник',
    cell: ({ row }) => (
      <Truncated text={`${userLabel(row.original)} · ${row.original.tgId}`}>
        <span className="font-medium">{userLabel(row.original)}</span>
        <span className="text-muted-foreground ml-2 text-xs tabular-nums">{row.original.tgId}</span>
      </Truncated>
    ),
  },
  { accessorKey: 'tokenBalance', header: 'Баланс', size: 110,
    cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span> },
  { accessorKey: 'generations', header: 'Генераций', size: 120,
    cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span> },
  { accessorKey: 'lastSeenAt', header: 'Последний раз', size: 170,
    cell: ({ getValue }) => <span className="text-muted-foreground">{ago(getValue() as string)}</span> },
  {
    id: 'banned', header: '', size: 110, enableSorting: false,
    cell: ({ row }) => (row.original.isBanned ? <Badge variant="destructive">забанен</Badge> : null),
  },
];

export function UsersTable({ rows }: { rows: UserRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowHref={(r) => `/users/${r.id}`}
      searchPlaceholder="Имя, @логин или telegram id"
      emptyTitle="Участников пока нет"
      emptyHint="Они появятся, когда кто-нибудь напишет боту."
    />
  );
}
