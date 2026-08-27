import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Вход — MQ Bot' };

export default async function LoginPage() {
  if (await getCurrentAdmin()) redirect('/');
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <LoginForm />
    </main>
  );
}
