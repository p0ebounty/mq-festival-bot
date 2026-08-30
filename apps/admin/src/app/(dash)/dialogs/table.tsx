'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, CellLink } from '@/components/data-table';
import { Truncated } from '@/components/truncated';
import { ago, dateTime, userLabel } from '@/lib/format';

export interface DialogRow {
  id: string;
  userId: string;
  firstName: string | null;
  username: string | null;
  tgId: string;
  startedAt: string;
  lastMessageAt: string;
  messages: number;
  tools: number;
}

const columns: ColumnDef<DialogRow, unknown>[] = [
  {
    id: 'name', header: 'Участник',
    accessorFn: (r) => `${r.firstName ?? ''} ${r.username ?? ''} ${r.tgId}`,
    cell: ({ row }) => (
      <Truncated text={`${userLabel(row.original)} · ${row.original.tgId}`}>
        <CellLink href={`/users/${row.original.userId}`}>
          <span className="font-medium">{userLabel(row.original)}</span>
        </CellLink>
      </Truncated>
    ),
  },
  { accessorKey: 'startedAt', header: 'Начат', size: 150,
    cell: ({ getValue }) => <span className="text-muted-foreground">{dateTime(getValue() as string)}</span> },
  { accessorKey: 'lastMessageAt', header: 'Последнее сообщение', size: 190,
    cell: ({ getValue }) => <span className="text-muted-foreground" suppressHydrationWarning>{ago(getValue() as string)}</span> },
  { accessorKey: 'messages', header: 'Сообщений', size: 120,
    cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span> },
  { accessorKey: 'tools', header: 'Вызовов', size: 110,
    cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span> },
];

export function DialogsTable({ rows }: { rows: DialogRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowHref={(r) => `/dialogs/${r.id}`}
      searchPlaceholder="Имя или telegram id участника"
      emptyTitle="Диалогов пока нет"
      emptyHint="Они появятся, когда кто-нибудь напишет боту."
    />
  );
}
