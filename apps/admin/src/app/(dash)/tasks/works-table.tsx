'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, CellLink } from '@/components/data-table';
import { Truncated } from '@/components/truncated';
import { dateTime, userLabel } from '@/lib/format';

export interface WorkRow {
  id: string;
  taskId: string;
  taskText: string | null;
  taskTitle: string;
  userPrompt: string;
  createdAt: string;
  mediaId: string;
  userId: string;
  firstName: string | null;
  username: string | null;
  attempts: number;
}

const columns: ColumnDef<WorkRow, unknown>[] = [
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
    accessorKey: 'taskText', header: 'Задание',
    cell: ({ row }) => {
      const text = row.original.taskText ?? row.original.taskTitle;
      return <Truncated text={text}><span>{text}</span></Truncated>;
    },
  },
  {
    accessorKey: 'userPrompt', header: 'Последняя фраза',
    cell: ({ getValue }) => {
      const text = String(getValue());
      return <Truncated text={text}><span className="text-muted-foreground">{text}</span></Truncated>;
    },
  },
  {
    accessorKey: 'attempts', header: 'Попыток', size: 110,
    cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span>,
  },
  {
    accessorKey: 'createdAt', header: 'Последняя', size: 140,
    cell: ({ getValue }) => <span className="text-muted-foreground">{dateTime(getValue() as string)}</span>,
  },
];

/**
 * Кто над чем работал — обзор, а не галерея.
 *
 * Раньше здесь были карточки на каждую правку: участник делает три-пять
 * попыток, и лента тонула в его же черновиках. Теперь строка на пару
 * «участник + задание», а путь к результату открывается таймлайном.
 */
export function WorksTable({ rows }: { rows: WorkRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowHref={(r) => `/tasks/${r.taskId}/${r.userId}`}
      searchPlaceholder="Участник, задание или фраза"
      emptyTitle="Работ пока нет"
      emptyHint="Как только участники начнут выполнять задания, они появятся здесь"
    />
  );
}
