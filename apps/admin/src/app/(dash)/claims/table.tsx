'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, CellLink } from '@/components/data-table';
import { Truncated } from '@/components/truncated';
import { Badge } from '@/components/ui/badge';
import { CheckIcon, MinusIcon } from 'lucide-react';
import { dateTime, userLabel, CLAIM_EVIDENCE } from '@/lib/format';

export interface ClaimRow {
  id: string;
  status: string;
  evidence: string | null;
  checks: Record<string, unknown> | null;
  postUrl: string | null;
  tokensAwarded: number;
  verdictReason: string | null;
  createdAt: string;
  userId: string;
  firstName: string | null;
  username: string | null;
}

/** Галочки каскада: сразу видно, на каком шаге всё встало. */
function Checks({ checks }: { checks: Record<string, unknown> | null }) {
  const c = checks ?? {};
  const items: Array<[string, unknown]> = [
    ['домен', c.domain], ['открылась', c.publicPage],
    ['картинка', c.imageMatch], ['хештеги', c.hashtags],
  ];
  return (
    <span className="flex flex-wrap gap-x-2 text-xs">
      {items.map(([label, v]) => (
        <span key={label}
              className={`inline-flex items-center gap-0.5 ${
                v === true ? 'text-foreground' : 'text-muted-foreground'
              }`}>
          {v === true ? <CheckIcon className="size-3" /> : <MinusIcon className="size-3" />}
          {label}
        </span>
      ))}
    </span>
  );
}

const columns: ColumnDef<ClaimRow, unknown>[] = [
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
    accessorKey: 'status', header: 'Вердикт', size: 110,
    cell: ({ row }) => (
      <Badge variant={row.original.status === 'approved' ? 'secondary' : 'outline'}>
        {row.original.status === 'approved' ? `+${row.original.tokensAwarded}` : 'отказ'}
      </Badge>
    ),
  },
  {
    accessorKey: 'verdictReason', header: 'Почему',
    cell: ({ getValue }) => <Truncated text={String(getValue() ?? '—')} />,
  },
  {
    accessorKey: 'evidence', header: 'На чём основан', size: 210,
    cell: ({ getValue }) => (
      <Truncated text={CLAIM_EVIDENCE[String(getValue() ?? 'none')] ?? String(getValue())} />
    ),
  },
  {
    id: 'checks', header: 'Проверки', size: 210, enableSorting: false,
    cell: ({ row }) => <Checks checks={row.original.checks} />,
  },
  {
    accessorKey: 'postUrl', header: 'Публикация', size: 200,
    cell: ({ getValue }) => {
      const url = getValue() as string | null;
      if (!url) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <Truncated text={url} className="text-xs">
          <CellLink href={url}>{url}</CellLink>
        </Truncated>
      );
    },
  },
  {
    accessorKey: 'createdAt', header: 'Когда', size: 140,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground whitespace-nowrap">{dateTime(getValue() as string)}</span>
    ),
  },
];

export function ClaimsTable({ rows }: { rows: ClaimRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Участник, причина или ссылка"
      emptyTitle="Заявок пока не было"
      emptyHint="Они появятся, когда участник пришлёт ссылку на свою публикацию."
    />
  );
}
