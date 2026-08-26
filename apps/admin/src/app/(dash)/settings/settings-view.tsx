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
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';

type SettingRow = { key: string; value: string | null; isSecret: boolean; hasValue: boolean };

type Props = { initial: Record<string, SettingRow> };

type KeyCheck = { state: 'idle' | 'checking' | 'ok' | 'fail'; message?: string; credits?: number };

export function SettingsView({ initial }: Props) {
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
          Меняются на лету — перезапуск сервисов не нужен.
        </p>
      </div>

      <Tabs defaultValue="provider">
        <TabsList>
          <TabsTrigger value="provider">Провайдер</TabsTrigger>
          <TabsTrigger value="economy">Экономика</TabsTrigger>
          <TabsTrigger value="limits">Лимиты</TabsTrigger>
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
                  Один ключ обслуживает и мозг агента, и генерацию картинок.
                  Полное значение никогда не отображается и не покидает сервер.
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
                      «Проверить ключ» запрашивает остаток кредитов у kie.ai — это подтверждает,
                      что ключ рабочий.
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
                <CardTitle>Модели</CardTitle>
                <CardDescription>Что используется для диалога и для картинок.</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <TextSetting
                    id="chat-model" label="Модель агента" settingKey="kie.chatModel"
                    rows={rows} onSave={save} saving={saving}
                  />
                  <TextSetting
                    id="image-model" label="Модель генерации картинок" settingKey="kie.imageModel"
                    rows={rows} onSave={save} saving={saving}
                  />
                  <Field>
                    <FieldLabel htmlFor="resolution">Разрешение</FieldLabel>
                    <Select
                      value={rows['kie.imageResolution']?.value ?? '1K'}
                      onValueChange={(v) => save('kie.imageResolution', v)}
                    >
                      <SelectTrigger id="resolution" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="1K">1K — быстро</SelectItem>
                          <SelectItem value="2K">2K</SelectItem>
                          <SelectItem value="4K">4K — медленно</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      На фестивале важна скорость — 1K обычно достаточно.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ───────────── Экономика ───────────── */}
        <TabsContent value="economy">
          <Card>
            <CardHeader>
              <CardTitle>Токены участников</CardTitle>
              <CardDescription>
                Значения по умолчанию — предположение, подтвердите с заказчиком.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <TextSetting id="start-balance" label="Стартовый баланс" settingKey="economy.startBalance"
                  rows={rows} onSave={save} saving={saving} numeric
                  hint="Сколько токенов получает участник при первом обращении." />
                <TextSetting id="cost-image" label="Цена генерации" settingKey="economy.costPerImage"
                  rows={rows} onSave={save} saving={saving} numeric
                  hint="Списывается до постановки задачи; при ошибке возвращается." />
                <TextSetting id="social-bonus" label="Бонус за репост" settingKey="economy.socialBonus"
                  rows={rows} onSave={save} saving={saving} numeric
                  hint="Начисляется после проверки скриншота публикации." />
              </FieldGroup>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────── Лимиты ───────────── */}
        <TabsContent value="limits">
          <Card>
            <CardHeader>
              <CardTitle>Лимиты и агент</CardTitle>
              <CardDescription>Защита от перегрузки на пике фестиваля.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <TextSetting id="per-hour" label="Генераций в час на участника" settingKey="limits.perHour"
                  rows={rows} onSave={save} saving={saving} numeric />
                <TextSetting id="concurrent" label="Одновременных генераций" settingKey="limits.concurrent"
                  rows={rows} onSave={save} saving={saving} numeric />
                <TextSetting id="max-iter" label="Лимит итераций tool-use" settingKey="agent.maxToolIterations"
                  rows={rows} onSave={save} saving={saving} numeric
                  hint="Сколько раз агент может вызвать инструменты за один ответ." />
                <TextSetting id="history" label="Сообщений в контексте" settingKey="agent.historyMessages"
                  rows={rows} onSave={save} saving={saving} numeric />
                <TextSetting id="retention" label="Хранить медиа, дней" settingKey="media.retentionDays"
                  rows={rows} onSave={save} saving={saving} numeric />
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
