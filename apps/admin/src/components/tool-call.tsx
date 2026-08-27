'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';

interface Props {
  toolName: string;
  input: unknown;
  output: unknown;
  ok: boolean | null;
  errorMessage: string | null;
  durationMs: number | null;
}

/**
 * Вызов инструмента с раскрытием.
 *
 * Ради этого блока админка и затевалась: понять, почему бот сделал не то,
 * можно только увидев, что именно он передал инструменту и что получил
 * обратно. Свёрнут по умолчанию — в диалоге вызовов десятки, и развёрнутые
 * они хоронят переписку.
 */
export function ToolCall({ toolName, input, output, ok, errorMessage, durationMs }: Props) {
  const [open, setOpen] = useState(false);
  const args = summarize(input);

  return (
    <div className="border-border/60 bg-muted/30 rounded-md border text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open
          ? <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
          : <ChevronRightIcon className="text-muted-foreground size-3.5 shrink-0" />}
        <code className="font-mono text-xs font-medium">{toolName}</code>
        <Badge variant={ok === false ? 'destructive' : 'secondary'} className="shrink-0">
          {ok === false ? 'ошибка' : 'ок'}
        </Badge>
        {!open && args ? (
          <span className="text-muted-foreground truncate text-xs">{args}</span>
        ) : null}
        <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
          {durationMs != null ? `${durationMs} мс` : ''}
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t px-3 py-3">
          <Block label="Аргументы" value={input} />
          <Block label="Результат" value={output} />
          {errorMessage ? (
            <div>
              <p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">Ошибка</p>
              <p className="text-destructive font-mono text-xs break-all">{errorMessage}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Block({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">{label}</p>
      <pre className="bg-background overflow-x-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap">
        {value == null ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/** Короткая выжимка аргументов для свёрнутого вида. */
function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    parts.push(`${k}: ${String(v).slice(0, 60)}`);
    if (parts.length >= 2) break;
  }
  return parts.join(' · ');
}
