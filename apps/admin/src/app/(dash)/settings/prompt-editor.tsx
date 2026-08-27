'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface Version {
  id: string;
  note: string | null;
  createdAt: string;
  adminLogin: string | null;
  length: number;
}

interface Data {
  current: string;
  isDefault: boolean;
  defaultPrompt: string;
  versions: Version[];
}

/**
 * Редактор системного промпта с историей и откатом.
 *
 * Промпт — это характер бота, и правят его прямо на фестивале. Неудачная
 * правка ломает не одну страницу, а все ответы сразу, поэтому старая версия
 * сохраняется автоматически перед каждой записью.
 */
export function PromptEditor() {
  const [data, setData] = useState<Data | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const [reloads, setReloads] = useState(0);
  /** Перезагрузка = смена ключа эффекта, а не прямой вызов setState из него. */
  const load = () => setReloads((n) => n + 1);

  useEffect(() => {
    // Отменяем запись состояния, если компонент размонтировали или запрос
    // устарел: иначе поздний ответ затрёт свежие правки в поле.
    let stale = false;
    void (async () => {
      try {
        const res = await fetch('/api/prompt');
        const json = (await res.json()) as { ok: boolean } & Data;
        if (!json.ok) throw new Error('bad');
        if (stale) return;
        setData(json);
        setValue(json.current);
        setFailed(false);
      } catch {
        if (!stale) setFailed(true);
      }
    })();
    return () => { stale = true; };
  }, [reloads]);

  async function save() {
    setSaving(true);
    const res = await fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    setSaving(false);
    if (!res.ok) return toast.error('Не сохранилось. Попробуйте ещё раз.');
    toast.success('Промпт сохранён — применится со следующего сообщения');
    load();
  }

  async function rollback(versionId: string) {
    const res = await fetch('/api/prompt/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId }),
    });
    if (!res.ok) return toast.error('Откат не прошёл');
    toast.success('Вернули прошлую версию');
    load();
  }

  // Ошибка сети — понятный блок с кнопкой, а не белый экран (30-admin-ui).
  if (failed) {
    return (
      <div className="border-destructive/40 space-y-3 rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm">Не удалось загрузить промпт.</p>
        <Button variant="outline" onClick={load}>Повторить</Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const dirty = value !== data.current;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {data.isDefault ? (
          <Badge variant="outline">сейчас работает промпт из кода</Badge>
        ) : (
          <Badge variant="secondary">промпт переопределён в админке</Badge>
        )}
        <span className="text-muted-foreground text-xs tabular-nums">
          {value.length} символов
        </span>
      </div>

      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={22}
        spellCheck={false}
        aria-label="Системный промпт агента"
        className="font-mono text-xs leading-relaxed"
      />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </Button>
        <Button variant="outline" disabled={!dirty} onClick={() => setValue(data.current)}>
          Отменить правки
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="ml-auto">Вернуть промпт из кода</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Вернуть промпт по умолчанию?</AlertDialogTitle>
              <AlertDialogDescription>
                В поле подставится текст из кода. Текущая версия сохранится в истории,
                вернуться к ней можно будет одним нажатием.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction onClick={() => setValue(data.defaultPrompt)}>
                Подставить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div>
        <p className="text-muted-foreground mb-2 text-xs tracking-wide uppercase">
          История версий
        </p>
        {data.versions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Пока пусто. Прошлая версия сохранится автоматически при первом сохранении.
          </p>
        ) : (
          <div className="divide-border divide-y rounded-lg border">
            {data.versions.map((v) => (
              <div key={v.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="text-muted-foreground tabular-nums">
                  {new Date(v.createdAt).toLocaleString('ru-RU', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                <span className="text-muted-foreground text-xs">{v.adminLogin ?? '—'}</span>
                <span className="text-muted-foreground text-xs tabular-nums">{v.length} симв.</span>
                {v.note ? <span className="text-muted-foreground text-xs">{v.note}</span> : null}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="ml-auto">Вернуть</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Откатиться к версии от {new Date(v.createdAt).toLocaleString('ru-RU')}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Бот начнёт отвечать по ней со следующего сообщения. Текущая версия
                        сохранится в истории.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void rollback(v.id)}>
                        Откатиться
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
