'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, CellLink } from '@/components/data-table';
import { Truncated } from '@/components/truncated';
import { dateTime, userLabel } from '@/lib/format';

export interface TaskWorkRow {
  id: string;
  userPrompt: string;
  createdAt: string;
  mediaId: string;
  userId: string;
  firstName: string | null;
  username: string | null;
}

const columns: ColumnDef<TaskWorkRow, unknown>[] = [
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
 * Работы по одному заданию — таблицей, а не плиткой.
 *
 * Плитка занимала экран и давала мало: у работ по одному заданию картинки
 * похожи, а различает их формулировка. В таблице она видна строкой, рядом
 * автор и время, и всё это ищется и сортируется.
 */
export function TaskWorksTable({ rows }: { rows: TaskWorkRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowHref={(r) => `/generations/${r.id}`}
      searchPlaceholder="Участник или фраза"
      emptyTitle="Работ по этому заданию пока нет"
      emptyHint="Они появятся, как только участники начнут его выполнять"
    />
  );
}
