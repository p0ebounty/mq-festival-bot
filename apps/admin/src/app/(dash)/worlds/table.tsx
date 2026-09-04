'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Truncated } from '@/components/truncated';
import { Badge } from '@/components/ui/badge';

export interface WorldRow {
  id: string;
  title: string;
  sourcePrompt: string | null;
  mediaId: string;
  isActive: boolean;
  timesIssued: number;
  works: number;
}

const columns: ColumnDef<WorldRow, unknown>[] = [
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
    // Название мира участник ВИДИТ: бот присылает картинку подписью
    // «Твой мир: подводный купол». Прятать его, в отличие от внутреннего
    // имени задания, не от кого.
    accessorKey: 'title', header: 'Мир',
    cell: ({ getValue }) => (
      <Truncated text={String(getValue())}>
        <span className="font-medium">{String(getValue())}</span>
      </Truncated>
    ),
  },
  {
    accessorKey: 'sourcePrompt', header: 'Чем нарисован',
    cell: ({ getValue }) => {
      const text = (getValue() as string | null) ?? '—';
      return <Truncated text={text}><span className="text-muted-foreground">{text}</span></Truncated>;
    },
  },
  {
    accessorKey: 'works', header: 'Работ', size: 100,
    cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span>,
  },
  {
    accessorKey: 'timesIssued', header: 'Выдан', size: 110,
    cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span>,
  },
  {
    accessorKey: 'isActive', header: 'Статус', size: 110,
    cell: ({ getValue }) => (getValue()
      ? <Badge variant="secondary">выдаётся</Badge>
      : <Badge variant="outline">выключен</Badge>),
  },
];

export function WorldsTable({ rows }: { rows: WorldRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowHref={(r) => `/worlds/${r.id}`}
      searchPlaceholder="Название мира или его промпт"
      emptyTitle="Миров нет"
      emptyHint="Пул миров заводит скрипт наполнения: scripts/seed-content.mts"
    />
  );
}
