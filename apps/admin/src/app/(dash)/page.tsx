import Link from 'next/link';
import { dashboardStats, generationsByDay } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarTooltip } from './bar-tooltip';

export const dynamic = 'force-dynamic';

function Stat({ label, value, hint, href }: {
  label: string; value: string | number; hint?: string; href?: string;
}) {
  const body = (
    <Card className="h-full transition-colors hover:border-foreground/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-muted-foreground mt-1 text-sm">{hint}</p> : null}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DashboardPage() {
  const [s, days] = await Promise.all([dashboardStats(), generationsByDay()]);
  const max = Math.max(1, ...days.map((d) => d.total));
  const errorRate = s.generationsToday
    ? Math.round((s.failedToday / s.generationsToday) * 100)
    : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Дашборд</h1>
        <p className="text-muted-foreground mt-1 text-sm">Что происходит на стенде прямо сейчас.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Генераций сегодня" value={s.generationsToday}
              hint={`всего ${s.generationsTotal}`} href="/generations" />
        <Stat label="Сейчас в работе" value={s.inFlight}
              hint={s.inFlight > 0 ? 'участники ждут картинку' : 'очередь пуста'} />
        <Stat label="Участников сегодня" value={s.activeToday}
              hint={`всего ${s.usersTotal}`} href="/users" />
        <Stat label="Доля сбоев" value={`${errorRate}%`}
              hint={`${s.failedToday} из ${s.generationsToday} за сегодня`} />
        <Stat label="Кредитов kie.ai" value={s.creditsToday} hint="израсходовано сегодня" />
        <Stat label="Средняя генерация"
              value={s.avgDurationSec != null ? `${s.avgDurationSec} с` : '—'}
              hint="по удачным за сегодня" />
        <Stat label="Бонусов за репост" value={s.bonusesToday}
              hint="начислено сегодня" href="/claims" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Генерации за две недели</CardTitle>
        </CardHeader>
        <CardContent>
          {days.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">Данных пока нет.</p>
          ) : (
            <div className="flex h-40 items-end gap-1.5">
              {days.map((d) => (
                <div key={d.day} className="group flex flex-1 flex-col items-center gap-2">
                  {/* Подсказка — компонент, а не нативный title (30-admin-ui). */}
                  <BarTooltip label={`${d.day}: ${d.total} генераций, сбоев ${d.failed}`}>
                    <div className="bg-foreground/10 group-hover:bg-foreground/20 relative w-full rounded-sm transition-colors"
                         style={{ height: `${(d.total / max) * 100}%`, minHeight: '3px' }}>
                      {d.failed > 0 ? (
                        <div className="bg-destructive/60 absolute inset-x-0 bottom-0 rounded-sm"
                             style={{ height: `${(d.failed / d.total) * 100}%` }} />
                      ) : null}
                    </div>
                  </BarTooltip>
                  <span className="text-muted-foreground text-[10px] tabular-nums">{d.day}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
