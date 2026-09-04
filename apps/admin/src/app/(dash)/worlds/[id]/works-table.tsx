'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, CellLink } from '@/components/data-table';
import { Truncated } from '@/components/truncated';
import { dateTime, userLabel } from '@/lib/format';

export interface WorldWorkDetailRow {
  id: string;
  userPrompt: string;
  caption: string | null;
  createdAt: string;
  mediaId: string;
  userId: string;
  firstName: string | null;
  username: string | null;
}

const columns: ColumnDef<WorldWorkDetailRow, unknown>[] = [
  {
    id: 'preview', header: '', size: 64, enableSorting: false,
    cell: ({ row }) => (
      <div className="bg-muted h-11 w-11 overflow-hidden rounded border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/media/${row.original.mediaId}`} alt="" className="h-full w-full object-cover" />
      </div>
    ),
  },
  {
    id: 'user', header: 'Участник', size: 180,
    accessorFn: (r) => `${r.firstName ?? ''} ${r.username ?? ''}`,
    cell: ({ row }) => (
      <Truncated text={userLabel(row.original)}>
        <CellLink href={`/users/${row.original.userId}`}>{userLabel(row.original)}</CellLink>
      </Truncated>
    ),
  },
  {
    accessorKey: 'userPrompt', header: 'Что написал',
    cell: ({ getValue }) => {
      const text = String(getValue());
      return <Truncated text={text}><span>{text}</span></Truncated>;
    },
  },
  {
    accessorKey: 'createdAt', header: 'Когда', size: 140,
    cell: ({ getValue }) => <span className="text-muted-foreground">{dateTime(getValue() as string)}</span>,
  },
];

/**
 * Все правки этого мира — каждая своей строкой, без схлопывания.
 *
 * В отличие от общего списка, здесь смысл именно в цепочке: конкурс про
 * самый неожиданный мир, и промежуточный шаг участника бывает интереснее
 * последнего.
 */
export function WorldWorksDetailTable({ rows }: { rows: WorldWorkDetailRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowHref={(r) => `/generations/${r.id}`}
      searchPlaceholder="Участник или фраза"
      emptyTitle="Из этого мира пока ничего не сделали"
      emptyHint="Работы появятся, как только участник изменит выданную картинку"
    />
  );
}
