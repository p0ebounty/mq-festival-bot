'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, CellLink } from '@/components/data-table';
import { Truncated } from '@/components/truncated';
import { Badge } from '@/components/ui/badge';
import { dateTime, duration, userLabel, GENERATION_STATUS, GENERATION_KIND } from '@/lib/format';

export interface GenerationRow {
  id: string;
  kind: string;
  status: string;
  model: string;
  userPrompt: string;
  finalPrompt: string | null;
  durationMs: number | null;
  createdAt: string;
  mediaId: string | null;
  userId: string;
  firstName: string | null;
  username: string | null;
  tgId?: string;
}

const columns: ColumnDef<GenerationRow, unknown>[] = [
  {
    id: 'preview', header: '', size: 64, enableSorting: false,
    cell: ({ row }) => (
      <div className="bg-muted h-11 w-11 overflow-hidden rounded border">
        {row.original.mediaId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/media/${row.original.mediaId}`} alt="" className="h-full w-full object-cover" />
        ) : null}
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
    accessorKey: 'userPrompt', header: 'Что просил участник',
    cell: ({ getValue }) => <Truncated text={String(getValue())} />,
  },
  {
    accessorKey: 'status', header: 'Статус', size: 120,
    cell: ({ getValue }) => {
      const st = GENERATION_STATUS[String(getValue())];
      return (
        <Badge variant={st?.tone === 'bad' ? 'destructive' : st?.tone === 'ok' ? 'secondary' : 'outline'}>
          {st?.label ?? String(getValue())}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'kind', header: 'Тип', size: 110,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{GENERATION_KIND[String(getValue())] ?? String(getValue())}</span>
    ),
  },
  {
    accessorKey: 'model', header: 'Модель', size: 160,
    cell: ({ getValue }) => <Truncated text={String(getValue())} className="font-mono text-xs" />,
  },
  {
    accessorKey: 'durationMs', header: 'Время', size: 90,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground tabular-nums">{duration(getValue() as number | null)}</span>
    ),
  },
  {
    accessorKey: 'createdAt', header: 'Когда', size: 140,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground whitespace-nowrap">{dateTime(getValue() as string)}</span>
    ),
  },
];

export function GenerationsTable({ rows }: { rows: GenerationRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowHref={(r) => `/generations/${r.id}`}
      searchPlaceholder="Запрос, модель или имя участника"
      emptyTitle="Генераций пока нет"
      emptyHint="Они появятся, когда участники начнут делать картинки."
    />
  );
}
