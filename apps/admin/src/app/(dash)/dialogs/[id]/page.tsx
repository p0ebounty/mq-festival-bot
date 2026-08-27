import Link from 'next/link';
import { notFound } from 'next/navigation';
import { conversationThread } from '@/lib/queries';
import { ToolCall } from '@/components/tool-call';
import { FollowNewMessages } from './follow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeftIcon, UserIcon } from 'lucide-react';
import { dateTime, userLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Картинки, приложенные к сообщению участника. */
function attachedImages(contentJson: unknown): string[] {
  const urls = (contentJson as { imageUrls?: unknown } | null)?.imageUrls;
  return Array.isArray(urls) ? urls.filter((u): u is string => typeof u === 'string') : [];
}

export default async function DialogPage({ params }: PageProps<'/dialogs/[id]'>) {
  const { id } = await params;
  const data = await conversationThread(id);
  if (!data) notFound();

  const { conversation: c, messages } = data;
  // Живое обновление дописывает сообщения снизу — следуем за ними.
  const followKey = messages.length + messages.reduce((n, m) => n + m.calls.length, 0);
  const totalTools = messages.reduce((n, m) => n + m.calls.length, 0);

  return (
    <div className="space-y-6">
      <FollowNewMessages count={followKey} />
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{userLabel(c)}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {dateTime(c.startedAt)} — {dateTime(c.lastMessageAt)} · {messages.length} сообщений ·
            {' '}{totalTools} вызовов инструментов
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
        {messages.map((m) => {
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
