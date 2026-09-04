'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, CellLink } from '@/components/data-table';
import { Truncated } from '@/components/truncated';
import { dateTime, userLabel } from '@/lib/format';

export interface WorldWorkRow {
  id: string;
  worldId: string;
  worldTitle: string;
  userPrompt: string;
  createdAt: string;
  mediaId: string;
  userId: string;
  firstName: string | null;
  username: string | null;
  attempts: number;
}

const columns: ColumnDef<WorldWorkRow, unknown>[] = [
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
    id: 'user', header: 'Участник', size: 170,
    accessorFn: (r) => `${r.firstName ?? ''} ${r.username ?? ''}`,
    cell: ({ row }) => (
      <Truncated text={userLabel(row.original)}>
        <CellLink href={`/users/${row.original.userId}`}>{userLabel(row.original)}</CellLink>
      </Truncated>
    ),
  },
  {
    accessorKey: 'worldTitle', header: 'Из какого мира', size: 200,
    cell: ({ row }) => (
      <Truncated text={row.original.worldTitle}>
        <CellLink href={`/worlds/${row.original.worldId}`}>{row.original.worldTitle}</CellLink>
      </Truncated>
    ),
  },
  {
    accessorKey: 'userPrompt', header: 'Последняя фраза',
    cell: ({ getValue }) => {
      const text = String(getValue());
      return <Truncated text={text}><span className="text-muted-foreground">{text}</span></Truncated>;
    },
  },
  {
    accessorKey: 'attempts', header: 'Правок', size: 100,
    cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span>,
  },
  {
    accessorKey: 'createdAt', header: 'Последняя', size: 140,
    cell: ({ getValue }) => <span className="text-muted-foreground">{dateTime(getValue() as string)}</span>,
  },
];

/**
 * Что участники сделали из миров.
 *
 * Строка на пару «участник + мир», а не на каждую правку: мир меняют по
 * очереди, пять раз подряд, и лента из всех правок — это чужие черновики.
 * Вся цепочка видна внутри мира.
 */
export function WorldWorksTable({ rows }: { rows: WorldWorkRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowHref={(r) => `/generations/${r.id}`}
      searchPlaceholder="Участник, мир или фраза"
      emptyTitle="Работ пока нет"
      emptyHint="Появятся, как только участники начнут менять выданные миры"
    />
  );
}
