'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Truncated } from '@/components/truncated';
import { Badge } from '@/components/ui/badge';

export interface TaskRow {
  id: string;
  title: string;
  taskText: string | null;
  mediaId: string;
  isActive: boolean;
  timesIssued: number;
  works: number;
}

const columns: ColumnDef<TaskRow, unknown>[] = [
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
    accessorKey: 'taskText', header: 'Задание',
    cell: ({ row }) => (
      <Truncated text={row.original.taskText ?? row.original.title}>
        <span className="font-medium">{row.original.taskText ?? row.original.title}</span>
      </Truncated>
    ),
  },
  {
    // ⚠️ Внутреннее название содержит ответ («гонец → дрон»), поэтому оно
    // живёт только здесь, в админке, и никогда не уходит участнику.
    accessorKey: 'title', header: 'Внутреннее имя', size: 220,
    cell: ({ getValue }) => (
      <Truncated text={String(getValue())}>
        <span className="text-muted-foreground">{String(getValue())}</span>
      </Truncated>
    ),
  },
  {
    accessorKey: 'works', header: 'Работ', size: 100,
    cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span>,
  },
  {
    accessorKey: 'timesIssued', header: 'Выдано', size: 110,
    cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span>,
  },
  {
    accessorKey: 'isActive', header: 'Статус', size: 110,
    cell: ({ getValue }) => (getValue()
      ? <Badge variant="secondary">выдаётся</Badge>
      : <Badge variant="outline">выключено</Badge>),
  },
];

export function TasksTable({ rows }: { rows: TaskRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowHref={(r) => `/tasks/${r.id}`}
      searchPlaceholder="Текст задания или название"
      emptyTitle="Заданий нет"
      emptyHint="Задания заводит скрипт наполнения: scripts/seed-content.mts"
    />
  );
}
