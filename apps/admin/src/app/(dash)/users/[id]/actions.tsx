'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/**
 * Действия над участником: правка баланса и бан.
 *
 * Никаких `confirm()` — требование заказчика. Разрушающее действие идёт
 * через AlertDialog с явным именем участника, чтобы нельзя было забанить
 * не того (правило 30-admin-ui).
 */
export function UserActions({ userId, name, balance, isBanned }: {
  userId: string; name: string; balance: number; isBanned: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body: unknown, okText: string) {
    const res = await fetch(`/api/users/${userId}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !json?.ok) {
      toast.error(json?.error ?? 'Не получилось. Попробуйте ещё раз.');
      return false;
    }
    toast.success(okText);
    start(() => router.refresh());
    return true;
  }

  function submitTokens(sign: 1 | -1) {
    // Валидация своя, не браузерная: всплывашка браузера здесь запрещена.
    const n = Number(amount.replace(',', '.'));
    if (!amount.trim()) return setError('Укажите количество');
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      return setError('Нужно целое число больше нуля');
    }
    if (sign === -1 && n > balance) return setError(`У участника всего ${balance}`);
    setError(null);
    void call('tokens', { delta: sign * n }, sign > 0 ? `Начислено ${n}` : `Списано ${n}`)
      .then((ok) => { if (ok) setAmount(''); });
  }

  return (
    <div className="space-y-4">
      <form
        noValidate
        onSubmit={(e) => { e.preventDefault(); submitTokens(1); }}
        className="space-y-2"
      >
        <Label htmlFor="amount">Изменить баланс</Label>
        <div className="flex gap-2">
          <Input
            id="amount"
            inputMode="numeric"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null); }}
            placeholder="сколько токенов"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'amount-error' : undefined}
          />
          <Button type="submit" disabled={pending}>Начислить</Button>
          <Button type="button" variant="outline" disabled={pending}
                  onClick={() => submitTokens(-1)}>
            Списать
          </Button>
        </div>
        {error ? (
          <p id="amount-error" className="text-destructive text-sm">{error}</p>
        ) : null}
      </form>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant={isBanned ? 'outline' : 'destructive'} disabled={pending}>
            {isBanned ? 'Снять бан' : 'Забанить'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isBanned ? `Вернуть доступ: ${name}?` : `Закрыть доступ: ${name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isBanned
                ? 'Участник снова сможет писать боту и делать картинки.'
                : 'Бот перестанет отвечать этому участнику. Действие обратимо.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void call('ban', { banned: !isBanned },
                isBanned ? 'Доступ возвращён' : 'Доступ закрыт')}
            >
              {isBanned ? 'Снять бан' : 'Забанить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
