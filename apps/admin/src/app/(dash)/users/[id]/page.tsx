import Link from 'next/link';
import { notFound } from 'next/navigation';
import { userCard } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangleIcon, ArrowLeftIcon } from 'lucide-react';
import { Truncated } from '@/components/truncated';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { UserActions } from './actions';
import {
  ago, dateTime, userLabel, GENERATION_STATUS, GENERATION_KIND, LEDGER_REASON,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function UserPage({ params }: PageProps<'/users/[id]'>) {
  const { id } = await params;
  const data = await userCard(id);
  if (!data) notFound();

  const { user, ledger, generations, claims, conversations, ledgerTotal } = data;
  const name = userLabel(user);
  const mismatch = ledgerTotal !== user.tokenBalance;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold">{name}</h1>
            {user.isBanned ? <Badge variant="destructive">забанен</Badge> : null}
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            telegram id {String(user.tgId)}
            {user.username ? ` · @${user.username}` : ''}
            {' · '}был {ago(user.lastSeenAt)}
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/users"><ArrowLeftIcon />Ко всем участникам</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Баланс
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-3xl font-semibold tabular-nums">{user.tokenBalance}</p>
            {mismatch ? (
              // Сумма журнала обязана сходиться с балансом. Если нет —
              // кто-то двигал баланс мимо репозитория, и это надо видеть.
              <p className="text-destructive flex items-center gap-1.5 text-sm">
                <AlertTriangleIcon className="size-4 shrink-0" />
                Журнал даёт {ledgerTotal}. Баланс меняли мимо журнала.
              </p>
            ) : null}
            <UserActions
              userId={user.id}
              name={name}
              balance={user.tokenBalance}
              isBanned={user.isBanned}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Движение токенов</CardTitle>
          </CardHeader>
          <CardContent>
            {ledger.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">Пока ничего.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableBody>
                    {ledger.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className={`w-16 text-right font-medium tabular-nums ${
                          l.delta > 0 ? 'text-foreground' : 'text-muted-foreground'
                        }`}>
                          {l.delta > 0 ? '+' : ''}{l.delta}
                        </TableCell>
                        <TableCell>{LEDGER_REASON[l.reason] ?? l.reason}</TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          → {l.balanceAfter}
                        </TableCell>
                        <TableCell className="text-muted-foreground w-32 text-right text-sm">
                          {dateTime(l.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Генерации</CardTitle>
        </CardHeader>
        <CardContent>
          {generations.length === 0 ? (
            <EmptyState title="Участник ещё ничего не сделал" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {generations.map((g) => {
                const st = GENERATION_STATUS[g.status];
                return (
                  // Нативной подсказки через title быть не должно —
                  // полный запрос показывает Truncated своей всплывашкой.
                  <Link key={g.id} href={`/generations/${g.id}`} className="group space-y-1.5">
                    <div className="bg-muted aspect-square overflow-hidden rounded-md border">
                      {g.mediaId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/media/${g.mediaId}`} alt=""
                             className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
                      ) : (
                        <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
                          {st?.label ?? g.status}
                        </div>
                      )}
                    </div>
                    <Truncated
                      text={g.userPrompt}
                      className="text-muted-foreground text-xs"
                    >
                      {GENERATION_KIND[g.kind] ?? g.kind}, {dateTime(g.createdAt)}
                    </Truncated>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Диалоги</CardTitle>
          </CardHeader>
          <CardContent>
            {conversations.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">Диалогов нет.</p>
            ) : (
              <Table>
                <TableBody>
                  {conversations.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/dialogs/${c.id}`} className="hover:underline">
                          {dateTime(c.startedAt)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-sm">
                        {c.messages} сообщ.
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Заявки на бонус</CardTitle>
          </CardHeader>
          <CardContent>
            {claims.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">Заявок нет.</p>
            ) : (
              <Table>
                <TableBody>
                  {claims.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Badge variant={c.status === 'approved' ? 'secondary' : 'outline'}>
                          {c.status === 'approved' ? `+${c.tokensAwarded}` : 'отказ'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate text-sm">
                        {c.verdictReason}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-sm">
                        {dateTime(c.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
