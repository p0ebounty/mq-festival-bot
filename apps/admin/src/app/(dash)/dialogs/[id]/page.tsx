import Link from 'next/link';
import { notFound } from 'next/navigation';
import { conversationThread } from '@/lib/queries';
import { ToolCall } from '@/components/tool-call';
import { FollowNewMessages } from './follow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeftIcon, UserIcon } from 'lucide-react';
import { dateTime, userLabel, GENERATION_STATUS } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Картинки, приложенные к сообщению участника. */
function attachedImages(contentJson: unknown): string[] {
  const urls = (contentJson as { imageUrls?: unknown } | null)?.imageUrls;
  return Array.isArray(urls) ? urls.filter((u): u is string => typeof u === 'string') : [];
}

/**
 * Картинка, которую бот нарисовал, — прямо в ленте разговора.
 *
 * Показывается и неудачная: «сбой» на своём месте в переписке объясняет,
 * почему участник дальше пишет «а где картинка», а пустая лента — нет.
 */
function GenerationCard({ g }: {
  g: {
    id: string; status: string; caption: string | null; userPrompt: string;
    createdAt: Date; mediaId: string | null; failMessage: string | null; taskId: string | null;
  };
}) {
  const st = GENERATION_STATUS[g.status];
  const ready = g.status === 'success' && g.mediaId;

  return (
    <div className="mx-auto w-full">
      <div className="mb-1 flex items-center gap-2">
        <Badge variant="outline" className="text-[10px]">картинка</Badge>
        <span className="text-muted-foreground text-xs">{dateTime(g.createdAt)}</span>
        {!ready && st ? (
          <Badge variant={st.tone === 'bad' ? 'destructive' : 'outline'} className="text-[10px]">
            {st.label}
          </Badge>
        ) : null}
        {g.taskId ? <Badge variant="secondary" className="text-[10px]">по заданию</Badge> : null}
      </div>

      <Link
        href={`/generations/${g.id}`}
        className="focus-visible:ring-ring hover:bg-muted/50 flex gap-3 rounded-lg border border-l-2 border-l-foreground/30 p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <div className="bg-muted h-28 w-28 shrink-0 overflow-hidden rounded border">
          {ready ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/media/${g.mediaId}`} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
              {g.status === 'failed' || g.status === 'refunded' ? 'нет' : '…'}
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          {g.caption ? <p className="text-sm break-words">{g.caption}</p> : null}
          <p className="text-muted-foreground text-xs break-words">
            просил: {g.userPrompt}
          </p>
          {g.failMessage ? (
            <p className="text-destructive text-xs break-words">{g.failMessage}</p>
          ) : null}
        </div>
      </Link>
    </div>
  );
}

export default async function DialogPage({ params }: PageProps<'/dialogs/[id]'>) {
  const { id } = await params;
  const data = await conversationThread(id);
  if (!data) notFound();

  const { conversation: c, messages, generations } = data;
  // Живое обновление дописывает сообщения снизу — следуем за ними.
  const followKey = messages.length + messages.reduce((n, m) => n + m.calls.length, 0) + generations.length;
  const totalTools = messages.reduce((n, m) => n + m.calls.length, 0);

  // Сообщения и картинки идут одной лентой по времени: результат должен
  // стоять там, где его попросили, иначе по переписке не понять, что
  // участник в итоге увидел.
  type Event =
    | { kind: 'message'; at: Date; message: (typeof messages)[number] }
    | { kind: 'generation'; at: Date; generation: (typeof generations)[number] };
  const events: Event[] = [
    ...messages.map((m): Event => ({ kind: 'message', at: m.createdAt, message: m })),
    ...generations.map((g): Event => ({ kind: 'generation', at: g.createdAt, generation: g })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="space-y-6">
      <FollowNewMessages count={followKey} />
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{userLabel(c)}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {dateTime(c.startedAt)} — {dateTime(c.lastMessageAt)} · {messages.length} сообщений ·
            {' '}{totalTools} вызовов инструментов · {generations.length} картинок
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/users/${c.userId}`}><UserIcon />Карточка участника</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dialogs"><ArrowLeftIcon />Ко всем диалогам</Link>
          </Button>
        </div>
      </div>

      {/* Колонка по центру: слева она смотрелась приклеенной к краю,
          а справа висела пустота во весь экран. */}
      <div className="mx-auto w-full max-w-4xl space-y-4">
        {events.map((e) => {
          if (e.kind === 'generation') return <GenerationCard key={`g-${e.generation.id}`} g={e.generation} />;
          const m = e.message;
          const mine = m.role === 'assistant';
          const images = attachedImages(m.contentJson);
          return (
            // Одна колонка, без раскидывания по краям: в переписке важно
            // читать подряд, а зеркальные отступы рвут глазу строку.
            <div key={m.id}>
              <div className="mb-1 flex items-center gap-2">
                <Badge variant={mine ? 'secondary' : 'outline'} className="text-[10px]">
                  {mine ? 'агент' : 'участник'}
                </Badge>
                <span className="text-muted-foreground text-xs">{dateTime(m.createdAt)}</span>
                {m.inputTokens != null ? (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {m.inputTokens}→{m.outputTokens} токенов
                  </span>
                ) : null}
              </div>

              {/* Кто говорит, различаем фоном и полоской слева, а не
                  положением на странице. */}
              <div className={`rounded-lg border border-l-2 px-4 py-3 ${
                mine ? 'bg-muted/40 border-l-foreground/30' : 'bg-background border-l-border'
              }`}>
                {images.length ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {images.map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={u} src={u} alt="" className="h-28 w-28 rounded border object-cover" />
                    ))}
                  </div>
                ) : null}
                <p className="text-sm break-words whitespace-pre-wrap">{m.text || <span className="text-muted-foreground">— пусто —</span>}</p>
              </div>

              {m.calls.length ? (
                <div className="mt-2 space-y-1.5">
                  {m.calls.map((call) => (
                    <ToolCall
                      key={call.id}
                      toolName={call.toolName}
                      input={call.input}
                      output={call.output}
                      ok={call.ok}
                      errorMessage={call.errorMessage}
                      durationMs={call.durationMs}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
