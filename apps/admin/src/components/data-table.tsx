'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState,
} from '@tanstack/react-table';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import {
  ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon,
} from 'lucide-react';

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  /** Куда ведёт клик по строке. Без неё строки некликабельны. */
  rowHref?: (row: T) => string | undefined;
  /** Плейсхолдер поиска. Пусто — поиска нет. */
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyHint?: string;
  pageSize?: number;
}

/**
 * Единственная таблица приложения.
 *
 * Одна на все разделы — чтобы поиск, сортировка, пагинация и поведение
 * клика были везде одинаковыми, а не собирались заново на каждой странице.
 * Механику берём готовую (`@tanstack/react-table`), свой тут только вид.
 *
 * Три вещи, ради которых она и появилась:
 *  - **пагинация и поиск включены везде**, где есть список;
 *  - **длинный текст обрезается многоточием**, а не растягивает таблицу
 *    в горизонтальную портянку;
 *  - **кликается вся строка**, а не одна ссылка в ней. Ссылки внутри
 *    продолжают работать: они останавливают всплытие.
 */
export function DataTable<T>({
  columns, data, rowHref, searchPlaceholder, emptyTitle = 'Ничего нет',
  emptyHint, pageSize = 25,
}: DataTableProps<T>) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState('');

  // Компилятор React не умеет мемоизировать то, что возвращает TanStack
  // Table, и честно об этом предупреждает. Для нас это безвредно: таблица
  // читает данные из пропсов и наружу свои функции не отдаёт. Гасим точечно,
  // чтобы «чисто» в линте означало именно чисто.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  const { pageIndex } = table.getState().pagination;

  // Пустая таблица без поиска — это «данных нет», с поиском — «не нашлось».
  const empty = useMemo(
    () => (filter ? { title: 'Ничего не нашлось', hint: 'Попробуйте другой запрос.' }
                  : { title: emptyTitle, ...(emptyHint ? { hint: emptyHint } : {}) }),
    [filter, emptyTitle, emptyHint],
  );

  return (
    <div className="space-y-4">
      {searchPlaceholder ? (
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="max-w-sm"
        />
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={empty.title} {...(empty.hint ? { hint: empty.hint } : {})} />
      ) : (
        <>
          {/* Таблица не растягивает страницу: при нехватке места
              прокручивается сама, а не выдавливает контейнер. */}
          <div className="overflow-x-auto rounded-lg border">
            <Table className="table-fixed">
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => {
                      const sortable = h.column.getCanSort();
                      const dir = h.column.getIsSorted();
                      return (
                        <TableHead
                          key={h.id}
                          style={h.column.columnDef.size ? { width: h.column.columnDef.size } : undefined}
                          className={sortable ? 'cursor-pointer select-none' : undefined}
                          onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                        >
                          <span className="inline-flex items-center gap-1">
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {dir === 'asc' ? <ChevronUpIcon className="text-muted-foreground size-3.5" />
                              : dir === 'desc' ? <ChevronDownIcon className="text-muted-foreground size-3.5" />
                              : null}
                          </span>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const href = rowHref?.(row.original);
                  return (
                    <TableRow
                      key={row.id}
                      onClick={href ? () => router.push(href) : undefined}
                      // Клик по всей строке — удобство для мыши. Роль
                      // строки при этом НЕ подменяем: role="link" затирает
                      // implicit role="row" и ломает таблицу для читалок
                      // (и для поиска по роли в тестах). Клавиатуре хватает
                      // tabIndex и Enter.
                      tabIndex={href ? 0 : undefined}
                      onKeyDown={href ? (e) => {
                        if (e.key === 'Enter') router.push(href);
                      } : undefined}
                      className={href ? 'hover:bg-muted/50 focus-visible:bg-muted/50 cursor-pointer outline-none' : undefined}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="max-w-0 truncate">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {pageCount > 1 ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-muted-foreground text-sm">
                {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, total)} из {total}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm"
                        disabled={!table.getCanPreviousPage()}
                        onClick={() => table.previousPage()}>
                  <ChevronLeftIcon />Назад
                </Button>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {pageIndex + 1} / {pageCount}
                </span>
                <Button variant="outline" size="sm"
                        disabled={!table.getCanNextPage()}
                        onClick={() => table.nextPage()}>
                  Вперёд<ChevronRightIcon />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Ссылка внутри кликабельной строки.
 *
 * Останавливает всплытие: иначе клик по ней сначала уводил бы по её
 * адресу, а потом строка тащила бы на свой.
 */
export function CellLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="hover:underline"
    >
      {children}
    </a>
  );
}
