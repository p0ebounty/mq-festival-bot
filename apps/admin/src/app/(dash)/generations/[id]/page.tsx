import Link from 'next/link';
import { notFound } from 'next/navigation';
import { generationById } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeftIcon, ExternalLinkIcon } from 'lucide-react';
import {
  dateTimeFull, duration, userLabel, GENERATION_STATUS, GENERATION_KIND,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 py-1.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="min-w-0 text-sm break-words">{children}</span>
    </div>
  );
}

export default async function GenerationPage({ params }: PageProps<'/generations/[id]'>) {
  const { id } = await params;
  const g = await generationById(id);
  if (!g) notFound();

  const st = GENERATION_STATUS[g.status];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">Генерация</h1>
            <Badge variant={st?.tone === 'bad' ? 'destructive' : st?.tone === 'ok' ? 'secondary' : 'outline'}>
              {st?.label ?? g.status}
            </Badge>
            <Badge variant="outline">{GENERATION_KIND[g.kind] ?? g.kind}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            <Link href={`/users/${g.userId}`} className="hover:underline">{userLabel(g)}</Link>
            {' · '}{dateTimeFull(g.createdAt)}
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/generations"><ArrowLeftIcon />Ко всем генерациям</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card>
          <CardContent className="pt-6">
            <div className="bg-muted overflow-hidden rounded-md border">
              {g.mediaId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/media/${g.mediaId}`} alt="" className="w-full object-contain" />
              ) : (
                <div className="text-muted-foreground flex aspect-square items-center justify-center text-sm">
                  результата нет
                </div>
              )}
            </div>
            {g.caption ? (
              <p className="text-muted-foreground mt-3 text-sm">Подпись: {g.caption}</p>
            ) : null}
            {g.shortId ? (
              <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                <a href={`/g/${g.shortId}`} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon />Публичная страница
                </a>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-6">
          {/*
            Пара, ради которой затевалась админка: видно, не «увёл» ли агент
            авторскую мысль. См. rules/20-bot-agent.md.
          */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Сказал участник</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm break-words">{g.userPrompt}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Ушло в модель</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground font-mono text-xs break-words whitespace-pre-wrap">
                {g.finalPrompt ?? '—'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Как это делалось</CardTitle>
            </CardHeader>
            <CardContent className="divide-border divide-y">
              <Row label="Модель"><code className="font-mono text-xs">{g.model}</code></Row>
              <Row label="Длительность">{duration(g.durationMs)}</Row>
              <Row label="Списано токенов">{g.tokensCharged}</Row>
              <Row label="Кредитов kie.ai">{g.creditsConsumed ?? '—'}</Row>
              <Row label="Готово">{dateTimeFull(g.completedAt)}</Row>
              <Row label="Исходная картинка">
                {g.sourceUrl
                  ? <a href={g.sourceUrl} target="_blank" rel="noreferrer"
                       className="font-mono text-xs break-all hover:underline">{g.sourceUrl}</a>
                  : <span className="text-muted-foreground">рисовали с нуля</span>}
              </Row>
              <Row label="Параметры">
                <code className="text-muted-foreground font-mono text-xs break-all">
                  {g.params ? JSON.stringify(g.params) : '—'}
                </code>
              </Row>
              {g.failMessage ? (
                <Row label="Сбой">
                  <span className="text-destructive break-words">
                    {g.failCode ? `${g.failCode}: ` : ''}{g.failMessage}
                  </span>
                </Row>
              ) : null}
              {g.conversationId ? (
                <Row label="Диалог">
                  <Link href={`/dialogs/${g.conversationId}`} className="hover:underline">
                    открыть переписку
                  </Link>
                </Row>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
