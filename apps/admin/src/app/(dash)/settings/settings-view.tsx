'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2Icon, KeyRoundIcon, XCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';

type SettingRow = { key: string; value: string | null; isSecret: boolean; hasValue: boolean };

type RouteChain = {
  task: string;
  label: string;
  chain: Array<{ id: string; label: string; cost: number; notes: string }>;
};

type Props = { initial: Record<string, SettingRow>; routes: RouteChain[] };

type KeyCheck = { state: 'idle' | 'checking' | 'ok' | 'fail'; message?: string; credits?: number };

export function SettingsView({ initial, routes }: Props) {
  const [rows, setRows] = useState(initial);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [check, setCheck] = useState<KeyCheck>({ state: 'idle' });
  const [saving, setSaving] = useState<string | null>(null);

  const keyRow = rows['kie.apiKey'];
  const keyIsSet = keyRow?.hasValue ?? false;

  async function save(key: string, value: string) {
    setSaving(key);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        toast.error('Не сохранено', { description: data.error });
        return false;
      }
      setRows((prev) => ({
        ...prev,
        [key]: { ...(prev[key] as SettingRow), value: prev[key]?.isSecret ? null : value, hasValue: Boolean(value) },
      }));
      toast.success('Сохранено');
      return true;
    } finally {
      setSaving(null);
    }
  }

  async function testKey(explicit?: string) {
    setCheck({ state: 'checking' });
    const res = await fetch('/api/settings/test-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(explicit ? { key: explicit } : {}),
    });
    const data = (await res.json()) as { ok: boolean; credits?: number; error?: string };
    setCheck(
      data.ok
        ? { state: 'ok', credits: data.credits }
        : { state: 'fail', message: data.error ?? 'Ключ не прошёл проверку' },
    );
  }

  async function saveApiKey() {
    if (!apiKeyDraft.trim()) {
      toast.error('Введите ключ');
      return;
    }
    if (await save('kie.apiKey', apiKeyDraft.trim())) {
      setApiKeyDraft('');
      await testKey();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Настройки</h1>
        <p className="text-muted-foreground text-sm">
          Применяются сразу, без перезапуска.
        </p>
      </div>

      <Tabs defaultValue="provider">
        <TabsList>
          <TabsTrigger value="provider">Провайдер</TabsTrigger>
          <TabsTrigger value="economy">Экономика</TabsTrigger>
          <TabsTrigger value="limits">Лимиты</TabsTrigger>
          <TabsTrigger value="share">Шаринг</TabsTrigger>
        </TabsList>

        {/* ───────────── Провайдер ───────────── */}
        <TabsContent value="provider">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRoundIcon className="size-4" />
                  Ключ kie.ai
                  {keyIsSet ? (
                    <Badge variant="secondary">задан</Badge>
                  ) : (
                    <Badge variant="destructive">не задан</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Один ключ на агента и картинки. Полное значение не показывается.
                </CardDescription>
              </CardHeader>

              <CardContent>
                <FieldGroup>
                  {!keyIsSet ? (
                    <Alert>
                      <AlertTitle>Ключ ещё не введён</AlertTitle>
                      <AlertDescription>
                        Возьмите ключ на{' '}
                        <a
                          href="https://kie.ai/api-key"
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline underline-offset-4"
                        >
                          kie.ai/api-key
                        </a>{' '}
                        и вставьте сюда. Без него бот не сможет ни отвечать, ни рисовать.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <Field>
                    <FieldLabel htmlFor="kie-key">
                      {keyIsSet ? 'Заменить ключ' : 'API-ключ'}
                    </FieldLabel>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="kie-key"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={keyIsSet ? 'Введите новый ключ, чтобы заменить' : 'вставьте ключ kie.ai'}
                        value={apiKeyDraft}
                        onChange={(e) => setApiKeyDraft(e.target.value)}
                        className="font-mono"
                      />
                      <div className="flex gap-2">
                        <Button onClick={saveApiKey} disabled={saving === 'kie.apiKey'}>
                          {saving === 'kie.apiKey' ? <Spinner data-icon="inline-start" /> : null}
                          Сохранить
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => testKey(apiKeyDraft.trim() || undefined)}
                          disabled={check.state === 'checking' || (!keyIsSet && !apiKeyDraft.trim())}
                        >
                          {check.state === 'checking' ? <Spinner data-icon="inline-start" /> : null}
                          Проверить ключ
                        </Button>
                      </div>
                    </div>
                    <FieldDescription>
                      Проверка запрашивает у kie.ai остаток кредитов.
                    </FieldDescription>
                  </Field>

                  {check.state === 'ok' ? (
                    <Alert data-testid="key-check-ok">
                      <CheckCircle2Icon />
                      <AlertTitle>Ключ рабочий</AlertTitle>
                      <AlertDescription>Остаток кредитов: {check.credits}</AlertDescription>
                    </Alert>
                  ) : null}

                  {check.state === 'fail' ? (
                    <Alert variant="destructive" data-testid="key-check-fail">
                      <XCircleIcon />
                      <AlertTitle>Ключ не прошёл проверку</AlertTitle>
                      <AlertDescription>{check.message}</AlertDescription>
                    </Alert>
                  ) : null}

                </FieldGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Модель агента</CardTitle>
                <CardDescription>
                  Ведёт диалог, вызывает инструменты и проверяет контент. Картинки
                  всегда рисует kie.ai, а текстовая модель может жить у другого
                  провайдера: укажите его URL и ключ.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <TextSetting
                    id="chat-model" label="Модель" settingKey="kie.chatModel"
                    rows={rows} onSave={save} saving={saving}
                    hint="На kie.ai: gemini-3-pro или gpt-5-5. У прямого провайдера — его имя модели: gpt-4.1 у OpenAI, openai/gpt-4.1 у OpenRouter. Проверка контента идёт этой же моделью."
                  />
                  <TextSetting
                    id="chat-base-url" label="URL провайдера" settingKey="chat.baseUrl"
                    rows={rows} onSave={save} saving={saving}
                    hint="Пусто — текст через kie.ai. Прямой провайдер: https://api.openai.com/v1 или https://openrouter.ai/api/v1."
                  />
                  <SecretSetting
                    id="chat-api-key" label="Ключ провайдера" settingKey="chat.apiKey"
                    rows={rows} onSave={save} saving={saving}
                    hint="Нужен только для прямого провайдера. Хранится зашифрованным, полное значение не показывается."
                  />
                </FieldGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Модели генерации картинок</CardTitle>
                <CardDescription>
                  Заданы в коде, здесь не меняются. Первая в цепочке — основная,
                  дальше запасные.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-5">
                  {routes.map((r) => (
                    <div key={r.task} className="flex flex-col gap-2">
                      <div className="text-sm font-medium">{r.label}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        {r.chain.map((m, i) => (
                          <span key={m.id} className="flex items-center gap-2">
                            {i > 0 ? (
                              <span className="text-muted-foreground text-xs">→</span>
                            ) : null}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant={i === 0 ? 'default' : 'outline'} className="cursor-default">
                                  {m.label}
                                  <span className="ml-1.5 font-mono text-[10px] opacity-70">
                                    ${m.cost.toFixed(3)}
                                  </span>
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">{m.notes}</TooltipContent>
                            </Tooltip>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  <Separator />
                  <p className="text-muted-foreground text-xs">
                    Цена за изображение, стандартное качество.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ───────────── Экономика ───────────── */}
        <TabsContent value="economy">
          <Card>
            <CardHeader>
              <CardTitle>Токены участников</CardTitle>
              <CardDescription>Значения по умолчанию не согласованы с заказчиком.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <TextSetting id="start-balance" label="Стартовый баланс" settingKey="economy.startBalance"
                  rows={rows} onSave={save} saving={saving} numeric
                  hint="Токенов при первом обращении." />
                <TextSetting id="cost-image" label="Цена генерации" settingKey="economy.costPerImage"
                  rows={rows} onSave={save} saving={saving} numeric
                  hint="Списывается до задачи, при ошибке возвращается." />
                <TextSetting id="social-bonus" label="Бонус за репост" settingKey="economy.socialBonus"
                  rows={rows} onSave={save} saving={saving} numeric
                  hint="Начисляется после проверки публикации." />
                <TextSetting id="weak-limit" label="Лимит слабых подтверждений" settingKey="economy.weakProofLimit"
                  rows={rows} onSave={save} saving={saving} numeric
                  hint="Бонусов по слабому доказательству на участника. 0 — только точное совпадение." />
              </FieldGroup>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────── Лимиты ───────────── */}
        <TabsContent value="limits">
          <Card>
            <CardHeader>
              <CardTitle>Лимиты и агент</CardTitle>
              <CardDescription>Защита от перегрузки.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <TextSetting id="per-hour" label="Генераций в час на участника" settingKey="limits.perHour"
                  rows={rows} onSave={save} saving={saving} numeric />
                <TextSetting id="concurrent" label="Одновременных генераций" settingKey="limits.concurrent"
                  rows={rows} onSave={save} saving={saving} numeric />
                <TextSetting id="max-iter" label="Лимит итераций tool-use" settingKey="agent.maxToolIterations"
                  rows={rows} onSave={save} saving={saving} numeric
                  hint="Вызовов инструментов за один ответ." />
                <TextSetting id="history" label="Сообщений в контексте" settingKey="agent.historyMessages"
                  rows={rows} onSave={save} saving={saving} numeric />
                <TextSetting id="images-ctx" label="Картинок в контексте" settingKey="agent.imagesInContext"
                  rows={rows} onSave={save} saving={saving} numeric
                  hint="Картинок диалога в запросе. Одна — 1,5–6 тыс. входных токенов." />
                <TextSetting id="retention" label="Хранить медиа, дней" settingKey="media.retentionDays"
                  rows={rows} onSave={save} saving={saving} numeric />
              </FieldGroup>
            </CardContent>
          </Card>
        </TabsContent>
        {/* ───────────── Шаринг ───────────── */}
        <TabsContent value="share">
          <Card>
            <CardHeader>
              <CardTitle>Страница результата и репосты</CardTitle>
              <CardDescription>
                Видны на странице по QR-коду. С заказчиком не согласованы.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <TextSetting id="hashtags" label="Хештеги для репоста" settingKey="share.hashtags"
                  rows={rows} onSave={save} saving={saving}
                  hint="Показываются участнику, на проверку не влияют." />
              </FieldGroup>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}

function TextSetting({
  id, label, settingKey, rows, onSave, saving, numeric, hint,
}: {
  id: string;
  label: string;
  settingKey: string;
  rows: Record<string, SettingRow>;
  onSave: (key: string, value: string) => Promise<boolean>;
  saving: string | null;
  numeric?: boolean;
  hint?: string;
}) {
  const [draft, setDraft] = useState(rows[settingKey]?.value ?? '');
  const dirty = draft !== (rows[settingKey]?.value ?? '');

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input
          id={id}
          // inputMode вместо type="number": нативные стрелки и браузерная
          // валидация числа запрещены правилами проекта.
          inputMode={numeric ? 'numeric' : 'text'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={numeric ? 'w-32 font-mono' : ''}
        />
        <Button
          variant="outline"
          disabled={!dirty || saving === settingKey}
          onClick={() => onSave(settingKey, draft)}
        >
          {saving === settingKey ? <Spinner data-icon="inline-start" /> : null}
          Сохранить
        </Button>
      </div>
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}

/**
 * Секретное поле: значение не показывается, только признак «задан».
 * Ввод — как у ключа kie.ai: password и без автозаполнения.
 */
function SecretSetting({
  id, label, settingKey, rows, onSave, saving, hint,
}: {
  id: string;
  label: string;
  settingKey: string;
  rows: Record<string, SettingRow>;
  onSave: (key: string, value: string) => Promise<boolean>;
  saving: string | null;
  hint?: string;
}) {
  const [draft, setDraft] = useState('');
  const isSet = rows[settingKey]?.hasValue ?? false;

  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}{' '}
        <Badge variant={isSet ? 'secondary' : 'outline'}>{isSet ? 'задан' : 'не задан'}</Badge>
      </FieldLabel>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={isSet ? 'Введите новый ключ, чтобы заменить' : 'вставьте ключ провайдера'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="font-mono"
        />
        <Button
          variant="outline"
          disabled={!draft.trim() || saving === settingKey}
          onClick={async () => { if (await onSave(settingKey, draft.trim())) setDraft(''); }}
        >
          {saving === settingKey ? <Spinner data-icon="inline-start" /> : null}
          Сохранить
        </Button>
      </div>
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}
