'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';

const schema = z.object({
  login: z.string().min(1, 'Введите логин'),
  password: z.string().min(1, 'Введите пароль'),
});
type Values = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { login: '', password: '' },
  });

  async function onSubmit(values: Values) {
    setFormError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };

    if (!data.ok) {
      setFormError(data.error ?? 'Не удалось войти');
      form.setValue('password', '');
      return;
    }
    router.replace('/');
    router.refresh();
  }

  const { errors, isSubmitting } = form.formState;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>MQ Bot</CardTitle>
        <CardDescription>Вход в панель управления</CardDescription>
      </CardHeader>

      {/* noValidate — обязательно: браузерная валидация запрещена правилами проекта */}
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CardContent>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive" data-testid="login-error">
                <AlertTitle>Не удалось войти</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <Field data-invalid={errors.login ? true : undefined}>
              <FieldLabel htmlFor="login">Логин</FieldLabel>
              <Input
                id="login"
                autoComplete="username"
                aria-invalid={errors.login ? true : undefined}
                {...form.register('login')}
              />
              {errors.login ? <FieldError>{errors.login.message}</FieldError> : null}
            </Field>

            <Field data-invalid={errors.password ? true : undefined}>
              <FieldLabel htmlFor="password">Пароль</FieldLabel>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={errors.password ? true : undefined}
                {...form.register('password')}
              />
              {errors.password ? <FieldError>{errors.password.message}</FieldError> : null}
            </Field>
          </FieldGroup>
        </CardContent>

        <CardFooter>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            Войти
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
